package config

import (
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr, DatabaseURL, RedisURL, JWTSecret string
	GoogleClientID, TurnstileSecret            string
	JWTTTL, RateLimitPerMinute                 int
	AuthRateLimitPerMinute                     int
}

func Load() Config {
	ttl, err := time.ParseDuration(env("JWT_TTL", "1h"))
	if err != nil || ttl <= 0 {
		ttl = time.Hour
	}
	rate, _ := strconv.Atoi(env("RATE_LIMIT_PER_MINUTE", "120"))
	if rate < 1 {
		rate = 120
	}
	authRate, _ := strconv.Atoi(env("AUTH_RATE_LIMIT_PER_MINUTE", "5"))
	if authRate < 1 {
		authRate = 5
	}
	jwtSecret := strings.TrimSpace(env("JWT_SECRET", ""))
	if jwtSecret == "" {
		log.Fatal("JWT_SECRET is required")
	}
	return Config{
		HTTPAddr: env("HTTP_ADDR", ":8080"), DatabaseURL: env("DATABASE_URL", ""),
		RedisURL: env("REDIS_URL", "redis://localhost:6379/0"), JWTSecret: jwtSecret,
		GoogleClientID: strings.TrimSpace(firstEnv("GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID")),
		TurnstileSecret: strings.TrimSpace(firstEnv("TURNSTILE_SECRET_KEY", "TURNSTILE_SECRET")),
		JWTTTL: int(ttl.Seconds()), RateLimitPerMinute: rate, AuthRateLimitPerMinute: authRate,
	}
}
func env(k, fallback string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return fallback
}

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			return v
		}
	}
	return ""
}
