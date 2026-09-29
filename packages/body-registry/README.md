# @arena/body-registry

The **Arena Body Registry protocol** — the RELEASE stage of the Arena
loop (Work Order A024; requirements R23/R24; README "Completion
target": … Certification → **Release** → Epoch consumption;
architecture-lock rules 5, 6, 12, 16, 17, 18, 23).

The registry is the authoritative record of **released Body versions**
and their release lineage.

## What is in the box

| Surface | Purpose |
|---|---|
| `evaluateReleaseGate` | The **release admission gate**: registration of a Body version FOR RELEASE, gated on real discipline — valid A023 certification statements + valid A022 compatibility verdicts, resolved through injected digest-addressed evidence stores, structurally validated and tamper-verified, fail-closed. |
| `ReleaseRecord` | Typed, append-only, deep-frozen, content-addressed release records: `release-registration` (citable artifact identity + channel + tags + frozen gate evidence), `release-supersession`, `release-retirement` (lineage states, history never rewritten). |
| `ReleasePublicationRecord` | Publication semantics: a registered release becomes a citable, content-addressed artifact identity through deterministic, **idempotent and reproducible** publication on an append-only ledger (`publish` / `retract`, identity immutability across history, mandatory rights metadata). |
| Envelope wiring | `register-release-command` / `release-registered-event`, `publish-release-command` / `release-published-event` inside `@arena/protocol-core`'s `Envelope<T>` — commands carry REQUIRED idempotency keys (lock rule 17). |
| `BodyRegistryError` | Closed error vocabulary with structured, wire-safe forms and a strictly validating parser. |

## The gate is real (never a rubber stamp)

A candidate is admitted only when **every** check passes:

1. the cited `BodyVersion` resolves in the body-version store, is
   structurally valid per the REAL A003 guard (`isBodyVersion`), is
   tamper-verified (`verifyBodyVersion`), and matches the candidate's
   ref exactly (tenant, name, version, digest);
2. every **certification citation** resolves, is structurally valid
   (`isCertificationRecord`), is tamper-verified (canonical digest over
   the digest-free view), is a `certification-run` record (a revocation
   is not certification), carries verdict `satisfied`, grants a level,
   and is **scoped to the exact body version** (the A023 subject's
   `bodyVersionRef` must equal the candidate's);
3. every **compatibility citation** resolves, is structurally valid
   (`isCompatibilityRecord`), is tamper-verified (both documented A022
   record-digest schemes — see below), carries verdict `compatible`,
   and addresses the candidate's body version;
4. an optional **forge provenance citation** (A021 `ForgeRecord`) is
   validated the same way when present — and a citation without an
   injected forge store **rejects** (fail-closed);
5. the **release channel discipline** ties channels to certification
   grants (spec/quality-model.md levels): `stable` requires CERTIFIED,
   `candidate` requires CANDIDATE|CERTIFIED, `development` accepts any
   grant.

Every refusal is a **structured, closed-vocabulary rejection**
(`ReleaseGateRejection`: reason + source + implicated ref + detail).
The gate never throws on refusable input; it throws only when evidence
infrastructure itself fails (`BODY_REGISTRY_EVIDENCE_UNRESOLVABLE` —
fail-closed admission).

## Publication semantics

- **Reproducible**: publication records are content-addressed over the
  full view with a caller-supplied timestamp — no hidden clock reads;
  identical inputs mint the byte-identical record.
- **Idempotent**: appending the identical publish record to a ledger is
  a no-op (the ledger is returned unchanged).
- **Append-only**: retraction never edits the original; it appends a
  `retract` record whose `supersedes` carries the publication digest.
- **Identity-immutable**: once a release identity
  (namespace/name/version) is bound to a digest anywhere in history,
  publishing the same identity with a different digest is rejected —
  even after a retraction (A002 publication law).
- **Rights are mandatory** (lock rule 23): a publication without valid
  rights metadata is unrepresentable.

## Dependencies (disclosed)

Runtime: `@arena/protocol-core` (canonical JSON + sha256, envelopes,
branded identifiers, SchemaRef) + the REAL sibling guards the gate
projects through — `@arena/agent-body` (A003 BodyVersion, refs,
rights, principals, timestamps), `@arena/certification` (A023 records,
levels), `@arena/compatibility` (A022 records), `@arena/body-forge`
(A021 forge records). Consumed, never reimplemented. Failures raised
by the REAL sibling guards propagate as their own typed errors where
the guard itself throws; domain failures raise `BodyRegistryError`.

## A022 compatibility-record integrity (disclosed)

A022 ships two documented digest schemes; the gate verifies against
**both** (fail-closed on neither matching):

1. the **package form** (`CompatibilityRegistry.createAndRegister`):
   sha256 over the canonical JSON of the full view (details included,
   optional fields dropped when absent);
2. the **service form** (`services/compatibility` engine): sha256 over
   plain `JSON.stringify` of a fixed key order with `details`
   excluded and optional fields null-normalized.

## Contracts disclosure (A024)

This package owns **no `contracts/` surface** (spec/work-items.md
assigns A024 only `packages/body-registry/*` and
`services/body-registry/*`), following the A019/A021/A022 precedent:
schemas live inside the package as SchemaRef-referenced data
(`BODY_REGISTRY_SCHEMAS`, `src/envelopes.ts`); existing contracts are
not redeclared. No generator ships, so governance G9 has nothing to
drift-check here.

## Reference fabric

The in-process reference registry — `BodyRegistryService` (register /
publish / supersede / retire with deterministic idempotent replay,
identity-immutability binding and ledger projections) plus the
envelope-wired service facade — lives in
`services/body-registry` (`@arena/body-registry-fabric`).

## Testing

Positive, negative/adversarial (tampering, scope mismatch, fail-closed
stores, channel discipline), hygiene (append-only proofs, closed
vocabularies, no mutation APIs) and property suites (determinism,
content addressing, avalanche). Run: `pnpm vitest run`.
