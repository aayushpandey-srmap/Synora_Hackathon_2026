#!/usr/bin/env bash
set -euo pipefail

docker compose up -d
set -a
# shellcheck disable=SC1091
source backend/.env
set +a
(cd backend && go run ./cmd/server) &
BACKEND_PID=$!
(cd frontend && npm install && npm run dev) &
FRONTEND_PID=$!
trap 'kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true' INT TERM EXIT
wait
