# @arena/capability-improvement-service

Reference capability-improvement pipeline service (Work Order C008; issue
#115; spec/expert-environment-session.md EES1.0 "Tool-gap discovery" +
"Knowledge capture"; architecture-lock rules 6, 17, 31, 32).

## What it does

Turns one completed paid intervention into staged, auditable capability
improvement **candidates** — never silent global truth:

1. **Capture** — `captureInterventionOutputs` loads a COMPLETED C007
   intervention outcome through the injected `InterventionOutcomePort`
   (the C007 seam — never another service import, boundary rule B2) and
   captures every EES1.0 `ToolGapSignal` as a staged
   `ToolGapSignalRecord` (stage `captured`) and every four-tier
   `KnowledgeArtifact` as a `LatticeKnowledgeRecord`. Reusable knowledge
   without GRANTED session consent fails closed. Content-key dedup means
   duplicate injections DEDUPLICATE (audited `*_deduplicated`) — triage
   counts can never be inflated.
2. **Tool-gap disposition** — the closed stage machine
   `captured → triaged → tool-specification-proposed → adapter-request |
   body-improvement-candidate | benchmark-candidate |
   marketplace-artifact-candidate`. Every transition is guarded
   (machine-readable reasons), emits its idempotent proposal onto the
   matching destination seam (protocol `Envelope` command envelopes) and
   only then moves the stage. Illegal transitions emit NOTHING.
3. **Knowledge disposition** — `promoteKnowledge` walks the
   no-silent-promotion wall (one scope rank per step, granted rights,
   validation evidence for the verified tier); `proposeKnowledgePatch`
   cuts the scoped, rights-carrying, evidence-backed `KnowledgePatch`
   and emits it to the A019/A020 learning seam as a CANDIDATE ONLY.
4. **Audit** — every capture-to-disposition decision lands in the
   append-only `DispositionAuditSink` with a machine-readable decision
   code, a contiguous sequence and a sha256 tamper-evident chain.

## Ports (all injected)

`Clock`, `InterventionOutcomePort` (C007 seam), `ToolGapSignalLedger`,
`KnowledgeLatticeLedger`, `ToolSpecificationProposalPort`,
`AdapterRequestProposalPort`, `BodyImprovementCandidatePort`,
`BenchmarkCandidatePort`, `MarketplaceArtifactCandidatePort`,
`LearningCandidatePort` (A019/A020/A021 seams), `DispositionAuditSink`.

The in-process reference implementations live in `fabric.ts`
(`InMemory*` / `CollectingProposalPort`). Hosts swap them for real
persistence in `adapters/*` — never here.

## Authority boundary

The service owns capture orchestration and disposition routing only. It
never judges domain outcomes (validation is C009's), never grants rights
beyond the session's consent statement, and never mutates the host
application's live agent (lock rule 32 — proposals only).

## Derived-from notes / architecture questions

- Feed terminals are reachable from BOTH `triaged` and
  `tool-specification-proposed` (EES1.0 lists a linear feed chain; the
  work order stages the disjunction after the spec proposal).
- The typed scope declaration convention is `"<kind>:<ref>"` over the
  C006 artifact's free-text scope string; unparsable scopes fail closed.
- No `rejected/withdrawn` terminal stage exists in the EES1.0 feed list;
  non-pursued signals simply stay captured/triaged.

Run the battery from the repository root (`pnpm run check` …
`pnpm run build`).
