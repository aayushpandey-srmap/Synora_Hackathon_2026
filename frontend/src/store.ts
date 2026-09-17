import { create } from "zustand";
import { auctionApi } from "./api";
import type { Auction, Bid } from "./types";

interface AuctionState {
  auctions: Auction[];
  selected?: Auction;
  bids: Bid[];
  loading: boolean;
  error?: string;
  load: () => Promise<void>;
  select: (auction: Auction) => Promise<void>;
  applyBid: (bid: Bid) => void;
}

export const useAuctionStore = create<AuctionState>((set, get) => ({
  auctions: [],
  bids: [],
  loading: false,
  load: async () => {
    set({ loading: true, error: undefined });
    try {
      set({ auctions: await auctionApi.list(), loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to load auctions", loading: false });
    }
  },
  select: async (auction) => {
    set({ selected: auction, bids: [], error: undefined });
    try {
      set({ bids: await auctionApi.bids(auction.id) });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to load bids" });
    }
  },
  applyBid: (bid) => {
    const { auctions, selected } = get();
    if (get().bids.some((existing) => existing.id === bid.id)) return;
    const updated = auctions.map((auction) =>
      auction.id === bid.auctionId
        ? { ...auction, currentPrice: bid.amount, bidCount: auction.bidCount + 1 }
        : auction
    );
    set({ auctions: updated, selected: selected?.id === bid.auctionId ? updated.find((a) => a.id === bid.auctionId) : selected, bids: [bid, ...get().bids] });
  }
}));
