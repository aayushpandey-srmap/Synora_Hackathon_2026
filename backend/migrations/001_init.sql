CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auctions (
  id UUID PRIMARY KEY, seller_id UUID NOT NULL REFERENCES users(id), title TEXT NOT NULL,
  starting_price BIGINT NOT NULL CHECK (starting_price >= 0),
  current_price BIGINT NOT NULL CHECK (current_price >= 0),
  ends_at TIMESTAMPTZ NOT NULL, status TEXT NOT NULL CHECK (status IN ('open','settled')),
  winner_id UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auctions_expiry ON auctions(status, ends_at);
CREATE TABLE IF NOT EXISTS bids (
  id UUID PRIMARY KEY, auction_id UUID NOT NULL REFERENCES auctions(id),
  bidder_id UUID NOT NULL REFERENCES users(id), amount BIGINT NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bids_winner ON bids(auction_id, amount DESC, created_at ASC);
