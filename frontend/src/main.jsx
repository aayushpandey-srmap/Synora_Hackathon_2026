import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import AuthScreen from './AuthScreen.jsx';
import AuctionTerminal from './AuctionTerminal.jsx';

const bidEvents = [
  { time: '14:38:19.344', label: 'BID MATCHED', value: '$42,855,000', node: 'Node #18', latency: '0.7ms' },
  { time: '14:38:20.481', label: 'BOOK SYNC', value: '08 asks / 49 bids', node: 'active lane', latency: '' },
  { time: '14:38:21.610', label: 'MICRO-BID', value: '$42,901,000', node: 'Node #2C', latency: '0.9ms' }
];

function Logo() {
  return <div className="brand-mark" aria-hidden="true"><span /><span /></div>;
}

function Sparkline() {
  return (
    <svg className="sparkline" viewBox="0 0 560 112" preserveAspectRatio="none" role="img" aria-label="Incoming bid velocity sparkline">
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#dce6db" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#dce6db" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="spark-area" d="M0 93 L40 96 L78 85 L120 89 L151 70 L192 84 L225 63 L273 78 L313 57 L348 75 L386 52 L423 65 L459 43 L506 60 L560 22 L560 112 L0 112 Z" />
      <polyline className="spark-line" points="0,93 40,96 78,85 120,89 151,70 192,84 225,63 273,78 313,57 348,75 386,52 423,65 459,43 506,60 560,22" />
      <circle className="spark-dot" cx="560" cy="22" r="3" />
    </svg>
  );
}

function DepthBars() {
  const rows = [
    ['42.85M', 88], ['42.83M', 62], ['42.80M', 44], ['42.89M', 52], ['42.92M', 76], ['42.95M', 38]
  ];
  return <div className="depth-bars">{rows.map(([price, width], index) => <div className="depth-row" key={price}><span>{price}</span><i style={{ width: `${width}%`, opacity: index > 2 ? 0.55 : 0.76 }} /></div>)}</div>;
}

function Countdown() {
  const [remaining, setRemaining] = useState(3.275);
  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(value => value <= 0.001 ? 3.275 : value - 0.017), 17);
    return () => window.clearInterval(timer);
  }, []);
  const formatted = useMemo(() => {
    const totalMs = Math.max(0, Math.round(remaining * 1000));
    const seconds = Math.floor(totalMs / 1000).toString().padStart(2, '0');
    const millis = (totalMs % 1000).toString().padStart(3, '0');
    return `00:00:${seconds}.${millis}`;
  }, [remaining]);
  return <strong className="countdown-value">{formatted}</strong>;
}

function AuctionPod() {
  return (
    <section className="auction-pod panel">
      <div className="panel-topline">
        <span className="live-label"><b className="status-dot" /> ACTIVE ASSET / MICRO-AUCTION POD</span>
        <span>UTC 14:38:12</span>
      </div>
      <div className="asset-title">Tier-1 Spectrum License <span>/</span> Lot #409</div>
      <div className="metric-row">
        <div>
          <div className="eyebrow">CURRENT HIGHEST BID</div>
          <div className="price">$42,885,000 <span className="gain">+0.55%</span></div>
        </div>
        <div className="countdown"><span className="eyebrow">NEXT BID WINDOW</span><Countdown /></div>
      </div>
      <div className="bidder-row">
        <div><span className="eyebrow">LEADING BIDDER</span><span className="bidder">Node #0x7F...C3 <em>(Tokyo)</em></span></div>
        <span className="latency-pill">LIVE / 0.8MS</span>
      </div>
      <div className="chart-header"><span>INCOMING BID VELOCITY / ORDER BOOK</span><span className="chart-live"><b className="status-dot" /> LIVE</span></div>
      <div className="chart-area"><DepthBars /><div className="chart"><span className="chart-peak">18.4</span><Sparkline /></div></div>
      <div className="panel-footer"><span>4551 / DEPTH</span><span>MICRO-BIDS / 1.4</span></div>
    </section>
  );
}

function BidStream() {
  return <aside className="bid-stream glass-panel">
    <div className="stream-topline"><span className="live-label"><b className="status-dot" /> REAL-TIME BID STREAM</span><span>LIVE / TAIL</span></div>
    <div className="stream-subline"><span>TERMINAL FEED</span><span>SEC: 00489</span></div>
    <div className="feed">{bidEvents.map(event => <div className="feed-line" key={event.time}><span className="feed-arrow">Ã¢â‚¬Âº</span><span><time>{event.time}</time> Ã¢â‚¬â€ <strong>{event.label}:</strong> {event.value} by {event.node}{event.latency && <> <small>(Latency: {event.latency})</small>}</span></div>)}</div>
    <div className="stream-footer"><span>LATENCY MEDIAN</span><span>0.8MS / TOKYO</span></div>
  </aside>;
}

function App() {
  const [authMode, setAuthMode] = useState(window.location.hash === '#auth');
  const [auctionMode, setAuctionMode] = useState(window.location.hash.startsWith('#auction') || window.location.pathname.startsWith('/auction/'));
  useEffect(() => {
    const onHashChange = () => {
      setAuthMode(window.location.hash === '#auth');
      setAuctionMode(window.location.hash.startsWith('#auction') || window.location.pathname.startsWith('/auction/'));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  if (authMode) return <AuthScreen />;
  if (auctionMode) return <AuctionTerminal />;
  return <main className="site-shell">
    <div className="grain" />
    <header className="topbar">
      <div className="system-tag"><span className="tag-rule" /> REAL-TIME AUCTION ENGINE <span className="slash">/</span> 5000 REQ/S</div>
      <div className="brand"><div className="brand-name"><Logo /><span>Auctoz</span></div><div className="market-status"><b className="status-dot" /> MARKETS LIVE</div></div>
    </header>
    <div className="content-grid">
      <section className="hero-copy">
        <div className="hero-tag">PRECISION BIDDING INFRASTRUCTURE</div>
        <h1>Lightning-fast bids,<br />across every active<br />auction you control.</h1>
        <p>Auctoz gives high-frequency bidders and institutional auctioneers an unfair edge in live biddingÃ¢â‚¬â€delivering sub-millisecond market visibility, real-time allocation tracking, and split-second decisions in one exact view.</p>
        <button className="cta" type="button" onClick={() => { window.location.hash = 'auth'; setAuthMode(true); }}>GET STARTED <span>Ã¢â€ â€™</span></button>
        <div className="telemetry"><span><b>Ã¢â‚¬Â¢</b> SIGNAL LATENCY: 0.8MS MEDIAN</span><span><b>Ã¢â‚¬Â¢</b> ACTIVE ROOMS: 17 / 64 ACTIVE</span></div>
      </section>
      <section className="dashboard" aria-label="Live auction dashboard"><AuctionPod /><BidStream /></section>
    </div>
    <footer>AUCTOZ <span>/</span> ENGINE ONLINE</footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
