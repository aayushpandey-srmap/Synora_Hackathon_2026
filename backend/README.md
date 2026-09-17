# Auction backend

## Run

The service requires `DATABASE_URL`, `REDIS_URL`, and a random `JWT_SECRET`
of at least 32 bytes. Optional settings are `HTTP_ADDR` (default `:8080`),
`TOKEN_TTL`, `SETTLE_INTERVAL`, and `COOKIE_SECURE`. Apply
`migrations/001_init.sql` before starting:

```powershell
$env:DATABASE_URL = "postgres://..."
$env:REDIS_URL = "redis://localhost:6379/0"
$env:JWT_SECRET = "use-a-random-secret-at-least-32-bytes-long"
go run ./cmd/server
```

Clients register or log in at `/auth/register` and `/auth/login`, then send
the returned JWT as `Authorization: Bearer ...`. WebSocket clients connect to
`/ws` without credentials in the URL and must send
`{"type":"auth","token":"..."}` as their first frame within three seconds.
