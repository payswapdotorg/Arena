# P004 evidence — Upstash failure/capacity matrix

**Work order:** P004 (issue #156) · **Release gate:** §5.4 posture obligations (wrong
credentials, fail-closed, no fallback).
**Producing suite:** `tests/hosted-provider-e2e/upstash/upstash-failure-matrix.test.ts`.

**Transcript below:** the finisher's live re-verification run (2026-10-09T05:36Z — the
predecessor worker captured an identical row set at 05:27Z but died before committing it;
all 43 battery tests re-ran green with zero skips).

| Scenario | Claim proven | Class |
|---|---|---|
| Wrong REST bearer token | typed `PERSISTENCE_TRANSPORT_FAILED`; the REAL endpoint answered 401 (detail stays in `cause`); token value never in the typed message; probe DEGRADED | DEMONSTRATED-LIVE |
| Unreachable endpoint | typed `PERSISTENCE_TRANSPORT_FAILED`; probe DEGRADED. Scope stated exactly: a REAL DNS resolution failure (RFC-2606 `.invalid` host) through the real network stack — no provider round-trip is involved in this row | DEMONSTRATED-LIVE (network-failure path; scope stated) |
| Unusable configuration | `readUpstashConfigFromEnv` resolves null for empty / non-http URL / blank token — DISABLED, never a half-configured transport | DEMONSTRATED-LIVE (in-process config reader) |
| No configuration at all | DISABLED before any network call — see `capacity/zero-credential-boot.md` | DEMONSTRATED-LIVE |

## Transcript (machine-generated, verbatim)

<!-- machine-generated transcript fragment (tests/hosted-provider-e2e, facet: upstash-failure-capacity) -->
<!-- embed VERBATIM under docs/evidence/production/providers/ -->
| timestamp (UTC) | step | command | resource | result | class |
|---|---|---|---|---|---|
| 2026-10-09T05:36:35.498Z | wrong credentials (REST bearer token) | UpstashCoordinationStore.cacheSet(...) with UPSTASH_REDIS_REST_TOKEN=<deliberately-invalid> [transport: SET over REST] | https://polished-yeti-167554.upstash.io | typed PERSISTENCE_TRANSPORT_FAILED (cause: REST endpoint answered 401 — the endpoint rejected the token; detail stays in cause, never in the typed message) — fail closed, no silent fallback | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:35.687Z | wrong credentials — capacity state | UpstashCoordinationStore.capacityProbe() with UPSTASH_REDIS_REST_TOKEN=<deliberately-invalid> [transport: PING over REST] | https://polished-yeti-167554.upstash.io | status=DEGRADED reasons=[probe-failed] (a misconfigured adapter is never reported healthy) | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:35.694Z | unreachable endpoint | UpstashCoordinationStore.cacheGet(...) with UPSTASH_REDIS_REST_URL=https://p004-unreachable-host.invalid [transport: GET over REST] | https://p004-unreachable-host.invalid | typed PERSISTENCE_TRANSPORT_FAILED; capacity probe DEGRADED. Scope stated exactly: a REAL DNS resolution failure (RFC-2606 .invalid host) through the real network stack — no provider round-trip is involved in this row | DEMONSTRATED-LIVE |

