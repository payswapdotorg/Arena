# @arena/body-forge

The Arena **Agent Body Forge protocol** (Work Order A021; requirement
R18 — *"Forge immutable Agent Body Versions"*; docs/architecture.md
§12 Agent Body Forge; architecture-lock rules 5, 6, 16, 17, 18, 23).

The Forge composes the §12 inputs — Body Manifest + Skills + Knowledge
+ Tools + Procedures/Policies + Verification + Evaluation +
Environment Requirements — into an **immutable Body Version**.

## What it is

| Object | What it commits to |
| --- | --- |
| `BodyManifest` | The **versioned, content-addressed composition INPUT**: mission/role; domain scope; capability refs (REAL A004 `CapabilityNodeRef` shape, digest-addressed) + skill refs (A003 `VersionedArtifactRef` shape — exactly what `BodyVersion.skills` commits to); knowledge/tool/procedure refs; memory/planning/safety policy documents; escalation/delegation rules; authority boundaries; evaluation suite refs (A012 descriptor digests); verification suite refs (A013 descriptor digests); environment requirements (A009-shaped documents, content-addressed); the substrate compatibility profile (A003 shape); provenance (author + timestamp + **EXPLICIT learning citations**); MANDATORY rights metadata (lock rule 23); parent/supersession lineage. Deep-frozen, digest-addressed (sha256 over the canonical digest-free view), tamper-checked (`verifyBodyManifest` fails closed). |
| `ForgePolicy` | The **versioned, content-addressed composition rules**: which inputs are mandatory (tunable minimums for skills/knowledge/tools/procedures that may only STRENGTHEN the hard A003 floors); how learning-derived proposals (A020 experiment records / A019 skill drafts) may enter a manifest — **each as an EXPLICIT cited provenance ref** (closed vocabulary `experiment-record` \| `skill-draft`; a manifest that silently embeds un-provenanced content is REJECTED); conflict pre-checks live at manifest construction (duplicate refs, duplicate capability ids, duplicate escalation conditions, duplicate policy ids); lineage rules (`requireParents`, `allowSupersession`). |
| `ForgeRecipe` / `forgeBodyVersion` / `forge` | The **deterministic composition**: a pure function of (manifest, policy, recipe) — NO hidden clock reads; same manifest + policy + recipe ⇒ byte-identical BodyVersion. Every compose produces a **NEW version proposal with full lineage** (parent refs, source manifest digest, policy digest, correlation id). The emitted proposal is a **REAL `@arena/agent-body` BodyVersion BY CONSTRUCTION** — built through `createBodyVersion` (the A003 constructor) and re-verified fail-closed (`isBodyVersion` + `verifyBodyVersion`). |
| `ForgeRecord` | The **append-only, idempotency-keyed** execution record (lock rule 17): forge key + correlation id + manifest digest + policy digest + emitted BodyVersion digest + the emitted version's content-addressed ref + provenance. Re-running the same key returns the recorded result (the fabric's replay). |
| Envelopes | `submit-forge-command` / `forge-completed-event` inside `@arena/protocol-core`'s `Envelope<T>`; commands carry a **required non-null idempotency key** (lock rule 17). |

## What it deliberately is NOT

- **It never mutates a BodyVersion** (lock rule 5): there is no
  update/delete/rewrite path anywhere; every compose mints a NEW
  immutable proposal. The hygiene suite proves the sources never call
  the A003 registry write API (`registerBodyVersion`) — appending a
  forged proposal to a body's version registry is the body owner's
  move, not the forge's.
- **Proposals only**: the forge emits; admission into an AgentBody's
  append-only registry happens through A003's `registerBodyVersion`
  (the single append authority).
- **Supersession is append-only** (lock rule 6): a manifest that
  supersedes a prior version MUST carry that version among its
  parents — a HARD, non-policy-tunable rule; the prior stays
  addressable forever.
- **No silent learning content**: learning PROPOSES (A020 experiment
  records, A019 skill drafts); the forge COMPOSES only explicitly
  cited, digest-bound contributions. History is never rewritten.
- **No contracts surface** (A019 precedent — see disclosure below).

## The hard rules (not policy-tunable)

1. **Supersedes ⇒ parent**: `lineage.supersedes` must appear in
   `lineage.parents` (`BODY_FORGE_LINEAGE_VIOLATION`).
2. **A003 AB1.0 floors**: mission/role non-empty; domainScope,
   capabilities, authorityBoundaries, evaluationSuites,
   verificationSuites, environmentRequirements each ≥ 1; rights
   MANDATORY; substrate profile alias-forbidden (all enforced at
   manifest construction; a policy may only strengthen).
3. **Determinism**: composition reads no clock and no ambient state;
   every timestamp and principal comes from the caller-supplied
   recipe.

## Projection rules (manifest → BodyVersion), disclosed

- `capabilities` (A004 refs) project to the A003 string list by
  **capability id**; the digest-addressed refs stay committed in the
  content-addressed manifest, which the forged version cites in
  `provenance.records` — nothing is silently lost, the chain is
  digest-verifiable end to end.
- `skills`/`knowledge`/`tools`/`procedures` project verbatim (same
  `VersionedArtifactRef` shape).
- `provenance.records` = EXACTLY `[manifest ref, policy ref]`
  (namespace `body-forge`); the full citation chain (every learning
  citation) stays reachable through the cited manifest digest.
- `provenance.creator` = `recipe.forgePrincipal`;
  `provenance.createdAt` = `recipe.forgedAt`.

## Contracts disclosure (A021)

This package owns **NO `contracts/` surface** (per spec/work-items.md,
A021's surfaces are `packages/body-forge/*` and `services/body-forge/*`
only — the A019 precedent). Its schemas live **inside the package as
SchemaRef-referenced data** (`BODY_FORGE_SCHEMAS`, namespace
`arena:schema/body-forge/...`); existing contracts are not redeclared.
No generator ships, so governance G9 has nothing to drift-check here.

## Dependencies (disclosed)

Runtime (zero external):

- `@arena/protocol-core` — canonical JSON + sha256 digests, envelopes,
  branded identifiers, SchemaRef, ProtocolError.
- `@arena/agent-body` — the **REAL BodyVersion contract**: the forge
  projects through `createBodyVersion` and re-validates with
  `isBodyVersion`/`verifyBodyVersion`, so the emitted proposals are
  A003 BodyVersions by construction (imported, never mirrored — no
  parity burden). The A003 view validators (principals, rights,
  policy documents, artifact refs, substrate profiles, timestamps)
  and tripwires (credential fields, provider names) are likewise
  reused, not mirrored.
- `@arena/capability-graph` — the **REAL `isCapabilityNodeRef` /
  `toCapabilityNodeRef` guards** for A004-shaped capability refs.

Failures raised inside the reused A003 constructors surface as
`AgentBodyError` (the A003 contract is the final authority on the
emitted shape); manifest/policy/recipe/record-level failures carry
`BODY_FORGE_*` codes.

## Reference fabric

The in-process reference fabric — `ForgeService` (submit → validate →
compose → record, with a digest-addressed append-only ForgeRecord
registry, deterministic replay and the A003-mirroring version-conflict
guard) plus the **compose-from-learning demo path** — lives in
`services/body-forge` (`@arena/body-forge-fabric`).

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (unit + negative + property + hygiene; 95 tests)
pnpm build       # tsc -p tsconfig.build.json -> dist/
```

See docs/repo-layout.md for the layering rules this package must obey
(enforced by `pnpm boundary`).
