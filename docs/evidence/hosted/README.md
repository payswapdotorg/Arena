# G002 — Hosted Live Proof, Provider/Quota Proof and Current Deployment Reconciliation

**Work Order:** G002 (issue #105) · **Stage:** post-B019 Launch Integrity Closure
**Evidence gathered:** 2026-10-07, 13:15–13:22 UTC (CURRENT state — not historical October 4 records)
**Method disclosure:** delivered by direct Tech-Lead execution under worker-brain outage
(all worker LLM access was quota-blocked 12:08–13:15+ UTC; provider credentials used
with values redacted; every record below is a verbatim current probe from this run).

## Verdict table (closure-spec checklist → evidence)

| Checklist item | Verdict | Evidence |
|---|---|---|
| public URL | PASS | `https://arena-preview-five.vercel.app` live — 3× spaced probes HTTP 200 (http-and-deployment.md) |
| current HTTP health | PASS | 200 text/html 20879B, 0.33–1.54s total; title "Arena — professional AI capability, kept inspectable" |
| Vercel deployment | PASS | project `arena-preview` (prj_PxNulA41ti7n3uulomMVhiskUPCa), latest production deploy READY 2026-10-07T10:36:57Z (http-and-deployment.md) |
| Neon connectivity/migrations | PASS-WITH-NOTES | Neon project `arena-preview` (steep-moon-56016170) verified via console API; direct DB/migration probe NOT-DERIVABLE (connection string is server-side only) — see providers.md |
| R2 lifecycle | PASS | bucket `arena-preview-objects` exists, credentials valid, 0 objects current (providers.md) |
| Upstash coordination | PASS | REST PONG verified (providers.md) |
| provider capacity state | PASS | acceptance harness "Provider Capacity Visibility" passed (quota-and-secrets.md) |
| fail-closed quota behavior | PASS | acceptance harness "Quota Exhaustion Fail-Closed" passed: EXHAUSTED, no billable path |
| absence of paid fallback | PASS | acceptance harness "No Hidden Paid Fallback" passed on /, /demo, /operations, /demo/operations; env names contain no paid-provider keys |
| server-side secret posture | PASS | 0 secret-shaped patterns across 357,179 bytes of served JS bundles (quota-and-secrets.md) |

## Acceptance harness

The repo's own B019 Hosted Preview Acceptance Harness (deploy/preview) was run live
against the preview URL at 13:21 UTC: **5/5 tests passed, Gate B PASSED** —
`preview-acceptance.json` and `summary.txt` copied verbatim into this directory.

## Files

- `http-and-deployment.md` — landing/demo/reset/404 probes + Vercel deployment truth
- `providers.md` — Neon, R2, Upstash, Vercel env-name posture
- `quota-and-secrets.md` — fail-closed/quota/capacity evidence + secret scan
- `preview-acceptance.json` + `summary.txt` — harness output (verbatim)
