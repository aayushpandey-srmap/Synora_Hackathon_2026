# Auction backend

This service is the Go REST/WebSocket edge for the existing PostgreSQL and Redis auction design.

## Run

1. Apply `database/schema.sql` to PostgreSQL.
2. Copy `.env.example` to `.env` and export the values.
3. Run `go run ./cmd/server` from `backend/`.

The server exposes:

- `POST /api/v1/auth` and `/api/v1/auth/login`
- `GET /api/v1/auctions`
- `GET /api/v1/auctions/{uuid}`
- `POST /api/v1/auctions`
- `POST /api/v1/bids`
- `GET /ws`

REST bid acceptance is atomic in Redis. The Lua script checks `auction:{id}:status`, compares the fixed-precision amount, updates price and leader, and publishes the JSON update to `auction:{id}:updates`. The settlement worker scans expired active auctions, writes the winning ledger row and final auction state transactionally, caches the terminal status, and removes the hot price/leader keys.

The WebSocket connection is intentionally unauthenticated only during the handshake. The first application frame must be `{"type":"auth","token":"..."}` within three seconds. After JWT and user validation, the connection subscribes to `auction:*:updates` and receives `PRICE_UPDATE` frames.

The repository does not contain a Zustand store; the existing frontend uses React state. `frontend/src/api.js` provides the REST and WebSocket integration used by the auth and auction terminal views.
