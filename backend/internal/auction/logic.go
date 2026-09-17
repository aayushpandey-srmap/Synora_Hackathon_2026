package auction

import (
	"errors"
	"time"
)
var ErrInvalid = errors.New("invalid auction")
func Validate(title string, starting int64, endsAt, now time.Time) error {
	if title == "" || len(title) > 200 || starting < 0 || !endsAt.After(now) { return ErrInvalid }
	return nil
}
func AcceptBid(current, amount int64, endsAt, now time.Time) bool {
	return amount > current && endsAt.After(now)
}
