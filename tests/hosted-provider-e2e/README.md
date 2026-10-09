# tests/hosted-provider-e2e — the P004 hosted-provider E2E battery

Live-provider end-to-end suites for the EXISTING hosted adapters
(`adapters/hosted/r2-object-store` and `adapters/hosted/upstash-redis`)
against the REAL providers, plus the zero-credential fail-closed check.
Evidence transcripts are captured (redacted at capture time) into
`docs/evidence/production/providers/*` — this battery is the producing
surface for the P004 evidence files.

NOT a pnpm workspace project (the `tests/*` precedent — the workspace
root does not include `tests/*`, and adding it would be a root-manifest
edit outside P004's owned surfaces). The battery runs through
adapters/hosted, the workspace package that owns vitest AND the hosted
adapters' provider dependency:

```bash
node tests/hosted-provider-e2e/run.mjs                 # typecheck + vitest
node tests/hosted-provider-e2e/run.mjs --no-app-boot    # skip the served-app suite
```

## Coverage

| Suite | What it proves | Live gate |
|---|---|---|
| `r2/r2-object-lifecycle.test.ts` | authorized write → head → read/download → digest leg → immutable replay → provider-side list (supplementary) → delete → empty bucket; retention honestly recorded as NOT CLAIMED (no retention primitive in the port) | R2 credentials + `ARENA_HOSTED_E2E_R2_BUCKET` (dedicated evidence bucket — content-addressed keys admit no prefix isolation, so a dedicated bucket is the only safe isolation) |
| `r2/r2-failure-matrix.test.ts` | wrong secret → typed `PERSISTENCE_TRANSPORT_FAILED` (fail closed, no fallback) + DEGRADED probe; foreign/nonexistent bucket → typed error, no data; anonymous object read → provider 401/403; wrong-secret read of an existing object → rejected before object-level authz; adapter-level no-retry posture + SDK default retry (local 500,500,200 stub) + quota/throttle 429 posture + port-level fail-closed exhaustion gate (the latter rows AUTOMATED-TEST-ONLY, never claimed live) | live rows need R2 credentials; the object-dependent rows also need the evidence bucket; simulated rows always run |
| `upstash/upstash-coordination.test.ts` | the ACTUAL coordination semantics (not PING): lease acquire/mutual-exclusion/renew/re-acquire/release/TTL-expiry, idempotency open/deterministic-duplicate/typed-conflict/expiry-reopen, fixed-window rate limit counting/over-limit/window reset, cache TTL set/get/delete/expiry, run-namespace isolation; queue honestly recorded as NOT PRESENT in the port | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (run-unique key namespace prefix keeps the shared free-tier Redis hermetic) |
| `upstash/upstash-failure-matrix.test.ts` | wrong REST token → typed transport error + DEGRADED; unreachable endpoint → typed transport error through a real DNS failure; config reader fails closed on partial/invalid configs | Upstash credentials |
| `zero-credential/zero-credential.test.ts` | the fail-closed contract: empty env AND sanitized copies of a credential-rich env both land in DISABLED — typed capacity errors BEFORE any network call (no client constructed), partial configs never half-run | none (always runs) |
| `zero-credential/zero-credential-app-boot.test.ts` | the BUILT app boots and serves the demo with a fully sanitized environment (zero provider credentials) | `apps/web/.next/BUILD_ID` (run `pnpm build` first); disable with `--no-app-boot` |

## Skip semantics (CI carries no credentials by design)

Every live suite self-skips with an EXPLICIT reason (the house pattern —
tests never REQUIRE live credentials). Each domain has an always-run gate
test that reports the activation status:

- `ctx.skip(<reason>)` — printed by the reporter;
- the reason states exactly which env names/gates are missing.

## Evidence capture

Set `ARENA_HOSTED_EVIDENCE_OUT=<dir>` and the suites append
machine-generated, redacted transcript rows (`<facet>.transcript.md`) for
embedding under `docs/evidence/production/providers/`. Every row carries
its evidence class (`DEMONSTRATED-LIVE` or `AUTOMATED-TEST-ONLY` — the
release-gate §3 vocabulary). Secret VALUES are redacted at capture time
(first 4 characters at most, wrapped as `<redacted NAME xxxx…>`).

## Honesty rules encoded here

- A configured resource, PING, or an empty bucket is NOT proof — every
  lifecycle row moves real bytes through the real adapter.
- Simulations (SDK retry stub, 429 injection, port-level exhaustion gate)
  are ALWAYS classified `AUTOMATED-TEST-ONLY`.
- The R2 adapter has no retention primitive and the CoordinationStore has
  no queue primitive — both are recorded as NOT CLAIMED / NOT PRESENT,
  never simulated as live.
