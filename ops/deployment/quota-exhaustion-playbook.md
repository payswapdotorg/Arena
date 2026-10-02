# Quota-Exhaustion Playbook — Hosted Preview (B015)

What happens when a free-tier quota is exhausted, how to verify it, and
the one rule that never bends: **no automatic paid fallback, ever.**

## The rule (product truth)

- The wiring **fails CLOSED** when a quota is exhausted: the operation is
  REFUSED with the typed `PersistenceCapacityError`
  (`PERSISTENCE_CAPACITY_EXHAUSTED`), carrying the blocking provider, the
  dimension and the structured reason (`quota-exhausted`).
- `CAPACITY_EXHAUSTION_POLICY` is the single-inhabitant type
  `'fail-closed'`; `NO_BILLABLE_FALLBACK` mirrors the B014 operations
  view-model fact. A billable fallback is not representable in the
  contracts — there is no parameter, no alternate route, no second
  destination.
- Upgrading a provider is a **deliberate human decision taken outside
  the system** (Tech Lead / owner), at the provider console, with the
  architecture re-baselined. The system never does it for you.

## What exhaustion looks like, per provider

| Provider | Dimension | Observable behavior when exhausted |
|---|---|---|
| Neon Free | `compute-hours` / `storage` / `transfer` | Neon suspends compute (Free idles after the CU allowance); probes go DEGRADED (`probe-failed`) or dimensions report exhausted; writes refuse. Storage over-quota is rejected by the provider. |
| Cloudflare R2 | `storage` / `class-a-operations` / `class-b-operations` | R2 rejects writes/requests beyond the free allowance (no silent billing on the free tier); object-store operations fail closed. |
| Upstash Redis Free | `commands` / `storage` / `bandwidth` | Upstash rejects commands past 500K/month (or 256 MB data); rate-limit/idempotency/cache operations refuse — authoritative facts are unaffected (they live in Neon/R2). |
| Apify Free | `monthly-spend-usd` | The platform itself blocks further usage until the next cycle ("blocks further platform usage after the allowance is exhausted"). Apify is optional: the primary lifecycle continues. |
| Vercel Hobby | functions duration (300 s) | Not an exhaustion state: a request-shape constraint. Long-running jobs must use the durable-job pattern (UI/API command → Job record → bounded worker → checkpoint → status event). |

## How the system surfaces it

1. **Capacity panel** (`/operations/capacity`, B014): the blocking
   provider flips to EXHAUSTED (or DISABLED) with reason
   `quota-exhausted` and the dimension named; the panel renders the
   fail-closed policy and `noBillableFallback` as data.
2. **Operations refuse**: `CapacityService.guard()` throws the typed
   error for the FIRST blocking provider in registration order
   (control-plane → object-store → coordination).
3. **DEGRADED is not exhaustion**: near-limit (< 10% remaining) is
   flagged (`dimension-near-limit`) but remains usable — a signal to act,
   not a refusal.

## Operator procedure

1. **Confirm** which dimension: capacity panel, or the typed error's
   `capacityReasons` (provider + dimension + code), or
   `ProviderHealthService.health()` snapshots.
2. **Do not look for a fallback switch — there isn't one.** Recovery
   options that stay inside the free tier:
   - Wait for the monthly window to reset (30/31-day windows; see
     `ops/deployment/free-tier-limits.md`).
   - Prune consumption: delete stale R2 objects (mind Class A op cost),
     drop unneeded Neon branches, flush Upstash (rebuildable state).
   - Reduce traffic: the preview is a bounded demo profile; load beyond
     the profile is out of scope (FT1.0: "a bounded preview profile, not
     a claim that arbitrary high-volume production workloads remain
     free").
3. **If the preview genuinely needs more than free tier**: escalate to
   the Tech Lead. The upgrade decision is human, documented, and
   re-baselines the free-tier contract (FT documents + quota constants +
   this playbook) — it is NEVER an automatic system behavior.
4. **Verify after recovery**: run `pnpm --dir deploy dryrun` (proves the
   wiring and the fail-closed contracts still hold) and watch the
   capacity panel return to AVAILABLE/DEGRADED.

## Verifying fail-closed behavior on demand (no live credentials)

```bash
# deterministic proofs, part of the deploy battery:
cd deploy && pnpm exec vitest run src/hosted/fail-closed.test.ts src/hosted/dry-run.integration.test.ts
```

`fail-closed.test.ts` proves: EXHAUSTED ⇒ typed refusal; DISABLED ⇒ typed
refusal; DEGRADED ⇒ usable. The dry run additionally simulates both
refusals end-to-end (`fail-closed:exhausted`, `fail-closed:disabled`
checks) against the composed wiring.
