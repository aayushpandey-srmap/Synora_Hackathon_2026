package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	HTTPAddr, DatabaseURL, RedisURL, JWTSecret string
	JWTTTL, RateLimitPerMinute int
}

func Load() Config {
	ttl, _ := time.ParseDuration(env("JWT_TTL", "1h"))
	rate, _ := strconv.Atoi(env("RATE_LIMIT_PER_MINUTE", "120"))
	if rate < 1 { rate = 120 }
	return Config{HTTPAddr: env("HTTP_ADDR", ":8080"), DatabaseURL: env("DATABASE_URL", ""),
		RedisURL: env("REDIS_URL", "redis://localhost:6379/0"), JWTSecret: env("JWT_SECRET", ""),
		JWTTTL: int(ttl.Seconds()), RateLimitPerMinute: rate}
}
func env(k, fallback string) string { if v := os.Getenv(k); v != "" { return v }; return fallback }
