# P004 evidence — Upstash coordination semantics (DEMONSTRATED-LIVE)

**Work order:** P004 (issue #156) · **Register rows closed:** L-005 ("Upstash PING ≠
end-to-end coordination proof") · **Release gate:** §5.4 ("the actual
lock/idempotency/lease/queue operation the runtime uses — not PING alone").
**Producing suite:** `tests/hosted-provider-e2e/upstash/upstash-coordination.test.ts` (the
EXISTING adapter `adapters/hosted/upstash-redis` — `UpstashCoordinationStore` — against the
live Upstash Redis REST endpoint).

## How this was run (reproducible command — the finisher re-verification run, 2026-10-09T05:36Z)

```bash
export PATH="/home/z/node22/bin:$HOME/.npm-global/bin:$PATH"   # Node 22 (repo engines pin >=22 <23, engine-strict; sandbox default is 24)
source /home/z/my-project/scripts/env.sh                   # UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
export ARENA_HOSTED_EVIDENCE_OUT=/tmp/p004-evidence-finisher   # transcript capture
node tests/hosted-provider-e2e/run.mjs
```

**Lineage (honest):** the predecessor P004 worker captured an identical row set at
2026-10-09T05:26Z but died before committing the evidence; this finisher re-ran the full
battery live (all 43 tests green, zero skips) and the committed transcript below is the
finisher's re-verification run (run-unique prefix `p004-744cd49ab83a:`).

Run isolation: the suite constructs the store with a RUN-UNIQUE `keyNamespacePrefix`
(`p004-<12hex>:`) — the adapter's hermetic-live-run contract — so the shared free-tier Redis
never carries state between runs. All keys live under `arena:cache:` / `arena:idem:` /
`arena:rl:` / `arena:lease:` namespaces (bounded/rebuildable state only; authoritative facts
never live here).

## Transcript (machine-generated, verbatim)

<!-- machine-generated transcript fragment (tests/hosted-provider-e2e, facet: upstash-coordination) -->
<!-- embed VERBATIM under docs/evidence/production/providers/ -->
| timestamp (UTC) | step | command | resource | result | class |
|---|---|---|---|---|---|
> 2026-10-09T05:36:06.944Z — live suite ACTIVE — endpoint: https://polished-yeti-167554.upstash.io, keyNamespacePrefix: p004-744cd49ab83a: (run-unique; hermetic live run)
| 2026-10-09T05:36:07.345Z | probe (context only) | UpstashCoordinationStore.capacityProbe() [transport: PING over REST] | https://polished-yeti-167554.upstash.io | status=AVAILABLE (PING — deliberately NOT counted as coordination proof; the lease/idempotency/rate-limit rows below are) | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:11.029Z | lease lifecycle (lock semantics) | acquireLease/leaseHolder/acquireLease(other)/renewLease(other+self)/acquireLease(self)/releaseLease(other+self) [transport: SET NX PX, GET, SET PX, DEL] | https://polished-yeti-167554.upstash.io key p004-744cd49ab83a:arena:lease:p004-792d4efa-lease-primary | acquire=true; read-back=holder-a; competing acquire=false; foreign renew=false; self renew=true; self re-acquire=true (TTL extension); foreign release=false; self release=true; holder=null | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:14.011Z | lease expiry | acquireLease(ttl=1200ms) → sleep 1700ms → leaseHolder → acquireLease(other holder) | https://polished-yeti-167554.upstash.io key p004-744cd49ab83a:arena:lease:p004-792d4efa-lease-expiry | after TTL: holder=null; next holder acquires=true (server-side PX expiry observed live — not a clock simulation) | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:15.326Z | idempotency window: open / duplicate / conflict | openIdempotencyWindow(key, digestA, ttl) → replay(digestA) → replay(digestB) [transport: SET NX PX, GET] | https://polished-yeti-167554.upstash.io key p004-744cd49ab83a:arena:idem:631ab590-8b17-4ad8-b1c9-344af07f3880 | opened (expiresAt=1791524234014); duplicate with the SAME expiresAt (deterministic replay); different digest → typed PERSISTENCE_IDEMPOTENCY_CONFLICT | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:17.575Z | idempotency window: expiry | openIdempotencyWindow(ttl=1200ms) → sleep 1700ms → openIdempotencyWindow(60s) | https://polished-yeti-167554.upstash.io key p004-744cd49ab83a:arena:idem:4bbf53fc-3f06-44d6-bc1a-44f7662f39cf | outcome=opened with a fresh expiry (the expired window no longer dedupes — server-side TTL observed live) | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:21.794Z | rate-limit fixed window | hitRateLimit(key, windowMs=3000, limit=3) ×4 → wait past resetAt → hit again [transport: INCR, PEXPIRE] | https://polished-yeti-167554.upstash.io key p004-744cd49ab83a:arena:rl:p004-792d4efa-ratelimit:<windowStart> | counts 1,2,3 allowed; 4th denied (allowed=false, remaining=0, resetAt=1791524181000); after the window boundary the counter restarts at 1 (self-expiring window observed live) | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:25.670Z | cache TTL | cacheSet/cacheGet/cacheDelete; cacheSet(ttl=1200ms) → sleep 1700ms → cacheGet [transport: SET PX, GET, DEL] | https://polished-yeti-167554.upstash.io keys p004-744cd49ab83a:arena:cache:p004-792d4efa-cache, …:p004-792d4efa-cache-ttl | value round-trips; delete=true then false; expired value reads null (server-side PX expiry) | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:26.751Z | namespace isolation (bounded/rebuildable state scoping) | store(prefix A).acquireLease → store(prefix B).leaseHolder(same logical key) | https://polished-yeti-167554.upstash.io keys p004-744cd49ab83a:arena:lease:p004-792d4efa-isolation vs p004-ac42bb3e6387:arena:lease:p004-792d4efa-isolation | prefix B observes null — runs never share state on the shared free-tier Redis (hermetic live runs) | DEMONSTRATED-LIVE |
> 2026-10-09T05:36:26.752Z — queue enqueue/dequeue: NOT PRESENT in the CoordinationStore port (cache/idempotency/rate-limit/lease are the four bounded sub-surfaces). The runtime queue semantics are owned by the durable job runner over the control plane (P002 surface) — no queue claim is made here and none is simulated.

## Reading the semantics against release-gate §5.4

| Gate operation | Where it is proven | Class |
|---|---|---|
| lock/lease | acquire → holder read-back → **mutual exclusion** (competing acquire=false) → renew discipline (foreign renew=false, self renew=true) → same-holder re-acquire (TTL extension) → release discipline (foreign release=false, self release=true) → holder=null | DEMONSTRATED-LIVE |
| lease expiry | 1200ms TTL → server-side expiry observed (holder=null) → next holder acquires | DEMONSTRATED-LIVE |
| idempotency | open (`opened`) → replay same digest (`duplicate` with the **same expiresAt** — deterministic replay) → different digest → typed `PERSISTENCE_IDEMPOTENCY_CONFLICT` → expired window re-opens | DEMONSTRATED-LIVE |
| rate limit | fixed-window INCR counting 1..3 allowed, 4th denied (remaining=0, resetAt recorded), self-expiring window restarts at 1 after the boundary | DEMONSTRATED-LIVE |
| cache | TTL set/get round-trip, delete true→false, server-side TTL expiry reads null | DEMONSTRATED-LIVE |
| queue enqueue/dequeue | **NOT PRESENT in the CoordinationStore port** — cache/idempotency/rate-limit/lease are the four bounded sub-surfaces; the runtime's queue semantics are owned by the durable job runner over the control plane (P002 surface). No queue claim is made and none is simulated | not applicable (honestly recorded) |

**This is not PING evidence:** the only PING row is labeled "context only" — the coordination
proof is the lease/idempotency/rate-limit/cache rows above, all executed against
`https://polished-yeti-167554.upstash.io` with the real REST token.
