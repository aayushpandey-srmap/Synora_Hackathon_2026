# Frontend

React + TypeScript + Vite client for the auction API. It expects `GET /auctions`,
`GET /auctions/:id/bids`, `POST /auctions/:id` and a WebSocket at `/ws`.
Set `VITE_API_URL` and optionally `VITE_WS_URL` for a remote API.

```sh
npm install
npm run dev
npm run build
```

REST requests include credentials, while the WebSocket sends a short-lived JWT in its
first JSON auth frame (never in the URL). Store that token in `sessionStorage` under
`auction_token`. In production serve the built assets over HTTPS and configure the API
origin explicitly.
