package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/synora/auction/backend/internal/config"
	"github.com/synora/auction/backend/internal/db"
	"github.com/synora/auction/backend/internal/handlers"
	auctionredis "github.com/synora/auction/backend/internal/redis"
	"github.com/synora/auction/backend/internal/settlement"
	ws "github.com/synora/auction/backend/internal/websocket"
	"github.com/jackc/pgx/v5"
)

func main() {
	cfg:=config.Load()
	ctx,cancel:=signal.NotifyContext(context.Background(),os.Interrupt,syscall.SIGTERM);defer cancel()
	pool,err:=db.Open(ctx,cfg.DatabaseURL);if err!=nil{log.Fatal(err)};defer pool.Close()
	rc,err:=auctionredis.Open(ctx,cfg.RedisURL);if err!=nil{log.Fatal(err)};defer rc.Close()
	hub:=ws.New(rc.Client,[]byte(cfg.JWTSecret))
	hub.Validate = func(ctx context.Context, id string) error {
		var exists bool
		if err := pool.QueryRow(ctx, "select exists(select 1 from users where id=$1)", id).Scan(&exists); err != nil { return err }
		if !exists { return pgx.ErrNoRows }
		return nil
	}
	app:=&handlers.App{DB:pool,Redis:rc.Client,Secret:[]byte(cfg.JWTSecret),TTL:time.Duration(cfg.JWTTTL)*time.Second,Limiter:handlers.NewLimiter(cfg.RateLimitPerMinute),AuthLimiter:handlers.NewLimiter(cfg.AuthRateLimitPerMinute),GoogleClientID:cfg.GoogleClientID,TurnstileSecret:cfg.TurnstileSecret}
	worker := &settlement.Worker{DB: pool, Redis: rc.Client, Interval: time.Second}
	go worker.Run(ctx)
	mux:=http.NewServeMux();mux.Handle("/ws",hub);mux.Handle("/",app.Routes())
	srv:=&http.Server{Addr:cfg.HTTPAddr,Handler:requestLog(mux),ReadHeaderTimeout:5*time.Second,ReadTimeout:15*time.Second,WriteTimeout:15*time.Second,IdleTimeout:60*time.Second}
	go func(){<-ctx.Done();shutdown,stop:=context.WithTimeout(context.Background(),10*time.Second);defer stop();_ = srv.Shutdown(shutdown)}()
	log.Printf("auction backend listening on %s",cfg.HTTPAddr);if err:=srv.ListenAndServe();err!=nil&&err!=http.ErrServerClosed{log.Fatal(err)}
}
func requestLog(next http.Handler)http.Handler{return http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){start:=time.Now();next.ServeHTTP(w,r);log.Printf("%s %s %s",r.Method,r.URL.Path,time.Since(start))})}
