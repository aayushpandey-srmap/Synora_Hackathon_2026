package websocket

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

type Hub struct { Redis *redis.Client; Secret []byte; Validate func(context.Context, string) error; mu sync.Mutex; conns map[*Conn]struct{} }
type Conn struct { ws *websocket.Conn; hub *Hub; send chan []byte }
type authFrame struct { Type string `json:"type"`; Token string `json:"token"` }
var upgrader=websocket.Upgrader{ReadBufferSize:4096,WriteBufferSize:4096,CheckOrigin:func(*http.Request)bool{return true}}
func New(redis *redis.Client, secret []byte)*Hub{return &Hub{Redis:redis,Secret:secret,conns:make(map[*Conn]struct{})}}
func (h *Hub) Publish(ctx context.Context, channel string, payload []byte) error{return h.Redis.Publish(ctx,channel,payload).Err()}
func (h *Hub) ServeHTTP(w http.ResponseWriter,r *http.Request){ws,e:=upgrader.Upgrade(w,r,nil);if e!=nil{return};c:=&Conn{ws:ws,hub:h,send:make(chan []byte,32)};if e=c.authenticate();e!=nil{_ = ws.WriteJSON(map[string]string{"type":"AUTH_ERROR","code":"AUTH_REQUIRED","message":e.Error()});_ = ws.Close();return};h.mu.Lock();h.conns[c]=struct{}{};h.mu.Unlock();_ = c.write(map[string]string{"type":"AUTH_SUCCESS"});ctx,cancel:=context.WithCancel(context.Background());defer cancel();go c.writer();go h.subscribe(ctx,c);c.reader()}
func (c *Conn) authenticate()error{_ = c.ws.SetReadDeadline(time.Now().Add(3*time.Second));var f authFrame;if e:=c.ws.ReadJSON(&f);e!=nil{return e};if f.Type!="AUTH"||f.Token==""{return context.Canceled};t,e:=jwt.Parse(f.Token,func(t *jwt.Token)(interface{},error){if t.Method!=jwt.SigningMethodHS256{return nil,context.Canceled};return c.hub.Secret,nil});if e!=nil||!t.Valid{return context.Canceled};if c.hub.Validate!=nil{claims,ok:=t.Claims.(jwt.MapClaims);sub,valid:=claims["sub"].(string);if !ok||!valid||c.hub.Validate(context.Background(),sub)!=nil{return context.Canceled}};return nil}
func (c *Conn) reader(){defer func(){c.hub.mu.Lock();delete(c.hub.conns,c);c.hub.mu.Unlock();close(c.send);_ = c.ws.Close()}();c.ws.SetReadDeadline(time.Now().Add(60*time.Second));c.ws.SetPongHandler(func(string)error{c.ws.SetReadDeadline(time.Now().Add(60*time.Second));return nil});for{if _,_,e:=c.ws.ReadMessage();e!=nil{return}}}
func (c *Conn) writer(){t:=time.NewTicker(25*time.Second);defer t.Stop();for{select{case p,ok:=<-c.send:if !ok{return};if e:=c.writeRaw(p);e!=nil{return};case <-t.C:if e:=c.ws.WriteControl(websocket.PingMessage,nil,time.Now().Add(time.Second));e!=nil{return}}}}
func (c *Conn) write(v any)error{b,e:=json.Marshal(v);if e!=nil{return e};return c.writeRaw(b)}
func (c *Conn) writeRaw(b []byte)error{c.ws.SetWriteDeadline(time.Now().Add(5*time.Second));return c.ws.WriteMessage(websocket.TextMessage,b)}
func (h *Hub) subscribe(ctx context.Context,c *Conn){p:=h.Redis.PSubscribe(ctx,"auction:*:updates");defer p.Close();for{m,e:=p.ReceiveMessage(ctx);if e!=nil{return};select{case c.send<-[]byte(m.Payload):default:}}}
