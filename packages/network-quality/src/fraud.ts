/**
 * The FRAUD CONTROLS (Work Order C020; issue #126) — anomaly findings over
 * the C010 payment records and identity findings, plus the ENFORCEMENT
 * CASE MACHINE.
 *
 *   - duplicate-payout attempts: two or more release/payout operations
 *     resolving the SAME escalation request (double payout);
 *   - payout velocity anomalies: payout frequency for one expert beyond
 *     the policy ceiling inside the velocity window;
 *   - expert impersonation: identity signals where credentials/
 *     attribution mismatch the claimed expert identity (FINAL-HANDOFF §18
 *     adversarial cases).
 *
 * ENFORCEMENT ACTIONS (HOLD / SUSPEND / INVESTIGATE) are EXPLICIT state
 * transitions over an enforcement case with APPEND-ONLY audit history —
 * never silent drops, never silent adjustments. The case machine PROPOSES
 * nothing itself: a finding's enforcement-action proposal opens it.
 *
 * Structural mirrors of the C010 public read surface (CommercialAuditEvent
 * legs) and the expert-registry identity-signal legs -- the house data-in
 * seam convention.
 */

import { digestCanonical } from '@arena/protocol-core';
import { NETWORK_QUALITY_ERROR_CODES, NetworkQualityError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  expectNonNegativeInteger,
  expectPositiveInteger,
  screenFieldNames,
  toNetworkQualityNeutralText,
  toNetworkQualityParty,
  toNetworkQualityRecordId,
  toNetworkQualityTenant,
  toNetworkQualityTimestamp,
} from './shared.js';
import { createFinding } from './finding.js';
import type { FindingRecord } from './finding.js';
import { isEnforcementAction } from './vocabulary.js';
import type { EnforcementAction, EnforcementCaseState } from './vocabulary.js';

/** Wire version of the fraud-control shapes. */
export const FRAUD_CONTROL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Structural mirrors of the C010 / registry public read surfaces
// ---------------------------------------------------------------------------

/** The C010 CommercialAuditEvent payout-relevant legs (structural mirror). */
export interface PayoutAuditSignal {
  readonly eventId: string;
  readonly kind: string;
  readonly requestId: string;
  readonly tenantId: string;
  /** The expert the payout flows to (null on non-payout operations). */
  readonly expertRef: string | null;
  readonly operationKey: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly ledgerStateAfter: string;
}

/** The expert-registry identity-signal legs (structural mirror). */
export interface IdentitySignal {
  readonly expertRef: string;
  readonly tenant: string;
  /**
   * The identity-integrity outcome from the registry's verification
   * surface: 'verified' | 'mismatch' | 'unverified'.
   */
  readonly credentialStatus: 'verified' | 'mismatch' | 'unverified';
  /** Claimed vs observed attribution mismatches (impersonation axis). */
  readonly attributionMismatches: number;
  readonly observedAt: string;
  readonly signalDigest: string;
}

// ---------------------------------------------------------------------------
// The versioned fraud policy
// ---------------------------------------------------------------------------

export interface FraudControlPolicy {
  readonly policyVersion: 1;
  /** Max payout operations per expert per velocity window. */
  readonly maxPayoutsPerExpertPerWindow: number;
  /** The payout-velocity window (epoch ms). */
  readonly payoutVelocityWindowMs: number;
}

export const DEFAULT_FRAUD_CONTROL_POLICY: FraudControlPolicy = Object.freeze({
  policyVersion: 1,
  maxPayoutsPerExpertPerWindow: 8,
  payoutVelocityWindowMs: 24 * 60 * 60 * 1000,
});

export function validateFraudControlPolicy(policy: FraudControlPolicy): FraudControlPolicy {
  expectPositiveInteger(
    policy.maxPayoutsPerExpertPerWindow,
    'maxPayoutsPerExpertPerWindow',
    NETWORK_QUALITY_ERROR_CODES.INVALID_POLICY,
    'fraud-control policy',
  );
  if (
    typeof policy.payoutVelocityWindowMs !== 'number' ||
    !Number.isFinite(policy.payoutVelocityWindowMs) ||
    policy.payoutVelocityWindowMs <= 0
  ) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_POLICY, {
      message:
        'fraud-control policy: payoutVelocityWindowMs must be a positive finite number of epoch milliseconds',
    });
  }
  return deepFreeze({ ...policy });
}

// ---------------------------------------------------------------------------
// Control 6 — DUPLICATE-PAYOUT ATTEMPTS (C010 anomaly)
// ---------------------------------------------------------------------------

/**
 * Detect duplicate-payout attempts: more than ONE release operation
 * (kind 'payment.release.recorded') auditing the SAME escalation request.
 * The C010 idempotency fabric replays identical operation keys verbatim;
 * DISTINCT operation keys paying the same request are the anomaly this
 * control flags (FINAL-HANDOFF §18 "duplicate payout").
 */
export async function detectDuplicatePayoutAttempts(
  input: {
    readonly events: readonly PayoutAuditSignal[];
    readonly detectedAt: string;
  },
): Promise<readonly FindingRecord[]> {
  const releaseEvents: PayoutAuditSignal[] = input.events.filter(
    (event) => event.kind === 'payment.release.recorded',
  );
  const byRequest = new Map<
    string,
    { readonly tenantId: string; readonly events: PayoutAuditSignal[] }
  >();
  for (const event of releaseEvents) {
    const entry = byRequest.get(event.requestId);
    if (entry === undefined) {
      byRequest.set(event.requestId, { tenantId: event.tenantId, events: [event] });
    } else {
      byRequest.set(event.requestId, {
        tenantId: entry.tenantId,
        events: [...entry.events, event],
      });
    }
  }
  const findings: FindingRecord[] = [];
  for (const [requestId, entry] of byRequest) {
    if (entry.events.length < 2) continue;
    const firstEvent = entry.events[0];
    if (firstEvent === undefined) continue;
    const expertRef = entry.events.find((event) => event.expertRef !== null)?.expertRef ?? null;
    const subjectParty =
      expertRef ?? `request-${requestId.replace(/[^a-z0-9._:-]/g, '').slice(0, 100)}`;
    findings.push(
      await createFinding({
        findingId: `nq-duppayout-${requestId.replace(/[^a-z0-9-]/g, '').slice(0, 40)}`,
        tenant: entry.tenantId,
        subjectParty,
        kind: 'duplicate-payout-attempt',
        severity: 'critical',
        evidence: entry.events.map((event) => ({
          surface: 'payments',
          refId: event.eventId,
          refDigest: null,
        })),
        reasons: [
          {
            code: 'duplicate-payout-operations',
            detail: `${entry.events.length} distinct release operations audit request ${requestId} (operation keys: ${entry.events.map((event) => event.operationKey).join(', ')}) -- double payout attempt`,
          },
        ],
        proposals: [
          {
            proposalKind: 'enforcement-action-proposal',
            targetSurface: 'network-quality',
            enforcementAction: 'HOLD',
            payload: { requestId, operations: entry.events.length },
          },
        ],
        observedAt: firstEvent.occurredAt,
        detectedAt: input.detectedAt,
        summary: `duplicate payout attempt: ${entry.events.length} release operations on request ${requestId}`,
      }),
    );
  }
  return Object.freeze(findings);
}

// ---------------------------------------------------------------------------
// Control 7 — PAYOUT VELOCITY ANOMALIES (C010 anomaly)
// ---------------------------------------------------------------------------

/**
 * Detect payout-velocity anomalies: an expert whose release count inside
 * the trailing velocity window exceeds the policy ceiling — the classic
 * money-movement red flag (FINAL-HANDOFF §18).
 */
export async function detectPayoutVelocityAnomalies(
  input: {
    readonly events: readonly PayoutAuditSignal[];
    readonly policy: FraudControlPolicy;
    readonly detectedAt: string;
  },
): Promise<readonly FindingRecord[]> {
  const policy = validateFraudControlPolicy(input.policy);
  const byExpert = new Map<string, PayoutAuditSignal[]>();
  for (const event of input.events) {
    if (event.kind !== 'payment.release.recorded' || event.expertRef === null) continue;
    const list = byExpert.get(event.expertRef) ?? [];
    list.push(event);
    byExpert.set(event.expertRef, list);
  }
  const findings: FindingRecord[] = [];
  for (const [expertRef, events] of byExpert) {
    const sorted = [...events].sort(
      (left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
    );
    let worst = 0;
    let worstStart = 0;
    for (let end = 0; end < sorted.length; end += 1) {
      const endEvent = sorted[end];
      if (endEvent === undefined) continue;
      const endMs = Date.parse(endEvent.occurredAt);
      let start = end;
      while (
        start > 0 &&
        Date.parse(sorted[start - 1]?.occurredAt ?? endEvent.occurredAt) > endMs - policy.payoutVelocityWindowMs
      ) {
        start -= 1;
      }
      const inWindow = end - start + 1;
      if (inWindow > worst) {
        worst = inWindow;
        worstStart = start;
      }
    }
    if (worst <= policy.maxPayoutsPerExpertPerWindow) continue;
    const windowEvents = sorted.slice(worstStart, worstStart + worst);
    const firstWindowEvent = windowEvents[0];
    if (firstWindowEvent === undefined) continue;
    findings.push(
      await createFinding({
        findingId: `nq-velocity-${expertRef}`,
        tenant: firstWindowEvent.tenantId,
        subjectParty: toNetworkQualityParty(expertRef, 'velocity detection'),
        kind: 'payout-velocity-anomaly',
        severity: worst >= policy.maxPayoutsPerExpertPerWindow * 2 ? 'high' : 'medium',
        evidence: windowEvents.map((event) => ({
          surface: 'payments',
          refId: event.eventId,
          refDigest: null,
        })),
        reasons: [
          {
            code: 'payout-velocity-beyond-ceiling',
            detail: `expert ${expertRef} received ${worst} payouts within ${policy.payoutVelocityWindowMs}ms (ceiling ${policy.maxPayoutsPerExpertPerWindow})`,
          },
        ],
        proposals: [
          {
            proposalKind: 'enforcement-action-proposal',
            targetSurface: 'network-quality',
            enforcementAction: 'INVESTIGATE',
            payload: { expertRef, payouts: worst },
          },
        ],
        observedAt: firstWindowEvent.occurredAt,
        detectedAt: input.detectedAt,
        summary: `payout velocity anomaly: expert ${expertRef} received ${worst} payouts inside the window`,
      }),
    );
  }
  return Object.freeze(findings);
}

// ---------------------------------------------------------------------------
// Control 8 — EXPERT IMPERSONATION (identity signals)
// ---------------------------------------------------------------------------

/**
 * Detect expert-impersonation signals: credential mismatches and
 * attribution mismatches from the registry's identity-verification
 * surface (FINAL-HANDOFF 18 "expert impersonation").
 */
export async function detectExpertImpersonation(
  input: {
    readonly signals: readonly IdentitySignal[];
    readonly detectedAt: string;
  },
): Promise<readonly FindingRecord[]> {
  const findings: FindingRecord[] = [];
  for (const signal of input.signals) {
    expectNonNegativeInteger(
      signal.attributionMismatches,
      'attributionMismatches',
      NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
      'impersonation detection',
    );
    toNetworkQualityTimestamp(signal.observedAt, 'impersonation observedAt');
    if (signal.credentialStatus !== 'mismatch' && signal.attributionMismatches === 0) continue;
    const severity: FindingSeverityValue =
      signal.credentialStatus === 'mismatch' ? 'critical' : 'high';
    const reasons = [];
    if (signal.credentialStatus === 'mismatch') {
      reasons.push({
        code: 'credential-mismatch',
        detail: `expert ${signal.expertRef} identity verification returned 'mismatch' -- claimed credentials do not verify`,
      });
    }
    if (signal.attributionMismatches > 0) {
      reasons.push({
        code: 'attribution-mismatch',
        detail: `expert ${signal.expertRef} has ${signal.attributionMismatches} claimed-vs-observed attribution mismatches`,
      });
    }
    findings.push(
      await createFinding({
        findingId: `nq-impersonation-${signal.expertRef}-${signal.signalDigest.slice(0, 16)}`,
        tenant: signal.tenant,
        subjectParty: toNetworkQualityParty(signal.expertRef, 'impersonation detection'),
        kind: 'expert-impersonation',
        severity,
        evidence: [
          {
            surface: 'expert-registry',
            refId: signal.signalDigest,
            refDigest: signal.signalDigest,
          },
        ],
        reasons,
        proposals: [
          {
            proposalKind: 'enforcement-action-proposal',
            targetSurface: 'network-quality',
            enforcementAction: 'SUSPEND',
            payload: { expertRef: signal.expertRef },
          },
        ],
        observedAt: signal.observedAt,
        detectedAt: input.detectedAt,
        summary: `expert impersonation signal for ${signal.expertRef} (${reasons.map((reason) => reason.code).join('+')})`,
      }),
    );
  }
  return Object.freeze(findings);
}

type FindingSeverityValue = FindingRecord['severity'];

// ---------------------------------------------------------------------------
// The enforcement case machine (explicit transitions, append-only audit)
// ---------------------------------------------------------------------------

/** One append-only enforcement audit entry. */
export interface EnforcementAuditEntry {
  readonly from: EnforcementCaseState;
  readonly to: EnforcementCaseState;
  readonly action: EnforcementAction | null;
  readonly reason: string;
  readonly actorParty: string;
  readonly at: string;
}

export interface EnforcementCaseView {
  readonly caseVersion: typeof FRAUD_CONTROL_VERSION;
  readonly caseId: string;
  readonly tenant: string;
  /** The party the enforcement action is about. */
  readonly subjectParty: string;
  /** The finding digests the case derives from (>= 1). */
  readonly sourceFindingDigests: readonly string[];
  readonly state: EnforcementCaseState;
  /** The active action (HOLD / SUSPEND / INVESTIGATE; null while OPEN). */
  readonly action: EnforcementAction | null;
  readonly auditHistory: readonly EnforcementAuditEntry[];
  readonly openedAt: string;
  readonly updatedAt: string;
}

/** A frozen, content-addressed enforcement case (+ digest). */
export interface EnforcementCase extends EnforcementCaseView {
  readonly digest: string;
}

/** The ONLY legal enforcement-case transitions out of each state. */
const ENFORCEMENT_CASE_TRANSITIONS_TABLE: Record<
  EnforcementCaseState,
  readonly EnforcementCaseState[]
> = {
  OPEN: ['ACTION_PROPOSED'],
  ACTION_PROPOSED: ['ACTION_ACTIVE', 'CLOSED'],
  ACTION_ACTIVE: ['ACTION_RELEASED', 'CLOSED'],
  ACTION_RELEASED: ['ACTION_PROPOSED', 'CLOSED'],
  CLOSED: [],
};

export const ENFORCEMENT_CASE_TRANSITIONS: Readonly<
  Record<EnforcementCaseState, readonly EnforcementCaseState[]>
> = Object.freeze(
  Object.fromEntries(
    Object.entries(ENFORCEMENT_CASE_TRANSITIONS_TABLE).map(([key, value]) => [
      key,
      Object.freeze(value),
    ]),
  ) as Record<EnforcementCaseState, readonly EnforcementCaseState[]>,
);

/** Open ONE enforcement case from >= 1 findings (explicit, auditable). */
export async function openEnforcementCase(input: {
  readonly caseId: string;
  readonly tenant: string;
  readonly subjectParty: string;
  readonly sourceFindingDigests: readonly string[];
  readonly proposedAction: string;
  readonly actorParty: string;
  readonly at: string;
  readonly reason: string;
}): Promise<EnforcementCase> {
  const record = expectFields(
    input,
    [
      'caseId',
      'tenant',
      'subjectParty',
      'sourceFindingDigests',
      'proposedAction',
      'actorParty',
      'at',
      'reason',
    ],
    [],
    NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
    'open enforcement case',
  );
  if (!isEnforcementAction(record['proposedAction'])) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
      message: `open enforcement case: unknown action: ${JSON.stringify(String(record['proposedAction']))} (HOLD | SUSPEND | INVESTIGATE)`,
    });
  }
  const digestsRaw = record['sourceFindingDigests'];
  if (!Array.isArray(digestsRaw) || digestsRaw.length === 0) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
      message: 'open enforcement case: at least one source finding digest is required',
    });
  }
  const at = toNetworkQualityTimestamp(record['at'] as string, 'open enforcement case at');
  const view: EnforcementCaseView = {
    caseVersion: FRAUD_CONTROL_VERSION,
    caseId: toNetworkQualityRecordId(record['caseId'] as string, 'enforcement caseId'),
    tenant: toNetworkQualityTenant(record['tenant'] as string, 'enforcement tenant'),
    subjectParty: toNetworkQualityParty(
      record['subjectParty'] as string,
      'enforcement subjectParty',
    ),
    sourceFindingDigests: Object.freeze([...(digestsRaw as string[])]),
    state: 'ACTION_PROPOSED',
    action: record['proposedAction'] as EnforcementAction,
    auditHistory: Object.freeze([
      deepFreeze({
        from: 'OPEN',
        to: 'ACTION_PROPOSED',
        action: record['proposedAction'] as EnforcementAction,
        reason: toNetworkQualityNeutralText(record['reason'] as string, 'enforcement reason'),
        actorParty: toNetworkQualityParty(record['actorParty'] as string, 'enforcement actorParty'),
        at,
      }) as EnforcementAuditEntry,
    ]),
    openedAt: at,
    updatedAt: at,
  };
  screenFieldNames(view, 'enforcementCase');
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as EnforcementCase;
}

/**
 * Apply ONE enforcement-case transition (ACTION_PROPOSED -> ACTION_ACTIVE
 * -> ACTION_RELEASED -> ... -> CLOSED). Fails closed on illegal
 * transitions and backdated times; the audit history is APPENDED.
 */
export async function transitionEnforcementCase(
  input: {
    readonly case: EnforcementCase;
    readonly to: EnforcementCaseState;
    readonly actorParty: string;
    readonly at: string;
    readonly reason: string;
    readonly action?: string | null;
  },
): Promise<EnforcementCase> {
  const record = expectFields(
    input,
    ['case', 'to', 'actorParty', 'at', 'reason'],
    ['action'],
    NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION,
    'transition enforcement case',
  );
  const theCase = record['case'] as EnforcementCase;
  const to = record['to'] as EnforcementCaseState;
  if (!ENFORCEMENT_CASE_TRANSITIONS[theCase.state].includes(to)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
      message: `transition enforcement case: ${theCase.state} -> ${to} is not legal (closed transition table)`,
      details: { from: theCase.state, to, legal: ENFORCEMENT_CASE_TRANSITIONS[theCase.state] },
    });
  }
  const at = toNetworkQualityTimestamp(record['at'] as string, 'transition enforcement at');
  if (Date.parse(at) < Date.parse(theCase.updatedAt)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.BACKDATED_RECORD, {
      message: 'transition enforcement case: transition time precedes the last audit entry — backdated transitions fail closed',
    });
  }
  const actionRaw = record['action'] ?? null;
  if (actionRaw !== null && !isEnforcementAction(actionRaw)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
      message: `transition enforcement case: unknown action: ${JSON.stringify(String(actionRaw))}`,
    });
  }
  let action = theCase.action;
  if (to === 'ACTION_PROPOSED') {
    if (actionRaw === null) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
        message: 'transition enforcement case: ACTION_PROPOSED requires the proposed action',
      });
    }
    action = actionRaw as EnforcementAction;
  }
  const entry: EnforcementAuditEntry = deepFreeze({
    from: theCase.state,
    to,
    action: to === 'ACTION_PROPOSED' ? (actionRaw as EnforcementAction) : actionRaw,
    reason: toNetworkQualityNeutralText(record['reason'] as string, 'enforcement transition reason'),
    actorParty: toNetworkQualityParty(
      record['actorParty'] as string,
      'enforcement transition actorParty',
    ),
    at,
  }) as EnforcementAuditEntry;
  const { digest: _priorDigest, ...priorView } = theCase;
  const view: EnforcementCaseView = {
    ...priorView,
    state: to,
    action,
    auditHistory: Object.freeze([...theCase.auditHistory, entry]),
    updatedAt: at,
  };
  screenFieldNames(view, 'enforcementCase');
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as EnforcementCase;
}

/** Verify the content digest of a stored enforcement case (tamper check). */
export async function verifyEnforcementCaseDigest(theCase: EnforcementCase): Promise<boolean> {
  const { digest: _digest, ...view } = theCase;
  return (await digestCanonical({ ...(view as EnforcementCaseView) })) === theCase.digest;
}

/**
 * THE NO-SILENT-DROP LAW: dropping a payout, an expert or a case without
 * an explicit enforcement transition has no code path -- this guard exists
 * so consumers fail closed when they attempt one.
 */
export function silentlyDropEnforcementTarget(): never {
  throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.SILENT_ADJUSTMENT_REJECTED, {
    message:
      'fraud controls never silently drop payouts, experts or cases — enforcement is an explicit state transition with append-only audit history',
  });
}
