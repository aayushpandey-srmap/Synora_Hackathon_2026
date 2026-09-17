# Live Auction MVP API Contract

Version: `v1`  
Base URL: `https://<host>/api/v1`  
WebSocket URL: `wss://<host>/ws`

This document defines only the REST and WebSocket contract. It does not change the PostgreSQL schema or Redis architecture.

## Contract conventions

- UUIDs are JSON strings in canonical lowercase UUID format.
- PostgreSQL `NUMERIC(12,2)` values are JSON strings with exactly two fractional digits, for example `"125.50"`. This avoids floating-point rounding.
- PostgreSQL `TIMESTAMPTZ` values are RFC 3339 / ISO-8601 strings in UTC, for example `"2026-09-17T13:00:00.000Z"`.
- `auction_status` is one of `DRAFT`, `ACTIVE`, `CLOSED`, `SETTLED`, or `CANCELLED`.
- REST authentication uses `Authorization: Bearer <JWT>`.
- Every response may include `X-Request-ID`; clients should echo a supplied request ID when retrying or reporting failures.
- Error responses use this envelope:

```json
{
  "error": {
    "code": "STRING_CONSTANT",
    "message": "Human readable description",
    "details": {}
  }
}
```

`details` is an object containing machine-readable field or conflict information and is `{}` when no additional data exists.

## Common status mapping

| HTTP status | Meaning | Typical error codes |
|---|---|---|
| `200 OK` | Successful read or login | — |
| `201 Created` | Resource or bid accepted | — |
| `400 Bad Request` | Malformed JSON or failed domain validation | `INVALID_JSON`, `VALIDATION_ERROR`, `INVALID_AMOUNT`, `AUCTION_NOT_BIDDABLE` |
| `401 Unauthorized` | Missing, malformed, expired, or invalid JWT/credentials | `AUTH_REQUIRED`, `INVALID_TOKEN`, `INVALID_CREDENTIALS` |
| `404 Not Found` | Resource does not exist or is not visible | `AUCTION_NOT_FOUND` |
| `409 Conflict` | Request conflicts with current auction state | `BID_TOO_LOW`, `BID_STALE`, `AUCTION_STATE_CONFLICT` |
| `429 Too Many Requests` | Rate limit exceeded | `RATE_LIMITED` |

Rate-limited responses include `Retry-After` in seconds when available.

## 1. Login

### `POST /api/v1/auth/login`

Exchanges credentials for a stateless JWT. Reads `users.email`; the password is checked against `users.password_hash`. This endpoint is public.

**Request headers**

```http
Content-Type: application/json
Accept: application/json
X-Request-ID: <optional opaque request ID>
```

**Request body**

```json
{
  "email": "bidder@example.com",
  "password": "correct horse battery staple"
}
```

| Field | Type | Required | Validation |
|---|---|---:|---|
| `email` | string | yes | Trimmed, valid email shape, case-normalized to lowercase for identity lookup |
| `password` | string | yes | Non-empty; never returned or logged |

**Success: `200 OK`**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "user": {
    "id": "2f4c2b4e-1e2d-4a0d-9cc5-3e0a9a9bd111",
    "email": "bidder@example.com"
  }
}
```

`expires_in` is an integer number of seconds. The JWT subject is the `users.id` UUID.

**Errors**

- `400 VALIDATION_ERROR`: missing, blank, or malformed `email`/`password`.
- `401 INVALID_CREDENTIALS`:

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Email or password is incorrect",
    "details": {}
  }
}
```

- `429 RATE_LIMITED`: repeated failed login attempts exceeded the configured limit.

## 2. Create auction

### `POST /api/v1/auctions`

Creates an `auctions` row. The existing schema has no seller/owner column, so the authenticated user is not persisted as an auction owner. New listings may be `DRAFT` or `ACTIVE`.

**Authentication**: required. The JWT subject must identify an existing `users.id`.

**Request headers**

```http
Authorization: Bearer <JWT>
Content-Type: application/json
Accept: application/json
Idempotency-Key: <required unique key for safe client retries>
X-Request-ID: <optional opaque request ID>
```

**Request body**

```json
{
  "item_title": "Vintage camera",
  "description": "Fully tested 35mm camera.",
  "starting_price": "125.50",
  "start_time": "2026-09-18T10:00:00.000Z",
  "end_time": "2026-09-18T12:00:00.000Z",
  "status": "ACTIVE"
}
```

| Field | Type | Required | Validation |
|---|---|---:|---|
| `item_title` | string | yes | Non-blank |
| `description` | string or null | no | Optional text |
| `starting_price` | fixed-precision decimal string | yes | Exactly two decimals, `> 0`, fits `NUMERIC(12,2)` |
| `start_time` | ISO-8601 string | yes | Valid `TIMESTAMPTZ` |
| `end_time` | ISO-8601 string | yes | Valid `TIMESTAMPTZ`, strictly after `start_time` |
| `status` | enum string | yes | Only `DRAFT` or `ACTIVE`; defaults to `DRAFT` if omitted by server policy |

`current_high_price` and `winner_id` are server-managed and must not be accepted in this request.

**Success: `201 Created`**

```json
{
  "auction": {
    "id": "a4bd2f3e-52cc-4d90-9c14-7c19cddf0e20",
    "item_title": "Vintage camera",
    "description": "Fully tested 35mm camera.",
    "starting_price": "125.50",
    "current_high_price": null,
    "winner_id": null,
    "status": "ACTIVE",
    "start_time": "2026-09-18T10:00:00.000Z",
    "end_time": "2026-09-18T12:00:00.000Z",
    "created_at": "2026-09-17T13:05:00.000Z",
    "updated_at": "2026-09-17T13:05:00.000Z"
  }
}
```

**Errors**

- `400 VALIDATION_ERROR`: missing fields, unsupported status, non-positive price, invalid timestamp, or `end_time <= start_time`.
- `401 AUTH_REQUIRED` / `INVALID_TOKEN`.
- `409 AUCTION_STATE_CONFLICT`: the `Idempotency-Key` was already used with a different request or the requested activation is no longer valid.
- `429 RATE_LIMITED`.

## 3. List auctions

### `GET /api/v1/auctions`

Public read endpoint for auction page loads. Reads from `auctions`; active filtering uses the existing partial active index.

**Authentication**: public. A valid JWT may be supplied but is not required.

**Query parameters**

| Parameter | Type | Required | Default | Validation |
|---|---|---:|---:|---|
| `status` | enum string | no | `ACTIVE` | One allowed `auction_status` value |
| `limit` | integer | no | `20` | `1..100` |
| `cursor` | opaque string | no | — | Cursor returned by a previous response |

**Request headers**

```http
Accept: application/json
Authorization: Bearer <JWT>  # optional
X-Request-ID: <optional opaque request ID>
```

**Success: `200 OK`**

```json
{
  "items": [
    {
      "id": "a4bd2f3e-52cc-4d90-9c14-7c19cddf0e20",
      "item_title": "Vintage camera",
      "description": "Fully tested 35mm camera.",
      "starting_price": "125.50",
      "current_high_price": "180.00",
      "winner_id": null,
      "status": "ACTIVE",
      "start_time": "2026-09-18T10:00:00.000Z",
      "end_time": "2026-09-18T12:00:00.000Z",
      "created_at": "2026-09-17T13:05:00.000Z",
      "updated_at": "2026-09-17T13:07:12.000Z"
    }
  ],
  "next_cursor": "eyJlbmRfdGltZSI6IjIw...",
  "has_more": true
}
```

**Errors**

- `400 VALIDATION_ERROR`: invalid status, cursor, or limit.
- `429 RATE_LIMITED`.

## 4. Get auction

### `GET /api/v1/auctions/{id}`

Returns the current durable auction projection from `auctions`. During an active auction, the real-time price may be newer in Redis/WebSocket notifications than this PostgreSQL-backed response until settlement synchronization completes.

**Authentication**: public; JWT optional.

**Path parameter**: `id` is a required UUID string.

**Request headers**

```http
Accept: application/json
Authorization: Bearer <JWT>  # optional
X-Request-ID: <optional opaque request ID>
```

**Success: `200 OK`**

```json
{
  "auction": {
    "id": "a4bd2f3e-52cc-4d90-9c14-7c19cddf0e20",
    "item_title": "Vintage camera",
    "description": "Fully tested 35mm camera.",
    "starting_price": "125.50",
    "current_high_price": "180.00",
    "winner_id": null,
    "status": "ACTIVE",
    "start_time": "2026-09-18T10:00:00.000Z",
    "end_time": "2026-09-18T12:00:00.000Z",
    "created_at": "2026-09-17T13:05:00.000Z",
    "updated_at": "2026-09-17T13:07:12.000Z"
  }
}
```

**Errors**

- `400 VALIDATION_ERROR`: malformed UUID.
- `404 AUCTION_NOT_FOUND`:

```json
{
  "error": {
    "code": "AUCTION_NOT_FOUND",
    "message": "Auction was not found",
    "details": { "auction_id": "a4bd2f3e-52cc-4d90-9c14-7c19cddf0e20" }
  }
}
```

- `429 RATE_LIMITED`.

## 5. Place bid

### `POST /api/v1/bids`

Accepts a bid for an active auction. The authenticated user is taken from the JWT subject. The hot path atomically compares and updates Redis `auction:{id}:price` and `auction:{id}:leader` through the existing Lua script, then publishes the update. The durable `bids` ledger is written by the settlement flow; this endpoint does not imply that a PostgreSQL bid row is synchronously committed before the response.

**Authentication**: required.

**Request headers**

```http
Authorization: Bearer <JWT>
Content-Type: application/json
Accept: application/json
Idempotency-Key: <required unique key for safe bid retries>
X-Request-ID: <optional opaque request ID>
```

**Request body**

```json
{
  "auction_id": "a4bd2f3e-52cc-4d90-9c14-7c19cddf0e20",
  "amount": "185.00"
}
```

| Field | Type | Required | Validation |
|---|---|---:|---|
| `auction_id` | UUID string | yes | Existing auction UUID |
| `amount` | fixed-precision decimal string | yes | Exactly two decimals, `> 0`, fits `NUMERIC(12,2)`, strictly greater than current Redis high price |

**Success: `201 Created`**

```json
{
  "bid": {
    "id": null,
    "auction_id": "a4bd2f3e-52cc-4d90-9c14-7c19cddf0e20",
    "user_id": "2f4c2b4e-1e2d-4a0d-9cc5-3e0a9a9bd111",
    "amount": "185.00",
    "placed_at": "2026-09-18T11:42:03.123Z",
    "is_winning_bid": false
  },
  "auction": {
    "id": "a4bd2f3e-52cc-4d90-9c14-7c19cddf0e20",
    "current_high_price": "185.00",
    "status": "ACTIVE",
    "end_time": "2026-09-18T12:00:00.000Z"
  }
}
```

`id` is `null` because the fast Redis acceptance response does not claim that the PostgreSQL identity `BIGINT` has been allocated. The settlement flow remains the PostgreSQL source of truth for the durable bid ID.

**Errors**

- `400 INVALID_AMOUNT`: malformed fixed-precision amount, amount `<= 0`, or value outside `NUMERIC(12,2)`.
- `400 AUCTION_NOT_BIDDABLE`: auction is not `ACTIVE`, has not started, or `end_time` has passed.
- `401 AUTH_REQUIRED` / `INVALID_TOKEN`.
- `404 AUCTION_NOT_FOUND`.
- `409 BID_TOO_LOW`:

```json
{
  "error": {
    "code": "BID_TOO_LOW",
    "message": "Bid must exceed the current high price",
    "details": {
      "auction_id": "a4bd2f3e-52cc-4d90-9c14-7c19cddf0e20",
      "current_high_price": "185.00",
      "submitted_amount": "180.00"
    }
  }
}
```

- `409 BID_STALE`: the request lost a concurrent race or its idempotency key maps to a different bid result.
- `429 RATE_LIMITED`.

## 6. WebSocket real-time updates

### `WebSocket /ws`

The connection starts unauthenticated. The client must send an authentication frame within **3 seconds** of connection establishment. The server closes the connection if the frame is absent, malformed, or invalid.

Recommended close codes:

| Code | Meaning |
|---:|---|
| `1008` | Policy violation: missing/invalid authentication |
| `1009` | Frame too large |
| `1013` | Temporary overload; client may reconnect with backoff |

All frames are UTF-8 JSON text frames. Clients must tolerate additional fields.

#### Client -> server: authentication frame

Must be the first application frame and arrive within three seconds:

```json
{
  "type": "AUTH",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

| Field | Type | Required | Validation |
|---|---|---:|---|
| `type` | string | yes | Exactly `AUTH` |
| `token` | string | yes | JWT only, without the `Bearer ` prefix |

The token subject must identify an existing `users.id`. There is no anonymous subscription mode in this MVP.

#### Server -> client: authentication success

```json
{
  "type": "AUTH_SUCCESS"
}
```

After `AUTH_SUCCESS`, the server may send bid updates for active auctions. This MVP does not add a new subscription storage model or REST subscription endpoint; the server may broadcast updates for all active auctions on the authenticated connection.

#### Server -> client: authentication failure / disconnect

Before closing, the server may send:

```json
{
  "type": "AUTH_ERROR",
  "code": "AUTH_REQUIRED",
  "message": "Authentication frame was not received within 3 seconds"
}
```

The server then closes the connection with code `1008`.

#### Server -> client: price update broadcast

Published after the Redis Lua script atomically updates both hot-state keys:

```json
{
  "type": "PRICE_UPDATE",
  "auction_id": "a4bd2f3e-52cc-4d90-9c14-7c19cddf0e20",
  "current_high_price": "185.00",
  "placed_at": "2026-09-18T11:42:03.123Z"
}
```

| Field | Type | Required | Source |
|---|---|---:|---|
| `type` | string | yes | Exactly `PRICE_UPDATE` |
| `auction_id` | UUID string | yes | Redis channel key / `auctions.id` |
| `current_high_price` | fixed-precision decimal string | yes | `auction:{id}:price` |
| `placed_at` | ISO-8601 string | yes | Event timestamp; maps to bid `placed_at` semantics |

Clients must treat updates as at-least-once and potentially out of order. They should keep the greatest observed price and use `placed_at` as a display hint, not as a replacement for PostgreSQL settlement state. Pub/Sub is not replayable; reconnecting clients must refresh `GET /api/v1/auctions/{id}`.

## Status rules summary

- `POST /auth/login`: `200` on valid credentials; `400` validation; `401` invalid credentials; `429` rate limited.
- `POST /auctions`: `201` when created; `400` invalid window/price; `401` missing or invalid JWT; `409` idempotency/state conflict; `429` rate limited.
- `GET /auctions`: `200` with cursor page; `400` invalid filters/cursor; `429` rate limited.
- `GET /auctions/{id}`: `200` projection; `400` malformed UUID; `404` unknown auction; `429` rate limited.
- `POST /bids`: `201` when Redis accepts a strictly higher bid; `400` invalid amount or expired/non-active auction; `401` invalid JWT; `404` unknown auction; `409` stale/outbid race; `429` rate limited.
- `WS /ws`: unauthenticated handshake is allowed only long enough to receive `AUTH`; missing/invalid authentication results in `AUTH_ERROR` plus close code `1008`.
