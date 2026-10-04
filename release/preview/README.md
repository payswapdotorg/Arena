# @arena/release-preview

B019 Preview Release Evidence Records

## Purpose

Typed, versioned evidence records for the Gate-F evidence set, a deterministic generator for reproducible evidence bundles, and evidence management following the release/src record pattern.

## The record contract (honesty first)

**The generator never fabricates a result.** The default bundle is the Gate-F record SKELETON: every check's real command, real artifact reference and reproducibility note, with `exitStatus` set to the `EXIT_STATUS_NOT_RUN` sentinel (`-1`) and `artifactRef` pointing at the owning test surface (or an explicit "pending launch-day evidence" marker where the artifact only exists at the gate). A bundle containing pending records is **INCOMPLETE** — it can never read as PASSED.

Gate status is derived deterministically:

| Condition | Bundle gate status |
|---|---|
| any record with `exitStatus !== 0` and `!== -1` | `FAILED` |
| any record with `exitStatus === -1` (not run) | `INCOMPLETE` |
| all records `exitStatus === 0` | `PASSED` |

## Evidence Types

### Gate-F Evidence Set (eight record kinds)
- **CI Evidence** — `gh run list --workflow ci.yml` status for the launch commit (artifact: `.github/workflows/ci.yml`)
- **Product E2E Evidence** — `pnpm run test:e2e` (artifact: `tests/product-e2e/run.mjs`)
- **Accessibility Evidence** — B018 conformance battery (artifact: `apps/web/src/a11y/testing/a11y.test.ts`)
- **Performance Evidence** — B018 budget battery (artifact: `tests/performance/src/product-budget.test.ts`)
- **Security Evidence** — A034 adversarial battery (artifact: `tests/security/battery.test.ts`, run via `services/security` → `pnpm run battery:test`)
- **Quota Evidence** — B015 catalog + fail-closed wiring tests (artifact: `deploy/src/hosted/quotas.test.ts`)
- **Deployment Evidence** — deployment-root smoke check + Gate-B acceptance battery (artifact: `deploy/preview/src/acceptance/health-checker.test.ts`)
- **Installation Evidence** — fresh-machine install (artifact: `scripts/product/README.md`, command: `node scripts/product/install.mjs`)

## Usage

### Generating the evidence bundle

```bash
# Default: the pending Gate-F skeleton (all records NOT_RUN, INCOMPLETE)
pnpm run generate

# With the preview URL recorded in the bundle metadata
pnpm run generate --preview-url https://arena-preview-five.vercel.app

# Byte-stable bundles for reproducible evidence (fixed timestamp)
pnpm run generate --timestamp 2026-10-04T12:00:00.000Z

# At the launch gate: fill the real exit statuses from the battery runs
pnpm run generate --input ./launch-day-inputs.json --tech-lead "Tech Lead Name"

# Validate an existing bundle
node dist/generator.js validate --bundle ./evidence/evidence-bundle.json
```

### Launch-day input format (`--input`)

```json
{
  "ci-001":     { "exitStatus": 0, "metadata": { "commitSha": "<launch commit>" } },
  "e2e-001":    { "exitStatus": 0, "metadata": { "testCounts": "37 passed / 0 failed" } },
  "deploy-001": { "exitStatus": 0, "artifactRef": "https://github.com/... runs/<id>" }
}
```

Records absent from the input map stay **pending** (`NOT_RUN`) — they are never silently passed.

### Evidence Bundle Structure

```
evidence/
└── evidence-bundle.json     # The typed bundle (records + derived summary)
```

## Record Schema

Each evidence record follows the typed schema (validated by zod — see `src/records.ts`):

```typescript
interface EvidenceRecord {
  id: string                    // Unique identifier (ci-001, e2e-001, ...)
  type: string                  // Evidence type (ci, product-e2e, accessibility, ...)
  name: string                  // Human-readable name
  description: string           // Detailed description
  command: string               // The REAL command to run at the gate
  exitStatus: number            // 0 = success; -1 = NOT_RUN (pending); other = failure
  artifactRef: string           // Real path to the owning artifact (or "pending launch-day evidence")
  reproducibility: string       // How the result can be reproduced
  timestamp: string             // ISO timestamp
  version: string               // Schema version
  metadata: Record<string, unknown> // Type-specific metadata
}
```

## TL-Owned Rows

The launch-day inputs and attestation are TL-owned at the gate: the deployment URL (`__ARENA_PREVIEW_URL__` placeholder in the record commands), the secret-injection attestation, and the checklist finalization. The generator consumes these as INPUTS (the `--input` map, `--preview-url`, `--tech-lead`) — the schema is never broken by filling them.

## Integration Points

### With Acceptance Harness
- Consumes test results from `deploy/preview/`
- Maps acceptance test outcomes to the deployment record
- Verifies Gate B compliance

### With Operational Runbooks
- Cross-references `ops/preview/` runbook outcomes

### With Launch Documentation
- Provides evidence for checklist verification (`docs/launch/evidence-index.md`)
- Supports evidence index mapping

## House Patterns

Follows the same structure as sibling packages:
- TypeScript with strict type checking (NodeNext import posture)
- Vitest for testing with deterministic setup
- CLI interface for automation (`node dist/generator.js` — build emits `dist/`)
- Typed records with Zod validation

## Development

```bash
# Type checking
pnpm run typecheck

# Linting
pnpm run lint

# Testing
pnpm run test

# Building (emits dist/ for the CLI entry)
pnpm run build

# Generate evidence (pending skeleton by default)
pnpm run generate
```

## Evidence Validation

### Automated Validation
- Schema validation for all records (`validate` CLI command)
- Exit-status semantics (0 / -1 / failure)
- Byte-stability: identical inputs → identical bundles

### Manual Review
- Tech Lead review of all evidence
- Cross-reference with checklist
- Attestation of TL-owned rows
- Final sign-off process

## Record Retention

- **Duration**: 12 months post-launch
- **Storage**: Arena release records with backup
- **Access**: Available to stakeholders upon request
- **Audit**: Regular integrity audits

## Related Documentation

- [Launch Checklist](../../docs/launch-checklist.md) - Complete requirements
- [Evidence Index](../../docs/launch/evidence-index.md) - Checklist mapping
- [Acceptance Harness](../../deploy/preview/README.md) - Gate B verification
- [Operational Runbooks](../../ops/preview/README.md) - Launch procedures

---

*This evidence generator is part of the B019 work order and provides the mechanical verification needed for the launch gate.*
