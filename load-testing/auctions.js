import http from "k6/http";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";

const base = __ENV.BASE_URL || "http://127.0.0.1:8080";
const errors = new Rate("auction_errors");
const bids = new Counter("bids_submitted");
export const options = {
  scenarios: {
    browse: { executor: "ramping-vus", startVUs: 1, stages: [{ duration: "30s", target: 10 }, { duration: "1m", target: 10 }, { duration: "15s", target: 0 }], exec: "browse" },
    realtime: { executor: "constant-vus", vus: 2, duration: "1m", exec: "realtime" }
  },
  thresholds: { http_req_failed: ["rate<0.02"], http_req_duration: ["p(95)<500"], auction_errors: ["rate<0.02"] }
};
const params = { headers: { Accept: "application/json", ...( __ENV.AUTH_COOKIE ? { Cookie: __ENV.AUTH_COOKIE } : {}) } };
export function browse() {
  const response = http.get(`${base}/api/auctions`, params);
  const ok = check(response, { "auction list succeeds": (r) => r.status === 200, "returns JSON": (r) => r.headers["Content-Type"]?.includes("json") });
  errors.add(!ok);
  if (ok) {
    const auctions = response.json();
    if (auctions.length && __ENV.PLACE_BIDS === "true") {
      const auction = auctions[Math.floor(Math.random() * auctions.length)];
      const bid = http.post(`${base}/api/auctions/${auction.id}/bids`, JSON.stringify({ amount: Number(auction.currentPrice) + 1 }), { ...params, headers: { ...params.headers, "Content-Type": "application/json" } });
      const accepted = check(bid, { "bid accepted": (r) => r.status === 201 || r.status === 200 });
      errors.add(!accepted); if (accepted) bids.add(1);
    }
  }
  sleep(Math.random() * 2 + 1);
}
export function realtime() {
  const response = http.get(`${base}/api/auctions`, params);
  if (!check(response, { "can discover auction": (r) => r.status === 200 })) { errors.add(true); return; }
  const auctions = response.json();
  if (!auctions.length) return;
  const endpoint = base.replace(/^http/, "ws") + `/ws/auctions/${encodeURIComponent(auctions[0].id)}`;
  const result = ws.connect(endpoint, params, (socket) => { socket.setTimeout(() => socket.close(), 20000); socket.on("message", () => {}); });
  errors.add(!check(result, { "websocket connects": (r) => r && r.status === 101 }));
}
