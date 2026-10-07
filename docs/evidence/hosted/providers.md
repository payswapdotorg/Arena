# G002 evidence — provider reconciliation (CURRENT, 2026-10-07 13:15–13:20 UTC)

All probes run with the platform's provider credentials; secret VALUES are redacted
(env var NAMES and resource IDs are recorded).

## Neon (control-plane store)

Console API (https://console.neon.tech/api/v2, org-scoped key):

```
project: arena-preview | id steep-moon-56016170 | created 2026-10-04 | (region field not exposed by list endpoint)
```

- Neon project for the hosted preview EXISTS and is current.
- Direct DB connectivity and migration state: **NOT-DERIVABLE without the production
  connection string** (DATABASE_URL is a Vercel env value; the token can list names,
  not decrypt values). Indirect current evidence: the hosted app's /api/health
  readiness (acceptance harness "Health Readiness" PASSED at 13:21 UTC) and the
  B002 hosted persistence adapter design (server-side only). Recorded as an honest
  limitation, not papered over.

## Cloudflare R2 (object store)

SigV4 ListBuckets against `<account>.r2.cloudflarestorage.com` (account id redacted):

```
16 buckets: adcos, aise-artifacts, arena-preview-objects, camscan-parity-evidence,
epoch-evidence, fleetos-staging-evidence, mos-objects, payswap-evidence-preview,
payswap-evidence-prod, reckon-artifacts, roamlink-pa012-backup, sos20-evidence-prod,
sporta-beta-artifacts, webflix-media, you-production, zeck-preview-main-artifacts
```

`arena-preview-objects`: credentials valid, ListObjectsV2 → **0 keys, IsTruncated=false**
(current lifecycle state: bucket provisioned and wired via R2_BUCKET/R2_S3_ENDPOINT
env names on the Vercel project; currently holding no objects — consistent with a
preview workload that has not persisted objects in the current window).

## Upstash (coordination)

```
$ curl $UPSTASH_REDIS_REST_URL/ping -H "Authorization: Bearer <redacted>"
{"result":"PONG"}
```

## Vercel environment posture (names only — values not decryptable by design)

8 env vars on `arena-preview`:

```
ARENA_SESSION_SECRET, DATABASE_URL, R2_ACCESS_KEY_ID, R2_BUCKET, R2_S3_ENDPOINT,
R2_SECRET_ACCESS_KEY, UPSTASH_REDIS_REST_TOKEN, UPSTASH_REDIS_REST_URL
```

Exactly the documented B002 hosted adapter set. **No paid-provider keys are present**
(no payment/model/API provider env names) — consistent with the free-tier,
no-paid-fallback posture.
