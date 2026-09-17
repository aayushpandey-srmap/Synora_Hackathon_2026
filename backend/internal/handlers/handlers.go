package handlers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

type App struct { DB *pgxpool.Pool; Redis *redis.Client; Secret []byte; TTL time.Duration; Limiter *Limiter; Hub Broadcaster }
type Limiter struct { mu sync.Mutex; m map[string]*limitEntry; max int }
type limitEntry struct { at time.Time; n int }
func NewLimiter(max int) *Limiter { return &Limiter{m: make(map[string]*limitEntry), max:max} }
func (l *Limiter) Allow(k string) bool { l.mu.Lock(); defer l.mu.Unlock(); e:=l.m[k]; now:=time.Now(); if e==nil || now.Sub(e.at)>=time.Minute { l.m[k]=&limitEntry{at:now,n:1}; return true }; if e.n>=l.max{return false};e.n++;return true }
type Broadcaster interface { Publish(context.Context, string, []byte) error }

type claims struct { UserID string `json:"sub"`; jwt.RegisteredClaims }
func (a *App) token(uid string) (string,error) { now:=time.Now(); return jwt.NewWithClaims(jwt.SigningMethodHS256, claims{UserID:uid,RegisteredClaims:jwt.RegisteredClaims{Subject:uid,IssuedAt:jwt.NewNumericDate(now),ExpiresAt:jwt.NewNumericDate(now.Add(a.TTL))}}).SignedString(a.Secret) }
func (a *App) user(r *http.Request) (string,error) { h:=r.Header.Get("Authorization"); if !strings.HasPrefix(h,"Bearer "){return "",fmt.Errorf("auth required")}; t,e:=jwt.ParseWithClaims(strings.TrimSpace(strings.TrimPrefix(h,"Bearer ")),&claims{},func(t *jwt.Token)(interface{},error){if t.Method != jwt.SigningMethodHS256{return nil,fmt.Errorf("signing method")};return a.Secret,nil});if e!=nil||!t.Valid{return "",fmt.Errorf("invalid token")}; c,ok:=t.Claims.(*claims);if !ok{return "",fmt.Errorf("invalid claims")};return c.Subject,nil }

func (a *App) Routes() http.Handler {
	m:=http.NewServeMux(); m.HandleFunc("/api/v1/health",a.health); m.HandleFunc("/api/v1/auth",a.auth);m.HandleFunc("/api/v1/auth/login",a.auth)
	m.HandleFunc("/api/v1/auctions",a.auctions);m.HandleFunc("/api/v1/auctions/",a.auction)
	m.HandleFunc("/api/v1/bids",a.bid)
	return a.withMiddleware(m)
}
func (a *App) withMiddleware(next http.Handler) http.Handler { return http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){ w.Header().Set("Access-Control-Allow-Origin","http://localhost:5173"); w.Header().Set("Access-Control-Allow-Headers","Authorization, Content-Type, X-Request-ID"); w.Header().Set("Access-Control-Allow-Methods","GET, POST, OPTIONS"); if r.Method=="OPTIONS" { w.WriteHeader(http.StatusNoContent); return }; id:=r.Header.Get("X-Request-ID");if id==""{id=randomID()};w.Header().Set("X-Request-ID",id);if a.Limiter!=nil&&!a.Limiter.Allow(r.RemoteAddr){writeErr(w,429,"RATE_LIMITED","Too many requests",nil);return};next.ServeHTTP(w,r) }) }
func (a *App) health(w http.ResponseWriter,r *http.Request) { if r.Method!="GET" { w.WriteHeader(http.StatusMethodNotAllowed); return }; dbStatus, redisStatus := "connected", "connected"; if err:=a.DB.Ping(r.Context()); err!=nil { dbStatus="error" }; if err:=a.Redis.Ping(r.Context()).Err(); err!=nil { redisStatus="error" }; overall := "ok"; if dbStatus!="connected" || redisStatus!="connected" { overall="degraded" }; writeJSON(w,http.StatusOK,map[string]any{"status":overall,"database":dbStatus,"redis":redisStatus}) }
func randomID() string { b:=make([]byte,12);_,_=rand.Read(b);return base64.RawURLEncoding.EncodeToString(b) }
func decode(r *http.Request, v any) error {
	d := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	if d.Decode(&struct{}{}) == nil {
		return fmt.Errorf("multiple JSON values")
	}
	return nil
}
func writeJSON(w http.ResponseWriter,status int,v any){w.Header().Set("Content-Type","application/json");w.WriteHeader(status);_=json.NewEncoder(w).Encode(v)}
func writeErr(w http.ResponseWriter,status int,code,msg string,details any){if details==nil{details=map[string]any{}};writeJSON(w,status,map[string]any{"error":map[string]any{"code":code,"message":msg,"details":details}})}
func (a *App) auth(w http.ResponseWriter,r *http.Request){if r.Method!="POST"{w.WriteHeader(405);return};var in struct{Email,Password string};if decode(r,&in)!=nil||strings.TrimSpace(in.Email)==""||len(in.Password)==0{writeErr(w,400,"VALIDATION_ERROR","Email and password are required",nil);return};var id,hash string;err:=a.DB.QueryRow(r.Context(),"select id,password_hash from users where email=$1",strings.ToLower(strings.TrimSpace(in.Email))).Scan(&id,&hash);if err!=nil||bcrypt.CompareHashAndPassword([]byte(hash),[]byte(in.Password))!=nil{writeErr(w,401,"INVALID_CREDENTIALS","Email or password is incorrect",nil);return};tok,err:=a.token(id);if err!=nil{writeErr(w,500,"INTERNAL_ERROR","Unable to issue token",nil);return};writeJSON(w,200,map[string]any{"token":tok,"token_type":"Bearer","expires_in":int(a.TTL.Seconds()),"user":map[string]string{"id":id,"email":strings.ToLower(strings.TrimSpace(in.Email))}})}

type auctionInput struct { ItemTitle string `json:"item_title"`; Description *string `json:"description"`; StartingPrice string `json:"starting_price"`; StartTime time.Time `json:"start_time"`; EndTime time.Time `json:"end_time"`; Status string `json:"status"` }
type auction struct { ID string `json:"id"`; ItemTitle string `json:"item_title"`; Description *string `json:"description"`; StartingPrice string `json:"starting_price"`; CurrentHigh *string `json:"current_high_price"`; Winner *string `json:"winner_id"`; Status string `json:"status"`; Start,End,Created,Updated time.Time }
func (x auction) json() map[string]any{return map[string]any{"id":x.ID,"item_title":x.ItemTitle,"description":x.Description,"starting_price":x.StartingPrice,"current_high_price":x.CurrentHigh,"winner_id":x.Winner,"status":x.Status,"start_time":x.Start.UTC().Format(time.RFC3339Nano),"end_time":x.End.UTC().Format(time.RFC3339Nano),"created_at":x.Created.UTC().Format(time.RFC3339Nano),"updated_at":x.Updated.UTC().Format(time.RFC3339Nano)}}
func scanAuction(row pgx.Row)(auction,error){var x auction;err:=row.Scan(&x.ID,&x.ItemTitle,&x.Description,&x.StartingPrice,&x.CurrentHigh,&x.Winner,&x.Status,&x.Start,&x.End,&x.Created,&x.Updated);return x,err}
func (a *App) auctions(w http.ResponseWriter,r *http.Request){switch r.Method{case "GET":a.listAuctions(w,r);case "POST":a.createAuction(w,r);default:w.WriteHeader(405)}}
func (a *App) createAuction(w http.ResponseWriter,r *http.Request){if _,e:=a.user(r);e!=nil{writeErr(w,401,"AUTH_REQUIRED","Authentication required",nil);return};var in auctionInput;if decode(r,&in)!=nil||strings.TrimSpace(in.ItemTitle)==""||in.StartingPrice==""||in.EndTime.IsZero()||in.StartTime.IsZero()||in.EndTime.Before(in.StartTime)||in.EndTime.Equal(in.StartTime){writeErr(w,400,"VALIDATION_ERROR","Invalid auction fields",nil);return};if in.Status==""{in.Status="DRAFT"};if in.Status!="DRAFT"&&in.Status!="ACTIVE"{writeErr(w,400,"VALIDATION_ERROR","Invalid status",nil);return};var x auction;err:=a.DB.QueryRow(r.Context(),`insert into auctions(item_title,description,starting_price,status,start_time,end_time) values($1,$2,$3,$4,$5,$6) returning id,item_title,description,starting_price,current_high_price,winner_id,status,start_time,end_time,created_at,updated_at`,strings.TrimSpace(in.ItemTitle),in.Description,in.StartingPrice,in.Status,in.StartTime,in.EndTime).Scan(&x.ID,&x.ItemTitle,&x.Description,&x.StartingPrice,&x.CurrentHigh,&x.Winner,&x.Status,&x.Start,&x.End,&x.Created,&x.Updated);if err!=nil{writeErr(w,400,"VALIDATION_ERROR","Unable to create auction",nil);return};writeJSON(w,201,map[string]any{"auction":x.json()})}
func (a *App) listAuctions(w http.ResponseWriter,r *http.Request){status:=r.URL.Query().Get("status");if status==""{status="ACTIVE"};limit,_:=strconv.Atoi(r.URL.Query().Get("limit"));if limit==0{limit=20};if limit<1||limit>100{writeErr(w,400,"VALIDATION_ERROR","Invalid limit",nil);return};rows,e:=a.DB.Query(r.Context(),`select id,item_title,description,starting_price,current_high_price,winner_id,status,start_time,end_time,created_at,updated_at from auctions where status=$1 order by start_time desc,id desc limit $2`,status,limit+1);if e!=nil{writeErr(w,500,"INTERNAL_ERROR","Unable to list auctions",nil);return};defer rows.Close();items:=[]map[string]any{};for rows.Next(){var x auction;if e=rows.Scan(&x.ID,&x.ItemTitle,&x.Description,&x.StartingPrice,&x.CurrentHigh,&x.Winner,&x.Status,&x.Start,&x.End,&x.Created,&x.Updated);e!=nil{writeErr(w,500,"INTERNAL_ERROR","Unable to read auctions",nil);return};items=append(items,x.json())};more:=len(items)>limit;if more{items=items[:limit]};writeJSON(w,200,map[string]any{"items":items,"next_cursor":"","has_more":more})}
func (a *App) auction(w http.ResponseWriter,r *http.Request){if r.Method!="GET"{w.WriteHeader(405);return};id:=strings.TrimPrefix(r.URL.Path,"/api/v1/auctions/");if _,e:=uuid.Parse(id);e!=nil{writeErr(w,400,"VALIDATION_ERROR","Invalid auction ID",nil);return};x,e:=scanAuction(a.DB.QueryRow(r.Context(),`select id,item_title,description,starting_price,current_high_price,winner_id,status,start_time,end_time,created_at,updated_at from auctions where id=$1`,id));if e==pgx.ErrNoRows{writeErr(w,404,"AUCTION_NOT_FOUND","Auction was not found",map[string]string{"auction_id":id});return};if e!=nil{writeErr(w,500,"INTERNAL_ERROR","Unable to load auction",nil);return};if price,redisErr:=a.Redis.Get(r.Context(),"auction:"+id+":price").Result();redisErr==nil&&price!=""{x.CurrentHigh=&price};writeJSON(w,200,map[string]any{"auction":x.json()})}

var amountPattern=regexp.MustCompile(`^[0-9]{1,10}\.[0-9]{2}$`)
func (a *App) bid(w http.ResponseWriter,r *http.Request){if r.Method!="POST"{w.WriteHeader(405);return};uid,e:=a.user(r);if e!=nil{writeErr(w,401,"AUTH_REQUIRED","Authentication required",nil);return};var in struct{AuctionID,Amount string};if decode(r,&in)!=nil||uuid.Validate(in.AuctionID)!=nil||!amountPattern.MatchString(in.Amount){writeErr(w,400,"INVALID_AMOUNT","Invalid bid",nil);return};var status string;var start,end time.Time;var current,starting string;e=a.DB.QueryRow(r.Context(),"select status,start_time,end_time,current_high_price,starting_price from auctions where id=$1",in.AuctionID).Scan(&status,&start,&end,&current,&starting);if e==nil{if status!="ACTIVE"||time.Now().Before(start)||time.Now().After(end){writeErr(w,400,"AUCTION_NOT_BIDDABLE","Auction is not accepting bids",nil);return};if e:=a.Redis.SetNX(r.Context(),"auction:"+in.AuctionID+":price",starting,0).Err();e!=nil{writeErr(w,503,"TEMPORARILY_UNAVAILABLE","Bid service unavailable",nil);return};if e:=a.Redis.Set(r.Context(),"auction:"+in.AuctionID+":status","ACTIVE",time.Until(end)).Err();e!=nil{writeErr(w,503,"TEMPORARILY_UNAVAILABLE","Bid service unavailable",nil);return}};if e==pgx.ErrNoRows{writeErr(w,404,"AUCTION_NOT_FOUND","Auction was not found",nil);return};if e!=nil||status!="ACTIVE"||time.Now().Before(start)||time.Now().After(end){writeErr(w,400,"AUCTION_NOT_BIDDABLE","Auction is not accepting bids",nil);return};placed:=time.Now().UTC();payload,_:=json.Marshal(map[string]any{"type":"PRICE_UPDATE","auction_id":in.AuctionID,"current_high_price":in.Amount,"placed_at":placed.Format(time.RFC3339Nano)});ok,e:=evalBid(r.Context(),a.Redis,in.AuctionID,in.Amount,uid,string(payload));if e!=nil{log.Printf("bid redis: %v",e);writeErr(w,503,"TEMPORARILY_UNAVAILABLE","Bid service unavailable",nil);return};if !ok{writeErr(w,409,"BID_TOO_LOW","Bid must exceed the current high price",map[string]string{"auction_id":in.AuctionID,"submitted_amount":in.Amount});return};writeJSON(w,201,map[string]any{"bid":map[string]any{"id":nil,"auction_id":in.AuctionID,"user_id":uid,"amount":in.Amount,"placed_at":placed.Format(time.RFC3339Nano),"is_winning_bid":false},"auction":map[string]any{"id":in.AuctionID,"current_high_price":in.Amount,"status":status,"end_time":end.UTC().Format(time.RFC3339Nano)}})}
func evalBid(ctx context.Context,c *redis.Client,id,amount,user,payload string)(bool,error){r,e:=c.Eval(ctx,`if redis.call("GET",KEYS[3]) ~= "ACTIVE" then return {-1,"CLOSED"} end;local p=redis.call("GET",KEYS[1]);if not p then p=ARGV[1] end;if tonumber(ARGV[1])<=tonumber(p) then return {0,p} end;redis.call("SET",KEYS[1],ARGV[1]);redis.call("SET",KEYS[2],ARGV[2]);redis.call("PUBLISH",KEYS[4],ARGV[3]);return {1,ARGV[1]}`,[]string{"auction:"+id+":price","auction:"+id+":leader","auction:"+id+":status","auction:"+id+":updates"},amount,user,payload).Result();if e!=nil{return false,e};v,ok:=r.([]interface{});if !ok||len(v)<1{return false,fmt.Errorf("bad redis response")};n,ok:=v[0].(int64);return ok&&n==1,nil}
