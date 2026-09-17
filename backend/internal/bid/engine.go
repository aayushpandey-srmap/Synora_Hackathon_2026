package bid

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
	"github.com/redis/go-redis/v9"
)

const script = `
local now = redis.call('TIME')[1]
local ends = tonumber(redis.call('HGET', KEYS[1], 'ends_at'))
if not ends or tonumber(now) >= ends then return -2 end
local current = tonumber(redis.call('HGET', KEYS[1], 'price') or '0')
local amount = tonumber(ARGV[1])
if amount <= current then return -1 end
redis.call('HSET', KEYS[1], 'price', amount, 'bidder', ARGV[2])
redis.call('PUBLISH', ARGV[3], ARGV[4])
return amount`

type Engine struct { Redis *redis.Client }
func New(r *redis.Client)*Engine{return &Engine{r}}
func (e *Engine) CheckAndSet(ctx context.Context, auctionID,bidder string, amount,current int64, endsAt time.Time)(bool,error){
	key:=fmt.Sprintf("auction:%s",auctionID); payload,_:=json.Marshal(map[string]any{"auction_id":auctionID,"bidder_id":bidder,"amount":amount})
	// Seed only missing state. Existing price is never reset by a competing request.
	if _,err:=e.Redis.HSetNX(ctx,key,"price",current).Result();err!=nil{return false,err}
	if _,err:=e.Redis.HSetNX(ctx,key,"ends_at",endsAt.Unix()).Result();err!=nil{return false,err}
	n,err:=e.Redis.Eval(ctx,script,[]string{key},amount,bidder,"auction:"+auctionID+":bids",string(payload)).Int64()
	if err!=nil{return false,err}; if n==-1||n==-2{return false,nil}; return true,nil
}
