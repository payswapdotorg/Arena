# P004 evidence — R2 failure/capacity matrix

**Work order:** P004 (issue #156) · **Release gate:** §5.3 posture obligations
(wrong credentials, cross-tenant/unauthorized access, retries, quota exhaustion,
fail-closed/no-paid-fallback).
**Producing suite:** `tests/hosted-provider-e2e/r2/r2-failure-matrix.test.ts`.

**Transcript below:** the finisher's live re-verification run (2026-10-09T05:36Z — the
predecessor worker captured an identical row set at 05:26–05:27Z but died before committing
it; all 43 battery tests re-ran green with zero skips).

## Summary of claims and classes

| Scenario | Claim proven | Class |
|---|---|---|
| Wrong secret access key | typed `PERSISTENCE_TRANSPORT_FAILED`; provider 403; secret value never in the typed message (detail stays in `cause`); probe DEGRADED — never AVAILABLE | DEMONSTRATED-LIVE |
| Foreign/unauthorized bucket | valid credentials against a bucket not in this account → 404 `NoSuchBucket` → typed error; no data, no fallback. Honest scope: single-account credentials; a TRUE cross-tenant bucket (another Cloudflare account) is unreachable — the nonexistent-bucket name is the client-side shape of that attempt | DEMONSTRATED-LIVE |
| Anonymous object access | unsigned GET for a LIVE object in the evidence bucket → HTTP 400 `InvalidArgument "Authorization"` (R2's unsigned-request rejection); object bytes never returned — private-by-default | DEMONSTRATED-LIVE |
| Wrong-secret read of an existing object | 403 before object-level authorization — the object's existence/bytes are not disclosed | DEMONSTRATED-LIVE |
| Adapter-level retry posture | the adapter performs exactly ONE transport call per operation (no retry loop); failures surface as typed `TRANSPORT_FAILED` | AUTOMATED-TEST-ONLY (injected counting transport) |
| Transport-level retry policy | the `@aws-sdk/client-s3` default retry strategy (maxAttempts=3) retries transient 5xx — demonstrated against a local stub answering 500,500,200 with the SAME client construction as `createR2ObjectStorageTransport` | AUTOMATED-TEST-ONLY (local stub; a live 5xx from R2 is not reproducible on demand) |
| Quota/throttle (429 SlowDown) | a transport-level quota error wraps into the typed `TRANSPORT_FAILED` after exactly ONE attempt — no second destination, no silent paid fallback (not representable in the taxonomy) | AUTOMATED-TEST-ONLY |
| Port-level exhaustion gate | `assertCapacityUsable(EXHAUSTED snapshot)` throws `PERSISTENCE_CAPACITY_EXHAUSTED`; `CAPACITY_EXHAUSTION_POLICY === 'fail-closed'` is the only representable policy | AUTOMATED-TEST-ONLY |
| Live quota exhaustion | NOT demonstrated and NOT claimed — no safe live trigger exists for the shared account (filling the 10 GiB free-tier storage allowance or throttling the shared credentials would damage other tenants of this account). Usage metering that decides EXHAUSTED lives in the deploy wiring (`deploy/src/hosted/quotas.ts`, outside P004 surfaces); the adapters themselves report AVAILABLE/DEGRADED/DISABLED from probe outcomes and never fabricate an EXHAUSTED reading | honestly not claimed |

## Transcript (machine-generated, verbatim)

<!-- machine-generated transcript fragment (tests/hosted-provider-e2e, facet: r2-failure-capacity) -->
<!-- embed VERBATIM under docs/evidence/production/providers/ -->
| timestamp (UTC) | step | command | resource | result | class |
|---|---|---|---|---|---|
| 2026-10-09T05:36:27.204Z | wrong credentials (secret access key) | R2BlobStore.put(...) with R2_SECRET_ACCESS_KEY=<deliberately-invalid> [transport: HeadObject] | bucket arena-p004-evidence @ https://<redacted CLOUDFLARE_ACCOUNT_ID 7e33…>.r2.cloudflarestorage.com | typed PERSISTENCE_TRANSPORT_FAILED (provider answered 403, cause name Unknown) — fail closed, no silent fallback, secret value absent from the typed message | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:27.336Z | wrong credentials — capacity state | R2BlobStore.capacityProbe() with R2_SECRET_ACCESS_KEY=<deliberately-invalid> [transport: HeadBucket] | bucket arena-p004-evidence @ https://<redacted CLOUDFLARE_ACCOUNT_ID 7e33…>.r2.cloudflarestorage.com | status=DEGRADED reasons=[probe-failed] (a misconfigured adapter is never reported healthy) | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:28.374Z | unauthorized/foreign bucket access | R2BlobStore.put(...) with R2_BUCKET=arena-p004-evidence-nonexistent-41ec143c96d0 (valid credentials, bucket not present in this account) | bucket arena-p004-evidence-nonexistent-41ec143c96d0 @ https://<redacted CLOUDFLARE_ACCOUNT_ID 7e33…>.r2.cloudflarestorage.com | typed PERSISTENCE_TRANSPORT_FAILED (provider answered 404, cause name NoSuchBucket) — no object data, no fallback path. Honest scope: single-account credentials — a TRUE cross-tenant bucket (another Cloudflare account) is not reachable from here; a nonexistent bucket name is the client-side shape of that attempt. | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:28.999Z | anonymous object access (no credentials) | fetch GET https://<redacted CLOUDFLARE_ACCOUNT_ID 7e33…>.r2.cloudflarestorage.com/arena-p004-evidence/sha256:86c8dfc1037db1395552516592a0ee20aaddd0cad0d7e986de11998788a6f65a — unsigned, no Authorization header | bucket arena-p004-evidence, key sha256:86c8dfc1037db1395552516592a0ee20aaddd0cad0d7e986de11998788a6f65a | HTTP 400 <?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error> — private-by-default: the provider rejects unsigned reads before object access; object bytes never returned | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:30.034Z | wrong-secret read of an existing object | R2BlobStore.get(key) with R2_SECRET_ACCESS_KEY=<deliberately-invalid> | bucket arena-p004-evidence, key sha256:506a68c6b621d0f7a4baac2cfd373549c1734ae690d9a93db0d5bc0f517ee12b | typed PERSISTENCE_TRANSPORT_FAILED (provider answered 403) — authentication precedes object-level authorization: the object's existence/bytes are not disclosed | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:30.341Z | adapter-level retry posture | R2BlobStore.put(...) over an injected counting transport that always fails | in-process transport seam (no network) | exactly 1 putObject call — the ADAPTER does not retry; failures surface as the typed TRANSPORT_FAILED error (deterministic single-attempt semantics; retry policy is delegated to the transport layer) | AUTOMATED-TEST-ONLY |
| 2026-10-09T05:36:30.548Z | transport-level retry policy | S3Client( SAME options as createR2ObjectStorageTransport ).send(HeadBucketCommand) against a local stub answering 500,500,200 | local stub 127.0.0.1:45455 (no provider round-trip) | 3 HTTP attempts, command resolved — the @aws-sdk/client-s3 default retry strategy (maxAttempts=3) covers transient 5xx at the transport layer | AUTOMATED-TEST-ONLY |
| 2026-10-09T05:36:30.550Z | quota/throttle error path (429 SlowDown) | R2BlobStore.put(...) over an injected transport throwing S3ServiceException SlowDown/429 on head_object | in-process transport seam (no network) | typed PERSISTENCE_TRANSPORT_FAILED after exactly 1 attempt — no second destination, no silent paid fallback (none is representable in the taxonomy); the caller fails closed | AUTOMATED-TEST-ONLY |
| 2026-10-09T05:36:30.551Z | port-level exhaustion gate | assertCapacityUsable(toCapacitySnapshot({status: EXHAUSTED, reasons: [quota-exhausted]})) | @arena/persistence capacity model (in-process) | throws PERSISTENCE_CAPACITY_EXHAUSTED; CAPACITY_EXHAUSTION_POLICY === 'fail-closed' is the only representable policy — live quota exhaustion was NOT triggered (filling the shared free-tier allowance or throttling the shared credentials would damage other tenants of this account); usage metering that decides EXHAUSTED lives in the deploy wiring (deploy/src/hosted/quotas.ts — outside P004 surfaces) | AUTOMATED-TEST-ONLY |
> 2026-10-09T05:36:30.551Z — live quota exhaustion NOT demonstrated and NOT claimed: a safe live trigger does not exist for the shared account (10 GiB storage allowance / request throttling shared with other projects). The 429 code path and the port-level fail-closed gate are the AUTOMATED-TEST-ONLY evidence above.

## Notes

- **Fail-closed chain, end to end:** unconfigured → `DISABLED` before any network call (see
  `capacity/zero-credential-boot.md`); misconfigured (wrong secret/wrong token/unreachable) →
  typed `PERSISTENCE_TRANSPORT_FAILED` + DEGRADED probe; quota errors → typed
  `PERSISTENCE_TRANSPORT_FAILED` / `PERSISTENCE_CAPACITY_EXHAUSTED` at the port gate. No
  alternate-route code exists anywhere in the ports, the adapters or the error taxonomy — a
  silent billable switch is not representable.
- **Secret hygiene observed live:** the typed messages carry env-var NAMES only; provider
  detail (endpoint/status/error names) is attached as `cause` and the typed messages were
  asserted to exclude the deliberately-invalid secret values and account detail.
