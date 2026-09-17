import { useEffect, useMemo, useState } from 'react';
import { connectAuctionStream, getAuction, placeBid } from './api.js';

const tapeRows = [
  ['#35558', 'ACCEPTED', '$4,296,000', 'JumpTrading_Edge', 'Tokyo', '0.8ms / 0ms', 'Atomic compare-and-swap serialized successfully'],
  ['#35557', 'STALE_LOWER', '$4,295,500', 'Node_0x2C', 'Frankfurt', '1.4ms / 3ms', 'Serializable validation failed: Bid not strictly higher'],
  ['#35556', 'ACCEPTED', '$4,295,500', 'Trader_Direct_01', 'New York', '0.7ms / 0ms', 'Manual bid accepted into serialization queue'],
  ['#35555', 'STALE_LOWER', '$4,294,900', 'LiquidityBot_7', 'London', '2.1ms / 5ms', 'Atomic compare-and-swap rejected lower price'],
  ['#35554', 'ACCEPTED', '$4,295,000', 'JumpTrading_Edge', 'Tokyo', '0.9ms / 0ms', 'Atomic compare-and-swap serialized successfully'],
  ['#35553', 'ACCEPTED', '$4,294,500', 'Northstar_Flow', 'Chicago', '1.1ms / 1ms', 'Reserve threshold confirmed'],
];

const edgeNodes = [
  ['New York', 'Equinix NY4', 'us-east-1', '1.2ms', '3.73ms'],
  ['Chicago', 'CME Aurora', 'us-central-1', '1.8ms', '4.02ms'],
  ['Frankfurt', 'Equinix FR2', 'eu-central-1', '2.4ms', '4.41ms'],
  ['London', 'Slough LD4', 'eu-west-2', '2.0ms', '3.98ms'],
  ['Tokyo', 'TY3 Colo', 'ap-northeast-1', '0.8ms', '3.21ms'],
  ['Singapore', 'SG1 Tier-3', 'ap-southeast-1', '3.1ms', '5.12ms'],
];

function TerminalSparkline({ latency = false }) {
  const lineA = latency ? '0,78 35,71 70,74 105,50 140,61 175,40 210,53 245,30 280,38 315,18 350,27 385,20 420,35 455,13 490,24 525,9' : '0,64 35,52 70,59 105,36 140,47 175,28 210,40 245,21 280,33 315,13 350,25 385,18 420,29 455,9 490,17 525,5';
  return <svg className="terminal-chart" viewBox="0 0 525 95" preserveAspectRatio="none" role="img" aria-label={latency ? 'Broadcast latency chart' : 'Throughput chart'}><defs><linearGradient id={latency ? 'latency-fill' : 'throughput-fill'} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={latency ? '#f59e0b' : '#4ade80'} stopOpacity=".28" /><stop offset="1" stopColor={latency ? '#f59e0b' : '#4ade80'} stopOpacity="0" /></linearGradient></defs><path d={`M${lineA} L525,95 L0,95 Z`} fill={`url(#${latency ? 'latency-fill' : 'throughput-fill'})`} /><polyline points={lineA} fill="none" stroke={latency ? '#f59e0b' : '#4ade80'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /><polyline points={latency ? '0,83 35,80 70,82 105,75 140,78 175,70 210,75 245,67 280,69 315,62 350,65 385,61 420,68 455,57 490,63 525,54' : '0,78 35,72 70,76 105,62 140,69 175,58 210,63 245,52 280,58 315,45 350,53 385,48 420,58 455,44 490,51 525,39'} fill="none" stroke="#909895" strokeOpacity=".55" strokeWidth="1" vectorEffect="non-scaling-stroke" /></svg>;
}

function StatBadge({ label, value, tone = '' }) {
  return <div className={`terminal-stat ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

export default function AuctionTerminal() {
  const auctionId = window.location.pathname.match(/\/auction\/([^/]+)/)?.[1] || window.location.hash.split('/')[1] || '108';
  const token = window.localStorage.getItem('auctoz_token') || '';
  const [amount, setAmount] = useState('4296500');
  const [currentBid, setCurrentBid] = useState('4296000');
  const [remaining, setRemaining] = useState(379.1);
  const [filter, setFilter] = useState('All');
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let mounted = true;
    getAuction(auctionId, token).then(auction => {
      if (mounted && auction.current_high_price) setCurrentBid(String(auction.current_high_price).replace('.', ''));
    }).catch(error => mounted && setLoadError(error.message));
    const disconnect = token ? connectAuctionStream(token, update => {
      if (update.auction_id === auctionId) setCurrentBid(String(update.current_high_price).replace('.', ''));
    }, error => mounted && setLoadError(error.message)) : undefined;
    return () => { mounted = false; disconnect?.(); };
  }, [auctionId, token]);
  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(value => value <= 0.1 ? 379.1 : value - 0.1), 100);
    return () => window.clearInterval(timer);
  }, []);
  const clock = useMemo(() => `${Math.floor(remaining / 60).toString().padStart(2, '0')}:${(remaining % 60).toFixed(1).padStart(4, '0')}`, [remaining]);
  const visibleRows = tapeRows.filter(row => filter === 'All' || (filter === 'Accepted' && row[1] === 'ACCEPTED') || (filter === 'Rejected' && row[1] !== 'ACCEPTED') || (filter === 'Manual Bids' && row[3] === 'Trader_Direct_01'));
  const submitBid = async event => {
    event.preventDefault();
    if (!token) { setMessage('AUTH REQUIRED / SIGN IN TO BID'); return; }
    try {
      await placeBid(auctionId, amount, token);
      setCurrentBid(amount);
      setMessage(`ACCEPTED / ${Number(amount).toLocaleString('en-US')} / SERIALIZATION QUEUE`);
    } catch (error) {
      setMessage(`${error.status === 409 ? 'STALE / OUTBID' : 'REJECTED'} / ${error.message}`);
    }
  };
  return <main className="auction-terminal">
    <div className="grain" />
    <header className="terminal-nav"><a className="terminal-brand" href="#"><span className="brand-mark"><i /><i /></span>Auctoz</a><div className="terminal-nav-meta"><span>AUCTION ENGINE / 5000 REQ/S</span><b className="status-dot" /> ALL SYSTEMS NOMINAL <button type="button" onClick={() => { window.location.hash = ''; }}>EXIT TERMINAL</button></div></header>
    <section className="auction-heading">
      <div><div className="auction-code">AUCTION-LOT #{auctionId} <span>/</span> TOKENIZED DEBT / HIGH-YIELD LIQUIDITY BOND</div><h1>Series-A Perpetual Treasury Bond<br /><em>(Liquidity Tranche)</em></h1><p>Mission-critical institutional yield asset with real-time atomic clearing and automated anti-sniping dynamic close.</p>{loadError && <div className="terminal-error">{loadError}</div>}</div>
      <div className="remaining"><span>TIME REMAINING</span><strong>{clock}</strong><small><b className="status-dot" /> DYNAMIC CLOSE ACTIVE</small></div>
    </section>
    <section className="bid-grid">
      <article className="highest-bid panel-dark"><div className="panel-label"><span>CURRENT HIGHEST VALID BID (BROADCASTED)</span><b>SEQ #35558</b></div><div className="highest-price">${Number(currentBid).toLocaleString('en-US')} <span className="live-tick"><b className="status-dot" /> LIVE TICK</span></div><div className="bid-footer"><span>LEADING BIDDER <strong>JumpTrading_Edge</strong></span><span>RESERVE ($200K): <strong className="green">RESERVE MET</strong></span></div></article>
      <form className="manual-terminal panel-glass" onSubmit={submitBid}><div className="panel-label"><span>MANUAL BIDDER TERMINAL</span><b>CLIENT: TRADER_DIRECT_01</b></div><div className="quick-bids">{[500, 1000, 2500, 5000].map(step => <button type="button" key={step} onClick={() => setAmount(String(Number(amount) + step))}>+${step.toLocaleString()} {step === 500 && <small>(MIN)</small>}</button>)}</div><label className="bid-input"><span>CUSTOM BID AMOUNT (MUST BE ≥ $4,296,500)</span><div><b>$</b><input value={amount} onChange={event => setAmount(event.target.value.replace(/\D/g, ''))} inputMode="numeric" /></div></label><button className="submit-bid" type="submit">SUBMIT TO SERIALIZATION QUEUE <span>→</span></button>{message && <p className="queue-message">{message}</p>}</form>
    </section>
    <section className="stat-row"><StatBadge label="MIN. NEXT BID" value="$4,296,500" /><StatBadge label="MIN. INCREMENT" value="+$500" /><StatBadge label="ACCEPTED BIDS" value="35,558" tone="positive" /><StatBadge label="REJECTED / STALE" value="19,402" tone="negative" /></section>
    <section className="module telemetry-module"><div className="module-heading"><div><span>REAL-TIME TELEMETRY &amp; CONTENTION MONITORING</span><small>High-Throughput Performance &amp; Latency Analytics</small></div><b>STREAMING / 25 SEC ROLLING WINDOW</b></div><div className="kpi-row"><StatBadge label="INCOMING TPS" value="192" /><StatBadge label="ACCEPTED TPS" value="121" tone="positive" /><StatBadge label="REJECTED / STALE" value="71" tone="negative" /><StatBadge label="P99 BROADCAST" value="0.89ms" tone="warning" /><StatBadge label="LOCK CONTENTION" value="0%" /></div><div className="chart-grid"><article className="chart-card"><div className="chart-title"><span>THROUGHPUT STREAM <small>REQ/SEC</small></span><i className="legend green-dot" /> ACCEPTED <i className="legend grey-dot" /> INCOMING <i className="legend red-dot" /> REJECTED</div><TerminalSparkline /><div className="chart-axis"><span>25s AGO</span><span>NOW</span></div></article><article className="chart-card"><div className="chart-title"><span>BROADCAST &amp; SERIALIZATION LATENCY <small>MS</small></span><span className="goal">P99 GOAL: &lt; 15MS</span></div><TerminalSparkline latency /><div className="chart-axis"><span>P50 / P95 / P99 TAIL</span><span>0.89MS CURRENT</span></div></article></div></section>
    <section className="module tape-module"><div className="module-heading"><div><span>LIVE BID SERIALIZATION STREAM &amp; ORDER TAPE</span><small>Real-Time Ingestion Log &amp; Transaction Audit Tape</small></div><button className={`pause-button ${paused ? 'paused' : ''}`} type="button" onClick={() => setPaused(value => !value)}>{paused ? 'RESUME STREAM [▶]' : 'PAUSE STREAM [||]'}</button></div><div className="tape-controls">{['All', 'Accepted', 'Rejected', 'Manual Bids'].map(item => <button type="button" className={filter === item ? 'active' : ''} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div><div className="tape-wrap"><table><thead><tr><th>SEQUENCE</th><th>STATUS</th><th>BID AMOUNT</th><th>CLIENT / BOT AGENT</th><th>REGION</th><th>LATENCY / WAIT</th><th>SERIALIZATION NOTE / REJECTION REASON</th></tr></thead><tbody>{visibleRows.map(row => <tr key={row[0]}><td>{row[0]}</td><td><span className={`status-badge ${row[1] === 'ACCEPTED' ? 'accepted' : 'stale'}`}>{row[1]}</span></td><td className="amount-cell">{row[2]}</td><td>{row[3]}</td><td>{row[4]}</td><td>{row[5]}</td><td className={row[1] === 'ACCEPTED' ? '' : 'rose-text'}>{row[6]}</td></tr>)}</tbody></table></div></section>
    <section className="module nodes-module"><div className="module-heading"><div><span>LOW-LATENCY WEBSOCKET BROADCAST PUSH NETWORK</span><small>Connected Edge Client Nodes &amp; Real-Time Price Sync</small></div><b className="sync-status"><i className="status-dot" /> ALL 6 EDGE REGIONS SYNCHRONIZED</b></div><div className="node-grid">{edgeNodes.map(node => <article className="node-card" key={node[0]}><div className="node-header"><span><i className="status-dot" /> {node[0]}</span><small>{node[1]}</small></div><div className="node-region">{node[2]}</div><div className="node-price"><span>SYNCED HIGHEST BID PRICE</span><strong>$6,19,000,000</strong></div><div className="node-metrics"><span>SEQ #51349</span><span>COLO PING <b>{node[3]}</b></span><span>PUSH Δ <b>{node[4]}</b></span></div></article>)}</div></section>
    <footer className="terminal-footer">AUCTOZ <span>/</span> ENGINE ONLINE <b>AUCTION-LOT #108 / SECURE SERIALIZATION LANE</b></footer>
  </main>;
}
