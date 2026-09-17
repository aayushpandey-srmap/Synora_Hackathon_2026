package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"github.com/golang-jwt/jwt/v5"
)

type Claims struct { UserID string `json:"sub"`; jwt.RegisteredClaims }
type Service struct { secret []byte; ttl time.Duration }
func New(secret []byte, ttl time.Duration) *Service { return &Service{secret, ttl} }
func (s *Service) Issue(userID string) (string, error) {
	return jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{UserID:userID, RegisteredClaims:jwt.RegisteredClaims{Subject:userID, ExpiresAt:jwt.NewNumericDate(time.Now().Add(s.ttl)), IssuedAt:jwt.NewNumericDate(time.Now())}}).SignedString(s.secret)
}
func (s *Service) Parse(token string) (string, error) {
	t, err := jwt.ParseWithClaims(token, &Claims{}, func(t *jwt.Token) (any,error) {
		if t.Method != jwt.SigningMethodHS256 { return nil, errors.New("unexpected signing method") }; return s.secret,nil
	})
	if err != nil || !t.Valid { return "", errors.New("invalid token") }
	c, ok := t.Claims.(*Claims); if !ok || c.Subject == "" { return "", errors.New("invalid claims") }; return c.Subject,nil
}
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter,r *http.Request) {
		h := r.Header.Get("Authorization"); if !strings.HasPrefix(h,"Bearer ") { http.Error(w,"unauthorized",http.StatusUnauthorized); return }
		id, err := s.Parse(strings.TrimPrefix(h,"Bearer ")); if err != nil { http.Error(w,"unauthorized",http.StatusUnauthorized); return }
		next.ServeHTTP(w,r.WithContext(context.WithValue(r.Context(), userKey{}, id)))
	})
}
type userKey struct{}
func UserID(ctx context.Context) string { v,_ := ctx.Value(userKey{}).(string); return v }
