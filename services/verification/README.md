# @arena/verification-fabric

The Arena **reference verifier fabric** (Work Order A013; requirements
R13, R14, R27, R28) — the in-process registry, artifact store, runner
and record ledger for the `@arena/verification` protocol. It mirrors
the A012 reference fabric structurally, and is
deliberately different where the protocols differ: it NEVER produces
numerical or graded quality assessments — only the closed
`pass` / `fail` / `unknown` evidence outcomes (architecture-lock rule
7).

## Surface

| Piece | What it does |
| --- | --- |
| `VerifierRegistry` | In-process verifier registry: `registerVerifier(descriptor, hook)` is idempotent by descriptor digest; a different digest under the same `(verifierId, version)` identity is an `IDENTITY_CONFLICT` (changing a verifier requires a new version). Lookups by digest; queries by method. |
| `VerificationFabric` | The runner + ledger + REAL A002 artifact store. `verify(verifierRef, evidence, {correlationId, idempotencyKey})` resolves the descriptor, validates the evidence bundle with the package primitives (kind matching → resolution → digest verification → provenance-chain validation), invokes the hook ONLY for verified evidence, merges the statuses, and builds the `VerificationRecord` through the domain constructor (which derives the outcome + unknown cause and computes the input digest). Same idempotency key + same command ⇒ no-op replay; same key + different command ⇒ `IDEMPOTENCY_CONFLICT`. Queries: by digest, verifier, correlation id, outcome, time range. |
| Reference verifiers | `makeConstraintCheckVerifier()` (method `constraint_check`): deterministic, content-based — the artifact's content must carry a `constraints` entry `{requirementId, satisfied}`; absent/malformed entries are `unsupported`, never a silent pass. `makeEvidenceProvenanceValidationVerifier()` (method `evidence_provenance_validation`): deterministic, provenance-based — producer pins must match; lineage-free evidence is `indeterminate` (method limitation). The other six EV1.0 methods are declared types with the pluggable hook interface and no implementations (A013 scope). |

## The hook seam

`VerifierHook` is the single pluggable seam: a function from one
resolved, digest-verified, provenance-chain-verified evidence item
(plus its requirement and descriptor) to a verdict from the CLOSED
vocabulary `supported | unsupported | indeterminate`. Hooks never
construct records, never see unverified evidence, and cannot emit
quantitative members (rejected by construction — the lock-rule-7
regression gate). A hook that does not speak for a verified
requirement yields `present-indeterminate` (recorded as a method
limitation, never guessed).

## Dependencies

`@arena/protocol-core` (envelopes, correlation ids / idempotency keys),
`@arena/verification` (the protocol) and `@arena/artifact-protocol`
(the REAL A002 `MaterialArtifact` store anchors evidence resolution to
the real artifact protocol). Zero external runtime dependencies (frozen
catalog). In-process only — no network, no database (the A013
reference slice, like A011's reference store and A012's reference
fabric).

## Demo

```bash
cd services/verification && pnpm demo    # or: node main.mjs
```

Drives one deterministic end-to-end scenario: REAL A002 artifacts
(constraint report + balance proof with lineage) → two reference
verifiers → the envelope round trip (`run-verification-command` →
`fabric.verify` → `verification-recorded-event`) → idempotent replay →
negative probes (unknown verifier, tampered evidence, missing
evidence, idempotency conflict, unknown method, rogue quantitative
hook member, identity conflict) → queries + observability dump.

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (registry + verifiers + fabric + property + hygiene)
pnpm build       # tsc -p tsconfig.build.json -> dist/
```

See docs/repo-layout.md for the layering rules this service must obey
(enforced by `pnpm boundary`).
