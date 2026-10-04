# @arena/deploy-preview

B019 Hosted Preview Acceptance Harness

## Purpose

Mechanically verifies **Gate B** of the launch checklist against a live preview, runs hermetically green when no preview is deployed, provides fail-closed free-tier validation and deterministic demo route execution.

## Architecture note: real probe surfaces

The product exposes **no dedicated HTTP health endpoint** — there is no `/api/health`, `/api/readiness`, `/api/capacity`, `/api/capability/*`, `/api/bodies` or `/api/marketplace` route (all 404 on the live deployment). The acceptance harness therefore probes the REAL product surfaces, mirroring the deploy workflow's own smoke-check semantics (`.github/workflows/deploy-preview.yml`: `GET /` → 2xx/3xx):

| Gate-B checklist item | Real probe surface | Assertion |
|---|---|---|
| Health/readiness checks are live | `GET /` | 2xx/3xx on the deployment root (deploy-workflow smoke-check parity) |
| Provider capacity state is visible | `GET /operations` + `GET /demo/operations` | `/operations` renders the fail-closed authenticated-session gate (operator-reachable route); `/demo/operations` renders the "Provider capacity (free tier)" board with the closed FT2.0 vocabulary (`AVAILABLE`, `DEGRADED`, `EXHAUSTED`, `DISABLED`) |
| Free-tier exhaustion is fail-closed | `GET /demo/operations` | The rendered exhaustion posture: an `EXHAUSTED` provider with `fail closed` operations and the `quota-exhausted` reason, plus the rendered FT2.0 contract (never silently degrades to unlimited, never switches to a billable path) |
| Hosted demo route walk (determinism) | `GET /demo`, `GET /demo/operations`, `POST /demo/reset` | Demo pages render labelled deterministic demo state; `POST /demo/reset` honours its documented contract (HTTP 303 redirect to `/demo` — see `apps/web/src/app/demo/reset/route.ts`) |
| No hidden paid fallback exists | `GET /`, `/demo`, `/operations`, `/demo/operations` | Page-level assertions: the fail-closed contract text is rendered, and no paid-fallback markers (upgrade prompts, billing claims, payment-provider handoffs) appear on any public surface |

Adding a dedicated `/api/health` endpoint is a Tech Lead architecture decision outside the B019 surfaces.

## Usage

### Installation

```bash
pnpm install
```

### Running the Acceptance Suite

#### Dry-run Mode (No Live Preview) — the default
```bash
pnpm run run
```
Every live-path probe is skipped honestly (visible skip marks, never a faked pass); the suite exits green hermetically.

#### Live Mode (With Preview URL)
```bash
ARENA_PREVIEW_URL=https://arena-preview-five.vercel.app pnpm run run
```

#### Run Specific Tests
```bash
ARENA_PREVIEW_URL=https://arena-preview-five.vercel.app pnpm run run -- --testNamePattern="Health"
```

#### Verbose Logging
```bash
ARENA_PREVIEW_URL=https://arena-preview-five.vercel.app pnpm run run -- --verbose
```

## Test Suite

The acceptance suite validates (real surfaces only — see the table above):

### Health & Readiness
- `GET /` returns a success response (2xx/3xx — deploy-workflow smoke-check parity)
- Bounded retries with linear backoff on transport failure

### Provider Capacity Visibility
- `/operations` is operator-reachable and renders the fail-closed session gate
- `/demo/operations` renders provider capacity state with the closed FT2.0 vocabulary (`AVAILABLE`, `DEGRADED`, `EXHAUSTED`, `DISABLED`)

### Quota Exhaustion Fail-Closed
- The rendered exhaustion posture: `EXHAUSTED` provider, `fail closed` operations, `quota-exhausted` reason
- The FT2.0 contract is rendered: never "unlimited" degradation, never a billable path

### Hosted Demo Route Walk
- Demo landing page renders labelled deterministic demo state
- Demo page walk under `/demo/**` carries the demo-state disclaimer
- `POST /demo/reset` honours the documented 303 → `/demo` determinism contract

### No Hidden Paid Fallback
- The fail-closed capacity contract is rendered on the capacity board (asserting the contract, not merely string absence)
- No paid-fallback markers on any public surface

## Evidence Generation

The harness generates a Gate-B evidence artifact:

- `preview-evidence.json` - Machine-readable evidence record
- `summary.txt` - Human-readable summary
- Contains test results, gate status, and recommendations

## Environment Variables

- `ARENA_PREVIEW_URL` - The hosted preview URL (optional for dry-run; live mode runs only when set)

## House Patterns

Follows the same structure as sibling packages:
- TypeScript with strict type checking
- Vitest for testing with deterministic setup (fixed clock in `src/test/setup.ts`)
- Command-line interface for automation
- Evidence generation for reproducible verification

## Integration

This package integrates with:
- `deploy/src/` for environment contracts and dry-run patterns
- `tests/product-e2e/` for driver and suite structure
- `ops/deployment/` + `ops/preview/` for operational runbooks
- `release/src/` + `release/preview/` for evidence record patterns

## Development

```bash
# Type checking
pnpm run typecheck

# Linting
pnpm run lint

# Testing
pnpm run test

# Building
pnpm run build

# Run acceptance (dry-run default)
pnpm run run
```
