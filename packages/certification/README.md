# @arena/certification

The Arena **certification protocol** — composition-level scoped certification
statements (Work Order A023; spec AB1.0 design law — "Arena certifies
statements of the form: Agent Body B, version V, possessed by Cognitive
Substrate M, under Environment E and Runtime Profile R, satisfied
Certification Suite S at revision X. Arena does NOT certify that M alone is
a professional."; requirements R2, R20, R43, R45, R46;
spec/quality-model.md "Certification levels"; architecture-lock rules 4, 6,
16, 17, 18; docs/architecture.md §5, §18).

Certification is the COMPOSITION-LEVEL STATEMENT that closes the loop:
capability evidence → certification statements. It is NEVER an unscoped
professional claim (the design law): the canonical CertificationRecord
carries a SCOPED CertificationStatement bound to the exact Body×Substrate×
Environment×RuntimeProfile×Suite+Rev composition under test, and the
verdict is DERIVED PURELY from the per-component summary — there is no API
through which a caller could supply a verdict, a numerical quality label or a graded label (the
design-law + lock-rule-7 separation enforced BY CONSTRUCTION: closed verdict
vocabulary, strict shape enforcement, derived verdict, structured
unknown-cause taxonomy, frozen objects).

## Objects

| Object | What it commits to |
| --- | --- |
| `CertificationSuiteDescriptor` | The **content-addressed, versioned** declaration of a certification suite: id, version, title, scope statement template, **component refs** (closed component-kind enum: `evaluation \| verification \| compatibility`; each kind carries a non-empty list of sha256 content digests of the A012/A013/A022 sibling descriptors/records the suite composes), the declared **verdict semantics** (all four mandatory: `pass \| conditional-pass \| fail \| unknown`), input/output schema refs and provenance. The suite digest IS the design-law **"revision X"** — same descriptor ⇒ same digest; any change ⇒ a different digest; a different digest under the same `(suiteId, version)` is an identity conflict (spec/quality-model.md: changing a suite requires a new version). |
| `ComponentVerdictSummary` | The per-component input to derivation: one entry per declared suite ref (`refKind`, `refDigest`, `verdict`, `constraints`, `notes`). Closed per-component verdict vocabulary (mirrors A012/A013: `pass \| fail \| unknown` — no quantitative members). A `pass` component MUST carry a constraints array (use `[]` for no constraints); a `fail` / `unknown` component MUST carry `null`. Unique `(refKind, refDigest)` keys (DUPLICATE_COMPONENT otherwise). |
| `CertificationRecord` | The **append-once** record of one certification run: suite descriptor digest, possession digest (A003), the flattened scope refs (body / substrate / environment / runtime-profile — the design-law fields), the component-verdict summary (set-equal to the suite's declaration, in suite order), the **derived** verdict (`pass` = every component pass and no constraints; `conditional-pass` = every component pass with at least one declared constraint; `fail` = at least one component `fail`; `unknown` = at least one component `unknown`), the **derived structured unknown cause** (`unverifiable-component \| suite-misconfiguration` + the driving component refs — required iff verdict is unknown), the **derived constraints** list, the **derived scoped CertificationStatement** (the design-law form), correlation id + idempotency key (lock rule 17), the **computed input digest** over `{suiteRef, possessionRef, componentVerdicts}` and timestamps + run provenance. Frozen on creation; pure replayable construction; identical inputs ⇒ identical record digest. |
| `CertificationStatement` | The **SCOPED** certification statement (the design law): Body×Substrate×Environment×RuntimeProfile×Possession×Suite+Rev×Verdict + rendered text + constraints. **DERIVED** from the record at construction time, never caller-supplied — an unscoped professional-claim is structurally impossible (the design-law negative; see `src/hygiene.test.ts`). |

## Verdict derivation (the pure total heart)

`deriveCertificationVerdict` is the pure **total** heart of the protocol:
every possible component summary maps to exactly one of the four closed
verdict members —

- any component `unknown` ⇒ `unknown` / `unverifiable-component`;
- else any component `fail` ⇒ `fail`;
- else any `pass` component declares a constraint ⇒ `conditional-pass`;
- else (all `pass`, no constraints) ⇒ `pass`.

There is no API through which a caller could supply a verdict, and no input
for which the derivation could produce a quantitative value — the
design-law + lock-rule-7 regression proof (see `src/property.test.ts`).

## Envelope wiring

Wire shapes travel inside `@arena/protocol-core`'s `Envelope<T>`:
`run-certification-command` / `certification-recorded-event`. Commands
carry a **required non-null idempotency key** (lock rule 17); the recorded
event carries the engine's authoritative, content-addressed record and the
run command's idempotency key when provided.

## Dependencies

Runtime dependencies are `@arena/protocol-core` (canonical JSON +
sha256 digests, envelopes, branded identifiers, correlation ids /
idempotency keys, SchemaRef, ProtocolError) and `@arena/agent-body`
(the A003 possession / body-version / cognitive-substrate / runtime-
profile / environment-profile primitives this protocol COMPOSES —
consumed by reference). The sibling protocols this package composes
(A012 evaluation, A013 verification, A022 compatibility) are addressed
STRICTLY BY DIGEST REFS — never redefined here. Zero external runtime
dependencies (frozen catalog).

## Contracts

Generated contracts live in `contracts/certification/` (repo root):
`certification-suite`, `certification-record`, `certification-statement`,
`certification-verdict`, `certification-error`, `run-certification-command`,
`certification-recorded-event`, `certification-schema-registry` (all
`.v1.json`). Regenerate with `pnpm contracts:generate`; drift is checked by
`pnpm contracts:check`, the drift suite (`src/drift.test.ts`) and
governance G9 (which auto-discovers package-level generators). Parity with
this TS surface is asserted by `src/contracts.parity.test.ts`.

## Reference fabric

The in-process reference fabric — suite registry, certification engine
(validate component summary → derive verdict → build record) and the
record ledger — lives in `services/certification`
(`@arena/certification-fabric`).

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative + property + parity + drift + hygiene)
pnpm build       # tsc -p tsconfig.build.json -> dist/
pnpm contracts:generate   # regenerate contracts/certification/*
pnpm contracts:check      # drift check against the committed copies
```

See docs/repo-layout.md for the layering rules this package must obey
(enforced by `pnpm boundary`).
