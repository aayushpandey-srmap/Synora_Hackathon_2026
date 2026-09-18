package handlers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
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

type App struct {
	DB               *pgxpool.Pool
	Redis            *redis.Client
	Secret           []byte
	TTL              time.Duration
	Limiter          *Limiter
	AuthLimiter      *Limiter
	GoogleClientID   string
	TurnstileSecret  string
}
type Limiter struct {
	mu  sync.Mutex
	m   map[string]*limitEntry
	max int
}
type limitEntry struct {
	at time.Time
	n  int
}

func NewLimiter(max int) *Limiter { return &Limiter{m: make(map[string]*limitEntry), max: max} }
func (l *Limiter) Allow(k string) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.m[k]
	now := time.Now()
	if e == nil || now.Sub(e.at) >= time.Minute {
		l.m[k] = &limitEntry{at: now, n: 1}
		return true, 0
	}
	if e.n >= l.max {
		retry := int((time.Minute - now.Sub(e.at)).Seconds())
		if retry < 1 {
			retry = 1
		}
		return false, retry
	}
	e.n++
	return true, 0
}

type claims struct {
	UserID string `json:"sub"`
	jwt.RegisteredClaims
}

func (a *App) token(uid string) (string, error) {
	now := time.Now()
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims{UserID: uid, RegisteredClaims: jwt.RegisteredClaims{Subject: uid, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(a.TTL))}}).SignedString(a.Secret)
}
func (a *App) user(r *http.Request) (string, error) {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return "", fmt.Errorf("auth required")
	}
	t, e := jwt.ParseWithClaims(strings.TrimSpace(strings.TrimPrefix(h, "Bearer ")), &claims{}, func(t *jwt.Token) (interface{}, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("signing method")
		}
		return a.Secret, nil
	})
	if e != nil || !t.Valid {
		return "", fmt.Errorf("invalid token")
	}
	c, ok := t.Claims.(*claims)
	if !ok {
		return "", fmt.Errorf("invalid claims")
	}
	return c.Subject, nil
}

func (a *App) Routes() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("/api/v1/health", a.health)
	m.HandleFunc("/api/v1/auth", a.auth)
	m.HandleFunc("/api/v1/auth/login", a.auth)
	m.HandleFunc("/api/v1/auth/google", a.googleAuth)
	m.HandleFunc("/api/v1/auctions", a.auctions)
	m.HandleFunc("/api/v1/auctions/", a.auction)
	m.HandleFunc("/api/v1/bids", a.bid)
	return a.withMiddleware(m)
}
func (a *App) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "http://localhost:5173")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Expose-Headers", "Retry-After, X-Request-ID")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = randomID()
		}
		w.Header().Set("X-Request-ID", id)
		if r.Method != http.MethodOptions {
			host := clientIP(r)
			limiter := a.Limiter
			if r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/api/v1/auth") && a.AuthLimiter != nil {
				limiter = a.AuthLimiter
			}
			if limiter != nil {
				if ok, retry := limiter.Allow(host); !ok {
					if retry < 1 {
						retry = 1
					}
					w.Header().Set("Retry-After", strconv.Itoa(retry))
					writeErr(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests. Try again shortly.", map[string]any{"retry_after": retry})
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (a *App) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	dbStatus, redisStatus := "connected", "connected"
	if err := a.DB.Ping(r.Context()); err != nil {
		dbStatus = "error"
	}
	if err := a.Redis.Ping(r.Context()).Err(); err != nil {
		redisStatus = "error"
	}
	overall := "ok"
	if dbStatus != "connected" || redisStatus != "connected" {
		overall = "degraded"
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": overall, "database": dbStatus, "redis": redisStatus})
}
func randomID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func clientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		if i := strings.Index(xff, ","); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return xff
	}
	if xr := strings.TrimSpace(r.Header.Get("X-Real-IP")); xr != "" {
		return xr
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
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
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeErr(w http.ResponseWriter, status int, code, msg string, details any) {
	if details == nil {
		details = map[string]any{}
	}
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": msg, "details": details}})
}
func (a *App) validateTurnstileToken(ctx context.Context, token, remoteIP string) error {
	secret := strings.TrimSpace(a.TurnstileSecret)
	if secret == "" {
		log.Printf("Turnstile validation failed: Turnstile is not configured (missing secret key)")
		return fmt.Errorf("turnstile is not configured")
	}
	if strings.TrimSpace(token) == "" {
		log.Printf("Turnstile validation failed: Missing token from client")
		return fmt.Errorf("missing turnstile token")
	}
	form := url.Values{"secret": {secret}, "response": {token}}
	if ip := strings.TrimSpace(remoteIP); ip != "" {
		form.Set("remoteip", ip)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://challenges.cloudflare.com/turnstile/v0/siteverify", strings.NewReader(form.Encode()))
	if err != nil {
		log.Printf("Turnstile validation failed: Failed to create request: %v", err)
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Turnstile validation failed: Request failed: %v", err)
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("Turnstile validation failed: Cloudflare returned status %d", resp.StatusCode)
		return fmt.Errorf("turnstile verification failed")
	}
	var body struct {
		Success bool     `json:"success"`
		Errors  []string `json:"error-codes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		log.Printf("Turnstile validation failed: Failed to decode response: %v", err)
		return err
	}
	if !body.Success {
		log.Printf("Turnstile validation failed: Invalid token. Errors: %v", body.Errors)
		return fmt.Errorf("invalid turnstile token")
	}
	log.Printf("Turnstile validation successful for IP: %s", remoteIP)
	return nil
}

func verifiedEmailFlag(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		return strings.EqualFold(t, "true")
	default:
		return false
	}
}

func (a *App) verifyGoogleIDToken(ctx context.Context, credential string) (string, error) {
	clientID := strings.TrimSpace(a.GoogleClientID)
	if clientID == "" {
		log.Printf("Google auth failed: Google Sign-In is not configured (missing client ID)")
		return "", fmt.Errorf("google sign-in is not configured")
	}
	credential = strings.TrimSpace(credential)
	if credential == "" {
		log.Printf("Google auth failed: Missing credential from client")
		return "", fmt.Errorf("missing google credential")
	}
	endpoint := "https://oauth2.googleapis.com/tokeninfo?id_token=" + url.QueryEscape(credential)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		log.Printf("Google auth failed: Failed to create request: %v", err)
		return "", err
	}
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Google auth failed: Request failed: %v", err)
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("Google auth failed: Google returned status %d", resp.StatusCode)
		return "", fmt.Errorf("invalid google credential")
	}
	var body struct {
		Aud           string `json:"aud"`
		Iss           string `json:"iss"`
		Email         string `json:"email"`
		EmailVerified any    `json:"email_verified"`
		Exp           string `json:"exp"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		log.Printf("Google auth failed: Failed to decode response: %v", err)
		return "", err
	}
	if body.Aud != clientID {
		log.Printf("Google auth failed: Audience mismatch. Expected: %s, Got: %s", clientID, body.Aud)
		return "", fmt.Errorf("google audience mismatch")
	}
	if body.Iss != "accounts.google.com" && body.Iss != "https://accounts.google.com" {
		log.Printf("Google auth failed: Issuer mismatch. Got: %s", body.Iss)
		return "", fmt.Errorf("google issuer mismatch")
	}
	if !verifiedEmailFlag(body.EmailVerified) {
		log.Printf("Google auth failed: Email not verified for: %s", body.Email)
		return "", fmt.Errorf("google email is not verified")
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	if email == "" || !strings.Contains(email, "@") {
		log.Printf("Google auth failed: Invalid email format")
		return "", fmt.Errorf("google email is missing")
	}
	if exp, err := strconv.ParseInt(body.Exp, 10, 64); err == nil && time.Now().Unix() >= exp {
		log.Printf("Google auth failed: Credential expired for: %s", email)
		return "", fmt.Errorf("google credential expired")
	}
	log.Printf("Google auth successful for: %s", email)
	return email, nil
}

func randomPassword() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func (a *App) googleAuth(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if strings.TrimSpace(a.GoogleClientID) == "" {
		log.Printf("Google auth rejected: Google Sign-In is not configured")
		writeErr(w, 503, "AUTH_UNAVAILABLE", "Google Sign-In is not configured. Please contact your administrator.", nil)
		return
	}
	var in struct {
		Credential string `json:"credential"`
	}
	if decode(r, &in) != nil || strings.TrimSpace(in.Credential) == "" {
		log.Printf("Google auth rejected: Invalid request - missing credential")
		writeErr(w, 400, "VALIDATION_ERROR", "Google credential is required", nil)
		return
	}
	email, err := a.verifyGoogleIDToken(r.Context(), in.Credential)
	if err != nil {
		log.Printf("Google auth failed: %v", err)
		writeErr(w, 401, "INVALID_CREDENTIALS", "Google authentication failed. Please try again.", nil)
		return
	}
	var id string
	err = a.DB.QueryRow(r.Context(), "select id from users where email=$1", email).Scan(&id)
	if err == pgx.ErrNoRows {
		log.Printf("Google auth: Creating new user for email: %s", email)
		password, passErr := randomPassword()
		if passErr != nil {
			log.Printf("Google auth failed: Failed to generate random password: %v", passErr)
			writeErr(w, 500, "INTERNAL_ERROR", "Unable to create Google account", nil)
			return
		}
		hash, hashErr := bcrypt.GenerateFromPassword([]byte(password), 12)
		if hashErr != nil {
			log.Printf("Google auth failed: Failed to hash password: %v", hashErr)
			writeErr(w, 500, "INTERNAL_ERROR", "Unable to create Google account", nil)
			return
		}
		if err = a.DB.QueryRow(r.Context(), "insert into users(email,password_hash) values($1,$2) returning id", email, string(hash)).Scan(&id); err != nil {
			log.Printf("Google auth failed: Failed to create user: %v", err)
			writeErr(w, 500, "INTERNAL_ERROR", "Unable to create Google account", nil)
			return
		}
		log.Printf("Google auth: Successfully created user with ID: %s", id)
	} else if err != nil {
		log.Printf("Google auth failed: Database error: %v", err)
		writeErr(w, 500, "INTERNAL_ERROR", "Unable to load Google account", nil)
		return
	}
	tok, err := a.token(id)
	if err != nil {
		log.Printf("Google auth failed: Failed to generate token: %v", err)
		writeErr(w, 500, "INTERNAL_ERROR", "Unable to issue token", nil)
		return
	}
	log.Printf("Google auth successful: User %s authenticated", id)
	writeJSON(w, http.StatusOK, map[string]any{"token": tok, "token_type": "Bearer", "expires_in": int(a.TTL.Seconds()), "user": map[string]string{"id": id, "email": email}})
}
func (a *App) auth(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	var in struct {
		Email          string `json:"email"`
		Password       string `json:"password"`
		TurnstileToken string `json:"cf_turnstile_response"`
	}
	if decode(r, &in) != nil || strings.TrimSpace(in.Email) == "" || len(in.Password) == 0 {
		writeErr(w, 400, "VALIDATION_ERROR", "Email and password are required", nil)
		return
	}
	if err := a.validateTurnstileToken(r.Context(), in.TurnstileToken, clientIP(r)); err != nil {
		if strings.Contains(err.Error(), "not configured") {
			writeErr(w, 503, "AUTH_UNAVAILABLE", "Turnstile verification is not configured", nil)
			return
		}
		writeErr(w, 400, "VALIDATION_ERROR", "Turnstile verification is required", nil)
		return
	}
	var id, hash string
	err := a.DB.QueryRow(r.Context(), "select id,password_hash from users where email=$1", strings.ToLower(strings.TrimSpace(in.Email))).Scan(&id, &hash)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password)) != nil {
		writeErr(w, 401, "INVALID_CREDENTIALS", "Email or password is incorrect", nil)
		return
	}
	tok, err := a.token(id)
	if err != nil {
		writeErr(w, 500, "INTERNAL_ERROR", "Unable to issue token", nil)
		return
	}
	writeJSON(w, 200, map[string]any{"token": tok, "token_type": "Bearer", "expires_in": int(a.TTL.Seconds()), "user": map[string]string{"id": id, "email": strings.ToLower(strings.TrimSpace(in.Email))}})
}

type auctionInput struct {
	ItemTitle     string    `json:"item_title"`
	Description   *string   `json:"description"`
	StartingPrice string    `json:"starting_price"`
	StartTime     time.Time `json:"start_time"`
	EndTime       time.Time `json:"end_time"`
	Status        string    `json:"status"`
}
type auction struct {
	ID                           string  `json:"id"`
	ItemTitle                    string  `json:"item_title"`
	Description                  *string `json:"description"`
	StartingPrice                string  `json:"starting_price"`
	CurrentHigh                  *string `json:"current_high_price"`
	Winner                       *string `json:"winner_id"`
	Status                       string  `json:"status"`
	Start, End, Created, Updated time.Time
}

func (x auction) json() map[string]any {
	return map[string]any{"id": x.ID, "item_title": x.ItemTitle, "description": x.Description, "starting_price": x.StartingPrice, "current_high_price": x.CurrentHigh, "winner_id": x.Winner, "status": x.Status, "start_time": x.Start.UTC().Format(time.RFC3339Nano), "end_time": x.End.UTC().Format(time.RFC3339Nano), "created_at": x.Created.UTC().Format(time.RFC3339Nano), "updated_at": x.Updated.UTC().Format(time.RFC3339Nano)}
}
func scanAuction(row pgx.Row) (auction, error) {
	var x auction
	err := row.Scan(&x.ID, &x.ItemTitle, &x.Description, &x.StartingPrice, &x.CurrentHigh, &x.Winner, &x.Status, &x.Start, &x.End, &x.Created, &x.Updated)
	return x, err
}
func (a *App) auctions(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		a.listAuctions(w, r)
	case "POST":
		a.createAuction(w, r)
	default:
		w.WriteHeader(405)
	}
}
func (a *App) createAuction(w http.ResponseWriter, r *http.Request) {
	if _, e := a.user(r); e != nil {
		writeErr(w, 401, "AUTH_REQUIRED", "Authentication required", nil)
		return
	}
	var in auctionInput
	if decode(r, &in) != nil || strings.TrimSpace(in.ItemTitle) == "" || in.StartingPrice == "" || in.EndTime.IsZero() || in.StartTime.IsZero() || in.EndTime.Before(in.StartTime) || in.EndTime.Equal(in.StartTime) {
		writeErr(w, 400, "VALIDATION_ERROR", "Invalid auction fields", nil)
		return
	}
	if in.Status == "" {
		in.Status = "DRAFT"
	}
	if in.Status != "DRAFT" && in.Status != "ACTIVE" {
		writeErr(w, 400, "VALIDATION_ERROR", "Invalid status", nil)
		return
	}
	var x auction
	err := a.DB.QueryRow(r.Context(), `insert into auctions(item_title,description,starting_price,status,start_time,end_time) values($1,$2,$3,$4,$5,$6) returning id,item_title,description,starting_price,current_high_price,winner_id,status,start_time,end_time,created_at,updated_at`, strings.TrimSpace(in.ItemTitle), in.Description, in.StartingPrice, in.Status, in.StartTime, in.EndTime).Scan(&x.ID, &x.ItemTitle, &x.Description, &x.StartingPrice, &x.CurrentHigh, &x.Winner, &x.Status, &x.Start, &x.End, &x.Created, &x.Updated)
	if err != nil {
		writeErr(w, 400, "VALIDATION_ERROR", "Unable to create auction", nil)
		return
	}
	writeJSON(w, 201, map[string]any{"auction": x.json()})
}
func encodeCursor(start time.Time, id string) string {
	if start.IsZero() || id == "" {
		return ""
	}
	payload, err := json.Marshal(map[string]any{"start_time": start.UTC().Format(time.RFC3339Nano), "id": id})
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(payload)
}
func decodeCursor(raw string) (time.Time, string, error) {
	if raw == "" {
		return time.Time{}, "", nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return time.Time{}, "", err
	}
	var cursor struct {
		StartTime string `json:"start_time"`
		ID        string `json:"id"`
	}
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return time.Time{}, "", err
	}
	start, err := time.Parse(time.RFC3339Nano, cursor.StartTime)
	if err != nil {
		return time.Time{}, "", err
	}
	if strings.TrimSpace(cursor.ID) == "" {
		return time.Time{}, "", fmt.Errorf("missing cursor id")
	}
	return start, cursor.ID, nil
}
func (a *App) listAuctions(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	if status == "" {
		status = "ACTIVE"
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit == 0 {
		limit = 20
	}
	if limit < 1 || limit > 100 {
		writeErr(w, 400, "VALIDATION_ERROR", "Invalid limit", nil)
		return
	}
	cursor := r.URL.Query().Get("cursor")
	var start time.Time
	var cursorID string
	if cursor != "" {
		var err error
		start, cursorID, err = decodeCursor(cursor)
		if err != nil {
			writeErr(w, 400, "VALIDATION_ERROR", "Invalid cursor", nil)
			return
		}
	}
	query := `select id,item_title,description,starting_price,current_high_price,winner_id,status,start_time,end_time,created_at,updated_at from auctions where status=$1`
	args := []any{status}
	idx := 2
	if cursorID != "" {
		query += ` and (start_time < $2 or (start_time = $2 and id < $3))`
		args = append(args, start, cursorID)
		idx = 4
	}
	query += ` order by start_time desc,id desc limit $` + strconv.Itoa(idx)
	args = append(args, limit+1)
	rows, e := a.DB.Query(r.Context(), query, args...)
	if e != nil {
		writeErr(w, 500, "INTERNAL_ERROR", "Unable to list auctions", nil)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var x auction
		if e = rows.Scan(&x.ID, &x.ItemTitle, &x.Description, &x.StartingPrice, &x.CurrentHigh, &x.Winner, &x.Status, &x.Start, &x.End, &x.Created, &x.Updated); e != nil {
			writeErr(w, 500, "INTERNAL_ERROR", "Unable to read auctions", nil)
			return
		}
		items = append(items, x.json())
	}
	more := len(items) > limit
	var nextCursor string
	if more {
		items = items[:limit]
		last := items[len(items)-1]
		start, err := time.Parse(time.RFC3339Nano, last["start_time"].(string))
		if err == nil {
			nextCursor = encodeCursor(start, last["id"].(string))
		}
	}
	writeJSON(w, 200, map[string]any{"items": items, "next_cursor": nextCursor, "has_more": more})
}
func (a *App) auction(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		w.WriteHeader(405)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/v1/auctions/")
	if _, e := uuid.Parse(id); e != nil {
		writeErr(w, 400, "VALIDATION_ERROR", "Invalid auction ID", nil)
		return
	}
	x, e := scanAuction(a.DB.QueryRow(r.Context(), `select id,item_title,description,starting_price,current_high_price,winner_id,status,start_time,end_time,created_at,updated_at from auctions where id=$1`, id))
	if e == pgx.ErrNoRows {
		writeErr(w, 404, "AUCTION_NOT_FOUND", "Auction was not found", map[string]string{"auction_id": id})
		return
	}
	if e != nil {
		writeErr(w, 500, "INTERNAL_ERROR", "Unable to load auction", nil)
		return
	}
	if price, redisErr := a.Redis.Get(r.Context(), "auction:"+id+":price").Result(); redisErr == nil && price != "" {
		x.CurrentHigh = &price
	}
	writeJSON(w, 200, map[string]any{"auction": x.json()})
}

var amountPattern = regexp.MustCompile(`^[0-9]{1,10}\.[0-9]{2}$`)

func (a *App) bid(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	uid, e := a.user(r)
	if e != nil {
		writeErr(w, 401, "AUTH_REQUIRED", "Authentication required", nil)
		return
	}
	var in struct{ AuctionID, Amount string }
	if decode(r, &in) != nil || uuid.Validate(in.AuctionID) != nil || !amountPattern.MatchString(in.Amount) {
		writeErr(w, 400, "INVALID_AMOUNT", "Invalid bid", nil)
		return
	}
	var status string
	var start, end time.Time
	var current, starting string
	e = a.DB.QueryRow(r.Context(), "select status,start_time,end_time,current_high_price,starting_price from auctions where id=$1", in.AuctionID).Scan(&status, &start, &end, &current, &starting)
	if e == nil {
		if status != "ACTIVE" || time.Now().Before(start) || time.Now().After(end) {
			writeErr(w, 400, "AUCTION_NOT_BIDDABLE", "Auction is not accepting bids", nil)
			return
		}
		if e := a.Redis.SetNX(r.Context(), "auction:"+in.AuctionID+":price", starting, 0).Err(); e != nil {
			writeErr(w, 503, "TEMPORARILY_UNAVAILABLE", "Bid service unavailable", nil)
			return
		}
		if e := a.Redis.Set(r.Context(), "auction:"+in.AuctionID+":status", "ACTIVE", time.Until(end)).Err(); e != nil {
			writeErr(w, 503, "TEMPORARILY_UNAVAILABLE", "Bid service unavailable", nil)
			return
		}
	}
	if e == pgx.ErrNoRows {
		writeErr(w, 404, "AUCTION_NOT_FOUND", "Auction was not found", nil)
		return
	}
	if e != nil || status != "ACTIVE" || time.Now().Before(start) || time.Now().After(end) {
		writeErr(w, 400, "AUCTION_NOT_BIDDABLE", "Auction is not accepting bids", nil)
		return
	}
	placed := time.Now().UTC()
	payload, _ := json.Marshal(map[string]any{"type": "PRICE_UPDATE", "auction_id": in.AuctionID, "current_high_price": in.Amount, "placed_at": placed.Format(time.RFC3339Nano)})
	ttlSeconds := int64(end.Add(24 * time.Hour).Sub(time.Now()).Seconds())
	if ttlSeconds <= 0 {
		ttlSeconds = 1
	}
	ok, currentHigh, e := evalBid(r.Context(), a.Redis, in.AuctionID, in.Amount, uid, string(payload), ttlSeconds)
	if e != nil {
		log.Printf("bid redis: %v", e)
		writeErr(w, 503, "TEMPORARILY_UNAVAILABLE", "Bid service unavailable", nil)
		return
	}
	if !ok {
		if currentHigh == "" {
			currentHigh = in.Amount
		}
		writeErr(w, 409, "BID_TOO_LOW", "Bid must exceed the current high price", map[string]string{"auction_id": in.AuctionID, "submitted_amount": in.Amount, "current_high_price": currentHigh})
		return
	}
	writeJSON(w, 201, map[string]any{"bid": map[string]any{"id": nil, "auction_id": in.AuctionID, "user_id": uid, "amount": in.Amount, "placed_at": placed.Format(time.RFC3339Nano), "is_winning_bid": true}, "auction": map[string]any{"id": in.AuctionID, "current_high_price": in.Amount, "status": status, "end_time": end.UTC().Format(time.RFC3339Nano)}})
}
func evalBid(ctx context.Context, c *redis.Client, id, amount, user, payload string, ttlSeconds int64) (bool, string, error) {
	r, e := c.Eval(ctx, `if redis.call("GET",KEYS[3]) ~= "ACTIVE" then return {-1,"CLOSED"} end;local p=redis.call("GET",KEYS[1]);if p and tonumber(ARGV[1]) <= tonumber(p) then return {0,p} end;redis.call("SET",KEYS[1],ARGV[1],"EX",ARGV[4]);redis.call("SET",KEYS[2],ARGV[2],"EX",ARGV[4]);redis.call("PUBLISH",KEYS[4],ARGV[3]);return {1,ARGV[1]}`, []string{"auction:" + id + ":price", "auction:" + id + ":leader", "auction:" + id + ":status", "auction:" + id + ":updates"}, amount, user, payload, ttlSeconds).Result()
	if e != nil {
		return false, "", e
	}
	v, ok := r.([]interface{})
	if !ok || len(v) < 2 {
		return false, "", fmt.Errorf("bad redis response")
	}
	n, ok := v[0].(int64)
	if !ok {
		return false, "", fmt.Errorf("invalid bid script result")
	}
	current, _ := v[1].(string)
	return n == 1, current, nil
}
