/**
 * Certification view-models (Work Order B012; issue #87;
 * apps/web/src/evaluation). Pure projection layer — no React, no I/O.
 *
 * Projects the canonical A023 objects (`CertificationRecord`,
 * `CertificationSuite`, `CertificationSubject` — read server-side through
 * the package's PUBLIC API) into the renderable certification detail
 * view, and the canonical B005 `certification` read payload into the
 * claim summary. The B012 product truths enforced HERE, BY CONSTRUCTION:
 *
 *   - certification is COMPOSITION-SCOPED: the detail view's positive
 *     variant REQUIRES the full five-part tuple (Body Version ×
 *     Substrate × Environment × Runtime × Certification Suite) as
 *     non-optional fields. A record whose subject or suite is missing is
 *     structurally UNREPRESENTABLE as a certification — it renders as
 *     the 'incomplete-record' variant with the missing pieces named. A
 *     bare-model claim has no constructor here;
 *   - certification ≠ marketplace purchase ≠ expert qualification: the
 *     scope note rides every view as frozen data, and the granted level
 *     is the DERIVED level (constraints ⇒ CONDITIONAL), never a claim;
 *   - validity is the honest append-only posture: ACTIVE / SUPERSEDED /
 *     REVOKED projected from the record set (revocations and supersession
 *     lineage supplied by the caller) — the A023 model has no wall-clock
 *     expiry, and the view says so instead of inventing a window;
 *   - revocations render with their grounds, never as silent deletions.
 */

import { isCertificationRecord } from '../../../../packages/certification/src/index.js';
import type {
  CertificationLevel,
  CertificationRecord,
  CertificationSuite,
  CertificationSubject,
  CertificationVerdict,
  StageResult,
} from '../../../../packages/certification/src/index.js';
import type { CanonicalRead } from '../../../../packages/read-model/src/index.js';
import { CERTIFICATION_SCOPE_NOTE } from './state-mark.js';
import { certificationPosture } from './fixtures.js';
import type { CertificationPosture } from './fixtures.js';

/** Version of the certification view surface (bump on breaking changes). */
export const CERTIFICATION_VIEW_VERSION = 1 as const;

/** The five-part composition tuple every certification claim is scoped to. */
export interface CertificationCompositionTuple {
  /** The Agent Body B, version V (tenant/name/version + content digest). */
  readonly bodyVersion: {
    readonly tenant: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
  /** The cognitive substrate M under test. */
  readonly substrate: {
    readonly substrateId: string;
    readonly substrateVersion: string;
    readonly digest: string;
  };
  /** The environment E. */
  readonly environment: {
    readonly environmentId: string;
    readonly environmentVersion: string;
    readonly constraints: readonly string[];
  };
  /** The runtime profile R. */
  readonly runtime: {
    readonly runtimeId: string;
    readonly runtimeVersion: string;
    readonly configuration: string;
  };
  /** The certification suite S (identity + revision digest). */
  readonly suite: {
    readonly suiteId: string;
    readonly suiteVersion: string;
    readonly suiteRevision: string;
    readonly levelGrant: string;
    readonly constraints: readonly string[];
  };
}

/** One suite stage result, with its evidence digest when satisfied. */
export interface CertificationStageView {
  readonly stageId: string;
  readonly kind: string;
  readonly outcome: string;
  readonly reason: string;
  readonly evidenceDigest: string | undefined;
  readonly unknownCause: string | undefined;
}

/** The honest validity posture of one run (projected, never wall-clock). */
export interface CertificationValidityView {
  readonly posture: CertificationPosture;
  /** The DERIVED level actually granted (constraints ⇒ CONDITIONAL; failed/unknown runs grant NOTHING). */
  readonly grantedLevel: CertificationLevel | null;
  /** The earlier run digest THIS run supersedes (the lineage back-link), when carried. */
  readonly supersedes: string | undefined;
  readonly revocation: { readonly grounds: string; readonly recordedAt: string } | undefined;
  /** The no-expiry honesty note: A023 validity is lineage + revocation, never a wall-clock window. */
  readonly note: string;
}

/** The positive certification detail: the complete composition-scoped claim. */
export interface CertificationCompleteView {
  readonly kind: 'certification';
  readonly viewVersion: typeof CERTIFICATION_VIEW_VERSION;
  readonly certificationId: string;
  readonly digest: string;
  readonly truthClass: 'certification';
  readonly composition: CertificationCompositionTuple;
  /** The DERIVED verdict (satisfied | not-satisfied | unknown — never a score). */
  readonly verdict: CertificationVerdict;
  readonly validity: CertificationValidityView;
  /** The DERIVED scoped statement (text + scope summary), verbatim from the record. */
  readonly statement: {
    readonly text: string;
    readonly scope: {
      readonly body: string;
      readonly substrate: string;
      readonly environment: string;
      readonly runtime: string;
      readonly suite: string;
    };
    readonly grantedLevel: CertificationLevel | null;
    readonly constraints: readonly string[];
    readonly limitations: string | undefined;
  };
  readonly stages: readonly CertificationStageView[];
  readonly correlationId: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly tenantId: string | undefined;
  readonly workspaceId: string | undefined;
  readonly startedAt: string | undefined;
  readonly finishedAt: string | undefined;
  readonly executedBy: string | undefined;
  readonly recordedAt: string | undefined;
  /** The scope truth, carried as data and rendered verbatim. */
  readonly scopeNote: string;
}

/** The degraded certification detail: a record that is NOT a renderable composition-scoped claim. */
export interface CertificationIncompleteView {
  readonly kind: 'incomplete-record';
  readonly viewVersion: typeof CERTIFICATION_VIEW_VERSION;
  readonly certificationId: string;
  readonly digest: string | null;
  readonly truthClass: 'unknown';
  /** The missing pieces, by name — rendered as unknown, never fabricated. */
  readonly missing: readonly string[];
  readonly recordKind: string | undefined;
  readonly correlationId: string | undefined;
  readonly startedAt: string | undefined;
  readonly finishedAt: string | undefined;
  /** Why this renders incomplete — the honest framing. */
  readonly note: string;
  readonly scopeNote: string;
}

/** A certification detail is EITHER the complete claim OR the honest incomplete record — never a bare-model claim. */
export type CertificationDetailView = CertificationCompleteView | CertificationIncompleteView;

/** The projection input for the protocol-record detail view. */
export interface CertificationProjectionInput {
  readonly record: unknown;
  readonly suite?: unknown;
  /** Digests of runs a later run has SUPERSEDED (the lineage posture projection, supplied by the caller). */
  readonly supersededRunDigests?: readonly string[];
  /** Revocation records affecting any run (the append-only ledger projection). */
  readonly revocations?: readonly unknown[];
  /** Stable display id override (demo route ids); defaults to the record digest. */
  readonly certificationId?: string;
}

/**
 * Project an A023 certification record into its detail view. GUARDED:
 * only a structurally valid `CertificationRecord` of kind
 * 'certification-run' whose subject AND suite are BOTH present can render
 * as the 'certification' variant — the complete composition tuple is
 * non-optional there, so a bare-model (subject-less or suite-less) claim
 * is structurally impossible to render. Everything else renders as the
 * 'incomplete-record' variant with the missing pieces named.
 */
export function toCertificationDetailView(
  input: CertificationProjectionInput,
): CertificationDetailView {
  const certificationId = input.certificationId;

  const recordOk = isCertificationRecord(input.record);
  if (!recordOk) {
    return incomplete(input, null, [
      'certification record (structurally unreadable)',
    ]);
  }
  const record = input.record as CertificationRecord;

  if (record.kind !== 'certification-run') {
    return incomplete(input, record.digest, ['certification run (record is a revocation)'], record);
  }
  if (record.subject === null || record.suiteRef === null) {
    const missing: string[] = [];
    if (record.subject === null) missing.push('subject (the tested composition)');
    if (record.suiteRef === null) missing.push('suite (the certification suite)');
    return incomplete(input, record.digest, missing, record);
  }
  const suiteOk = input.suite !== undefined && isCertificationSuiteLike(input.suite);
  if (!suiteOk) {
    return incomplete(input, record.digest, ['suite (the certification suite)'], record);
  }
  const suite = input.suite as CertificationSuite;

  const subject: CertificationSubject = record.subject;
  const runDigest = record.digest;
  const revocationsForRun = (input.revocations ?? []).filter(
    (candidate) =>
      isCertificationRecord(candidate) && (candidate as CertificationRecord).revokes === runDigest,
  );
  const posture = certificationPosture({
    runDigest,
    supersededBy: input.supersededRunDigests ?? [],
    revoked: revocationsForRun.length > 0 ? [runDigest] : [],
  });
  const revocationRecord =
    revocationsForRun.length > 0 ? (revocationsForRun[0] as CertificationRecord) : undefined;

  const statement = record.statement;
  const stages: CertificationStageView[] = record.stages.map((stage: StageResult) =>
    Object.freeze({
      stageId: stage.stageId,
      kind: suiteStageKind(suite, stage.stageId),
      outcome: stage.outcome,
      reason: stage.reason,
      evidenceDigest: stage.evidenceDigest ?? undefined,
      unknownCause: stage.unknownCause !== null ? String(stage.unknownCause.reason) : undefined,
    } satisfies CertificationStageView),
  );

  return Object.freeze({
    kind: 'certification',
    viewVersion: CERTIFICATION_VIEW_VERSION,
    certificationId: certificationId ?? runDigest,
    digest: runDigest,
    truthClass: 'certification',
    composition: Object.freeze({
      bodyVersion: Object.freeze({
        tenant: subject.bodyVersionRef.tenant,
        name: subject.bodyVersionRef.name,
        version: subject.bodyVersionRef.version,
        digest: subject.bodyVersionRef.digest,
      }),
      substrate: Object.freeze({
        substrateId: subject.substrateRef.substrateId,
        substrateVersion: subject.substrateRef.substrateVersion,
        digest: subject.substrateRef.digest,
      }),
      environment: Object.freeze({
        environmentId: subject.environmentRef.environmentId,
        environmentVersion: subject.environmentRef.environmentVersion,
        constraints: Object.freeze([...subject.environmentRef.constraints]),
      }),
      runtime: Object.freeze({
        runtimeId: subject.runtimeProfile.runtimeId,
        runtimeVersion: subject.runtimeProfile.runtimeVersion,
        configuration: JSON.stringify(subject.runtimeProfile.configuration),
      }),
      suite: Object.freeze({
        suiteId: suite.suiteId,
        suiteVersion: suite.version,
        suiteRevision: suite.digest,
        levelGrant: suite.levelGrant,
        constraints: Object.freeze([...suite.constraints]),
      }),
    } satisfies CertificationCompositionTuple),
    verdict: record.verdict ?? 'unknown',
    validity: Object.freeze({
      posture,
      grantedLevel: record.grantedLevel,
      supersedes: record.supersedes ?? undefined,
      revocation:
        revocationRecord !== undefined && revocationRecord.grounds !== null
          ? Object.freeze({
              grounds: revocationRecord.grounds,
              recordedAt: revocationRecord.provenance.recordedAt,
            })
          : undefined,
      note: CERTIFICATION_VALIDITY_NOTE,
    } satisfies CertificationValidityView),
    statement:
      statement !== null
        ? Object.freeze({
            text: statement.text,
            scope: Object.freeze({
              body: `${String(statement.scope.body)}@${String(statement.scope.bodyVersion)}`,
              substrate: `${String(statement.scope.substrate)}@${String(statement.scope.substrateVersion)}`,
              environment: `${String(statement.scope.environment)}@${String(statement.scope.environmentVersion)}`,
              runtime: `${String(statement.scope.runtime)}@${String(statement.scope.runtimeVersion)}`,
              suite: `${String(statement.scope.suite)}@${String(statement.scope.suiteVersion)}`,
            }),
            grantedLevel: statement.grantedLevel,
            constraints: Object.freeze([...statement.constraints]),
            limitations: statement.limitations ?? undefined,
          })
        : Object.freeze({
            text: 'Derived statement unreadable on this record.',
            scope: Object.freeze({
              body: 'unknown',
              substrate: 'unknown',
              environment: 'unknown',
              runtime: 'unknown',
              suite: 'unknown',
            }),
            grantedLevel: null,
            constraints: Object.freeze([]),
            limitations: undefined,
          }),
    stages: Object.freeze(stages),
    correlationId: record.correlationId,
    idempotencyKey: record.idempotencyKey,
    tenantId: record.tenantId ?? undefined,
    workspaceId: record.workspaceId ?? undefined,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    executedBy: record.provenance.executedBy,
    recordedAt: record.provenance.recordedAt,
    scopeNote: CERTIFICATION_SCOPE_NOTE,
  } satisfies CertificationCompleteView);
}

/** The honesty note for the validity posture (append-only lineage, no wall-clock expiry). */
const CERTIFICATION_VALIDITY_NOTE =
  'Arena certification validity is an append-only ledger posture — ACTIVE, SUPERSEDED by a later run, or REVOKED by a recorded revocation — never a wall-clock expiry window.';

/** Build the honest incomplete variant. */
function incomplete(
  input: CertificationProjectionInput,
  digest: string | null,
  missing: readonly string[],
  record?: CertificationRecord,
): CertificationIncompleteView {
  return Object.freeze({
    kind: 'incomplete-record',
    viewVersion: CERTIFICATION_VIEW_VERSION,
    certificationId: input.certificationId ?? digest ?? 'unknown-certification',
    digest,
    truthClass: 'unknown',
    missing: Object.freeze([...missing]),
    recordKind: record?.kind,
    correlationId: record?.correlationId,
    startedAt: record?.startedAt,
    finishedAt: record?.finishedAt,
    note: 'This record cannot render as a certification: the tested composition (Body Version × Substrate × Environment × Runtime × Suite) is not fully readable. A bare-model or subject-less claim is never fabricated to fill the space.',
    scopeNote: CERTIFICATION_SCOPE_NOTE,
  } satisfies CertificationIncompleteView);
}

/** Structural check for the supplied suite (guards the projection input). */
function isCertificationSuiteLike(value: unknown): value is CertificationSuite {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CertificationSuite).suiteId === 'string' &&
    typeof (value as CertificationSuite).digest === 'string'
  );
}

/** The suite-declared KIND of one stage id ('unknown' when the suite does not declare it). */
function suiteStageKind(suite: CertificationSuite, stageId: string): string {
  const stage = suite.stages.find((candidate) => candidate.stageId === stageId);
  return stage?.kind ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Certification claim summaries (the canonical B005 read payload)
// ---------------------------------------------------------------------------

/** The claim summary of one canonical `certification` read (the B010 honesty pattern). */
export interface CertificationClaimSummary {
  readonly viewVersion: typeof CERTIFICATION_VIEW_VERSION;
  readonly recordId: string;
  readonly tenantId: string;
  readonly certificationId: string | undefined;
  /** The subject the payload names (bodyId@bodyVersion), when carried. */
  readonly subject: { readonly bodyId: string; readonly bodyVersion: string } | undefined;
  readonly certificationKind: string | undefined;
  readonly verdict: string | undefined;
  readonly basis: string | undefined;
  readonly certifiedAt: string | undefined;
  /**
   * The truth class carried by the read-model KIND (canonical read of kind
   * 'certification' — kind-driven, never guessed from the payload shape).
   */
  readonly truthClass: 'certification';
  readonly scopeNote: string;
  /** Payload fields the read did not carry — rendered as unknown. */
  readonly unknownFields: readonly string[];
}

/** Typed projection failure for a non-certification canonical read. */
export const CERTIFICATION_READ_KIND_MISMATCH = 'EVALUATION_CERTIFICATION_READ_KIND_MISMATCH' as const;

/**
 * Project one canonical `certification` read into its claim summary. The
 * payload is loose JSON (the B005 record store carries it opaquely), so
 * every field is read honestly: a missing piece is listed in
 * `unknownFields` and renders as Unknown — the B010 certification-claim
 * pattern. A read of any other kind is a typed projection failure.
 */
export function toCertificationClaimSummary(read: CanonicalRead): CertificationClaimSummary {
  if (read.kind !== 'certification') {
    throw new Error(
      `certification claim projection requires kind 'certification' (got ${JSON.stringify(read.kind)} on ${JSON.stringify(read.recordId)}) [${CERTIFICATION_READ_KIND_MISMATCH}]`,
    );
  }
  const data =
    typeof read.data === 'object' && read.data !== null && !Array.isArray(read.data)
      ? (read.data as Readonly<Record<string, unknown>>)
      : {};

  const unknownFields: string[] = [];
  const readString = (field: string): string | undefined => {
    const value = data[field];
    if (typeof value !== 'string' || value.length === 0) {
      unknownFields.push(field);
      return undefined;
    }
    return value;
  };

  const certificationId = readString('certificationId');
  const verdict = readString('verdict');
  const certificationKind = readString('certificationKind');
  const basis = readString('basis');
  const certifiedAt = readString('certifiedAt');

  const subjectData =
    typeof data['subject'] === 'object' && data['subject'] !== null && !Array.isArray(data['subject'])
      ? (data['subject'] as Readonly<Record<string, unknown>>)
      : {};
  const bodyId =
    typeof subjectData['bodyId'] === 'string' && subjectData['bodyId'].length > 0
      ? subjectData['bodyId']
      : undefined;
  const bodyVersion =
    typeof subjectData['bodyVersion'] === 'string' && subjectData['bodyVersion'].length > 0
      ? subjectData['bodyVersion']
      : undefined;
  const subject =
    bodyId !== undefined && bodyVersion !== undefined
      ? Object.freeze({ bodyId, bodyVersion })
      : undefined;
  if (subject === undefined) unknownFields.push('subject (bodyId@bodyVersion)');

  return Object.freeze({
    viewVersion: CERTIFICATION_VIEW_VERSION,
    recordId: read.recordId,
    tenantId: String(read.tenantId),
    certificationId,
    subject,
    certificationKind,
    verdict,
    basis,
    certifiedAt,
    truthClass: 'certification',
    scopeNote: CERTIFICATION_SCOPE_NOTE,
    unknownFields: Object.freeze([...new Set(unknownFields)]),
  } satisfies CertificationClaimSummary);
}
