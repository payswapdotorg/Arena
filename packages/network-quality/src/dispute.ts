/**
 * The DISPUTE STATE MACHINE (Work Order C020; issue #126).
 *
 * Lifecycle (C020 work order):
 *
 *   OPEN -> UNDER_REVIEW -> RESOLVED-with-typed-outcome
 *     + ESCALATED (from OPEN or UNDER_REVIEW; returns to UNDER_REVIEW or
 *       resolves)
 *     + WITHDRAWN (by the complainant, from any non-terminal state)
 *
 *   - disputes reference escalations, validation verdicts and payment
 *     records through their owning surfaces' PUBLIC REFS (typed
 *     subject refs -- C009 adjudication verdicts, C001 escalations, C010
 *     payment audit events -- never direct writes into their state);
 *   - resolution is a TYPED transition with machine-readable reasons and
 *     retained audit history (lock rule 6: every transition appends);
 *   - REVIEWER COI IS CHECKED: a reviewer party to the dispute (complainant
 *     or respondent) is EXCLUDED -- assigning such a reviewer fails closed
 *     with NETWORK_QUALITY_REVIEWER_COI_CONFLICT;
 *   - a dispute record is content-addressed and tamper-evident (digest
 *     over the full view INCLUDING the transition history).
 */

import { digestCanonical } from '@arena/protocol-core';
import { NETWORK_QUALITY_ERROR_CODES, NetworkQualityError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  expectNonEmptyString,
  screenFieldNames,
  toNetworkQualityNeutralText,
  toNetworkQualityRecordId,
  toNetworkQualityTenant,
  toNetworkQualityTimestamp,
  toNetworkQualityParty,
} from './shared.js';
import {
  DISPUTE_RESOLUTION_OUTCOMES,
  DISPUTE_TRANSITIONS,
  isDisputeResolutionOutcome,
  isDisputeTransitionReason,
  toDisputeTransition,
} from './vocabulary.js';
import type {
  DisputeResolutionOutcome,
  DisputeState,
  DisputeTransitionReason,
} from './vocabulary.js';

/** Wire version of the dispute record. */
export const DISPUTE_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The dispute subject: owning-surface public refs (never direct writes)
// ---------------------------------------------------------------------------

/** The closed dispute-subject kinds (the surfaces a dispute may reference). */
export const DISPUTE_SUBJECT_KINDS = Object.freeze([
  'escalation-request',
  'validation-verdict',
  'payment-audit-event',
  'competition-outcome',
] as const);

export type DisputeSubjectKind = (typeof DISPUTE_SUBJECT_KINDS)[number];

/** A typed reference into an owning surface's public records. */
export interface DisputeSubjectRef {
  readonly kind: DisputeSubjectKind;
  /** The owning surface's record id (opaque here, addressable there). */
  readonly refId: string;
  /** The content digest of the referenced record when available (null otherwise). */
  readonly refDigest: string | null;
}

/** One append-only transition entry in the dispute audit history. */
export interface DisputeTransitionEntry {
  readonly from: DisputeState;
  readonly to: DisputeState;
  /** >= 1 machine-readable reason codes from the closed vocabulary. */
  readonly reasons: readonly DisputeTransitionReason[];
  /** The reviewer party executing the transition (null when not reviewer-driven). */
  readonly reviewerParty: string | null;
  readonly at: string;
  /** Neutral-text note (never a narrative override of the reasons). */
  readonly note: string | null;
  /** The typed resolution outcome (RESOLVED transitions only, else null). */
  readonly resolutionOutcome: DisputeResolutionOutcome | null;
}

export interface DisputeRecordView {
  readonly disputeVersion: typeof DISPUTE_RECORD_VERSION;
  readonly disputeId: string;
  readonly tenant: string;
  /** The party raising the dispute (expert ref or tenant-side principal). */
  readonly complainantParty: string;
  /** The party the dispute is against (expert ref or tenant-side principal). */
  readonly respondentParty: string;
  /** The owning-surface records this dispute is about (>= 1). */
  readonly subjects: readonly DisputeSubjectRef[];
  readonly state: DisputeState;
  /** The assigned reviewer (null while OPEN). */
  readonly reviewerParty: string | null;
  /** The resolution outcome (RESOLVED only, else null). */
  readonly resolutionOutcome: DisputeResolutionOutcome | null;
  /** The append-only transition history (>= 1 entry: the intake). */
  readonly history: readonly DisputeTransitionEntry[];
  readonly openedAt: string;
  readonly updatedAt: string;
  readonly summary: string;
}

/** A frozen, content-addressed dispute record (+ digest). */
export interface DisputeRecord extends DisputeRecordView {
  readonly digest: string;
}

export interface OpenDisputeInput {
  readonly disputeId: string;
  readonly tenant: string;
  readonly complainantParty: string;
  readonly respondentParty: string;
  readonly subjects: readonly {
    readonly kind: string;
    readonly refId: string;
    readonly refDigest?: string | null;
  }[];
  readonly summary: string;
  readonly at: string;
  readonly intakeReason?: DisputeTransitionReason;
}

function requireSubjects(value: unknown, context: string): readonly DisputeSubjectRef[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
      message: `${context}: a dispute requires at least one owning-surface subject ref`,
    });
  }
  return Object.freeze(
    value.map((entry, index) => {
      const record = expectFields(
        entry,
        ['kind', 'refId'],
        ['refDigest'],
        NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
        `${context}.subjects[${index}]`,
      );
      if (
        typeof record['kind'] !== 'string' ||
        !(DISPUTE_SUBJECT_KINDS as readonly string[]).includes(record['kind'])
      ) {
        throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_REF, {
          message: `${context}.subjects[${index}]: unknown dispute subject kind: ${JSON.stringify(String(record['kind']))}`,
          details: { known: DISPUTE_SUBJECT_KINDS },
        });
      }
      const refDigestRaw = record['refDigest'] ?? null;
      return deepFreeze({
        kind: record['kind'],
        refId: expectNonEmptyString(
          record['refId'],
          'refId',
          NETWORK_QUALITY_ERROR_CODES.INVALID_REF,
          `${context}.subjects[${index}]`,
        ),
        refDigest:
          refDigestRaw === null || refDigestRaw === undefined
            ? null
            : (refDigestRaw as string),
      }) as DisputeSubjectRef;
    }),
  );
}

/** Open ONE dispute (OPEN state, intake history entry appended). */
export async function openDispute(input: OpenDisputeInput): Promise<DisputeRecord> {
  const record = expectFields(
    input,
    ['disputeId', 'tenant', 'complainantParty', 'respondentParty', 'subjects', 'summary', 'at'],
    ['intakeReason'],
    NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
    'open dispute',
  );
  const at = toNetworkQualityTimestamp(record['at'] as string, 'open dispute at');
  const complainantParty = toNetworkQualityParty(
    record['complainantParty'] as string,
    'open dispute complainantParty',
  );
  const respondentParty = toNetworkQualityParty(
    record['respondentParty'] as string,
    'open dispute respondentParty',
  );
  if (complainantParty === respondentParty) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
      message:
        'open dispute: complainant and respondent must be distinct parties — a self-dispute is inadmissible',
    });
  }
  const intakeReasonRaw: unknown =
    record['intakeReason'] === undefined ? 'intake-accepted' : record['intakeReason'];
  if (!isDisputeTransitionReason(intakeReasonRaw)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
      message: `open dispute: unknown transition reason: ${JSON.stringify(String(intakeReasonRaw))}`,
    });
  }
  const intakeReason: DisputeTransitionReason = intakeReasonRaw;
  const view: DisputeRecordView = {
    disputeVersion: DISPUTE_RECORD_VERSION,
    disputeId: toNetworkQualityRecordId(record['disputeId'] as string, 'open dispute disputeId'),
    tenant: toNetworkQualityTenant(record['tenant'] as string, 'open dispute tenant'),
    complainantParty,
    respondentParty,
    subjects: requireSubjects(record['subjects'], 'open dispute'),
    state: 'OPEN',
    reviewerParty: null,
    resolutionOutcome: null,
    history: Object.freeze([
      deepFreeze({
        from: 'OPEN',
        to: 'OPEN',
        reasons: Object.freeze([intakeReason]),
        reviewerParty: null,
        at,
        note: null,
        resolutionOutcome: null,
      }) as DisputeTransitionEntry,
    ]),
    openedAt: at,
    updatedAt: at,
    summary: toNetworkQualityNeutralText(record['summary'] as string, 'open dispute summary'),
  };
  screenFieldNames(view, 'disputeRecord');
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as DisputeRecord;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface TransitionDisputeInput {
  readonly to: DisputeState;
  readonly reasons: readonly DisputeTransitionReason[];
  /** The reviewer executing the transition (null when not reviewer-driven). */
  readonly reviewerParty?: string | null;
  readonly at: string;
  readonly note?: string | null;
  /** REQUIRED on RESOLVED transitions (typed outcome). */
  readonly resolutionOutcome?: DisputeResolutionOutcome;
}

/**
 * THE REVIEWER-COI EXCLUSION: a reviewer party to the dispute (complainant
 * or respondent) can never review or resolve it -- the assignment fails
 * closed with NETWORK_QUALITY_REVIEWER_COI_CONFLICT. Undeclared COI is the
 * COI registry's domain; PARTYHOOD is structural and checked here.
 */
export function assertReviewerNotPartyToDispute(
  reviewerParty: string,
  dispute: DisputeRecord,
): void {
  if (reviewerParty === dispute.complainantParty || reviewerParty === dispute.respondentParty) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.REVIEWER_COI_CONFLICT, {
      message: `reviewer ${reviewerParty} is a party to dispute ${dispute.disputeId} -- reviewer COI exclusion fails closed (a reviewer party to the dispute is excluded)`,
      details: {
        disputeId: dispute.disputeId,
        complainantParty: dispute.complainantParty,
        respondentParty: dispute.respondentParty,
      },
    });
  }
}

/**
 * Apply ONE typed dispute transition. Fails closed on illegal transitions
 * (closed table), missing/typed-illegal reasons, reviewer COI, missing
 * resolution outcome on RESOLVED, resolution outcome on non-RESOLVED, and
 * transitions out of terminal states. The audit history is APPENDED (lock
 * rule 6) — the prior entries are retained verbatim.
 */
export async function transitionDispute(
  dispute: DisputeRecord,
  input: TransitionDisputeInput,
): Promise<DisputeRecord> {
  const record = expectFields(
    input,
    ['to', 'reasons', 'at'],
    ['reviewerParty', 'note', 'resolutionOutcome'],
    NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION,
    'transition dispute',
  );
  const to = toDisputeTransition(dispute.state, record['to'], 'transition dispute');
  const at = toNetworkQualityTimestamp(record['at'] as string, 'transition dispute at');
  if (Date.parse(at) < Date.parse(dispute.updatedAt)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.BACKDATED_RECORD, {
      message: `transition dispute: transition time (${at}) precedes the last transition (${dispute.updatedAt}) -- backdated transitions fail closed`,
    });
  }
  const reasonsRaw = record['reasons'];
  if (!Array.isArray(reasonsRaw) || reasonsRaw.length === 0) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
      message: 'transition dispute: at least one machine-readable reason code is required',
    });
  }
  for (const reason of reasonsRaw) {
    if (!isDisputeTransitionReason(reason)) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
        message: `transition dispute: unknown reason code: ${JSON.stringify(String(reason))}`,
      });
    }
  }

  const reviewerPartyRaw = record['reviewerParty'] ?? null;
  const reviewerParty =
    reviewerPartyRaw === null || reviewerPartyRaw === undefined
      ? null
      : toNetworkQualityParty(reviewerPartyRaw as string, 'transition dispute reviewerParty');

  // Reviewer assignment / reviewer-driven transitions enforce the COI law.
  if (reviewerParty !== null) {
    assertReviewerNotPartyToDispute(reviewerParty, dispute);
  }

  const resolutionOutcomeRaw = record['resolutionOutcome'] ?? null;
  if (to === 'RESOLVED') {
    if (!isDisputeResolutionOutcome(resolutionOutcomeRaw)) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
        message: `transition dispute: RESOLVED requires a typed resolution outcome (closed vocabulary: ${DISPUTE_RESOLUTION_OUTCOMES.join(' | ')})`,
        details: { known: DISPUTE_RESOLUTION_OUTCOMES },
      });
    }
  } else if (resolutionOutcomeRaw !== null) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
      message:
        'transition dispute: a resolution outcome may only travel on a RESOLVED transition',
    });
  }

  // UNDER_REVIEW requires a reviewer; OPEN -> UNDER_REVIEW is the assignment.
  let assignedReviewer = dispute.reviewerParty;
  if (to === 'UNDER_REVIEW') {
    if (reviewerParty === null && dispute.reviewerParty === null) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
        message:
          'transition dispute: UNDER_REVIEW requires the assigning reviewer (reviewerParty) -- an unreviewed review state is inadmissible',
      });
    }
    if (reviewerParty !== null) assignedReviewer = reviewerParty;
  }
  if (dispute.state === 'UNDER_REVIEW' && reviewerParty === null && to === 'RESOLVED') {
    if (dispute.reviewerParty === null) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
        message: 'transition dispute: only an assigned reviewer may RESOLVE a dispute',
      });
    }
  }

  const noteRaw = record['note'] ?? null;
  const entry: DisputeTransitionEntry = deepFreeze({
    from: dispute.state,
    to,
    reasons: Object.freeze([...(reasonsRaw as DisputeTransitionReason[])]),
    reviewerParty,
    at,
    note:
      noteRaw === null || noteRaw === undefined
        ? null
        : toNetworkQualityNeutralText(noteRaw as string, 'transition dispute note'),
    resolutionOutcome: to === 'RESOLVED' ? (resolutionOutcomeRaw as DisputeResolutionOutcome) : null,
  }) as DisputeTransitionEntry;

  const { digest: _priorDigest, ...priorView } = dispute;
  const view: DisputeRecordView = {
    ...priorView,
    state: to,
    reviewerParty: assignedReviewer,
    resolutionOutcome: to === 'RESOLVED' ? (resolutionOutcomeRaw as DisputeResolutionOutcome) : null,
    history: Object.freeze([...dispute.history, entry]),
    updatedAt: at,
  };
  screenFieldNames(view, 'disputeRecord');
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as DisputeRecord;
}

/** Recompute the content digest of a stored dispute (tamper check). */
export async function recomputeDisputeDigest(dispute: DisputeRecord): Promise<string> {
  const { digest: _digest, ...view } = dispute;
  return digestCanonical({ ...(view as DisputeRecordView) });
}

/** Verify the content digest of a stored dispute (append-only integrity). */
export async function verifyDisputeDigest(dispute: DisputeRecord): Promise<boolean> {
  return (await recomputeDisputeDigest(dispute)) === dispute.digest;
}

/** The disputes a party is involved in (complainant or respondent). */
export function partyToDispute(party: string, dispute: DisputeRecord): boolean {
  return dispute.complainantParty === party || dispute.respondentParty === party;
}

/** Dispute states that accept new transitions (non-terminal). */
export function disputeIsTerminal(dispute: DisputeRecord): boolean {
  return DISPUTE_TRANSITIONS[dispute.state].length === 0;
}
