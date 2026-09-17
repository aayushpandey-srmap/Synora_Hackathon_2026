const API_BASE = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws';

async function jsonResponse(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || fallback);
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

export async function login(email, password) {
  const response = await fetch(`${API_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return jsonResponse(response, 'Authentication failed');
}

export async function getAuction(id, token) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = ['Bearer', token].join(' ');
  const response = await fetch(`${API_BASE}/auctions/${id}`, { headers });
  const payload = await jsonResponse(response, 'Auction could not be loaded');
  return payload.auction || payload;
}

export async function placeBid(auctionId, amount, token) {
  const response = await fetch(`${API_BASE}/bids`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: ['Bearer', token].join(' '),
    },
    body: JSON.stringify({ auction_id: auctionId, amount: Number(amount).toFixed(2) }),
  });
  return jsonResponse(response, 'Bid was rejected');
}

export function connectAuctionStream(token, onPriceUpdate, onError) {
  const socket = new WebSocket(WS_URL);
  const timer = window.setTimeout(() => socket.close(1008, 'authentication timeout'), 3000);
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', token })));
  socket.addEventListener('message', event => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'PRICE_UPDATE') onPriceUpdate(payload);
      if (payload.type === 'AUTH_ERROR') onError?.(new Error(payload.message || 'WebSocket authentication failed'));
    } catch (error) {
      onError?.(error);
    }
  });
  socket.addEventListener('close', () => window.clearTimeout(timer));
  socket.addEventListener('error', () => onError?.(new Error('Live bid stream disconnected')));
  return () => { window.clearTimeout(timer); socket.close(); };
}
