# G002 evidence — quota/fail-closed/capacity + secret posture (CURRENT)

## B019 Hosted Preview Acceptance Harness (run live 2026-10-07T13:21:43Z)

```
ARENA_PREVIEW_URL=https://arena-preview-five.vercel.app pnpm run run -- run   (deploy/preview kit)

Tests run: 5   Passed: 5   Failed: 0   Skipped: 0
- Health Readiness .................. passed (365ms)
- Provider Capacity Visibility ...... passed (593ms)
- Quota Exhaustion Fail-Closed ...... passed (15ms)
- Hosted Demo Route Walk ............ passed (612ms)
- No Hidden Paid Fallback ........... passed (1297ms)
GATE B: PASSED
```

Verbatim highlights from the live run:

```
✅ Quota exhaustion posture rendered fail-closed (EXHAUSTED, quota-exhausted, no billable path)
✅ Demo landing page accessible and labelled deterministic
✅ Demo reset honoured the 303 → /demo determinism contract
✅ FT2.0 fail-closed capacity contract rendered (no billable path, no unlimited degradation)
✅ Operations surface gated by server-side fail-closed session validation
✅ /, /demo, /operations, /demo/operations — no paid-fallback markers
```

Full machine-readable bundle: `preview-acceptance.json` (this directory).

## Server-side secret posture — served-bundle scan

Four JS bundles served by the live preview (total 357,179 bytes) scanned for
secret-shaped patterns (`NEON_API_KEY`, `R2_SECRET`, `ghp_[A-Za-z0-9]{20,}`,
`sk-[A-Za-z0-9]{20,}`, `postgres://…`):

```
/_next/static/chunks/e3aa3536-b22dd33cd0e72635.js   173020 bytes   0 hits
/_next/static/chunks/4217-f92b493c64da67ef.js        173863 bytes   0 hits
/_next/static/chunks/main-app-786b7cda0c949a6b.js       559 bytes   0 hits
/_next/static/chunks/app/error-961ef71768067d74.js     5737 bytes   0 hits
```

Zero client-side secret leakage. Secrets exist only as server-side Vercel env vars
(see providers.md) — matching the documented posture.
