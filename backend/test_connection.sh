#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
TEST_EMAIL="${TEST_EMAIL:-operator@example.com}"
TEST_PASSWORD="${TEST_PASSWORD:-change-me}"
AUCTION_ID="${AUCTION_ID:-}"

require_command() { command -v "$1" >/dev/null 2>&1 || { echo "Missing command: $1" >&2; exit 1; }; }
require_command curl
require_command jq

echo "1/5 health"
health="$(curl --fail-with-body -sS "$BASE_URL/api/v1/health")"
printf '%s\n' "$health" | jq -e '.status == "ok" and .database == "connected" and .redis == "connected"'

echo "2/5 auth"
auth_response="$(curl --fail-with-body -sS -X POST "$BASE_URL/api/v1/auth" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")"
token="$(printf '%s' "$auth_response" | jq -er '.token')"
printf 'JWT acquired (%s chars)\n' "${#token}"

echo "3/5 auction list"
auctions="$(curl --fail-with-body -sS "$BASE_URL/api/v1/auctions?status=ACTIVE&limit=10" \
  -H "Authorization: Bearer $token")"
printf '%s\n' "$auctions" | jq .
if [[ -z "$AUCTION_ID" ]]; then
  AUCTION_ID="$(printf '%s' "$auctions" | jq -er '.items[0].id')"
fi
if [[ -z "${BID_AMOUNT:-}" ]]; then
  current_price="$(printf '%s' "$auctions" | jq -er --arg id "$AUCTION_ID" '.items[] | select(.id == $id) | (.current_high_price // .starting_price)')"
  BID_AMOUNT="$(awk "BEGIN { printf \"%.2f\", $current_price + 0.01 }")"
fi

echo "4/5 bid 201 + lower bid 409"
bid_amount="$BID_AMOUNT"
status="$(curl -sS -o /tmp/auctoz-bid.json -w '%{http_code}' -X POST "$BASE_URL/api/v1/bids" \
  -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -d "{\"auction_id\":\"$AUCTION_ID\",\"amount\":\"$bid_amount\"}")"
[[ "$status" == "201" ]] || { cat /tmp/auctoz-bid.json; echo "Expected 201, got $status" >&2; exit 1; }
lower="$(awk "BEGIN { printf \"%.2f\", $bid_amount - 1 }")"
status="$(curl -sS -o /tmp/auctoz-outbid.json -w '%{http_code}' -X POST "$BASE_URL/api/v1/bids" \
  -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -d "{\"auction_id\":\"$AUCTION_ID\",\"amount\":\"$lower\"}")"
[[ "$status" == "409" ]] || { cat /tmp/auctoz-outbid.json; echo "Expected 409, got $status" >&2; exit 1; }
echo "Bid status assertions passed"

echo "5/5 websocket auth"
require_command websocat
printf '%s\n' "{\"type\":\"auth\",\"token\":\"$token\"}" | timeout 5 websocat "${WS_URL:-ws://localhost:8080/ws}" | head -n 1 | jq -e '.type == "AUTH_SUCCESS"'
echo "Connection audit passed"
