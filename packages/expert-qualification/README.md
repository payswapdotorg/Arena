# @arena/expert-qualification

The Arena **expert qualification and matching protocol** (Work Order A007;
requirements R7 "Qualify experts against evidence-backed competencies" and
R8 "Match expert requirements to qualified experts").

Pure TypeScript; the ONLY runtime dependency is `@arena/protocol-core`
(canonical JSON + sha256 digests, `Envelope<T>`, branded identifiers,
`SchemaRef`, `ProtocolError`), reused throughout — never reimplemented.
Cross-protocol objects (A006 credential refs and expert-profile views,
A013 verification-record refs, A012 evaluation-record refs,
capability-graph node refs) are validated plain-string VIEW types — the
`@arena/expert-registry` convention — so sibling data passes through
unchanged while this package stays dependency-minimal. Zero model/provider
surface (lock rule 10). Zero new external runtime dependencies.

## What it is

- **QualificationEvidence** — typed, digest-addressed evidence records over
  the CLOSED four-member kind vocabulary (`credential-ref`,
  `work-product-ref`, `verification-ref`, `evaluation-ref`), append-only
  (lock rule 6): records are immutable, content-addressed, and
  supersession APPENDS via the `supersedes` digest — the superseded record
  is never edited. `observedAt` is the recency dimension.
- **CompetencyClaim** — an expert's claim on a capability/skill node ref
  with a typed proficiency (A006's closed vocabulary) and its evidence
  digests (>= 1 — an evidence-free claim is structurally not a claim).
  Content-addressed, immutable, tenant-scoped (lock rule 11).
- **QualificationPolicy** — versioned, content-addressed rules stating
  WHAT EVIDENCE QUALIFIES: per-kind minimum FRESH counts, the freshness
  window, the validity window and the conflict rules (evidence that
  revokes regardless of positive evidence).
- **QualificationRecord** — the COMPUTED qualification state of a claim
  under a declared policy at a fixed time: the closed status vocabulary
  (`qualified | unqualified | stale | expired | revoked`), per-requirement
  sufficiency outcomes (counts + freshness — no scores), the validity
  window (renewal/decay) and supersession chains. Expiry APPENDS decay
  records and never rewrites history (lock rule 6).
- **The pure engine** — `evaluateCompetencyClaim` /
  `recordQualificationExpiry` / `isQualificationInForce`: deterministic
  (no clock reads, no hidden state), conflict-first, freshness-next,
  sufficiency-last.
- **MatchRequest / MatchingPolicy / MatchResult / QualifiedExpertCard** —
  the matching data contracts: per-requirement satisfaction evidence,
  explicit unmatched reasons from a closed vocabulary (no silent
  best-effort), deterministic digest tie-breaking, and NO aggregate
  quality label and NO standing input anywhere (spec/quality-model.md:
  do not collapse expert quality into a single global score).
- **Envelope wiring** — `qualify-claim-command` /
  `record-qualification-expiry-command` (REQUIRED idempotency keys, lock
  rule 17), `qualification-recorded-event`, `match-experts-query` /
  `match-completed-response` (pure queries carry none).

## What it deliberately is NOT

- **It is NOT an access or rights system.** QUALIFICATION
  IS DATA — in the architecture-lock's own words (rule 9): "Expert
  identity/qualification is distinct from system authority." No object in
  this package conveys rights, roles or system authority; the
  qualification record is an INPUT to matching and audit, nothing more.
  The hygiene suite enforces the vocabulary separation by scanning
  sources (comment-stripped), contract STRUCTURES, the README and the
  canonical object forms.
- **It is NOT a standing system.** No global score, no standing
  aggregation, per-requirement evidence only (no ranking-of-experts semantics)
  (spec/quality-model.md).
- **It is NOT a licensure claim.** Certification does not convey a legal
  license, professional registration, sign-off authority or authority to
  practice where external law requires it (spec/quality-model.md,
  professional limitations; R39).

The reference fabric (in-process pool + pure matcher + command
orchestration) lives in `services/expert-matching`
(`@arena/expert-matching-fabric`).

## Commands

```bash
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint .
pnpm test             # vitest run (unit + negative + property + parity + drift + hygiene)
pnpm build            # tsc -p tsconfig.build.json
pnpm contracts:generate   # regenerate contracts/expert-qualification
pnpm contracts:check      # drift check against the committed contracts
```

Generated contracts: `contracts/expert-qualification/*.v1.json` at the repo
root (15 schemas + schema registry), emitted by
`scripts/generate-contracts.mjs` per the A001/A002 generator convention
(deterministic, sorted keys, versioned SchemaRef `$id`, `--check` drift
mode). Drift is also checked by the drift suite and governance G9
(auto-discovers package-level generators).

## Test map

| Suite | Focus |
| --- | --- |
| `errors.test.ts` | closed error taxonomy, structured round-trips, strict parsing |
| `shared.test.ts` | pattern guards, tenant scoping, proficiency ordering, view validators |
| `evidence.test.ts` | the four kinds, content addressing, append-only supersession, adversarial payloads |
| `claim.test.ts` | claim construction, determinism, tamper detection, negatives |
| `policy.test.ts` | requirements/windows/conflict rules, version discipline, negatives |
| `qualification.test.ts` | all five status derivations, freshness math, renewal/decay chains, replay |
| `match-protocol.test.ts` | match request/policy/card/result guards and consistency enforcement |
| `envelopes.test.ts` | command/event/query/response wiring, tamper tripwires |
| `property.test.ts` | LCG-seeded determinism/totality/tamper/supersession invariants |
| `contracts.parity.test.ts` | generated contracts ↔ TS surface parity |
| `drift.test.ts` | generator `--check` tripwires (tampered/missing/extra) |
| `hygiene.test.ts` | lock-rule-9 and no-aggregate-score separation negatives |
