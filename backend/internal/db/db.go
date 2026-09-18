package db

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	if url == "" { return nil, fmt.Errorf("DATABASE_URL is required") }
	cfg, err := pgxpool.ParseConfig(url); if err != nil { return nil, err }
	cfg.MaxConns = 20
	p, err := pgxpool.NewWithConfig(ctx, cfg); if err != nil { return nil, err }
	if err = p.Ping(ctx); err != nil { p.Close(); return nil, err }
	return p, nil
}
