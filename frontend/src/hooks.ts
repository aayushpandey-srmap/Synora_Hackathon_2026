import { useEffect, useRef } from "react";
import { useAuctionStore } from "./store";
import type { AuctionEvent } from "./types";

export function useAuctions() {
  const { auctions, loading, error, load } = useAuctionStore();
  useEffect(() => void load(), [load]);
  return { auctions, loading, error };
}

export function useAuctionEvents(auctionId?: string) {
  const applyBid = useAuctionStore((state) => state.applyBid);
  const load = useAuctionStore((state) => state.load);
  const socket = useRef<WebSocket | undefined>(undefined);

  useEffect(() => {
    if (!auctionId) return;
    const base = (import.meta.env.VITE_WS_URL as string | undefined) ??
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
    const ws = new WebSocket(`${base.replace(/\/$/, "")}/ws`);
    socket.current = ws;
    ws.onopen = () => {
      const token = sessionStorage.getItem("auction_token");
      if (token) ws.send(JSON.stringify({ type: "auth", token }));
    };
    ws.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as AuctionEvent;
        if (event.type === "bid.created") applyBid(event.bid);
        if (event.type === "auction.updated") void load();
      } catch { /* Ignore malformed server messages. */ }
    };
    return () => { ws.close(1000, "navigation"); socket.current = undefined; };
  }, [auctionId, applyBid, load]);
}
