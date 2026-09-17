import type { Auction, Bid } from "./types";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...init?.headers }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const auctionApi = {
  list: (signal?: AbortSignal) => request<Auction[]>("/auctions", { signal }),
  get: (id: string, signal?: AbortSignal) => request<Auction>(`/auctions/${encodeURIComponent(id)}`, { signal }),
  bids: (id: string, signal?: AbortSignal) =>
    request<Bid[]>(`/auctions/${encodeURIComponent(id)}/bids`, { signal }),
  placeBid: (id: string, amount: number) =>
    request<Bid>(`/auctions/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ amount })
    })
};
