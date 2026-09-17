import { useState } from "react";
import { auctionApi } from "./api";
import { useAuctionEvents, useAuctions } from "./hooks";
import { useAuctionStore } from "./store";
import type { Auction } from "./types";
import "./styles.css";

const money = (amount: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);

function Detail({ auction }: { auction: Auction }) {
  const { bids, error, applyBid } = useAuctionStore();
  const [amount, setAmount] = useState(String(auction.currentPrice + 1));
  const [message, setMessage] = useState("");
  useAuctionEvents(auction.id);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    try { applyBid(await auctionApi.placeBid(auction.id, Number(amount))); setMessage("Bid placed."); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Bid failed."); }
  }
  return <aside className="detail">
    <button className="close" onClick={() => useAuctionStore.setState({ selected: undefined })} aria-label="Close">×</button>
    <p className="eyebrow">{auction.status}</p><h2>{auction.title}</h2>
    <p>{auction.description ?? "No description provided."}</p>
    <strong className="price">{money(auction.currentPrice, auction.currency)}</strong>
    <form onSubmit={submit}><label htmlFor="amount">Your maximum bid</label><div className="bid-row"><input id="amount" type="number" min={auction.currentPrice + 0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /><button disabled={auction.status !== "live"}>Bid</button></div></form>
    {(message || error) && <p className="notice">{message || error}</p>}
    <h3>Recent bids</h3>{bids.length === 0 ? <p className="muted">No bids yet.</p> : <ul className="bids">{bids.map((bid) => <li key={bid.id}><span>{money(bid.amount, auction.currency)}</span><small>{new Date(bid.createdAt).toLocaleString()}</small></li>)}</ul>}
  </aside>;
}

export default function App() {
  const { auctions, loading, error } = useAuctions();
  const selected = useAuctionStore((state) => state.selected);
  const select = useAuctionStore((state) => state.select);
  return <main><header><div><p className="eyebrow">LIVE MARKETPLACE</p><h1>Bidboard<span>.</span></h1></div><p className="muted">Transparent, real-time auctions.</p></header>
    <section className="layout"><div><div className="section-heading"><h2>Auctions</h2><button className="refresh" onClick={() => void useAuctionStore.getState().load()}>Refresh</button></div>
      {loading && <p>Loading auctions…</p>}{error && <p className="notice">{error}</p>}<div className="grid">{auctions.map((auction) => <button className="card" key={auction.id} onClick={() => void select(auction)}><div className="card-image" style={auction.imageUrl ? { backgroundImage: `url(${encodeURI(auction.imageUrl)})` } : undefined} /><div className="card-body"><p className="eyebrow">{auction.status}</p><h3>{auction.title}</h3><strong>{money(auction.currentPrice, auction.currency)}</strong><small>{auction.bidCount} bids · ends {new Date(auction.endsAt).toLocaleDateString()}</small></div></button>)}</div>
    </div>{selected && <Detail auction={selected} />}</section></main>;
}
