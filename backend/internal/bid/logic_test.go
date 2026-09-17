package bid

import (
	"testing"
	"time"
)

func TestValid(t *testing.T) {
	now := time.Unix(100, 0)
	if Valid(5, 5, now.Add(time.Hour), now) || Valid(5, 6, now, now) {
		t.Fatal("boundary bid accepted")
	}
	if !Valid(5, 6, now.Add(time.Second), now) {
		t.Fatal("valid bid rejected")
	}
}
