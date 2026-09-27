# @arena/environment-protocol

The ENV1.0 protocol layer for Arena environments (Work Order A009;
`spec/environment.md`; architecture §7, §16; architecture-lock rules 8, 21,
23; requirements R9, R22, R23, R44). Domain package (layer: domain) whose
only workspace dependency is `@arena/protocol-core` — canonical JSON,
sha256 digests, branded identifiers, `Envelope<T>` and `SchemaRef` are
reused from there, never reimplemented.

## Surface

- **`EnvironmentDefinition`** — the versioned, content-addressed
  declaration of an executable world carrying ALL fifteen ENV1.0 declare
  fields (identity id/version, image/build digest, initial state snapshot
  ref+digest with the snapshot support flag, seed policy with the embedded
  reproducibility profile, action/tool surface, observation surface,
  resource limits, network policy, filesystem policy, secret policy, time
  limits, reset semantics, checkpoint semantics, evidence outputs,
  evaluator/verifier hooks). Deep-frozen at creation; sha256 digest over
  the canonical digest-free view; registry-style dedup through the
  append-only `EnvironmentRegistry` (`ENVIRONMENT_VERSION_CONFLICT` on
  divergent content for the same version).
- **`ReproducibilityProfile` / `SeedPolicy`** — deterministic preferred;
  nondeterminism must declare capture of seed, versions, external inputs
  and timing/context metadata; deterministic+seed and
  deterministic+capture are contradictions and rejected.
- **`RunAddress`** — every run addressable by task version, environment
  version (content-addressed), run id, initial snapshot digest, trajectory
  digest and evidence digests; all parts required.
- **Isolation policies** — `ResourceLimits` (bounded CPU/memory/time),
  `NetworkPolicy` (default-deny egress, explicit allows),
  `FilesystemPolicy` (explicit mounts only, no blanket write),
  `SecretPolicy` (reference-only injection points; secret material never
  enters canonical objects) and `TimeLimits`.
- **`WorkloadDeclaration` + `assertLeastPrivilege`** — a workload (trusted
  or untrusted) must require nothing beyond the environment's declared
  allows.
- **Envelope wiring** — `register-environment-command`,
  `admit-workload-command` (mandatory idempotency keys),
  `environment-registered-event`, `workload-admitted-event`.

The protocol is runtime-neutral by construction: the executable substrate
is addressed only through content digests; runner/provider strings are
rejected at construction and absent from canonical/digested objects
(`ENVIRONMENT_RUNTIME_LEAKAGE`).

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative tests per constructor)
pnpm build       # tsc -p tsconfig.build.json -> dist/
pnpm contracts:generate   # regenerate contracts/environment/*.v1.json
pnpm contracts:check     # drift check (also run by governance G9)
```

Generated contracts live in `contracts/environment/` at the repository
root; parity against this TS surface is asserted by
`src/contracts.parity.test.ts`, drift by `src/drift.test.ts` and the
governance G9 check (which auto-discovers package-level generators).

See `docs/repo-layout.md` for the layering rules this package must obey
(enforced by `pnpm boundary`).
