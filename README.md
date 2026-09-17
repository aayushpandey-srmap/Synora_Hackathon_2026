# Synora auction platform

Runnable monorepo baseline for a real-time auction platform:

- `backend/` — Go HTTP/WebSocket API, Redis bid coordination and Pub/Sub, PostgreSQL schema, and settlement worker.
- `frontend/` — React + TypeScript + Zustand client with REST and WebSocket hooks.
- `infrastructure/` — local Docker Compose plus Terraform ECS/ALB baseline.
- `load-testing/` — k6 smoke, bidding, and WebSocket scenarios.

## Local prerequisites

- Go 1.22+
- Node.js 20+ and npm
- Docker and Docker Compose
- k6 (optional, for load tests)

## Run locally

1. Start dependencies:

   ```sh
   docker compose -f infrastructure/docker-compose.yml up -d postgres redis
   ```

2. Start the API:

   ```sh
   cd backend
   cp .env.example .env
   go run ./cmd/server
   ```

3. Start the web client in another terminal:

   ```sh
   cd frontend
   npm install
   npm run dev
   ```

The API listens on `http://localhost:8080` by default. WebSocket clients authenticate
with their JWT in the first JSON frame after connecting; tokens are never put in a URL.
The server closes unauthenticated sockets after three seconds.

## Validation

```sh
cd backend && go test ./...
cd frontend && npm run typecheck
```

See each component's README and `.env.example` for configuration details. Production
deployment is intentionally a baseline: review Terraform variables, secrets, network
policies, and observability before applying it.