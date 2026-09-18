# Synora_Hackathon_2026


Real-Time Auction EngineA high-performance, low-latency distributed auction platform built to handle high-concurrency bidding using Go, Redis, and React. The system employs an in-memory O(1) state engine in Redis to process bids sub-millisecond, real-time WebSocket fan-out, and PostgreSQL for persistent settlement.Key Architectural FeaturesStateless JWT Authentication: Secure REST endpoints with Bearer tokens; WebSocket connections authenticate via an immediate client-sent auth frame within 3 seconds to avoid exposed query-string tokens in ALB access logs.O(1) Redis State Machine: Atomic bid verification and high-bid updating via single-threaded, constant-time Lua scripts in Redis.Real-Time Live Updates: Distributed Go instances subscribe to Redis Pub/Sub channels to broadcast state changes across all active WebSocket connections to update the frontend Zustand store instantly.Asynchronous Settlement: Ephemeral state is finalized and committed to PostgreSQL asynchronously upon auction expiration by dedicated Go background workers.Frontend / Backend Data Flow[React/Zustand Client] 



     │
     ├─ (1) POST /api/v1/bids ─────────► [AWS ALB] ──► [Go API Server]
     │                                                     │
     │                                            (2) Execute Lua Script
     │                                                     │
     │                                                     ▼
     │                                             [(O(1)) Redis Engine]
     │                                                     │
     │◄── (3) 201 Created / 409 Outbid ────────────────────┤
     │                                                     │
     │                                            (4) Pub/Sub Update
     │                                                     │
     │                                                     ▼
     │                                            [Redis Pub/Sub]
     │                                                     │
     │                                            (5) Broadcast Event
     │                                                     │
     │                                                     ▼
     │◄── (6) WebSocket Update Frame ───────────── [Go WS Handlers]

     
Ingest: The React client fires a POST request to the Go backend via the AWS ALB.Validate: Go validates the JWT signature and payload structure.Execute: Go invokes an $O(1)$ Lua script in Redis. The script checks auction status and atomically updates the price and leading bidder ID if the incoming bid is higher.Respond: The HTTP thread immediately returns 201 Created or 409 Conflict (outbid) to the caller.Broadcast: On a successful bid, Redis Pub/Sub fires an update to all Go cluster nodes, which push the new price to clients over open WebSocket connections.Settle: Upon expiration, a Go background worker reads the finalized state from Redis, logs the winning bid into PostgreSQL, closes the auction, and purges key-value caches.Data Store & State ManagementData StoreEntity / TopicStructure / SchemaPurposeRedisActive PriceKey-Value: auction:{id}:priceSingle source of truth for current high bid.RedisActive LeaderKey-Value: auction:{id}:leaderTracks User ID of the leading bidder.RedisBroadcastPub/Sub: auction:{id}:updatesEphemeral message channel for Go nodes.PostgreSQLusersid, email, password_hashCore identity and credential records.PostgreSQLauctionsid, item, end_time, statusSystem of record for items and timelines.PostgreSQLbidsid, auction_id, user_id, amountAppend-only ledger for settlement & audit.API & Telemetry SpecificationsREST & WebSocket EndpointsProtocolEndpointPrimary FunctionExpected ResponsesRESTPOST /api/v1/authExchanges credentials for JWT.200 OK (with Token), 401 UnauthorizedRESTPOST /api/v1/bidsSubmits a validated bid.201 Created, 409 Conflict, 429 Too Many RequestsRESTGET /api/v1/auctionsRetrieves initial state on page load.200 OK (Current Price, End Time)WebSocketwss://api.../wsSubscribes to live price updates.Pushes updated price payloads; responds to ping frames.Project Structure/monorepo-root



├── /backend          # Go API handlers, WebSocket upgrader, Redis Lua scripts, PostgreSQL migrations

├── /frontend         # React application, Zustand state slices, WebSocket connection hooks

├── /infrastructure   # AWS ECS Terraform configs, Dockerfiles, ALB routing rules

└── /load-testing     # Grafana k6 scripts simulating simultaneous HTTP POSTs and WS subscriptions

Mitigation of Known Architectural RisksEphemeral Port Exhaustion: High-volume WebSocket connection counts (5,000+ per node) can exhaust TCP sockets. Resolved by tuning OS-level sysctl parameters on ECS containers and auto-scaling Go backend nodes via ALB using active connection metrics rather than CPU load alone.Redis Lua Script Blocking: Redis runs single-threaded; long scripts block operations. Solved by guaranteeing $O(1)$ operations with zero loops. JWT authentication and payload validation occur strictly in Go before touching Redis.Thundering Herd at Expiration: Massive read spikes occur when thousands of users refresh upon auction end. Mitigated by serving closed-auction states from Redis or an in-memory Go cache for 60 seconds post-close before querying PostgreSQL.NTP Clock Skew: Server clock variances could allow invalid late bids. Mitigated by enforcing auction expiration via Redis server time and centralized key TTLs rather than distributed Go instance system clocks.
