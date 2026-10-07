/**
 * The typed FINDING RECORD (Work Order C020; issue #126) — the shared
 * shape of every anti-gaming and fraud control output.
 *
 * A finding is TYPED (closed FINDING_KINDS vocabulary), EVIDENCE-CARRYING
 * (>= 1 owning-surface evidence refs), REASON-CARRYING (machine-readable
 * closed reason codes), APPEND-ONLY and content-addressed. Findings
 * PROPOSE actions into the owning surfaces (requalification triggers,
 * profile evidence, enforcement) — they never silently adjust scores,
 * routing, adjudication or payment state.
 */

import { digestCanonical } from '@arena/protocol-core';
import { NETWORK_QUALITY_ERROR_CODES, NetworkQualityError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  expectNonEmptyString,
  expectPositiveInteger,
  screenFieldNames,
  toNetworkQualityNeutralText,
  toNetworkQualityParty,
  toNetworkQualityRecordId,
  toNetworkQualityTenant,
  toNetworkQualityTimestamp,
} from './shared.js';
import {
  FINDING_KIND_CATEGORY,
  FINDING_SEVERITIES,
  isFindingKind,
  isFindingSeverity,
  isEnforcementAction,
} from './vocabulary.js';
import type {
  EnforcementAction,
  FindingCategory,
  FindingKind,
  FindingSeverity,
} from './vocabulary.js';

/** Wire version of the finding record. */
export const FINDING_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Evidence + reasons + proposals
// ---------------------------------------------------------------------------

/** One owning-surface evidence ref a finding derives from. */
export interface FindingEvidenceRef {
  /** The dep surface the evidence lives in (closed vocabulary per control). */
  readonly surface: string;
  /** The dep record id (opaque here, addressable there). */
  readonly refId: string;
  /** The dep record content digest when available (null otherwise). */
  readonly refDigest: string | null;
}

/** One machine-readable finding reason (closed per-control vocabularies). */
export interface FindingReason {
  readonly code: string;
  readonly detail: string;
}

/** The closed proposal kinds (what a finding may PROPOSE into owning surfaces). */
export const FINDING_PROPOSAL_KINDS = Object.freeze([
  /** A requalification trigger — proposal to the C004 owning surface. */
  'requalification-trigger-proposal',
  /** Dimensional evidence — proposal into the C005 profile ingestion port. */
  'profile-evidence-proposal',
  /** An enforcement action — proposal into the C020 enforcement case machine. */
  'enforcement-action-proposal',
] as const);

export type FindingProposalKind = (typeof FINDING_PROPOSAL_KINDS)[number];

/** One typed proposal a finding carries (data, never a write). */
export interface FindingProposal {
  readonly proposalKind: FindingProposalKind;
  /** The owning surface the proposal addresses (e.g. 'expert-calibration'). */
  readonly targetSurface: string;
  /** The proposed action (enforcement proposals only; else null). */
  readonly enforcementAction: EnforcementAction | null;
  /** Machine-readable proposal payload (plain JSON, screen-checked). */
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface FindingRecordView {
  readonly findingVersion: typeof FINDING_RECORD_VERSION;
  readonly findingId: string;
  readonly tenant: string;
  /** The party the finding is ABOUT (an expert ref). */
  readonly subjectParty: string;
  readonly kind: FindingKind;
  readonly category: FindingCategory;
  readonly severity: FindingSeverity;
  /** >= 1 owning-surface evidence refs. */
  readonly evidence: readonly FindingEvidenceRef[];
  /** >= 1 machine-readable reasons. */
  readonly reasons: readonly FindingReason[];
  /** Zero or more typed proposals into owning surfaces. */
  readonly proposals: readonly FindingProposal[];
  readonly observedAt: string;
  readonly detectedAt: string;
  readonly summary: string;
}

/** A frozen, content-addressed finding record (+ digest). */
export interface FindingRecord extends FindingRecordView {
  readonly digest: string;
}

export interface CreateFindingInput {
  readonly findingId: string;
  readonly tenant: string;
  readonly subjectParty: string;
  readonly kind: string;
  readonly severity: string;
  readonly evidence: readonly {
    readonly surface: string;
    readonly refId: string;
    readonly refDigest?: string | null;
  }[];
  readonly reasons: readonly { readonly code: string; readonly detail: string }[];
  readonly proposals?: readonly {
    readonly proposalKind: string;
    readonly targetSurface: string;
    readonly enforcementAction?: string | null;
    readonly payload: Record<string, unknown>;
  }[];
  readonly observedAt: string;
  readonly detectedAt: string;
  readonly summary: string;
}

function requireEvidence(value: unknown, context: string): readonly FindingEvidenceRef[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
      message: `${context}: a finding requires at least one owning-surface evidence ref -- unevidenced findings are inadmissible`,
    });
  }
  return Object.freeze(
    (value as unknown[]).map((entry, index) => {
      const record = expectFields(
        entry,
        ['surface', 'refId'],
        ['refDigest'],
        NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
        `${context}.evidence[${index}]`,
      );
      const refDigestRaw = record['refDigest'] ?? null;
      return deepFreeze({
        surface: expectNonEmptyString(
          record['surface'],
          'surface',
          NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE,
          `${context}.evidence[${index}]`,
        ),
        refId: expectNonEmptyString(
          record['refId'],
          'refId',
          NETWORK_QUALITY_ERROR_CODES.INVALID_REF,
          `${context}.evidence[${index}]`,
        ),
        refDigest:
          refDigestRaw === null || refDigestRaw === undefined ? null : (refDigestRaw as string),
      }) as FindingEvidenceRef;
    }),
  );
}

function requireReasons(value: unknown, context: string): readonly FindingReason[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
      message: `${context}: a finding requires at least one machine-readable reason -- unexplained findings are inadmissible`,
    });
  }
  return Object.freeze(
    (value as unknown[]).map((entry, index) => {
      const record = expectFields(
        entry,
        ['code', 'detail'],
        [],
        NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
        `${context}.reasons[${index}]`,
      );
      return deepFreeze({
        code: expectNonEmptyString(
          record['code'],
          'code',
          NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
          `${context}.reasons[${index}]`,
        ),
        detail: toNetworkQualityNeutralText(
          record['detail'] as string,
          `${context}.reasons[${index}].detail`,
        ),
      }) as FindingReason;
    }),
  );
}

function requireProposals(value: unknown, context: string): readonly FindingProposal[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
      message: `${context}: proposals must be an array of typed proposals`,
    });
  }
  return Object.freeze(
    (value as unknown[]).map((entry, index) => {
      const record = expectFields(
        entry,
        ['proposalKind', 'targetSurface', 'payload'],
        ['enforcementAction'],
        NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
        `${context}.proposals[${index}]`,
      );
      if (
        typeof record['proposalKind'] !== 'string' ||
        !(FINDING_PROPOSAL_KINDS as readonly string[]).includes(record['proposalKind'])
      ) {
        throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
          message: `${context}.proposals[${index}]: unknown proposal kind: ${JSON.stringify(String(record['proposalKind']))}`,
          details: { known: FINDING_PROPOSAL_KINDS },
        });
      }
      const enforcementActionRaw = record['enforcementAction'] ?? null;
      if (enforcementActionRaw !== null && !isEnforcementAction(enforcementActionRaw)) {
        throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
          message: `${context}.proposals[${index}]: unknown enforcement action: ${JSON.stringify(String(enforcementActionRaw))} (HOLD | SUSPEND | INVESTIGATE)`,
        });
      }
      if (
        record['proposalKind'] === 'enforcement-action-proposal' &&
        enforcementActionRaw === null
      ) {
        throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
          message: `${context}.proposals[${index}]: an enforcement-action proposal requires its enforcement action (HOLD | SUSPEND | INVESTIGATE)`,
        });
      }
      if (
        record['proposalKind'] !== 'enforcement-action-proposal' &&
        enforcementActionRaw !== null
      ) {
        throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
          message: `${context}.proposals[${index}]: only enforcement-action proposals carry an enforcement action`,
        });
      }
      const payload = record['payload'];
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
          message: `${context}.proposals[${index}]: payload must be a plain JSON object`,
        });
      }
      return deepFreeze({
        proposalKind: record['proposalKind'] as FindingProposalKind,
        targetSurface: expectNonEmptyString(
          record['targetSurface'],
          'targetSurface',
          NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE,
          `${context}.proposals[${index}]`,
        ),
        enforcementAction: (enforcementActionRaw as EnforcementAction | null) ?? null,
        payload: deepFreeze({ ...(payload as Record<string, unknown>) }),
      }) as FindingProposal;
    }),
  );
}

/**
 * Create ONE append-only, content-addressed finding record. Fails closed
 * on unknown kinds/severities, kind/category mismatch, missing evidence
 * or reasons, backdated detection, authority/PII-shaped fields.
 */
export async function createFinding(input: CreateFindingInput): Promise<FindingRecord> {
  const record = expectFields(
    input,
    [
      'findingId',
      'tenant',
      'subjectParty',
      'kind',
      'severity',
      'evidence',
      'reasons',
      'observedAt',
      'detectedAt',
      'summary',
    ],
    ['proposals'],
    NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
    'finding record',
  );
  if (!isFindingKind(record['kind'])) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
      message: `finding record: unknown finding kind: ${JSON.stringify(String(record['kind']))}`,
      details: { known: Object.keys(FINDING_KIND_CATEGORY) },
    });
  }
  const kind = record['kind'] as FindingKind;
  if (!isFindingSeverity(record['severity'])) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
      message: `finding record: unknown severity: ${JSON.stringify(String(record['severity']))}`,
      details: { known: FINDING_SEVERITIES },
    });
  }
  const observedAt = toNetworkQualityTimestamp(
    record['observedAt'] as string,
    'finding record observedAt',
  );
  const detectedAt = toNetworkQualityTimestamp(
    record['detectedAt'] as string,
    'finding record detectedAt',
  );
  if (Date.parse(detectedAt) < Date.parse(observedAt)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.BACKDATED_RECORD, {
      message: `finding record: detectedAt (${detectedAt}) precedes observedAt (${observedAt}) -- backdated detection fails closed`,
    });
  }
  const view: FindingRecordView = {
    findingVersion: FINDING_RECORD_VERSION,
    findingId: toNetworkQualityRecordId(
      record['findingId'] as string,
      'finding record findingId',
    ),
    tenant: toNetworkQualityTenant(record['tenant'] as string, 'finding record tenant'),
    subjectParty: toNetworkQualityParty(
      record['subjectParty'] as string,
      'finding record subjectParty',
    ),
    kind,
    category: FINDING_KIND_CATEGORY[kind],
    severity: record['severity'] as FindingSeverity,
    evidence: requireEvidence(record['evidence'], 'finding record'),
    reasons: requireReasons(record['reasons'], 'finding record'),
    proposals: requireProposals(record['proposals'], 'finding record'),
    observedAt,
    detectedAt,
    summary: toNetworkQualityNeutralText(record['summary'] as string, 'finding record summary'),
  };
  screenFieldNames(view, 'findingRecord');
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as FindingRecord;
}

/** Recompute the content digest of a stored finding (tamper check). */
export async function recomputeFindingDigest(finding: FindingRecord): Promise<string> {
  const { digest: _digest, ...view } = finding;
  return digestCanonical({ ...(view as FindingRecordView) });
}

/** Verify the content digest of a stored finding (append-only integrity). */
export async function verifyFindingDigest(finding: FindingRecord): Promise<boolean> {
  return (await recomputeFindingDigest(finding)) === finding.digest;
}

/**
 * The append-only invariant guard: there is NO finding mutation API — a
 * "corrected" finding is a NEW finding; the prior one remains (lock
 * rule 6).
 */
export function mutateFinding(): never {
  throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.APPEND_ONLY_VIOLATION, {
    message:
      'findings are append-only -- there is no update or delete path; a correction is a new finding (lock rule 6)',
  });
}

/** The default evidence ref count a finding must carry (documentation constant). */
export const FINDING_MINIMUM_EVIDENCE = 1 as const;

/** Validate a positive sample size (shared by the detection controls). */
export function expectSampleSize(value: number, context: string): number {
  return expectPositiveInteger(
    value,
    'sampleSize',
    NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
    context,
  );
}
