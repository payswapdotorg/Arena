# Arena Agent Contract

## Non-negotiable

The repository is the only durable source of truth. Never rely on conversation memory or undocumented assumptions.

## Recovery

Read, in order:

- README.md
- AI_CONTINUATION.md
- docs/LLM-ARCHITECT-HANDOFF.md
- spec/PROJECT-STATE.md
- spec/architecture.md
- spec/architecture-lock.md
- spec/requirements.md
- spec/work-items.md
- spec/dependency-graph.md
- spec/worker-runbook.md
- the assigned Work Order
- live GitHub issue/PR state
- the exact dispatch base SHA

## Architect / Tech Lead

Owns architecture, Work Orders, dispatch, acceptance, review, merge decisions, and project state.

May dispatch at most 3 workers concurrently.

Active Work Orders must have frozen, machine-auditable write surfaces; concurrent Work Orders must be pairwise-disjoint.

Reconcile worker claims against GitHub/API ground truth, especially SHAs, file counts, verification results and merge ancestry.

## Worker

Implements exactly one Work Order, stays within declared ownership surfaces, never edits governance state in flight, never silently broadens scope, adds reproducible verification evidence, and never merges its own PR.

## Concurrency

No-rebase is default.

Concurrent Work Orders must not share source files, package manifests, generated contract surfaces, root manifests, lockfiles or governance state.

Shared contracts are implemented and stabilized before consumers.

Root dependency/lockfile reconciliation is serialized by the Tech Lead.

## Agent Body principle

A model is never treated as synonymous with an Agent Body.

A body version is independently versioned and addressable.

A possession binds a body version to a cognitive substrate and compatible runtime profile.

Certification claims apply to the composition under test, not to the underlying model in isolation.

## Authority

Experts, models, agents and evaluators produce proposals, evidence or judgments according to assigned responsibilities. No model or expert session becomes semantic authority by itself.

Arena does not overwrite host-system authoritative state.

## Provenance

Training, evaluation, expert work, environment snapshots, artifacts and certification results retain enough lineage to reproduce or audit the claim.

## Security

Identity, tenancy, authorization, policy and expert qualification are separate concerns.

Untrusted task/environment workloads execute only inside approved isolation boundaries.

Secrets are never committed.

Customer data is never silently reused across tenants.

## Merge gate

Implementation complete + verification green + evidence complete + ownership compliant + Architect approval = merge.

## Remediation

Architect findings are fixed on the same branch/PR with regression evidence.
