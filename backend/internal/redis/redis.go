package redis

import (
	"context"
	"fmt"
	"time"
	"github.com/redis/go-redis/v9"
)

const BidScript = `if redis.call("GET", KEYS[3]) ~= "ACTIVE" then return {-1, "CLOSED"} end
local price = redis.call("GET", KEYS[1])
if not price then price = ARGV[1] end
if tonumber(ARGV[1]) <= tonumber(price) then return {0, price} end
redis.call("SET", KEYS[1], ARGV[1])
redis.call("SET", KEYS[2], ARGV[2])
redis.call("PUBLISH", KEYS[4], ARGV[3])
return {1, ARGV[1]}`

type Client struct { *redis.Client }
func Open(ctx context.Context, raw string) (*Client, error) {
	o, err := redis.ParseURL(raw); if err != nil { return nil, err }
	c := redis.NewClient(o); if err := c.Ping(ctx).Err(); err != nil { c.Close(); return nil, err }
	return &Client{c}, nil
}
func (c *Client) Bid(ctx context.Context, auction, amount, user string) (bool, string, error) {
	v, err := BidScriptEval(ctx, c.Client, auction, amount, user, ""); return v, amount, err
}
func BidScriptEval(ctx context.Context, c *redis.Client, auction, amount, user, payload string) (bool, error) {
	r, err := c.Eval(ctx, BidScript, []string{"auction:"+auction+":price", "auction:"+auction+":leader", "auction:"+auction+":status", "auction:"+auction+":updates"}, amount, user, payload).Result()
	if err != nil { return false, err }
	a, ok := r.([]interface{}); if !ok || len(a) != 2 { return false, fmt.Errorf("invalid bid script response") }
	n, ok := a[0].(int64); if !ok { return false, fmt.Errorf("invalid bid script result") }; return n == 1, nil
}

func (c *Client) SetActive(ctx context.Context, auction string, until time.Time) error {
	ttl := time.Until(until)
	if ttl <= 0 { return fmt.Errorf("auction already ended") }
	return c.Set(ctx, "auction:"+auction+":status", "ACTIVE", ttl).Err()
}
