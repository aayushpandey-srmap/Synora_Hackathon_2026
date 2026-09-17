package settlement

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Worker struct {
	DB *pgxpool.Pool
	Redis *redis.Client
	Interval time.Duration
}

func (w *Worker) Run(ctx context.Context) {
	if w.Interval <= 0 { w.Interval = time.Second }
	t := time.NewTicker(w.Interval)
	defer t.Stop()
	w.scan(ctx)
	for {
		select {
		case <-ctx.Done(): return
		case <-t.C: w.scan(ctx)
		}
	}
}

func (w *Worker) scan(ctx context.Context) {
	rows, err := w.DB.Query(ctx, `select id, end_time from auctions where status='ACTIVE' and end_time <= now() order by end_time`)
	if err != nil { log.Printf("settlement scan: %v", err); return }
	defer rows.Close()
	for rows.Next() {
		var id string; var end time.Time
		if err := rows.Scan(&id, &end); err != nil { log.Printf("settlement row: %v", err); continue }
		if err := w.settle(ctx, id, end); err != nil { log.Printf("settle %s: %v", id, err) }
	}
}

func (w *Worker) settle(ctx context.Context, id string, end time.Time) error {
	price, leader, err := w.Redis.MGet(ctx, "auction:"+id+":price", "auction:"+id+":leader").Result()
	if err != nil { return err }
	tx, err := w.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil { return err }
	defer tx.Rollback(ctx)
	var status string
	if err := tx.QueryRow(ctx, `select status from auctions where id=$1 for update`, id).Scan(&status); err != nil {
		if err == pgx.ErrNoRows { return nil }; return err
	}
	if status != "ACTIVE" { return nil }
	if _, err := tx.Exec(ctx, `update auctions set status='CLOSED', updated_at=now() where id=$1`, id); err != nil { return err }
	finalStatus := "CLOSED"
	if priceStr, ok := price.(string); ok && priceStr != "" {
		user, ok := leader.(string); if !ok || user == "" { return fmt.Errorf("price exists without leader") }
		if _, err := tx.Exec(ctx, `insert into bids(auction_id,user_id,amount,is_winning_bid) values($1,$2,$3,true) on conflict (auction_id) where is_winning_bid do nothing`, id, user, priceStr); err != nil { return err }
		if _, err := tx.Exec(ctx, `update auctions set status='SETTLED', current_high_price=$2, winner_id=$3, updated_at=now() where id=$1 and status='CLOSED'`, id, priceStr, user); err != nil { return err }
		finalStatus = "SETTLED"
	}
	if err := tx.Commit(ctx); err != nil { return err }
	ttl := time.Until(end.Add(24*time.Hour)); if ttl <= 0 { ttl = time.Hour }
	if err := w.Redis.Set(ctx, "auction:"+id+":status", finalStatus, ttl).Err(); err != nil { return err }
	return w.Redis.Del(ctx, "auction:"+id+":price", "auction:"+id+":leader").Err()
}
