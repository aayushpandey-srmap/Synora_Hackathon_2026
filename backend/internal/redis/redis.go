package redis

import (
	"context"

	"github.com/redis/go-redis/v9"
)

type Client struct{ *redis.Client }

func Open(ctx context.Context, raw string) (*Client, error) {
	o, err := redis.ParseURL(raw)
	if err != nil {
		return nil, err
	}
	c := redis.NewClient(o)
	if err := c.Ping(ctx).Err(); err != nil {
		c.Close()
		return nil, err
	}
	return &Client{c}, nil
}
