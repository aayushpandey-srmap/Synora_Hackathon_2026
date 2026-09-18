const API_BASE = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws';
const SESSION_KEY = 'auctoz_session';
let authToken = '';

function persistSession(payload) {
  if (!payload?.token || !payload?.user?.id) {
    const error = new Error('Authentication succeeded but the session payload was incomplete.');
    error.code = 'SESSION_ERROR';
    console.error('Session persistence error:', error.message, 'Payload:', payload);
    throw error;
  }
  authToken = payload.token;
  const expiresAt = Date.now() + (Number(payload.expires_in) || 3600) * 1000;
  const session = {
    token: payload.token,
    token_type: payload.token_type || 'Bearer',
    user: payload.user,
    expires_at: expiresAt,
  };
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    // Verify session was stored correctly
    const stored = window.sessionStorage.getItem(SESSION_KEY);
    if (!stored) {
      throw new Error('Session storage failed - sessionStorage may be disabled');
    }
    const parsed = JSON.parse(stored);
    if (parsed.token !== payload.token) {
      throw new Error('Session verification failed - stored token mismatch');
    }
    console.log('Session persisted successfully for user:', payload.user.id);
  } catch (error) {
    console.error('Session storage error:', error);
    const sessionError = new Error('Failed to store session. Your browser may have storage disabled.');
    sessionError.code = 'SESSION_STORAGE_ERROR';
    throw sessionError;
  }
}

function restoreSession() {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const session = JSON.parse(raw);
    if (!session?.token || (session.expires_at && session.expires_at <= Date.now())) {
      window.sessionStorage.removeItem(SESSION_KEY);
      authToken = '';
      return;
    }
    authToken = session.token;
  } catch {
    window.sessionStorage.removeItem(SESSION_KEY);
    authToken = '';
  }
}

restoreSession();

export function setAuthToken(token) {
  authToken = token || '';
  if (!authToken) {
    window.sessionStorage.removeItem(SESSION_KEY);
  }
}

export function getAuthToken() {
  if (!authToken) restoreSession();
  return authToken;
}

export function getSessionUser() {
  try {
    const session = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || '{}');
    return session.user || null;
  } catch {
    return null;
  }
}

async function jsonResponse(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || fallback);
    error.status = response.status;
    error.code = payload?.error?.code;
    error.retryAfter = Number(payload?.error?.details?.retry_after || response.headers.get('Retry-After') || 0);
    throw error;
  }
  return payload;
}

async function postAuth(path, body, fallback) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    const error = new Error('Unable to reach the authentication service. Check your connection and try again.');
    error.code = 'NETWORK_ERROR';
    throw error;
  }
  return jsonResponse(response, fallback);
}

export async function login(email, password, turnstileToken = '') {
  const payload = await postAuth('/auth', { email, password, cf_turnstile_response: turnstileToken || '' }, 'Authentication failed');
  persistSession(payload);
  return payload;
}

export async function loginWithGoogle(credential) {
  if (!credential) {
    const error = new Error('Google credential is missing');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  const payload = await postAuth('/auth/google', { credential }, 'Google authentication failed');
  persistSession(payload);
  return payload;
}

export async function getAuction(id, token) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = ['Bearer', token].join(' ');
  const response = await fetch(`${API_BASE}/auctions/${id}`, { headers });
  const payload = await jsonResponse(response, 'Auction could not be loaded');
  return payload.auction || payload;
}

export async function getAllAssets(token) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = ['Bearer', token].join(' ');
  const response = await fetch(`${API_BASE}/auctions`, { headers });
  const payload = await jsonResponse(response, 'Assets could not be loaded');
  return payload.auctions || payload.assets || [];
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
      if (payload.type === 'AUTH_SUCCESS') {
        window.clearTimeout(timer);
      }
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
