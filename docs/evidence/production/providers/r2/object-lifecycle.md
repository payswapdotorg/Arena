# P004 evidence — R2 object lifecycle (DEMONSTRATED-LIVE)

**Work order:** P004 (issue #156) · **Register rows closed:** L-004 ("R2 lifecycle unproven —
bucket empty at probe") · **Release gate:** §5.3
**Producing suite:** `tests/hosted-provider-e2e/r2/r2-object-lifecycle.test.ts` (the EXISTING
adapter `adapters/hosted/r2-object-store` — `R2BlobStore` — against live Cloudflare R2).

## How this was run (reproducible command — the finisher re-verification run, 2026-10-09T05:36Z)

```bash
export PATH="/home/z/node22/bin:$HOME/.npm-global/bin:$PATH"   # Node 22 (repo engines pin >=22 <23, engine-strict; sandbox default is 24)
source /home/z/my-project/scripts/env.sh                   # UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN / CLOUDFLARE_ACCOUNT_ID
set -a; source <r2-sigv4-env-file>; set +a                 # R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_S3_ENDPOINT (SigV4 S3 keys)
export R2_BUCKET=arena-p004-evidence                       # base configuration the adapter env reader requires
export ARENA_HOSTED_E2E_R2_BUCKET=arena-p004-evidence      # the P004 dedicated-bucket gate
export ARENA_HOSTED_EVIDENCE_OUT=/tmp/p004-evidence-finisher   # transcript capture
pnpm build                                                 # produces apps/web/.next/BUILD_ID for the app-boot suite
node tests/hosted-provider-e2e/run.mjs
```

**Lineage (honest):** the predecessor P004 worker captured an identical row set at
2026-10-09T05:26–05:27Z but died before committing the evidence; this finisher re-ran the
full battery live (all 43 tests green, zero skips) and the committed transcript below is the
finisher's re-verification run. The only tooling change between the runs: the recorder's
per-row length cap was raised 400 → 1200 so the zero-credential rows embed complete env-name
lists (see `tests/hosted-provider-e2e/support/transcript.ts`).

## Resources (recorded, not secret)

- **Bucket:** `arena-p004-evidence` — a DEDICATED evidence bucket created for P004 on
  2026-10-09 (~05:12 UTC) with `S3Client.send(new CreateBucketCommand({Bucket:
  'arena-p004-evidence'}))` over the same SigV4 credentials/client construction the adapter's
  transport uses (`region: 'auto'`, `forcePathStyle: true`, account S3 endpoint). The provider
  answered **HTTP 200**; a follow-up `ListBuckets` showed the bucket among the account's
  buckets. The finisher re-verified the bucket still exists (HeadBucket → HTTP 200,
  2026-10-09T05:33Z) before the re-verification run below. The bucket is private by default
  (the anonymous-access row in `r2/failure-capacity-matrix.md` demonstrates that posture on
  this very bucket).
- **Key prefix:** none is possible by design — blob keys are CONTENT-ADDRESSED
  (`sha256:<64 hex>`); the key IS the digest. Bucket-level isolation is therefore the only
  isolation, which is why this run refuses to touch any other bucket
  (`ARENA_HOSTED_E2E_R2_BUCKET` gate in `tests/hosted-provider-e2e/support/live-env.ts`).
- **Redacted config:** endpoint `https://<redacted CLOUDFLARE_ACCOUNT_ID 7e33…>.r2.cloudflarestorage.com`;
  access key id and secret are server-side env values — NAMES only appear here.

## Transcript (machine-generated, verbatim; every step: command, UTC timestamp, resource id)

<!-- machine-generated transcript fragment (tests/hosted-provider-e2e, facet: r2-lifecycle) -->
<!-- embed VERBATIM under docs/evidence/production/providers/ -->
| timestamp (UTC) | step | command | resource | result | class |
|---|---|---|---|---|---|
> 2026-10-09T05:36:30.794Z — live suite ACTIVE — dedicated evidence bucket: arena-p004-evidence, endpoint: https://<redacted CLOUDFLARE_ACCOUNT_ID 7e33…>.r2.cloudflarestorage.com
| 2026-10-09T05:36:30.973Z | probe | R2BlobStore.capacityProbe() [transport: HeadBucket] | bucket arena-p004-evidence | status=AVAILABLE checkedAt=1791524190972 (probe only — the lifecycle proof is the write/read/delete steps below) | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:31.455Z | authorized write | R2BlobStore.put({content, contentType=application/json, metadata}) [transport: HeadObject + PutObject] | bucket arena-p004-evidence, key sha256:1e24caf1d546c74997667c9ae930eb79bacd4e0f457bd5e68a965579e5fa0abf | byteLength=208 createdAt=1791524191129 alreadyPresent=false | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:31.627Z | head | R2BlobStore.exists(key) [transport: HeadObject] | bucket arena-p004-evidence, key sha256:1e24caf1d546c74997667c9ae930eb79bacd4e0f457bd5e68a965579e5fa0abf | exists=true | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:31.903Z | authorized read + download | R2BlobStore.get(key) [transport: GetObject + transformToByteArray] | bucket arena-p004-evidence, key sha256:1e24caf1d546c74997667c9ae930eb79bacd4e0f457bd5e68a965579e5fa0abf | bytes=208 contentType=application/json metadata={surface,run} — downloaded bytes byte-equal to the written payload | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:32.059Z | digest leg (list-or-digest) | computeBlobDigest(downloadedContent) === blobKeyDigest(key) | bucket arena-p004-evidence, key sha256:1e24caf1d546c74997667c9ae930eb79bacd4e0f457bd5e68a965579e5fa0abf | sha256 recomputed over downloaded bytes matches the content-addressed key (the BlobStore port exposes no list op; the key IS the digest — this is the gate's digest leg) | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:32.379Z | immutable replay | R2BlobStore.put(identical content, different metadata) | bucket arena-p004-evidence, key sha256:1e24caf1d546c74997667c9ae930eb79bacd4e0f457bd5e68a965579e5fa0abf | alreadyPresent=true createdAt preserved (1791524191129); first write's metadata preserved (content addressing — in-place mutation unrepresentable) | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:32.561Z | provider-side list (supplementary) | S3Client.send(ListObjectsV2Command) — same credentials/client construction as the adapter transport; NOT an adapter op (the port has no list vocabulary) | bucket arena-p004-evidence | keys=[sha256:1e24caf1d546c74997667c9ae930eb79bacd4e0f457bd5e68a965579e5fa0abf] — the evidence object is present | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:33.294Z | delete | R2BlobStore.delete(key) [transport: HeadObject + DeleteObject]; then exists/get/delete-again | bucket arena-p004-evidence, key sha256:1e24caf1d546c74997667c9ae930eb79bacd4e0f457bd5e68a965579e5fa0abf | delete=true; exists=false; get=null; second delete=false (lifecycle closed) | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:33.433Z | provider-side list after delete (supplementary) | S3Client.send(ListObjectsV2Command) | bucket arena-p004-evidence | keyCount=0 — bucket empty after the lifecycle (not "configured resource" evidence: real bytes were written and removed) | DEMONSTRATED-LIVE |
| 2026-10-09T05:36:33.433Z | retention (not supported by the adapter) | n/a — no retention/lifecycle op exists in BlobStore or ObjectStorageTransport | bucket arena-p004-evidence | deletion is immediate; retention rules are not representable through this adapter — recorded as NOT CLAIMED, per the gate wording "(retention if the adapter supports it)" | AUTOMATED-TEST-ONLY |

## Reading the lifecycle against release-gate §5.3

| Gate leg | Where it is proven | Class |
|---|---|---|
| authorized write | `put` row (real PutObject through the adapter) | DEMONSTRATED-LIVE |
| read | `get` row (real GetObject; bytes returned to the caller) | DEMONSTRATED-LIVE |
| download | the SAME `get` row — the BlobStore port has a single read operation that returns the bytes (`transformToByteArray`); there is no second "download" vocabulary | DEMONSTRATED-LIVE |
| list-or-digest | the **digest** leg: the recomputed sha256 over the downloaded bytes equals the content-addressed key; a provider-side ListObjectsV2 is recorded as SUPPLEMENTARY verification (same credentials/client construction; not an adapter op — the port has no list vocabulary) | DEMONSTRATED-LIVE |
| delete | `delete` row + post-delete `exists/get/delete` + provider-side list showing the bucket empty | DEMONSTRATED-LIVE |
| retention (if the adapter supports it) | NOT CLAIMED — no retention/lifecycle op exists in `BlobStore` or `ObjectStorageTransport`; deletion is immediate | not applicable (honestly recorded) |

**Immutability bonus:** an identical replay (`put` of the same bytes with different metadata)
preserved the FIRST write's metadata and creation time — the content-addressing discipline
verified live.

**This is not "configured resource" evidence:** the transcript shows real bytes written,
downloaded, and deleted in the dedicated bucket; the bucket is empty again at the end of the
run.
