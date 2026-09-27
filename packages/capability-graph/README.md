# @arena/capability-graph

The Capability Graph and skill taxonomy for Arena (Work Order A004;
docs/architecture.md §3, §4; requirements R4, R17, R32, R37;
architecture-lock rules 6, 21, 23).

The graph is **descriptive and queryable; it does not replace object
authority** (architecture.md §4). It relates the eleven §4 node kinds —
domain, capability, sub-capability, skill, tool, task family, evaluator,
verifier, expert competency, observed failure, body version — through nine
typed, provenance-bearing edge kinds.

- **CapabilityNode** — a versioned, digest-addressed, deep-frozen node for
  each of the eleven kinds: kind, stable id, semver version, a versioned
  payload-schema `SchemaRef`, a kind-specific payload, optional supersedes
  digest (append-only supersession) and optional provenance (REQUIRED for
  skills — §3). The sha256 digest is computed over the canonical JSON of the
  digest-free view with `@arena/protocol-core`'s `digestCanonical` — never
  reimplemented. Same content ⇒ same digest; different content ⇒ different
  digest.
- **CapabilityEdge** — a typed relation (decomposes-into, requires, produces,
  evaluates, verifies, observes-failure-of, competent-in, exercised-by,
  extends-domain) with a per-kind endpoint matrix, a versioned payload and a
  REQUIRED provenance reference on every edge. Unknown edge kinds are
  rejected.
- **Skill taxonomy** — the hierarchical edge subgraph (decomposes-into,
  extends-domain, requires, produces) is maintained as a DAG: inserting an
  edge that would close a cycle throws `CAPABILITY_GRAPH_CYCLE_DETECTED`
  with the offending node path in the message and in `details.path`. Skill
  payloads carry the §3 shape (inputs, outputs, prerequisites, evidence,
  tests) plus explicit professionalLimitations and customerData (lock rule
  23).
- **CapabilityGraph** — append-only and deep-frozen: `appendNode` /
  `appendEdge` / `applyDomainPack` are PURE (they return a new frozen graph
  and never mutate the original); there is no update, delete or rewrite API.
  Supersession happens by append — the superseded node stays immutable and
  addressable forever (lock rule 6). Node/edge admission re-verifies claimed
  digests fail-closed; one identity key ⇒ one digest, forever; bit-identical
  re-assertions are idempotent.
- **Pure queries** — descendants/ancestors, subgraph by kinds, reachable
  skills for a domain, simple paths, dependents of a skill, supersession
  chains. Deterministic (key-sorted) frozen results: idempotent reads, no
  phantom nodes.
- **DomainPack** — the lock-rule-21 extension point: a descriptor (id,
  version, target domain, declared extensions: skills / environments /
  evaluators) that can ADD nodes and edges but can never supersede, redefine
  or rewrite a node it does not own (`CAPABILITY_GRAPH_PACK_OVERREACH`).
  Environments are explicit versioned references (owned by the environment
  protocol, A009), never first-class nodes — new domains extend the Arena
  lifecycle, they do not fork it.
- **Envelope wiring** — commands and events travel inside
  `@arena/protocol-core`'s `Envelope<T>` (idempotency-keyed commands,
  correlation ids, canonical serialization, digest verification).

Generated contracts: `contracts/capability/*.json` via
`scripts/generate-contracts.mjs` (`pnpm contracts:generate`,
`pnpm contracts:check`). Parity with the TS surface is asserted by
`src/contracts.parity.test.ts`; drift is asserted by `src/drift.test.ts` and
by the repo-wide governance G9 check, which runs every package-level
generator.

Purity: the only runtime dependency is `@arena/protocol-core` (protocol
layer; the layer machine-classification in `scripts/boundary-check.mjs`
treats this package as a domain package — all import edges remain legal;
mirrors the A002 final report note). Zero new external runtime dependencies;
the property tests use a seeded in-file LCG, not faker/fast-check.
