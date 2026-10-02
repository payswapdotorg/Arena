/**
 * Verification view-models (Work Order B012; issue #87;
 * apps/web/src/evaluation). Pure projection layer — no React, no I/O.
 *
 * Projects the canonical A013 objects (`VerificationRecord`,
 * `VerifierDescriptor` — read server-side through the package's PUBLIC
 * API) into the renderable verification detail view. The B012 product
 * truths enforced HERE, by construction:
 *
 *   - verification renders as ITS OWN truth class: a decided outcome
 *     (pass | fail) is a VERIFIED FACT — a claim checked against its
 *     evidence by the named verifier (B003: "checked ... by the
 *     verification authority", displayed WITH its verification
 *     provenance) — while an `unknown` outcome renders as UNKNOWN, fail
 *     honest, never guessed;
 *   - the verifier IDENTITY (id, version, method, declared semantics)
 *     and the SCOPE (the declared evidence requirements) render with
 *     every verdict — a verdict without its verifier and scope is a
 *     degraded view;
 *   - evidence ADDRESSES (evidence kind + content-addressed artifact
 *     reference + provenance) render in the record's append-only order,
 *     each as its own `evidence` truth class — evidence supports a
 *     conclusion, it is never itself the conclusion;
 *   - verification NEVER renders a score: the A013 record has none by
 *     construction, and the view carries the not-an-evaluation note.
 */

import {
  isVerificationRecord,
  isVerifierDescriptor,
} from '../../../../packages/verification/src/index.js';
import type {
  VerificationOutcome,
  VerificationRecord,
  VerifierDescriptor,
} from '../../../../packages/verification/src/index.js';
import { VERIFICATION_NOT_EVALUATION_NOTE } from './state-mark.js';

/** Version of the verification view surface (bump on breaking changes). */
export const VERIFICATION_VIEW_VERSION = 1 as const;

/** The verifier identity every verdict is bound to. */
export interface VerifierIdentityView {
  readonly verifierId: string | undefined;
  readonly version: string | undefined;
  /** The closed A013 method vocabulary member (e.g. constraint_check). */
  readonly method: string | undefined;
  /** The declared outcome semantics — what pass/fail/unknown MEAN for this verifier. */
  readonly semantics: { readonly pass: string; readonly fail: string; readonly unknown: string } | undefined;
  /** The descriptor digest the record's verifierRef binds. */
  readonly verifierRef: string | undefined;
  /** The reproducibility policy (deterministic | seeded-stochastic | provider-dependent). */
  readonly reproducibility: string | undefined;
}

/** One declared requirement of the verification scope, with its support status. */
export interface VerificationRequirementView {
  readonly requirementId: string | undefined;
  /** The evidence KIND the requirement demands (closed per-descriptor vocabulary). */
  readonly evidenceKind: string | undefined;
  /** The claim the evidence must support. */
  readonly claim: string | undefined;
  /** The closed support status (present-supported | present-unsupported | present-unverified | present-indeterminate | missing). */
  readonly status: string | undefined;
  /** Digest of the examined evidence artifact (null when missing). */
  readonly evidenceDigest: string | undefined;
  readonly notes: string | undefined;
}

/** One append-only evidence address: kind + content-addressed artifact + provenance. */
export interface VerificationEvidenceAddressView {
  /** Stable bundle key (`evidenceKind:namespace/name@version#digest`). */
  readonly key: string;
  readonly evidenceKind: string | undefined;
  readonly artifact: {
    readonly namespace: string | undefined;
    readonly name: string | undefined;
    readonly version: string | undefined;
    readonly digest: string | undefined;
  };
  readonly producedBy: string | undefined;
  readonly producedAt: string | undefined;
  readonly notes: string | undefined;
}

/** The fully-renderable verification detail view (positive OR truthfully degraded). */
export interface VerificationDetailView {
  readonly viewVersion: typeof VERIFICATION_VIEW_VERSION;
  /** Stable display id (the route id in demo mode; the digest otherwise). */
  readonly verificationId: string;
  /** The append-once record digest (null only when the payload was unreadable). */
  readonly digest: string | null;
  /**
   * The OWN truth class of a verification outcome: 'verified-fact' when the
   * verifier decided (pass | fail — a checked claim WITH its verification
   * provenance); 'unknown' when the verifier could not decide (fail honest).
   */
  readonly truthClass: 'verified-fact' | 'unknown';
  /** The DERIVED outcome (pass | fail | unknown), when readable. */
  readonly outcome: VerificationOutcome | undefined;
  /** The DERIVED structured why of an unknown outcome (reason + detail). */
  readonly unknownCause: { readonly reason: string; readonly detail: string } | undefined;
  readonly verifier: VerifierIdentityView;
  /** The verification scope: one row per declared requirement, in descriptor order. */
  readonly requirements: readonly VerificationRequirementView[];
  /** The evidence bundle in the record's append-only order. */
  readonly evidence: readonly VerificationEvidenceAddressView[];
  readonly correlationId: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly inputDigest: string | undefined;
  readonly startedAt: string | undefined;
  readonly finishedAt: string | undefined;
  readonly executedBy: string | undefined;
  readonly recordedAt: string | undefined;
  /** The honest not-an-evaluation framing, carried as data and rendered verbatim. */
  readonly notEvaluationNote: string;
  /** Payload pieces that were missing/unreadable — rendered as unknown, by name. */
  readonly unknownFields: readonly string[];
  /** True iff the A013 record itself was structurally readable. */
  readonly readable: boolean;
}

/** The projection input: the A013 objects (or malformed stand-ins) to project. */
export interface VerificationProjectionInput {
  readonly record: unknown;
  readonly descriptor?: unknown;
  /** Stable display id override (demo route ids); defaults to the record digest. */
  readonly verificationId?: string;
}

/**
 * Project the A013 objects into the verification detail view. The record
 * and descriptor are guarded structurally; malformed pieces degrade
 * truthfully (named unknown fields) — never a fabricated verdict, never a
 * guessed verifier identity, never a thrown render.
 */
export function toVerificationDetailView(
  input: VerificationProjectionInput,
): VerificationDetailView {
  const unknownFields: string[] = [];

  const recordOk = isVerificationRecord(input.record);
  if (!recordOk) unknownFields.push('verification record (structurally unreadable)');
  const record: VerificationRecord | undefined = recordOk
    ? (input.record as VerificationRecord)
    : undefined;

  const descriptorOk =
    input.descriptor !== undefined && isVerifierDescriptor(input.descriptor);
  if (!descriptorOk) unknownFields.push('verifier descriptor');
  const descriptor: VerifierDescriptor | undefined = descriptorOk
    ? (input.descriptor as VerifierDescriptor)
    : undefined;

  const outcome = record?.outcome;
  const truthClass: VerificationDetailView['truthClass'] =
    outcome === 'pass' || outcome === 'fail' ? 'verified-fact' : 'unknown';

  // Requirements: record support rows joined to the descriptor's declared
  // requirements (descriptor order — the canonical order). A support row
  // without its declaration renders with claim/kind unknown; a declared
  // requirement without a support row renders with status unknown.
  const requirements: VerificationRequirementView[] = [];
  if (descriptor !== undefined || record !== undefined) {
    const declared =
      descriptor !== undefined
        ? descriptor.requiredEvidence
        : record?.evidenceSupport.map((entry) => ({
            requirementId: entry.requirementId,
            evidenceKind: undefined,
            claim: undefined,
            artifact: null,
            requiredProducer: null,
          })) ?? [];
    const support = new Map(
      (record?.evidenceSupport ?? []).map((entry) => [entry.requirementId, entry]),
    );
    for (const requirement of declared) {
      const supportEntry = support.get(requirement.requirementId);
      if (supportEntry === undefined) {
        unknownFields.push(`support status ${String(requirement.requirementId)}`);
      }
      requirements.push(
        Object.freeze({
          requirementId: requirement.requirementId,
          evidenceKind: requirement.evidenceKind,
          claim: requirement.claim,
          status: supportEntry?.status,
          evidenceDigest: supportEntry?.evidenceDigest ?? undefined,
          notes: supportEntry?.notes ?? undefined,
        } satisfies VerificationRequirementView),
      );
    }
  } else {
    unknownFields.push('verification scope (requirements)');
  }

  // Evidence addresses: the append-only bundle order, verbatim.
  const evidence: VerificationEvidenceAddressView[] = (record?.evidence ?? []).map(
    (ref) =>
      Object.freeze({
        key: `${String(ref.evidenceKind)}:${String(ref.artifact.namespace)}/${String(ref.artifact.name)}@${String(ref.artifact.version)}#${String(ref.artifact.digest)}`,
        evidenceKind: ref.evidenceKind,
        artifact: Object.freeze({
          namespace: ref.artifact.namespace,
          name: ref.artifact.name,
          version: ref.artifact.version,
          digest: ref.artifact.digest,
        }),
        producedBy: ref.provenance.producedBy,
        producedAt: ref.provenance.producedAt,
        notes: ref.provenance.notes ?? undefined,
      } satisfies VerificationEvidenceAddressView),
  );
  if (record !== undefined && evidence.length === 0) {
    unknownFields.push('evidence bundle (empty)');
  }

  const verifier: VerifierIdentityView = Object.freeze({
    verifierId: descriptor?.verifierId,
    version: descriptor?.version,
    method: descriptor?.method,
    semantics:
      descriptor !== undefined
        ? Object.freeze({
            pass: descriptor.outcomeSemantics.pass,
            fail: descriptor.outcomeSemantics.fail,
            unknown: descriptor.outcomeSemantics.unknown,
          })
        : undefined,
    verifierRef: descriptor?.digest ?? record?.verifierRef,
    reproducibility: descriptor?.reproducibility.policy,
  });

  return Object.freeze({
    viewVersion: VERIFICATION_VIEW_VERSION,
    verificationId: input.verificationId ?? record?.digest ?? 'unknown-verification',
    digest: record?.digest ?? null,
    truthClass,
    outcome,
    unknownCause:
      record?.unknownCause !== undefined && record.unknownCause !== null
        ? Object.freeze({
            reason: record.unknownCause.reason,
            detail: record.unknownCause.detail,
          })
        : undefined,
    verifier,
    requirements: Object.freeze(requirements),
    evidence: Object.freeze(evidence),
    correlationId: record?.correlationId,
    idempotencyKey: record?.idempotencyKey,
    inputDigest: record?.inputDigest,
    startedAt: record?.startedAt,
    finishedAt: record?.finishedAt,
    executedBy: record?.provenance.executedBy,
    recordedAt: record?.provenance.recordedAt,
    notEvaluationNote: VERIFICATION_NOT_EVALUATION_NOTE,
    unknownFields: Object.freeze([...new Set(unknownFields)]),
    readable: recordOk,
  } satisfies VerificationDetailView);
}
