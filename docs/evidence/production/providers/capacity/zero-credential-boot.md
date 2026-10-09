# P004 evidence — demo-with-zero-credentials check (the fail-closed contract)

**Work order:** P004 (issue #156) · **Work-items acceptance:** "Demo still runs with zero
provider credentials."
**Producing suites:** `tests/hosted-provider-e2e/zero-credential/zero-credential.test.ts`
(adapter layer, always runs) and
`tests/hosted-provider-e2e/zero-credential/zero-credential-app-boot.test.ts` (the BUILT app,
live boot).

**Transcript below:** the finisher's live re-verification run (2026-10-09T05:36Z — the
predecessor worker captured an identical row set at 05:27Z but died before committing it;
all 43 battery tests re-ran green with zero skips). The recorder's per-row length cap was
raised 400 → 1200 for this run, so both env-name rows below now embed the COMPLETE list of
the 19 removed provider env-var NAMES (the predecessor's capture had truncated them mid-list;
NAMES only — never values).

## What was proven

1. **Adapter layer (no credentials by construction):** with an EMPTY env and with a SANITIZED
   copy of a credential-rich environment, both hosted adapters are `DISABLED` —
   `capacityProbe()` reports `DISABLED` with reason `configuration-missing`, and EVERY port
   operation throws the typed `PERSISTENCE_CAPACITY_DISABLED` BEFORE any network call (no
   client/transport is constructed at all — `enabled === false`). Partial configurations are
   also `DISABLED`. The typed errors carry env-var NAMES only, never values.
2. **App layer (live boot of the production artifact):** the built app
   (`apps/web` production build, BUILD_ID present) boots under `next start` with a fully
   sanitized environment — 19 provider credential names removed (the hosted env contract
   names from `deploy/src/hosted/env-contract.ts` plus the sandbox-side provider variables) —
   and serves the demo (`GET /demo → 200`, `GET / → 200`). Absence of every provider
   degrades nothing the demo needs; there is no crash and no fallback provider.

## Transcript (machine-generated, verbatim)

<!-- machine-generated transcript fragment (tests/hosted-provider-e2e, facet: zero-credential) -->
<!-- embed VERBATIM under docs/evidence/production/providers/ -->
| timestamp (UTC) | step | command | resource | result | class |
|---|---|---|---|---|---|
| 2026-10-09T05:36:35.025Z | app boot with zero provider credentials | next start -p 31324 with sanitizedEnv(process.env) — removed 19 provider env names: DATABASE_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_S3_ENDPOINT, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, VERCEL_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, NEON_API_KEY, NEON_API_KEY_ALT, UPSTASH_MCP_API_KEY, UPSTASH_MCP_URL, UPSTASH_ACCOUNT_EMAIL, UPSTASH_REDIS_REST_TOKEN_ALT, UPSTASH_REDIS_REST_TOKEN_OLD, ARENA_HOSTED_E2E_R2_BUCKET, ARENA_HOSTED_EVIDENCE_OUT (NAMES only) | apps/web production build @ /home/z/worktrees/P004/apps/web (BUILD_ID present), http://127.0.0.1:31324 | GET /demo → 200; GET / → 200 (20837 bytes) — the demo runs with NO provider credentials set (the fail-closed contract: absence of providers degrades nothing the demo needs) | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:35.911Z | R2 zero-credential posture | new R2BlobStore({ env: {} }) → capacityProbe() + put/get/exists/delete | in-process (no network — the gate fires before any transport exists) | enabled=false; probe=DISABLED reasons=[configuration-missing]; every operation → typed PERSISTENCE_CAPACITY_DISABLED with missingEnvVarNames (the env-var NAMES, never values) | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:35.913Z | Upstash zero-credential posture | new UpstashCoordinationStore({ env: {} }) → capacityProbe() + cacheSet/cacheGet/openIdempotencyWindow/hitRateLimit/acquireLease | in-process (no network — the gate fires before any transport exists) | enabled=false; probe=DISABLED reasons=[configuration-missing]; every operation → typed PERSISTENCE_CAPACITY_DISABLED with missingEnvVarNames [UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN] | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:35.914Z | partial-configuration posture | R2BlobStore({R2_ACCESS_KEY_ID only}); UpstashCoordinationStore({URL only}) | in-process | both DISABLED reasons=[configuration-missing] — partial credentials never produce a half-live adapter | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:35.915Z | sanitized-environment posture | sanitizedEnv(process.env) — removed 19 provider env names: DATABASE_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_S3_ENDPOINT, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, VERCEL_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, NEON_API_KEY, NEON_API_KEY_ALT, UPSTASH_MCP_API_KEY, UPSTASH_MCP_URL, UPSTASH_ACCOUNT_EMAIL, UPSTASH_REDIS_REST_TOKEN_ALT, UPSTASH_REDIS_REST_TOKEN_OLD, ARENA_HOSTED_E2E_R2_BUCKET, ARENA_HOSTED_EVIDENCE_OUT (NAMES only) | in-process | both adapters DISABLED — sanitization (not mere absence) yields the zero-credential fail-closed posture | DEMONSTRATED-LIVE |

## Note on classification

These rows carry `DEMONSTRATED-LIVE` with an explicit "in-process (no network — the gate fires
before any transport exists)" scope for the adapter rows and a real process boot for the app
row: nothing in the scenario is simulated — the absence of credentials is real, the adapters
are the real adapter classes, and the app is the real production build. The classification
convention (see README.md) keys on whether any part of the scenario was faked; none was.
