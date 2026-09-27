# @arena/agent-body

Agent Body, BodyVersion, Cognitive Substrate, Possession and Agent Instance
protocol for Arena (Work Order A003; spec AB1.0; architecture-lock rules 1,
2, 3, 4, 5, 17, 22, 23; requirements R1, R2, R18, R19, R20, R43, R45, R46).

- **AgentBody** — the first-class persistent object (lock rule 1): a stable,
  tenant-scoped identity with creation metadata, mandatory rights metadata
  (lock rule 23) and a content-addressed registry of immutable BodyVersions
  appended purely via `registerBodyVersion`.
- **BodyVersion** — the immutable, content-addressed snapshot (lock rule 5)
  of every AB1.0 field: body identity/version; mission and role; domain
  scope; capabilities and SkillRefs; KnowledgeRefs; ToolRefs;
  procedures/workflows; memory policy; planning/decision policy;
  escalation/delegation; authority boundaries; safety policy; evaluation
  suite refs; verification suite refs; environment requirements; substrate
  compatibility profile; provenance and lineage; parent/supersession refs.
  The sha256 digest (canonical JSON, reused from `@arena/protocol-core` —
  never reimplemented) content-addresses the version: same content ⇒ same
  digest, different content ⇒ different digest, same version + different
  content ⇒ `AGENT_BODY_VERSION_CONFLICT` (registry-style dedup).
- **CognitiveSubstrate** — provider-neutral reference to a model/runtime
  capability identifying all eight AB1.0 items (provider adapter; model
  family/id; model revision; modality profile; tool-calling profile;
  context/profile limits; adapter version; integrity metadata). Credentials
  NEVER enter canonical objects (credential-shaped field names are rejected
  with `AGENT_BODY_SUBSTRATE_CREDENTIAL_REJECTED`); provider brand names are
  rejected in every identifier (`AGENT_BODY_PROVIDER_NAME_REJECTED` — lock
  rule 10: provider details remain behind adapters).
- **SubstrateCompatibilityProfile** — per-profile capability requirements
  (modalities, tool semantics, context characteristics, cost/latency
  constraints, required evaluation suites, prohibited conditions,
  substrate-keyed adaptations). It may NOT declare any model as semantically
  identical to the Body: there is NO substrate≡body equality API anywhere in
  this package (asserted by `src/aliasing.test.ts`), and identity-asserting
  profile fields are rejected with `AGENT_BODY_SUBSTRATE_ALIAS_FORBIDDEN`.
  Certification interpretation: claims apply to the tested composition
  `BodyVersion × Substrate × Environment × Runtime × CertificationSuite` —
  never `Substrate = Profession` (requirements R43, R46).
- **Possession** — the immutable, digest-bearing binding (lock rule 3):
  `BodyVersion + CognitiveSubstrate + RuntimeProfile + EnvironmentProfile +
  PolicyBundle + optional ModelSpecificArtifacts`, content-addressed over the
  canonical digest-free view. A substrate upgrade or ANY component change
  produces a new possession digest (a new possession version — requirement
  R45). Model-specific artifacts (lock rule 22) are versioned and
  content-addressed: an (artifactId, artifactVersion) is permanently bound to
  one digest, and a behavioral artifact change forces a new possession via
  `upgradeModelSpecificArtifact` (silent mutation throws
  `AGENT_BODY_ARTIFACT_VERSION_CONFLICT`).
- **AgentInstance** — the ephemeral, append-only execution of a possession:
  instance id, possession digest, environment instance, runtime state, event
  stream (contiguous sequences, monotonic timestamps) and termination
  status. Terminal states (completed/failed/terminated) are FINAL: every
  lifecycle operation on a terminated instance throws
  `AGENT_BODY_INSTANCE_TERMINATED`, and deep-freezing makes in-place mutation
  throw too.
- **Envelope wiring** — commands and events travel inside
  `@arena/protocol-core`'s `Envelope<T>` (idempotency-keyed commands,
  correlation ids, canonical serialization, digest verification).

Generated contracts: `contracts/agent-body/*.json` via
`scripts/generate-contracts.mjs` (`pnpm --filter @arena/agent-body
contracts:generate`, `pnpm --filter @arena/agent-body contracts:check`).
Governance G9 runs this generator's `--check` from `pnpm check`, so the
contracts are drift-governed centrally without any root-file edit. Parity
with the TS surface is asserted by `src/contracts.parity.test.ts`; drift is
asserted by `src/drift.test.ts`; provider-leakage and public-surface hygiene
by `src/hygiene.test.ts`; the substrate≢body anti-alias rule by
`src/aliasing.test.ts`.

Purity: the only workspace import is `@arena/protocol-core` (protocol layer)
— the sibling domain packages (`@arena/artifact-protocol`,
`@arena/provenance`) are NOT imported; their structural shapes (artifact
refs, principals, rights, timestamps) are re-declared here as validated
plain-string views kept in parity with the A002 constants via the generated
contracts. The layer machine-classification in `scripts/boundary-check.mjs`
treats this package as a domain package — all import edges remain legal.
