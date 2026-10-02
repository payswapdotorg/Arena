# Free-Tier Limits — Hosted Preview (B015)

Normative source: `docs/deployment/free-tier-architecture.md` (FT1.0) and
`spec/free-tier-contract.md` (FT2.0). The machine-readable constants live
in `deploy/src/hosted/quotas.ts` and are PINNED by
`deploy/src/hosted/quotas.test.ts` — drift between this table, the
constants and the architecture document fails the deploy battery.

> Providers republish limits over time. "Current vendor-published
> allowances must be checked during deployment because provider limits
> can change" (FT1.0). Updating a ceiling is a one-line change in
> `quotas.ts` + this table + the pinning test — reviewed like any code.

## The quota table

| Provider (plan) | Dimension | Free-tier allowance | Window |
|---|---|---|---|
| Neon Free | `storage` | 512 MB (0.5 GB per project) | total |
| Neon Free | `compute-hours` | 100 CU-hours per project | 31 days |
| Neon Free | `transfer` | 5 GB public network transfer per project | 31 days |
| Neon Free (account-level) | projects | 100 | — |
| Neon Free (account-level) | branches per project | 10 | — |
| Cloudflare R2 Standard | `storage` | 10 GB-month | 30 days |
| Cloudflare R2 Standard | `class-a-operations` | 1,000,000 / month | 30 days |
| Cloudflare R2 Standard | `class-b-operations` | 10,000,000 / month | 30 days |
| Cloudflare R2 Standard | egress | free (Internet egress) | — |
| Upstash Redis Free | `commands` | 500,000 / month | 30 days |
| Upstash Redis Free | `storage` | 256 MB data | total |
| Upstash Redis Free | `bandwidth` | 10 GB / month | 30 days |
| Apify Free (optional) | `monthly-spend-usd` | $5 platform spend | 30 days |
| Vercel Hobby | functions max duration | 300 s (a request-shape constraint, not an allowance) | — |
| Vercel Hobby | price | $0 / month | — |

## Where quota state surfaces (B014 wiring — not a parallel dashboard)

- **Operations capacity panel**: the hosted preview's `/operations/capacity`
  page (B014) renders `CapacitySnapshot` dimensions per registered
  provider. B015's wiring registers the three hosted providers behind the
  SAME neutral logical ids the panel already knows —
  `control-plane-store`, `object-store`, `coordination-store` — so the
  panel lights up through the existing `CapacityProbe` port without any
  apps/web change.
- **Declared dimensions**: the wiring passes the table above to the B002
  adapters as `declaredAllowances`; probes surface `{dimension, limit}`
  (with `used`/`remaining` unknown until a usage meter exists — usage
  metering/cost monitoring is B019's launch-gate concern).
- **The guard**: `CapacityService.guard()` (composed by
  `deploy/src/hosted/fail-closed.ts`) is the fail-closed gate.
- **API surface**: `ProviderHealthService.health()` /
  `CapacityService.capacity()` from `@arena/persistence-service` expose
  the same snapshots for any operations consumer.

## The fail-closed rules (FT2.0, verbatim)

- "Every hosted adapter returns one of: AVAILABLE / DEGRADED / EXHAUSTED /
  DISABLED. **Adapters never silently switch to a paid path.**"
- Missing configuration ⇒ adapters construct DISABLED and every port
  operation throws the typed `PersistenceCapacityError` BEFORE any
  network call.
- `CAPACITY_EXHAUSTION_POLICY = 'fail-closed'` — a single-inhabitant
  type; a billable fallback is not representable in the contracts.
- Deterministic proofs run in the deploy battery:
  `deploy/src/hosted/fail-closed.test.ts` (exhausted ⇒ typed refusal;
  disabled ⇒ typed refusal; DEGRADED/near-limit ⇒ flagged but usable) and
  the `fail-closed:*` checks of the dry run.

What happens operationally when a quota IS exhausted: see
[quota-exhaustion-playbook.md](./quota-exhaustion-playbook.md).
