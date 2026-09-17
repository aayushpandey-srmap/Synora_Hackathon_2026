package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	HTTPAddr      string
	DatabaseURL   string
	RedisURL      string
	JWTSecret     []byte
	TokenTTL      time.Duration
	AuthTimeout   time.Duration
	SettleEvery   time.Duration
	CookieSecure  bool
}

func Load() (Config, error) {
	c := Config{
		HTTPAddr: os.Getenv("HTTP_ADDR"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		RedisURL: os.Getenv("REDIS_URL"),
		JWTSecret: []byte(os.Getenv("JWT_SECRET")),
		TokenTTL:  time.Hour,
		AuthTimeout: 3 * time.Second,
		SettleEvery: time.Second,
	}
	if c.HTTPAddr == "" { c.HTTPAddr = ":8080" }
	if v := os.Getenv("TOKEN_TTL"); v != "" {
		d, err := time.ParseDuration(v); if err != nil { return c, fmt.Errorf("TOKEN_TTL: %w", err) }; c.TokenTTL = d
	}
	if v := os.Getenv("SETTLE_INTERVAL"); v != "" {
		d, err := time.ParseDuration(v); if err != nil { return c, fmt.Errorf("SETTLE_INTERVAL: %w", err) }; c.SettleEvery = d
	}
	if v := os.Getenv("COOKIE_SECURE"); v != "" {
		b, err := strconv.ParseBool(v); if err != nil { return c, fmt.Errorf("COOKIE_SECURE: %w", err) }; c.CookieSecure = b
	}
	if len(c.JWTSecret) < 32 { return c, errors.New("JWT_SECRET must be at least 32 bytes") }
	if c.DatabaseURL == "" || c.RedisURL == "" { return c, errors.New("DATABASE_URL and REDIS_URL are required") }
	if c.TokenTTL <= 0 || c.AuthTimeout <= 0 || c.SettleEvery <= 0 { return c, errors.New("durations must be positive") }
	return c, nil
}
