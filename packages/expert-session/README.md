# @arena/expert-session

Arena expert environment session **domain core** (Work Order C006; issue #113; `spec/expert-environment-session.md` **EES1.0**).

Pure TypeScript domain package (workspace imports: `@arena/protocol-core`, `@arena/escalation` — the merged C001 escalation-mode vocabulary, consumed read-only). It is the mechanism by which a paid human intervention becomes a directly reusable learning event: the privacy-safe replica of the agent's actual environment.

## Core objects

- **`ExpertSessionCapsule`** — derived from an `ExecutionCapsuleSource` (task + world state + files/data + tool availability + policy + relevant history): **isolated** (the privacy barrier is applied at derivation — world state screened, redacted documents dropped, excluded tools removed), **scoped to one escalation**, **time-bounded**, **privacy-policy controlled**, **non-authoritative** for the host application's live world (typed `authority: 'non-authoritative-replica'`). Content-addressed sha256 digest; deep-frozen.
- **Session modes** — the six EES1.0 modes (`observe`/`correct`/`unblock`/`takeover`/`teach`/`review`) as a typed capability policy; allowed modes derive from the `EscalationRequest`'s `escalationModes` (`deriveSessionModes`; `observe` is the always-present inspection floor). Unpermitted mode escalation is the typed `UNPERMITTED_MODE` failure.
- **`PrivacyBarrier`** — the EES1.0 control set (field/document redaction, secret+tool exclusion, tenant boundary, identity masking, time-limited credentials, read-only resources, action allowlist, download/clipboard/screenshot restrictions) with fail-closed composition and **escape detection**: live-world refs, outside-capsule resources, cross-tenant resources and undeclared tools throw the typed `ESCAPE_ATTEMPT`; barrier control violations throw `PRIVACY_VIOLATION`.
- **Observable event stream** — the closed approved vocabulary (environment observations, human actions, tool invocations/results, artifact changes, annotations, checkpoints, final result, expert corrections, tool-gap signals). **Private chain-of-thought is never captured or transmitted** (typed `PRIVATE_REASONING` at construction; the observation projection re-screens every payload through the capsule barrier).
- **`ToolGapSignal`** — the full EES1.0 field set (tool name, capability, why needed, inputs/outputs, external/manual nature, access requirements, cost/latency, **evidence of use — required**, recommended integration boundary, substitution possibility).
- **Knowledge-capture tiers** — `task-specific-guidance` / `scoped-reusable-knowledge` / `candidate-domain-rule` / `verified-domain-constraint` with the **no-silent-promotion law enforced structurally**: artifacts are frozen; promotion is an explicit append-only operation (`promotedFrom` chain + justification + fresh granted consent); the verified tier requires a `validationRef`; demotion is denied.
- **Session completion** — `ExpertSessionSubmission`: result + evidence + annotations + corrections + optional knowledge artifacts + optional tool-gap signals + **consent/rights statement (required)**.
- **Session lifecycle** — `open → active → completed` (+ `expired`/`cancelled`) bound to the C001 escalation states (SESSION_READY → IN_PROGRESS → SUBMITTED); append-only history and event stream with monotonic sequences and injected timestamps.
- **Replay** — `buildReplayTrace` projects `state → human action → observable consequence → evidence` frames, clearly marked `kind: 'bounded-expert-session-replay'`, `liveMutation: false`; `asLiveMutation` fails closed with `REPLAY_AS_LIVE`.

## Envelopes

Wire messages in the `expert-session` SchemaRef namespace: `open-expert-session-command` (REQUIRED idempotency key), `submit-expert-session-command` (REQUIRED idempotency key), `get-expert-session-query` (NULL key — reads are not commands), `expert-session-response`. Parsing is strict and fail-closed.

## Consumers

- `services/expert-session` — the session lifecycle service (injected ports, A015 fabric semantics).
- `adapters/expert-environment` — capsule materialization against the A009/A010 environment protocol/runtime.

## Scripts

```
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run
pnpm build       # tsc -p tsconfig.build.json
```
