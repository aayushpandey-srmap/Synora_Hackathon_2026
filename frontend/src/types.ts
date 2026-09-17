export type AuctionStatus = "scheduled" | "live" | "ended";

export interface Auction {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  startingPrice: number;
  currentPrice: number;
  currency: string;
  endsAt: string;
  status: AuctionStatus;
  bidCount: number;
}

export interface Bid {
  id: string;
  auctionId: string;
  bidderId?: string;
  amount: number;
  createdAt: string;
}

export interface ApiError {
  message: string;
  code?: string;
}

export type AuctionEvent =
  | { type: "bid.created"; auctionId: string; bid: Bid }
  | { type: "auction.updated"; auction: Auction }
  | { type: "auction.ended"; auctionId: string; endedAt: string };
