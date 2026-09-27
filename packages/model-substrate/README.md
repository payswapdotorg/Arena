# @arena/model-substrate

Arena workspace package (layer: domain), Work Order A016 — the
provider-neutral **Cognitive Substrate / model adapter protocol**
(spec AB1.0; architecture-lock rules 2, 10; requirements R19, R20, R45).

## Surface

- **SubstrateAdapter protocol** (`src/adapter.ts`) — the versioned,
  provider-neutral adapter interface: `registerSubstrate(descriptor) →
  CognitiveSubstrate-shaped record`, `probeCapabilities() →
  modality/tool-calling/context profiles`, `reportHealth()` (health +
  descriptor integrity self-check), and the content-addressed
  **AdapterDescriptor** (registry-style dedup: same descriptor ⇒ same
  digest). Pure types + validators — no I/O, no providers.
- **Substrate records** (`src/substrate.ts`) — `createSubstrateRecord`
  materializes EXACTLY the @arena/agent-body `CognitiveSubstrate` shape
  (type-only import; byte-identical integrity digests — golden
  cross-implementation digest pinned in `substrate.test.ts`).
- **SubstrateRegistry** (`src/registry.ts`) — in-memory, append-only,
  digest/neutral-id keyed; idempotent re-registration of the same digest;
  conflicts rejected; tampered inputs fail closed.
- **Compatibility test harness types** (`src/compatibility.ts`) —
  `SubstrateCompatibilityTest` (BodyVersion ref + substrate digest +
  profile requirements) and the typed RESULT record (pass/fail/inconclusive
  + evidence refs). The compatibility ENGINE is A022 — no decision logic
  here.
- **SubstrateUpgrade** (`src/upgrade.ts`) — old digest → new digest with
  `recertificationRequired: true` (literal); an upgrade NEVER silently
  rebinds a Possession (type-level, construction-level and API-level
  enforcement — a new possession version is required, R45).
- **Envelope wiring** (`src/envelopes.ts`) — commands (idempotency keys
  REQUIRED) and events over `@arena/protocol-core`'s `Envelope<T>`, with a
  versioned schema registry in the `model-substrate` namespace.

Domain purity (gate 10): runtime workspace imports ONLY
`@arena/protocol-core`; `@arena/agent-body` is used exclusively through
type-only imports (re-exported so adapter implementors never need it
directly). The provider/credential screening conventions are vendored
character-for-character from A003 and parity-pinned against BOTH the
generated contracts and `contracts/agent-body/cognitive-substrate.v1.json`.

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative tests)
pnpm build       # tsc -p tsconfig.build.json -> dist/
pnpm contracts:generate   # regenerate contracts/model-substrate/*.json
pnpm contracts:check      # drift check (also run by governance G9)
```

See docs/repo-layout.md for the layering rules this package must obey
(enforced by `pnpm boundary`).

## Reference adapters

Two reference adapters implementing this protocol live under
`adapters/models/` (`adapter-neutral-mock`, `adapter-offline-stub`) — pure
TypeScript mocks with deterministic outputs, zero external runtime deps.
