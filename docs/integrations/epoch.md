# Integrating a capability provider (Epoch) with the Arena loop

This guide describes how an external capability provider consumes the
Arena capability-development loop through the **A026 epoch adapter**
(`adapters/epoch`, `@arena/epoch-adapter`) — the EPI1.0 contract in
`spec/epoch-integration.md` — and how the **A027 end-to-end slice**
(`examples/epoch-e2e` + `tests/epoch-e2e`) proves the whole loop works.

The worked, deterministic reference is
`examples/epoch-e2e/src/walkthrough.ts`
(`runEpochCapabilityGapLoop()`); the integration tests live in
`tests/epoch-e2e/`.

## The consumption contract (EPI1.0)

### 1. The provider detects a capability gap and submits a request

When Epoch (the provider) detects a capability failure, it submits a
`CapabilityDevelopmentRequest` — a closed-shape, fail-closed JSON
object carrying:

- `requestId`, `requestedAt`, `tenant`, `idempotencyKey`
  (**required**, unique per logical request), optional `correlationId`
  and `causationId`;
- `authorization` — `{ authorizationVersion, tenant, principal, scopes }`.
  The authorization tenant MUST equal the request tenant (cross-tenant
  requests are rejected fail-closed);
- `targetReleaseChannel` — `development` | `candidate` | `stable`
  (the A024 release-admission discipline: `candidate`/`stable` admit
  only certification-backed artifacts);
- `caseSeed` — the capability-case seed (problem statement, target
  capability, domain, observed failure, evidence, requirements);
- `failedTrajectoryRefs` — the failed runs the provider observed;
- `evaluationGaps` — where the provider's evaluation falls short;
- `requirements` — capability + domain requirements.

The adapter validates the request against the closed shape (unknown
fields, malformed digests, non-ISO timestamps are all rejected), then
translates the seed into a **real A005 Capability Case** and emits a
typed `run-capability-development` command envelope (idempotency key
required — architecture-lock rule 17) for the Arena write surface.

### 2. Arena runs the development loop (deterministically)

The A027 slice composes the reference fabrics for the full loop:

case provisioning (A005) → TaskSpec compilation (A008) → environment
run (A009/A010) → trajectory (A011) → evaluation (A012) → verification
(A013) → skill extraction (A019) → learning attribution (A020) →
certification (A023) → release admission (A024).

### 3. The job envelope (the asynchronous contract)

Every capability-development job carries, per EPI1.0:

| Field | Meaning |
| --- | --- |
| `jobId` | the job identity (a UUIDv4) |
| `submission.correlationId` | the causal flow id (echoed from the request or minted) |
| `causationId` | what caused this job (EPI1.0-mandated) |
| `submission.idempotencyKey` | A015 submission identity — same key + same content = the SAME job (replay, no re-execution); same key + different content = `IDEMPOTENCY_CONFLICT` |
| `requestDigest` | the content digest of the submitted request |
| `authorization` | frozen authorization metadata (tenant / principal / scopes) |
| `targetReleaseChannel` | the release-admission channel |
| `status` | the explicit lifecycle: `queued → running → succeeded \| failed \| cancelled` (terminal states are final) |
| `artifactDigests` | the sorted, unique digests of every output artifact |
| `outputs` | the EPI1.0 output refs |

### 4. The typed response: the eleven EPI1.0 output ref kinds

On completion the provider receives content-addressed refs (A002
discipline — kind + digest identity):

`capability-case`, `task-spec`, `environment`, `trajectory-set`,
`evaluator`, `verifier`, `skill-artifact`, `agent-body-version`,
`compatibility-report`, `certification`.

Every ref is `{ refVersion: 1, kind, digest (sha256), address }`. The
three kinds the A025 public read surface exposes
(`agent-body-version`, `compatibility-report`, `certification`) are
resolvable through the adapter's `resolveOutputRef` (not-found is the
value `null`, never an error); the remaining kinds are carried
validated and frozen.

### 5. The error vocabulary (closed)

The adapter throws `EpochAdapterError` with a code drawn from the
closed vocabulary (the code prefixes the thrown message):

`INVALID_REQUEST`, `INVALID_REF`, `INVALID_AUTHORIZATION`,
`CROSS_TENANT`, `IDEMPOTENCY_REQUIRED`, `IDEMPOTENCY_CONFLICT`,
`JOB_NOT_FOUND`, `JOB_TERMINAL`, `INVALID_LIFECYCLE`,
`UNRESOLVED_ARTIFACT`, `SCHEMA_MISMATCH`, `UNSUPPORTED_VERSION`,
`WORLD_MODEL_FORBIDDEN`, `UNKNOWN_ERROR`.

Gate highlights (all adversarially tested in `tests/epoch-e2e`):

- **Channel gate (A024):** completing a `candidate`/`stable` job
  without a `certification` output ref throws `UNRESOLVED_ARTIFACT`.
- **Ref discipline:** completion refs duplicating the job's case ref,
  or claiming the same digest under different kinds, throw
  `INVALID_REF`.
- **Terminal finality:** a terminal job can never be re-completed
  (`JOB_TERMINAL`).
- **Attribution discipline (A020):** if the evaluator or verifier
  version differs between the baseline and intervention arms, the
  capability-lift verdict is forced to `inconclusive-unless-controlled`
  — a changed evaluator is never silently read as an improvement.

## The authority boundary

Arena NEVER crosses the Epoch authority boundary (EPI1.0 "Arena does
not"):

- mutate the Epoch World Model;
- execute Epoch actions;
- alter Epoch constraints;
- change approved baselines;
- alter Epoch delivery state;
- become Epoch semantic authority.

The boundary is **structural**: the adapter exposes no World-Model
mutation surface of any kind — the exported surface is declaration +
typed translation + Arena reads only. The hygiene suite in
`adapters/epoch` scans the public surface for forbidden mutation
vocabulary; the A027 battery pins the loop's read-only consumption of
provider inputs.

## Reproducing the slice

```bash
cd examples/epoch-e2e
pnpm install            # standalone project (own lockfile)
pnpm run test           # walkthrough + determinism tests
pnpm run battery:test   # the tests/epoch-e2e adversarial battery
pnpm run typecheck
```

Every timestamp, seed, idempotency key and correlation id in the slice
is a fixed scenario input; two runs of the loop produce
byte-identical digests (the regression pin in `tests/epoch-e2e`).
