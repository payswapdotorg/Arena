# @arena/expert-registry

The Expert registry and Expert profile protocol (Work Order A006;
docs/architecture.md §8: "Experts are capability providers. Profiles include
identity, competencies, qualifications, evidence, task history,
reliability, availability and domain/jurisdiction where appropriate.
Qualification, reputation and authorization are separate concerns.";
requirements R7 registry side, R32 measurement data, R37 domain-pack guard;
architecture-lock rules 6, 9, 11, 23, 24).

Domain layer; the ONLY runtime dependency is `@arena/protocol-core`
(canonical JSON + sha256 digests, branded identifiers, `Envelope<T>`,
`SchemaRef`, `ProtocolError` — reused, never reimplemented).

## Core model

- **ExpertProfile** — versioned, content-addressed (sha256 over the
  canonical digest-free view via `digestCanonical`), immutable +
  deep-frozen, carrying EVERY §8 field group:
  - *identity*: tenant scope + NEUTRAL `expert-` prefixed id plus declared
    identity refs (digest-addressed attestations; PII minimization —
    no personal data anywhere on the profile);
  - *competencies*: capability/skill refs + typed proficiency levels with
    >= 1 digest-addressed proficiency evidence refs (R7);
  - *qualifications*: typed records — credential refs, evidence digests,
    closed status vocabulary (qualification DATA, never authorization);
  - *evidence*: digest-addressed foundational refs (append-only);
  - *task history*: append-only content-addressed record refs;
  - *reliability*: an append-only event-sourced ledger
    (`task-completed` | `task-failed` | `no-response`); counters are
    ALWAYS recomputed from history (`recomputeReliabilityMetrics`) and are
    never directly mutable or declarable (R32, lock rule 6);
  - *availability*: typed windows (daily / weekly ISO-day / one-time);
  - *domain/jurisdiction*: >= 1 domain node refs, 0+ typed ISO 3166
    jurisdictions, >= 1 explicit professional limitations over a closed
    class vocabulary covering safety, privacy and licensing (lock rule 23);
  - plus the explicit per-group privacy policy that governs public-view
    derivation.
- **Separation of concerns (lock rule 9 — the critical gate)**: the
  authority/PII vocabulary screen (`authority-screen.ts`) rejects any
  field asserting system authority, roles or permissions
  (`systemRole`, `authority`, `adminOf`, `grantedScopes`, …) and any
  personal-data field (`email`, `phone`, `legalName`, …) at any input
  depth. Authorization is a SEPARATE FUTURE PROTOCOL — nothing in this
  package grants, implies or records a permission.
- **Lifecycle** — append-only DRAFT → PUBLISHED → SUSPENDED ⇄ PUBLISHED
  (reinstatement) → RETIRED (terminal finality) with a deep-frozen
  append-only event history; supersession by new versions
  (`supersedes`/`supersededBy`), superseded versions stay immutable and
  addressable forever.
- **ExpertRegistry** — an in-memory, protocol-level, append-only
  registry: register/list/get by digest + neutral id; idempotent
  re-registration; identity conflicts rejected; tenant scoping with
  cross-tenant reads failing closed (lock rule 11; reserved `public`
  namespace readable by all).
- **Public view** — `deriveExpertPublicView` strips every
  tenant-internal-marked group (privacy policy is explicit metadata,
  lock rule 23); evidence/task history/reliability/lifecycle are
  structurally never public.
- **Domain packs (R37)** — `ExpertDomainPack` descriptors ADD domain
  competency types and typed metadata fields; they can NEVER alter
  lifecycle semantics (closed input key set) or inject authority/PII
  fields (screened declared names).
- **Envelopes** — commands and events travel inside protocol-core's
  `Envelope<T>` with REQUIRED idempotency keys on commands (lock rule 17).

## Generated contracts

`contracts/expert/*.v1.json` (41 schemas) — regenerate with:

```bash
pnpm --filter @arena/expert-registry contracts:generate
pnpm --filter @arena/expert-registry contracts:check   # drift tripwire
```

Parity with the TS surface is asserted by `src/contracts.parity.test.ts`;
file-level drift by `src/drift.test.ts`; both run under `pnpm test`. The
repo-wide governance G9 entry point discovers this package's generator
automatically (`packages/*/scripts/generate-contracts.mjs`), so no root
file edits were needed.

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative tests)
pnpm build       # tsc -p tsconfig.build.json -> dist/
```

See docs/repo-layout.md for the layering rules this package must obey
(enforced by `pnpm boundary`).
