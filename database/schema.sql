-- Synora live auction platform
-- PostgreSQL schema-of-record for users, auctions, and the append-only bid ledger.
--
-- This script is intentionally migration-friendly: enum creation is guarded, while
-- table/index definitions are idempotent for local bootstrap environments.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    CREATE TYPE auction_status AS ENUM (
        'DRAFT',
        'ACTIVE',
        'CLOSED',
        'SETTLED',
        'CANCELLED'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT users_email_not_blank CHECK (btrim(email) <> ''),
    CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
    CONSTRAINT users_password_hash_not_blank CHECK (btrim(password_hash) <> ''),
    CONSTRAINT users_updated_at_after_created_at CHECK (updated_at >= created_at),
    CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS auctions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_title TEXT NOT NULL,
    description TEXT,
    starting_price NUMERIC(12, 2) NOT NULL,
    current_high_price NUMERIC(12, 2),
    winner_id UUID,
    status auction_status NOT NULL DEFAULT 'DRAFT',
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT auctions_item_title_not_blank CHECK (btrim(item_title) <> ''),
    CONSTRAINT auctions_starting_price_positive CHECK (starting_price > 0),
    CONSTRAINT auctions_current_high_price_valid CHECK (
        current_high_price IS NULL
        OR current_high_price >= starting_price
    ),
    CONSTRAINT auctions_end_after_start CHECK (end_time > start_time),
    CONSTRAINT auctions_updated_at_after_created_at CHECK (updated_at >= created_at),
    CONSTRAINT auctions_settlement_state_consistent CHECK (
        (status = 'SETTLED' AND current_high_price IS NOT NULL AND winner_id IS NOT NULL)
        OR (status <> 'SETTLED')
    ),
    CONSTRAINT auctions_winner_only_when_settled CHECK (
        winner_id IS NULL OR status = 'SETTLED'
    ),
    CONSTRAINT auctions_winner_fk
        FOREIGN KEY (winner_id)
        REFERENCES users (id)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT
);

CREATE TABLE IF NOT EXISTS bids (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    auction_id UUID NOT NULL,
    user_id UUID NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    placed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_winning_bid BOOLEAN NOT NULL DEFAULT FALSE,

    CONSTRAINT bids_positive_amount CHECK (amount > 0),
    CONSTRAINT bids_auction_fk
        FOREIGN KEY (auction_id)
        REFERENCES auctions (id)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT,
    CONSTRAINT bids_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT
);

-- A settlement has exactly one winning ledger row for an auction.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_one_winner_per_auction
    ON bids (auction_id)
    WHERE is_winning_bid;

-- Active auction page loads and expiry-worker scans.
CREATE INDEX IF NOT EXISTS idx_auctions_active
    ON auctions (end_time)
    WHERE status = 'ACTIVE';

-- Fast lookup of auctions by lifecycle and chronological window.
CREATE INDEX IF NOT EXISTS idx_auctions_status_start_time
    ON auctions (status, start_time DESC);

-- Leaderboards and settlement winner verification.
CREATE INDEX IF NOT EXISTS idx_bids_auction_amount
    ON bids (auction_id, amount DESC);

-- Foreign-key support for user history and referential checks.
CREATE INDEX IF NOT EXISTS idx_bids_user_id
    ON bids (user_id);

CREATE INDEX IF NOT EXISTS idx_bids_auction_id
    ON bids (auction_id);

-- Append-oriented settlement scans and audit queries.
CREATE INDEX IF NOT EXISTS idx_bids_auction_placed_at
    ON bids (auction_id, placed_at DESC, id DESC);

COMMIT;
