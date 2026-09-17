package bid

import "time"

// Valid reports whether a bid can beat the current value at the server's
// observed time. The Redis script performs the same check atomically.
func Valid(current, amount int64, endsAt, now time.Time) bool {
	return amount > current && endsAt.After(now)
}
