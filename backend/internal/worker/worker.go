package worker
import ("context";"time";"auction/backend/internal/store")
type Worker struct { Store *store.Store; Every time.Duration }
func (w *Worker) Run(ctx context.Context){ t:=time.NewTicker(w.Every); defer t.Stop(); for { select { case <-ctx.Done():return; case <-t.C: ids,err:=w.Store.ExpiredOpen(ctx); if err==nil { for _,id:=range ids { _=w.Store.Settle(ctx,id) } } } } }
