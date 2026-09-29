/**
 * @arena/certification — the ARENA CERTIFICATION PROTOCOL (Work Order
 * A023; spec AB1.0 design law — "Arena certifies statements of the form:
 * Agent Body B, version V, possessed by Cognitive Substrate M, under
 * Environment E and Runtime Profile R, satisfied Certification Suite S at
 * revision X. Arena does NOT certify that M alone an unscoped professional scope claim.";
 * requirements R2, R20, R43, R45, R46; spec/quality-model.md
 * "Certification levels"; architecture-lock rules 4, 6, 16, 17, 18; docs/
 * architecture.md §5, §18).
 *
 * Certification is the COMPOSITION-LEVEL STATEMENT that closes the loop:
 * capability evidence → certification statements. It is NEVER an unscoped
 * professional claim (the design law): the canonical CertificationRecord
 * carries a SCOPED CertificationStatement bound to the exact Body×Substrate×
 * Environment×RuntimeProfile×Suite+Rev composition under test, and the
 * verdict is DERIVED PURELY from the per-component summary — there is no
 * API through which a caller could supply a verdict, a numerical quality label, or a graded label (the
 * design-law + lock-rule-7 separation enforced BY CONSTRUCTION:
 * closed verdict vocabulary, strict shape enforcement, derived verdict,
 * structured unknown-cause taxonomy, frozen objects).
 *
 * Pure TypeScript; runtime dependencies are @arena/protocol-core (canonical
 * JSON + sha256 digests, envelopes, branded identifiers, correlation ids /
 * idempotency keys, SchemaRef, ProtocolError) and @arena/agent-body
 * (the A003 possession / body-version / cognitive-substrate / runtime-
 * profile / environment-profile primitives this protocol COMPOSES,
 * consumed by reference). The sibling protocols this package composes
 * (A012 evaluation, A013 verification, A022 compatibility) are addressed
 * STRICTLY BY DIGEST REFS — never redefined here, exactly like @arena/
 * evaluation binds A005/A011 by digest.
 *
 * Core objects (all deep-frozen, content-addressed, no mutation API):
 *   - CertificationSuiteDescriptor — the content-addressed, versioned
 *     declaration of a certification suite: id, version, title, scope
 *     statement template, component refs (closed component-kind enum:
 *     evaluation | verification | compatibility), declared verdict
 *     semantics (all four mandatory), input/output schema refs and
 *     provenance. Same descriptor ⇒ same digest; ANY change ⇒ a different
 *     digest (the suite's content-addressed revision IS the digest —
 *     the design-law "at revision X");
 *   - ComponentVerdictSummary — the per-component input to derivation:
 *     one entry per declared suite ref (refKind, refDigest, verdict,
 *     constraints, notes), closed-verdict per entry, unique (kind, ref);
 *   - CertificationRecord — the APPEND-ONCE record of one certification
 *     run: suiteRef, possessionRef, flattened scope refs (body/substrate/
 *     environment/runtime-profile), the component summary (set-equal to
 *     the suite's declaration), the DERIVED certification verdict
 *     (pass | conditional-pass | fail | unknown — computed purely from
 *     the component summary, never caller-supplied, never numerical or
 *     graded), the DERIVED structured unknown cause, the DERIVED
 *     constraints list, the DERIVED scoped CertificationStatement,
 *     correlation id + idempotency key, the COMPUTED input digest
 *     over {suiteRef, possessionRef, componentVerdicts}, timestamps and
 *     run provenance;
 *   - CertificationStatement — the SCOPED statement form (design law):
 *     Body×Substrate×Environment×RuntimeProfile×Suite+Rev×Verdict +
 *     rendered text + constraints; DERIVED from the record at construction
 *     time, never caller-supplied — an unscoped "unscoped-professional-claim" claim
 *     is structurally impossible (the design-law negative; see hygiene
 *     suite);
 *   - CertificationError / closed vocabularies / guards — the typed
 *     error taxonomy, the frozen vocabularies (verdicts, component
 *     verdicts, component kinds, unknown reasons, schema names) and
 *     the structural guards;
 *   - Envelope<T> wiring — run-certification-command /
 *     certification-recorded-event with REQUIRED idempotency keys on
 *     commands (architecture-lock rule 17).
 *
 * The REFERENCE FABRIC (suite registry, certification engine, record
 * ledger) lives in services/certification (@arena/certification-fabric)
 * — in-process, zero external runtime dependencies.
 *
 * Generated contracts live in ../../contracts/certification (repo root —
 * A023 owned surface; see scripts/generate-contracts.mjs). Drift is
 * checked by the drift suite and governance G9 (which auto-discovers
 * package-level generators), and parity is asserted against this TS
 * surface by contracts.parity.test.ts.
 */

export * from './errors.js';
export * from './shared.js';
export * from './component-kind.js';
export * from './verdict.js';
export * from './statement.js';
export * from './suite.js';
export * from './record.js';
export * from './envelopes.js';

import { CERTIFICATION_ERROR_CODES } from './errors.js';
import {
  CERTIFICATION_SCHEMA_VERSION,
  CERTIFICATION_SCHEMAS,
} from './envelopes.js';

/** Version of this package's protocol surface. */
export const CERTIFICATION_PROTOCOL_VERSION = CERTIFICATION_SCHEMA_VERSION;

/** The certification error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_CERTIFICATION_ERROR_CODES: readonly string[] = Object.freeze(
  [...Object.values(CERTIFICATION_ERROR_CODES)],
);

/** The certification schema registry (parity-checked against contracts). */
export const CERTIFICATION_SCHEMA_REGISTRY: Readonly<Record<string, string>> =
  Object.freeze({
    ...CERTIFICATION_SCHEMAS,
  });
