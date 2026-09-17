package auction
import ("testing";"time")
func TestAcceptBid(t *testing.T){ now:=time.Unix(100,0); if !AcceptBid(10,10,now.Add(time.Hour),now)||AcceptBid(10,11,now.Add(-time.Second),now){t.Fatal("bid boundary accepted")}; if !AcceptBid(10,11,now.Add(time.Hour),now){t.Fatal("valid bid rejected")} }
func TestValidate(t *testing.T){if Validate("",1,time.Now().Add(time.Hour),time.Now())==nil{t.Fatal("empty title accepted")}}
