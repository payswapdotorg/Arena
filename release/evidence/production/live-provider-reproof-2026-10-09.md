# P008 — Fresh live-provider re-proof at the release-candidate base (DEMONSTRATED-LIVE)

- **Work order:** P008 — release evidence, checklist reconciliation and governance gate (issue #160)
- **Purpose:** release-gate §5 items 2/3/4 re-verification at the P008 dispatch base — the
  gate's minimum bundle requires DIRECT migration/connectivity (Neon), object lifecycle (R2)
  and coordination-semantics (Upstash) proof; historical probes are not current proof.
- **Run window:** 2026-10-09T13:36–13:37Z (all timestamps below are machine-generated at run
  time; no historical evidence was rewritten).
- **Source tree:** worktree `/home/z/worktrees/P008`, branch `work/P008-release-evidence`,
  base `efca69b` (the dispatched release-candidate base; the final RC is the post-merge main
  SHA — see `hosted-availability-and-deploy-linkage.md` for the sequencing note).
- **Node:** v22.22.0 (`/home/z/node22/bin` — the repo pins engines >=22 <23, engine-strict).

## 1. Neon — fresh migration/connectivity battery (release-gate §5.2)

**How this was run (reproducible; credentials NEVER printed or committed):**

```bash
source /home/z/my-project/scripts/env.sh        # NEON_API_KEY_ALT (org-scoped console key)
export PATH=/home/z/node22/bin:$PATH
# 1. create the DEDICATED P008 evidence project "arena-p008-evidence" via
#    POST https://console.neon.tech/api/v2/projects {"project":{"name":"arena-p008-evidence"}}
#    (the ONLY project this lineage writes; all other org projects are read-only to it);
#    the neondb_owner password minted in the creation response is kept ONLY at
#    /tmp/p008-neon-url.txt (mode 600) for the duration of the run — never printed;
# 2. create a FRESH branch (clean database) on that project via
#    POST /api/v2/projects/<id>/branches {"branch":{"name":"p008-evidence-<ts>","parent_id":"<default>"},"endpoints":[{"type":"read_write"}]}
# 3. run the P002 live-Neon acceptance battery through the PRODUCTION composition:
ARENA_P002_NEON_EVIDENCE_URL="$(cat /tmp/p008-neon-url.txt)" \
ARENA_P002_EVIDENCE_OUT=/tmp/p008-neon-evidence \
  node tests/runtime-host/run.mjs
```

**Resources (recorded, not secret):**

- **Dedicated Neon project:** `arena-p008-evidence` — id `spring-waterfall-59948079`
  (created 2026-10-09T13:35:29Z by this lineage; the only project written by this run).
- **Evidence branch (fresh, clean DB):** `p008-evidence-20261009T133542Z` — id
  `br-round-dawn-b4oylla3` (parent: the project's default branch `br-bitter-boat-b497eby8`).
- **Branch endpoint host:** `ep-withered-star-b4gb3cxw.c-6.us-east-2.aws.neon.tech`
  (read/write, region aws-us-east-2).
- **Driver:** the REAL Neon serverless HTTP driver (`@neondatabase/serverless`) via the same
  production composition (`deploy/runtime/src/composition.ts`) the runtime uses.
- **Redacted config:** connection string exists only in the child process environment (and
  the mode-600 /tmp file for this session); no connection string or password appears here.

**Lineage disclosure (honest):** a first project-creation attempt (`fancy-unit-40600200`,
2026-10-09T13:33Z) failed at the branch-creation step (the creation script polled the default
branch before the project finished initializing; the API answered an error payload without a
`branch` key). That half-created project was **deleted** (DELETE
`/api/v2/projects/fancy-unit-40600200`, HTTP 200) and re-created cleanly as
`spring-waterfall-59948079` above. The committed committed battery ran once, green, against
the second project's fresh branch. No shared or pre-existing project was touched; the org
project list was otherwise read-only (it also still carries the earlier dedicated evidence
projects `arena-p002-evidence` and `arena-p002f1-evidence` — not modified by this run).

**Battery result (exact):**

```
 RUN  v5.0.1 /home/z/worktrees/P008/tests/runtime-host
 ✓ composition-parity.test.ts (4 tests) 33ms
 ✓ pglite-acceptance.test.ts (2 tests) 8187ms
 ✓ live-neon-acceptance.test.ts (1 test) 24636ms
 Test Files  3 passed (3)
      Tests  7 passed (7)
 Start at  13:36:15 / Duration  35.35s
```

**Machine-generated transcript (verbatim, redacted at capture time):**

```markdown
<!-- /tmp/p008-neon-evidence/live-neon-transcript.md (2026-10-09T13:36Z) -->
# P002 acceptance proofs — live-neon
- clock: ManualClock pinned at 2026-10-07T10:00:00.000Z (A015 injected time)
- (a) start #1 applied migrations: [1,2,3,4,5,6]
- (b) escalation persisted + read back: requestId=esc_…(36 chars) state=matching lens=customer
- (c) restart: migrationsApplied=[] recovery={"nonTerminalJobs":1,"reclaimedLeases":1,"terminalJobsUntouched":0}
- audit chain: 3 records, digest-linked across the restart boundary (head 26b7fadc8763…(64 hex))
- (d) replay returned requestId=esc_…(36 chars) outcome="replay"; recorded outcome stable (274 bytes)
- (e) cross-tenant fail-closed: create=RUNTIME_CROSS_TENANT_ACCESS read=RUNTIME_ESCALATION_NOT_FOUND act=ESCALATION_CROSS_TENANT_ACCESS list=0
- health: state="started" ready=true capacity="AVAILABLE"
```

**Reading against release-gate §5.1/§5.2:** migrations **1..6 applied from zero** on a fresh
branch of the dedicated project (the current latest ledger — includes P002-F1's migration
0006), an accepted escalation **persisted and read back** through the real adapter, a **hard
restart resumed** (one non-terminal job reclaimed, zero terminal jobs re-executed), retries
returned the **deterministic recorded replay outcome**, and **cross-tenant access failed
closed** on every path. The embedded-PGlite transcript of the same battery (identical shape,
engine PGlite) is recorded at `/tmp/p008-neon-evidence/embedded-postgres-transcript.md`
(AUTOMATED-TEST-ONLY class for the CI path).

## 2. R2 + Upstash — fresh hosted-provider battery (release-gate §5.3/§5.4)

**How this was run (reproducible):**

```bash
export PATH=/home/z/node22/bin:$PATH
source /home/z/my-project/scripts/env.sh      # UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN / CLOUDFLARE_ACCOUNT_ID
set -a; source /tmp/r2_old.env; set +a        # R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_S3_ENDPOINT (SigV4 S3 keys — operator secret store, never committed)
export R2_BUCKET=arena-p004-evidence          # base configuration the adapter env reader requires
export ARENA_HOSTED_E2E_R2_BUCKET=arena-p004-evidence   # the P004 dedicated-bucket gate (bucket-level isolation — content-addressed keys admit no prefix isolation)
export ARENA_HOSTED_EVIDENCE_OUT=/tmp/p008-provider-evidence
node tests/hosted-provider-e2e/run.mjs --no-app-boot   # app-boot suite skipped (no apps/web build yet at probe time) — disclosed
```

**Battery result (exact):**

```
 ✓ r2/r2-failure-matrix.test.ts (11 tests) 3326ms
 ✓ upstash/upstash-coordination.test.ts (10 tests) 18716ms
 ✓ r2/r2-object-lifecycle.test.ts (11 tests) 3201ms
 ✓ zero-credential/zero-credential.test.ts (4 tests) 8ms
 ✓ upstash/upstash-failure-matrix.test.ts (5 tests) 480ms
 ✓ zero-credential/zero-credential-app-boot.test.ts (2 tests | 2 skipped) 3ms
 Test Files  6 passed (6)
      Tests  41 passed | 2 skipped (43)
 Start at  13:37:12 / Duration  28.68s
```

The 2 skips are the app-boot suite (run with `--no-app-boot` because `apps/web/.next/BUILD_ID`
had not been built at probe time; the P004 committed evidence
`docs/evidence/production/providers/capacity/zero-credential-boot.md` covers that row's
DEMONSTRATED-LIVE class from its own run — this re-proof does not re-claim it).

**Resources:** bucket `arena-p004-evidence` (the P004 dedicated evidence bucket, re-verified
present via HeadBucket HTTP 200 as part of the lifecycle suite's capacity probe row); Upstash
REST endpoint `https://polished-yeti-167554.upstash.io` (the operator's shared free-tier
Redis; this battery's keys are run-unique-prefixed and hermetic — the namespace-isolation row
proves the scoping). Secret VALUES never appear below; only env-var NAMES and resource IDs.

### 2.1 R2 object lifecycle (transcript, machine-generated, verbatim)

<!-- machine-generated transcript fragment (tests/hosted-provider-e2e, facet: r2-lifecycle) — re-proof run 2026-10-09T13:37Z -->
| timestamp (UTC) | step | command | resource | result | class |
|---|---|---|---|---|---|
> 2026-10-09T13:37:36.048Z — live suite ACTIVE — dedicated evidence bucket: arena-p004-evidence, endpoint: https://<redacted CLOUDFLARE_ACCOUNT_ID 7e33…>.r2.cloudflarestorage.com
| 2026-10-09T13:37:36.540Z | probe | R2BlobStore.capacityProbe() [transport: HeadBucket] | bucket arena-p004-evidence | status=AVAILABLE checkedAt=1791553056539 (probe only — the lifecycle proof is the write/read/delete steps below) | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:37.095Z | authorized write | R2BlobStore.put({content, contentType=application/json, metadata}) [transport: HeadObject + PutObject] | bucket arena-p004-evidence, key sha256:0b3f6c76412cc419bfa7986bcb613f2e95e73e62c4afc9f4c7f50e4cc069dfd2 | byteLength=208 createdAt=1791553056781 alreadyPresent=false | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:37.233Z | head | R2BlobStore.exists(key) [transport: HeadObject] | bucket arena-p004-evidence, key sha256:0b3f6c76412cc419bfa7986bcb613f2e95e73e62c4afc9f4c7f50e4cc069dfd2 | exists=true | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:37.461Z | authorized read + download | R2BlobStore.get(key) [transport: GetObject + transformToByteArray] | bucket arena-p004-evidence, key sha256:0b3f6c76412cc419bfa7986bcb613f2e95e73e62c4afc9f4c7f50e4cc069dfd2 | bytes=208 contentType=application/json metadata={surface,run} — downloaded bytes byte-equal to the written payload | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:37.606Z | digest leg (list-or-digest) | computeBlobDigest(downloadedContent) === blobKeyDigest(key) | bucket arena-p004-evidence, key sha256:0b3f6c76412cc419bfa7986bcb613f2e95e73e62c4afc9f4c7f50e4cc069dfd2 | sha256 recomputed over downloaded bytes matches the content-addressed key (the BlobStore port exposes no list op; the key IS the digest — this is the gate's digest leg) | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:37.940Z | immutable replay | R2BlobStore.put(identical content, different metadata) | bucket arena-p004-evidence, key sha256:0b3f6c76412cc419bfa7986bcb613f2e95e73e62c4afc9f4c7f50e4cc069dfd2 | alreadyPresent=true createdAt preserved (1791553056781); first write's metadata preserved (content addressing — in-place mutation unrepresentable) | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:38.134Z | provider-side list (supplementary) | S3Client.send(ListObjectsV2Command) — same credentials/client construction as the adapter transport; NOT an adapter op (the port has no list vocabulary) | bucket arena-p004-evidence | keys=[sha256:0b3f6c76412cc419bfa7986bcb613f2e95e73e62c4afc9f4c7f50e4cc069dfd2] — the evidence object is present | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:38.848Z | delete | R2BlobStore.delete(key) [transport: HeadObject + DeleteObject]; then exists/get/delete-again | bucket arena-p004-evidence, key sha256:0b3f6c76412cc419bfa7986bcb613f2e95e73e62c4afc9f4c7f50e4cc069dfd2 | delete=true; exists=false; get=null; second delete=false (lifecycle closed) | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:39.032Z | provider-side list after delete (supplementary) | S3Client.send(ListObjectsV2Command) | bucket arena-p004-evidence | keyCount=0 — bucket empty after the lifecycle (not "configured resource" evidence: real bytes were written and removed) | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:39.033Z | retention (not supported by the adapter) | n/a — no retention/lifecycle op exists in BlobStore or ObjectStorageTransport | bucket arena-p004-evidence | deletion is immediate; retention rules are not representable through this adapter — recorded as NOT CLAIMED, per the gate wording "(retention if the adapter supports it)" | AUTOMATED-TEST-ONLY |

### 2.2 Upstash coordination semantics (transcript, machine-generated, verbatim)

<!-- machine-generated transcript fragment (tests/hosted-provider-e2e, facet: upstash-coordination) — re-proof run 2026-10-09T13:37Z -->
| timestamp (UTC) | step | command | resource | result | class |
|---|---|---|---|---|---|
> 2026-10-09T13:37:16.949Z — live suite ACTIVE — endpoint: https://polished-yeti-167554.upstash.io, keyNamespacePrefix: p004-2b7ad38fef83: (run-unique; hermetic live run)
| 2026-10-09T13:37:17.367Z | probe (context only) | UpstashCoordinationStore.capacityProbe() [transport: PING over REST] | https://polished-yeti-167554.upstash.io | status=AVAILABLE (PING — deliberately NOT counted as coordination proof; the lease/idempotency/rate-limit rows below are) | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:21.155Z | lease lifecycle (lock semantics) | acquireLease/leaseHolder/acquireLease(other)/renewLease(other+self)/acquireLease(self)/releaseLease(other+self) [transport: SET NX PX, GET, SET PX, DEL] | https://polished-yeti-167554.upstash.io key p004-2b7ad38fef83:arena:lease:p004-7a144054-lease-primary | acquire=true; read-back=holder-a; competing acquire=false; foreign renew=false; self renew=true; self re-acquire=true (TTL extension); foreign release=false; self release=true; holder=null | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:24.176Z | lease expiry | acquireLease(ttl=1200ms) → sleep 1700ms → leaseHolder → acquireLease(other holder) | https://polished-yeti-167554.upstash.io key p004-2b7ad38fef83:arena:lease:p004-7a144054-lease-expiry | after TTL: holder=null; next holder acquires=true (server-side PX expiry observed live — not a clock simulation) | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:25.485Z | idempotency window: open / duplicate / conflict | openIdempotencyWindow(key, digestA, ttl) → replay(digestA) → replay(digestB) [transport: SET NX PX, GET] | https://polished-yeti-167554.upstash.io key p004-2b7ad38fef83:arena:idem:14612ea4-a3da-49b3-a0f5-c7b344f735c7 | opened (expiresAt=1791553104179); duplicate with the SAME expiresAt (deterministic replay); different digest → typed PERSISTENCE_IDEMPOTENCY_CONFLICT | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:27.717Z | idempotency window: expiry | openIdempotencyWindow(ttl=1200ms) → sleep 1700ms → openIdempotencyWindow(60s) | https://polished-yeti-167554.upstash.io key p004-2b7ad38fef83:arena:idem:106ab955-10d9-4c76-a203-7e6538a49cd3 | outcome=opened with a fresh expiry (the expired window no longer dedupes — server-side TTL observed live) | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:30.783Z | rate-limit fixed window | hitRateLimit(key, windowMs=3000, limit=3) ×4 → wait past resetAt → hit again [transport: INCR, PEXPIRE] | https://polished-yeti-167554.upstash.io key p004-2b7ad38fef83:arena:rl:p004-7a144054-ratelimit:<windowStart> | counts 1,2,3 allowed; 4th denied (allowed=false, remaining=0, resetAt=1791553050000); after the window boundary the counter restarts at 1 (self-expiring window observed live) | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:34.617Z | cache TTL | cacheSet/cacheGet/cacheDelete; cacheSet(ttl=1200ms) → sleep 1700ms → cacheGet [transport: SET PX, GET, DEL] | https://polished-yeti-167554.upstash.io keys p004-2b7ad38fef83:arena:cache:p004-7a144054-cache, …:p004-7a144054-cache-ttl | value round-trips; delete=true then false; expired value reads null (server-side PX expiry) | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:35.661Z | namespace isolation (bounded/rebuildable state scoping) | store(prefix A).acquireLease → store(prefix B).leaseHolder(same logical key) | https://polished-yeti-167554.upstash.io keys p004-2b7ad38fef83:arena:lease:p004-7a144054-isolation vs p004-854777cef902:arena:lease:p004-7a144054-isolation | prefix B observes null — runs never share state on the shared free-tier Redis (hermetic live runs) | DEMONSTRATED-LIVE |
> 2026-10-09T13:37:35.662Z — queue enqueue/dequeue: NOT PRESENT in the CoordinationStore port (cache/idempotency/rate-limit/lease are the four bounded sub-surfaces). The runtime queue semantics are owned by the durable job runner over the control plane (P002 surface) — no queue claim is made here and none is simulated.

### 2.3 R2 failure/capacity matrix (transcript, machine-generated, verbatim)

<!-- machine-generated transcript fragment (tests/hosted-provider-e2e, facet: r2-failure-capacity) — re-proof run 2026-10-09T13:37Z -->
| timestamp (UTC) | step | command | resource | result | class |
|---|---|---|---|---|---|
| 2026-10-09T13:37:13.413Z | wrong credentials (secret access key) | R2BlobStore.put(...) with R2_SECRET_ACCESS_KEY=<deliberately-invalid> [transport: HeadObject] | bucket arena-p004-evidence @ https://<redacted CLOUDFLARE_ACCOUNT_ID 7e33…>.r2.cloudflarestorage.com | typed PERSISTENCE_TRANSPORT_FAILED (provider answered 403, cause name Unknown) — fail closed, no silent fallback, secret value absent from the typed message | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:13.536Z | wrong credentials — capacity state | R2BlobStore.capacityProbe() with R2_SECRET_ACCESS_KEY=<deliberately-invalid> [transport: HeadBucket] | bucket arena-p004-evidence @ https://<redacted CLOUDFLARE_ACCOUNT_ID 7e33…>.r2.cloudflarestorage.com | status=DEGRADED reasons=[probe-failed] (a misconfigured adapter is never reported healthy) | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:14.571Z | unauthorized/foreign bucket access | R2BlobStore.put(...) with R2_BUCKET=arena-p004-evidence-nonexistent-2995673788fb (valid credentials, bucket not present in this account) | bucket arena-p004-evidence-nonexistent-2995673788fb @ https://<redacted CLOUDFLARE_ACCOUNT_ID 7e33…>.r2.cloudflarestorage.com | typed PERSISTENCE_TRANSPORT_FAILED (provider answered 404, cause name NoSuchBucket) — no object data, no fallback path. Honest scope: single-account credentials — a TRUE cross-tenant bucket (another Cloudflare account) is not reachable from here; a nonexistent bucket name is the client-side shape of that attempt. | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:15.206Z | anonymous object access (no credentials) | fetch GET https://<redacted CLOUDFLARE_ACCOUNT_ID 7e33…>.r2.cloudflarestorage.com/arena-p004-evidence/sha256:b48e606913ae094422ab4940cacd3ca8895489385ab38eb1e9369e36d3ff6584 — unsigned, no Authorization header | bucket arena-p004-evidence, key sha256:b48e606913ae094422ab4940cacd3ca8895489385ab38eb1e9369e36d3ff6584 | HTTP 400 <?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error> — private-by-default: the provider rejects unsigned reads before object access; object bytes never returned | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:16.135Z | wrong-secret read of an existing object | R2BlobStore.get(key) with R2_SECRET_ACCESS_KEY=<deliberately-invalid> | bucket arena-p004-evidence, key sha256:7297958526dcac028c40cbd714b5f135b7d3033570e5c75925acf27507d9a63c | typed PERSISTENCE_TRANSPORT_FAILED (provider answered 403) — authentication precedes object-level authorization: the object's existence/bytes are not disclosed | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:16.400Z | adapter-level retry posture | R2BlobStore.put(...) over an injected counting transport that always fails | in-process transport seam (no network) | exactly 1 putObject call — the ADAPTER does not retry; failures surface as the typed TRANSPORT_FAILED error (deterministic single-attempt semantics; retry policy is delegated to the transport layer) | AUTOMATED-TEST-ONLY |
| 2026-10-09T13:37:16.505Z | transport-level retry policy | S3Client( SAME options as createR2ObjectStorageTransport ).send(HeadBucketCommand) against a local stub answering 500,500,200 | local stub 127.0.0.1:36285 (no provider round-trip) | 3 HTTP attempts, command resolved — the @aws-sdk/client-s3 default retry strategy (maxAttempts=3) covers transient 5xx at the transport layer | AUTOMATED-TEST-ONLY |
| 2026-10-09T13:37:16.507Z | quota/throttle error path (429 SlowDown) | R2BlobStore.put(...) over an injected transport throwing S3ServiceException SlowDown/429 on head_object | in-process transport seam (no network) | typed PERSISTENCE_TRANSPORT_FAILED after exactly 1 attempt — no second destination, no silent paid fallback (none is representable in the taxonomy); the caller fails closed | AUTOMATED-TEST-ONLY |
| 2026-10-09T13:37:16.508Z | port-level exhaustion gate | assertCapacityUsable(toCapacitySnapshot({status: EXHAUSTED, reasons: [quota-exhausted]})) | @arena/persistence capacity model (in-process) | throws PERSISTENCE_CAPACITY_EXHAUSTED; CAPACITY_EXHAUSTION_POLICY === 'fail-closed' is the only representable policy — live quota exhaustion was NOT triggered (filling the shared free-tier allowance or throttling the shared credentials would damage other tenants of this account); usage metering that decides EXHAUSTED lives in the deploy wiring (deploy/src/hosted/quotas.ts — outside P004 surfaces) | AUTOMATED-TEST-ONLY |
> 2026-10-09T13:37:16.508Z — live quota exhaustion NOT demonstrated and NOT claimed: a safe live trigger does not exist for the shared account (10 GiB storage allowance / request throttling shared with other projects). The 429 code path and the port-level fail-closed gate are the AUTOMATED-TEST-ONLY evidence above.

### 2.4 Upstash failure/capacity matrix (transcript, machine-generated, verbatim)

<!-- machine-generated transcript fragment (tests/hosted-provider-e2e, facet: upstash-failure-capacity) — re-proof run 2026-10-09T13:37Z -->
| timestamp (UTC) | step | command | resource | result | class |
|---|---|---|---|---|---|
| 2026-10-09T13:37:40.336Z | wrong credentials (REST bearer token) | UpstashCoordinationStore.cacheSet(...) with UPSTASH_REDIS_REST_TOKEN=<deliberately-invalid> [transport: SET over REST] | https://polished-yeti-167554.upstash.io | typed PERSISTENCE_TRANSPORT_FAILED (cause: REST endpoint answered 401 — the endpoint rejected the token; detail stays in cause, never in the typed message) — fail closed, no silent fallback | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:40.546Z | wrong credentials — capacity state | UpstashCoordinationStore.capacityProbe() with UPSTASH_REDIS_REST_TOKEN=<deliberately-invalid> [transport: PING over REST] | https://polished-yeti-167554.upstash.io | status=DEGRADED reasons=[probe-failed] (a misconfigured adapter is never reported healthy) | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:40.560Z | unreachable endpoint | UpstashCoordinationStore.cacheGet(...) with UPSTASH_REDIS_REST_URL=https://p004-unreachable-host.invalid [transport: GET over REST] | https://p004-unreachable-host.invalid | typed PERSISTENCE_TRANSPORT_FAILED; capacity probe DEGRADED. Scope stated exactly: a REAL DNS resolution failure (RFC-2606 .invalid host) through the real network stack — no provider round-trip is involved in this row | DEMONSTRATED-LIVE |

### 2.5 Zero-credential fail-closed posture (transcript, machine-generated, verbatim)

<!-- machine-generated transcript fragment (tests/hosted-provider-e2e, facet: zero-credential) — re-proof run 2026-10-09T13:37Z -->
| timestamp (UTC) | step | command | resource | result | class |
|---|---|---|---|---|---|
| 2026-10-09T13:37:39.685Z | R2 zero-credential posture | new R2BlobStore({ env: {} }) → capacityProbe() + put/get/exists/delete | in-process (no network — the gate fires before any transport exists) | enabled=false; probe=DISABLED reasons=[configuration-missing]; every operation → typed PERSISTENCE_CAPACITY_DISABLED with missingEnvVarNames (the env-var NAMES, never values) | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:39.687Z | Upstash zero-credential posture | new UpstashCoordinationStore({ env: {} }) → capacityProbe() + cacheSet/cacheGet/openIdempotencyWindow/hitRateLimit/acquireLease | in-process (no network — the gate fires before any transport exists) | enabled=false; probe=DISABLED reasons=[configuration-missing]; every operation → typed PERSISTENCE_CAPACITY_DISABLED with missingEnvVarNames [UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN] | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:39.688Z | partial-configuration posture | R2BlobStore({R2_ACCESS_KEY_ID only}); UpstashCoordinationStore({URL only}) | in-process | both DISABLED reasons=[configuration-missing] — partial credentials never produce a half-live adapter | DEMONSTRATED-LIVE |
| 2026-10-09T13:37:39.688Z | sanitized-environment posture | sanitizedEnv(process.env) — removed 19 provider env names: DATABASE_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_S3_ENDPOINT, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, VERCEL_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, NEON_API_KEY, NEON_API_KEY_ALT, UPSTASH_MCP_API_KEY, UPSTASH_MCP_URL, UPSTASH_ACCOUNT_EMAIL, UPSTASH_REDIS_REST_TOKEN_ALT, UPSTASH_REDIS_REST_TOKEN_OLD, ARENA_HOSTED_E2E_R2_BUCKET, ARENA_HOSTED_EVIDENCE_OUT (NAMES only) | in-process | both adapters DISABLED — sanitization (not mere absence) yields the zero-credential fail-closed posture | DEMONSTRATED-LIVE |

## 3. What this re-proof means (and does not mean)

- **DEMONSTRATED-LIVE at 2026-10-09T13:36–13:37Z, source tree efca69b:** Neon migration
  zero→latest (versions 1..6) + persistence + restart-resume + deterministic replay +
  cross-tenant fail-closed on a fresh branch of a dedicated project; the R2
  write/head/read/download/digest/immutable-replay/delete lifecycle (bucket empty again
  afterwards); the Upstash lease/idempotency/rate-limit/cache coordination semantics with
  server-side TTL; wrong-credential and anonymous fail-closed postures for both providers;
  the zero-credential DISABLED posture.
- **AUTOMATED-TEST-ONLY (stated, not claimed live):** adapter/transport retry rows and the
  port-level EXHAUSTED gate (no safe live quota-exhaustion trigger exists on the shared
  account — register row F-04a); the app-boot suite row (skipped here; covered by the P004
  committed evidence).
- **NOT re-proven here:** the hosted app's own runtime wiring against these providers (the
  hosted deployment is frozen at an older SHA — see
  `hosted-availability-and-deploy-linkage.md`); retention/lifecycle ops (absent from the
  adapter port — register row F-04b); true cross-account bucket access (single-account
  credentials — register row F-04d).
