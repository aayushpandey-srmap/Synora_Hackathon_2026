package ws

import (
	"encoding/json"
	"net/http"
	"net/url"
	"time"
	"github.com/gorilla/websocket"
	"auction/backend/internal/auth"
)
type Hub struct { Auth *auth.Service; Upgrader websocket.Upgrader }
func New(a *auth.Service)*Hub{return &Hub{a,websocket.Upgrader{CheckOrigin: sameOrigin}}}
func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" { return true }
	u, err := url.Parse(origin)
	if err != nil { return false }
	return u.Host == r.Host || (u.Hostname() == "localhost" && r.Hostname() == "localhost")
}
type frame struct { Type string `json:"type"`; Token string `json:"token,omitempty"` }
func (h *Hub) ServeHTTP(w http.ResponseWriter,r *http.Request){
	c,err:=h.Upgrader.Upgrade(w,r,nil);if err!=nil{return};defer c.Close()
	_ = c.SetReadDeadline(time.Now().Add(3*time.Second))
	_,b,err:=c.ReadMessage();if err!=nil{return};var f frame
	if json.Unmarshal(b,&f)!=nil||f.Type!="auth" { _=c.WriteJSON(map[string]string{"type":"error","error":"auth required"});return }
	id,err:=h.Auth.Parse(f.Token);if err!=nil { _=c.WriteJSON(map[string]string{"type":"error","error":"unauthorized"});return }
	_ = c.SetReadDeadline(time.Time{}); _=c.WriteJSON(map[string]string{"type":"authenticated","user_id":id})
	for { if _,_,err=c.ReadMessage();err!=nil{return} }
}
