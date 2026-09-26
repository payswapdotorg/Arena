# @arena/protocol-core

Arena base protocol primitives — **pure TypeScript, zero runtime dependencies**
(enforced by `pnpm governance`, check G7).

## Surface

| Module | Provides |
|---|---|
| `brand.ts` | compile-time `Brand<T, B>` utility |
| `protocol-error.ts` | closed `ProtocolError` code taxonomy, categories, strict structured (de)serialization |
| `identifiers.ts` | branded `CorrelationId` / `IdempotencyKey` with validation + generation |
| `schema-ref.ts` | versioned addressing: `arena:schema/<ns>/<name>@<major.minor.patch>` + core registry |
| `canonical-json.ts` | deterministic canonical JSON (RFC 8785-aligned subset) |
| `digest.ts` | sha256 hex digests over canonical values (WebCrypto, zero deps) |
| `envelope.ts` | stable `Envelope<T>` wire shape, canonical serialization, digest + tamper verification |

## Design invariants

- **Zero runtime deps**; only `devDependencies` (pinned via the pnpm catalog).
- **No model/provider names** anywhere in this package (architecture-lock
  rule 10 — provider details stay behind adapters).
- **Commands are idempotent-addressable**: `kind: 'command'` envelopes MUST
  carry a non-null `idempotencyKey` (architecture-lock rule 17).
- **Unknown versions fail closed**: envelope wire versions and core schema
  versions that are not registered are rejected, never guessed.
- **Canonical form is the digest basis**: sha256 over canonical JSON
  (sorted keys, no whitespace); key order never changes a digest.

## Contracts

`contracts/*.json` are **generated** by `scripts/generate-contracts.mjs` —
never edit them by hand:

```bash
pnpm contracts:generate   # regenerate
pnpm governance           # G9 verifies no drift between generator and committed files
```

`src/contracts.parity.test.ts` additionally binds the generated schemas to
the TypeScript constants (codes, categories, patterns, registry).

## Development

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative suites)
pnpm build       # tsc -p tsconfig.build.json -> dist/
```

Package scaffolded with `scripts/new-package.mjs`.
