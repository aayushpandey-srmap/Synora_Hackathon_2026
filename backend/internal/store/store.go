package store

import (
	"context"
	"errors"
	"time"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Auction struct { ID, SellerID, Title string; StartingPrice, CurrentPrice int64; EndsAt time.Time; Status string; WinnerID *string }
type Bid struct { ID, AuctionID, BidderID string; Amount int64; CreatedAt time.Time }
type Store struct { DB *pgxpool.Pool }
func New(db *pgxpool.Pool) *Store { return &Store{db} }
func (s *Store) ListAuctions(ctx context.Context) ([]Auction, error) {
	rows, err := s.DB.Query(ctx, `SELECT id,seller_id,title,starting_price,current_price,ends_at,status,winner_id FROM auctions WHERE status='open' ORDER BY ends_at`)
	if err != nil { return nil, err }
	defer rows.Close()
	var auctions []Auction
	for rows.Next() { var a Auction; if err := rows.Scan(&a.ID,&a.SellerID,&a.Title,&a.StartingPrice,&a.CurrentPrice,&a.EndsAt,&a.Status,&a.WinnerID); err != nil { return nil, err }; auctions = append(auctions, a) }
	return auctions, rows.Err()
}
func (s *Store) ListBids(ctx context.Context, auctionID string) ([]Bid, error) {
	rows, err := s.DB.Query(ctx, `SELECT id,auction_id,bidder_id,amount,created_at FROM bids WHERE auction_id=$1 ORDER BY created_at DESC`, auctionID)
	if err != nil { return nil, err }
	defer rows.Close()
	var bids []Bid
	for rows.Next() { var b Bid; if err := rows.Scan(&b.ID,&b.AuctionID,&b.BidderID,&b.Amount,&b.CreatedAt); err != nil { return nil, err }; bids = append(bids, b) }
	return bids, rows.Err()
}
func (s *Store) CreateAuction(ctx context.Context,a Auction) error {
	_,err:=s.DB.Exec(ctx,`INSERT INTO auctions(id,seller_id,title,starting_price,current_price,ends_at,status) VALUES($1,$2,$3,$4,$4,$5,'open')`,a.ID,a.SellerID,a.Title,a.StartingPrice,a.EndsAt); return err
}
func (s *Store) GetAuction(ctx context.Context,id string)(Auction,error) {
	var a Auction; err:=s.DB.QueryRow(ctx,`SELECT id,seller_id,title,starting_price,current_price,ends_at,status,winner_id FROM auctions WHERE id=$1`,id).Scan(&a.ID,&a.SellerID,&a.Title,&a.StartingPrice,&a.CurrentPrice,&a.EndsAt,&a.Status,&a.WinnerID); return a,err
}
func (s *Store) RecordBid(ctx context.Context,b Bid) error {
	_,err:=s.DB.Exec(ctx,`INSERT INTO bids(id,auction_id,bidder_id,amount,created_at) VALUES($1,$2,$3,$4,COALESCE($5,now()))`,b.ID,b.AuctionID,b.BidderID,b.Amount,b.CreatedAt); return err
}
func (s *Store) UpdateCurrentPrice(ctx context.Context, id string, amount int64) error {
	_, err := s.DB.Exec(ctx, `UPDATE auctions SET current_price=$2 WHERE id=$1 AND status='open' AND current_price < $2`, id, amount)
	return err
}
func (s *Store) CreateUser(ctx context.Context, id, email, passwordHash string) error {
	_, err := s.DB.Exec(ctx, `INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)`, id, email, passwordHash)
	return err
}
func (s *Store) UserPassword(ctx context.Context, email string) (string, string, error) {
	var id, hash string
	err := s.DB.QueryRow(ctx, `SELECT id,password_hash FROM users WHERE email=$1`, email).Scan(&id, &hash)
	return id, hash, err
}
func (s *Store) Settle(ctx context.Context,id string) error {
	tx,err:=s.DB.Begin(ctx); if err!=nil{return err}; defer tx.Rollback(ctx)
	var status string; err=tx.QueryRow(ctx,`SELECT status FROM auctions WHERE id=$1 FOR UPDATE`,id).Scan(&status); if err!=nil{return err}
	if status=="settled" { return tx.Commit(ctx) }
	_,err=tx.Exec(ctx,`UPDATE auctions SET status='settled',winner_id=(SELECT bidder_id FROM bids WHERE auction_id=$1 ORDER BY amount DESC,created_at ASC LIMIT 1) WHERE id=$1 AND status='open'`,id); if err!=nil{return err}; return tx.Commit(ctx)
}
func (s *Store) ExpiredOpen(ctx context.Context)([]string,error){ rows,err:=s.DB.Query(ctx,`SELECT id FROM auctions WHERE status='open' AND ends_at<=now()`); if err!=nil{return nil,err}; defer rows.Close(); var ids []string; for rows.Next(){var id string; if err:=rows.Scan(&id);err!=nil{return nil,err};ids=append(ids,id)}; return ids,rows.Err() }
var ErrInvalidBid=errors.New("bid must exceed current price")
