/**
 * The human-data COMMISSION model (Work Order C012; issue #118) — a typed
 * production request over the C001 escalation machinery.
 *
 * A commission is the customer's declaration of the DATASET SHAPE they want
 * produced: capability need, permitted escalation modes, the per-item output
 * schema, quantity, acceptance criteria, budget/urgency, learning
 * permissions, rights posture and retention. It COMPILES to ES1.0
 * EscalationRequests through the C001 public port (createEscalationRequest
 * — one seam, no new lifecycle): one escalation per commissioned item, all
 * sharing the commission's declared policies.
 *
 * The commission lifecycle (the studio's production lifecycle, distinct
 * from the C001 escalation lifecycle it drives):
 *   DRAFT → SUBMITTED → IN_PRODUCTION → ASSEMBLING → DELIVERED
 *   with ABANDONED and FAILED as explicit terminal states.
 *
 * Derived from spec/human-escalation-work-items.md C012 + FINAL-HANDOFF §4
 * + the ERF1.0 learning state + the ES1.0 request fields (there is no
 * dedicated human-data spec — deviations are recorded as architecture
 * questions in the C012 PR).
 */

import { digestCanonical } from '@arena/protocol-core';
import type { IdempotencyKey } from '@arena/protocol-core';
import { toIdempotencyKey } from '@arena/protocol-core';
import type {
  BudgetPolicy,
  CreateEscalationRequestInput,
  EscalationMode,
  EscalationRequest,
  EscalationUrgency,
  EnvironmentSessionPolicy,
  ExpertRequirements,
  LearningPermissions,
  PermittedAction,
  PrivacyPolicy,
  RetentionPolicy,
} from '@arena/escalation';
import {
  createEscalationRequest,
  isEscalationMode,
  isEscalationUrgency,
  isPermittedAction,
  isPlainJsonValue,
} from '@arena/escalation';
import type { RightsMetadata } from '@arena/artifact-protocol';
import { HUMAN_DATA_ERROR_CODES, HumanDataError } from './errors.js';
import type { ConsentRightsStatement } from './rights.js';
import { requireGrantedConsent, toConsentRightsStatement, toRightsPosture } from './rights.js';
import type { PlainJsonValue } from './shared.js';
import {
  deepFreeze,
  newCommissionId,
  requireStringArray,
  requireUnitInterval,
  toCommissionId,
  toIsoTimestamp,
} from './shared.js';

/** Wire version of the commission shape. */
export const COMMISSION_VERSION = 1 as const;

/** The studio production lifecycle (typed, closed). */
export const COMMISSION_STATES = Object.freeze([
  'draft',
  'submitted',
  'in_production',
  'assembling',
  'delivered',
  'abandoned',
  'failed',
] as const);
export type CommissionState = (typeof COMMISSION_STATES)[number];

/** Terminal commission states (final — no transitions out). */
export const COMMISSION_TERMINAL_STATES = Object.freeze(
  ['delivered', 'abandoned', 'failed'] as const,
);
export type TerminalCommissionState = (typeof COMMISSION_TERMINAL_STATES)[number];

export function isCommissionState(value: unknown): value is CommissionState {
  return (
    typeof value === 'string' && (COMMISSION_STATES as readonly string[]).includes(value)
  );
}

export function isTerminalCommissionState(value: unknown): value is TerminalCommissionState {
  return (
    typeof value === 'string' &&
    (COMMISSION_TERMINAL_STATES as readonly string[]).includes(value)
  );
}

/** The typed commission transition table. */
export const COMMISSION_TRANSITIONS: Readonly<Record<CommissionState, readonly CommissionState[]>> =
  Object.freeze({
    draft: ['submitted', 'abandoned'],
    submitted: ['in_production', 'abandoned', 'failed'],
    in_production: ['assembling', 'abandoned', 'failed'],
    assembling: ['delivered', 'failed'],
    delivered: [],
    abandoned: [],
    failed: [],
  });

/** Machine-readable transition verdict (never a bare boolean). */
export interface CommissionTransitionCheck {
  readonly allowed: boolean;
  readonly reason: 'legal-transition' | 'unknown-state' | 'terminal-state' | 'illegal-transition';
  readonly from: CommissionState | null;
  readonly to: CommissionState;
}

export function checkCommissionTransition(
  from: unknown,
  to: unknown,
): CommissionTransitionCheck {
  if (!isCommissionState(to)) {
    return { allowed: false, reason: 'unknown-state', from: null, to: to as CommissionState };
  }
  if (!isCommissionState(from)) {
    return { allowed: false, reason: 'unknown-state', from: null, to };
  }
  if (isTerminalCommissionState(from)) {
    return { allowed: false, reason: 'terminal-state', from, to };
  }
  const legal = COMMISSION_TRANSITIONS[from].includes(to);
  return {
    allowed: legal,
    reason: legal ? 'legal-transition' : 'illegal-transition',
    from,
    to,
  };
}

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/**
 * The dataset deliverable kinds a commission may target (closed vocabulary).
 * Each kind maps onto exactly one ES1.0 escalation result kind (see
 * KIND_RESULT_KIND) — the deliverable contract derives ONLY from results of
 * that kind.
 */
export const COMMISSION_DELIVERABLE_KINDS = Object.freeze([
  'correction-pairs',
  'demonstrations',
  'evaluation-cases',
  'knowledge-artifacts',
] as const);
export type CommissionDeliverableKind = (typeof COMMISSION_DELIVERABLE_KINDS)[number];

export function isCommissionDeliverableKind(
  value: unknown,
): value is CommissionDeliverableKind {
  return (
    typeof value === 'string' &&
    (COMMISSION_DELIVERABLE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Deliverable kind → the ES1.0 escalation result kind that carries its
 * payload (closed mapping): correction-pairs ← correction results,
 * demonstrations ← solution results (the trajectory/replay law applies),
 * evaluation-cases ← evaluation-verdict results, knowledge-artifacts ←
 * knowledge-patch results.
 */
export const KIND_RESULT_KINDS: Readonly<Record<CommissionDeliverableKind, string>> = Object.freeze(
  {
    'correction-pairs': 'correction',
    demonstrations: 'solution',
    'evaluation-cases': 'evaluation-verdict',
    'knowledge-artifacts': 'knowledge-patch',
  },
);

/**
 * Deliverable kinds that REQUIRE a bounded-replica expert session (the
 * EES1.0 replay law: a demonstration is visibly a bounded session, never a
 * live-world mutation).
 */
export const BOUNDED_SESSION_KINDS: readonly CommissionDeliverableKind[] = Object.freeze([
  'demonstrations',
]);

/** Per-commission acceptance criteria (evaluated through the C009 seam). */
export interface AcceptanceCriteria {
  /** The declared criteria an accepted item must satisfy (>= 1). */
  readonly criteria: readonly string[];
  /** Minimum fraction of commissioned items that must be C009-ACCEPTED (in [0,1]). */
  readonly minAcceptedRatio: number;
}

/** Maximum commissioned quantity (one escalation per item). */
export const MAX_COMMISSION_QUANTITY = 1000;

/** Reference of the delivered dataset bundle (immutable). */
export interface CommissionBundleRef {
  readonly version: string;
  readonly manifestDigest: string;
}

// ---------------------------------------------------------------------------
// The Commission
// ---------------------------------------------------------------------------

export interface HumanDataCommission {
  readonly commissionVersion: typeof COMMISSION_VERSION;
  readonly commissionId: string;
  readonly tenantId: string;
  readonly clientAppId: string;
  /** The dataset's artifact name (A002 name pattern — the bundle identity's name). */
  readonly datasetName: string;
  readonly capabilityNeed: string;
  readonly deliverableKind: CommissionDeliverableKind;
  readonly escalationModes: readonly EscalationMode[];
  /** The desired per-item output schema (ES1.0 desiredOutputSchema, per item). */
  readonly perItemOutputSchema: PlainJsonValue;
  /** How many items the commission commissions (one escalation per item). */
  readonly quantity: number;
  readonly acceptanceCriteria: AcceptanceCriteria;
  /** PER-ITEM maximum spend (each compiled escalation carries this budget). */
  readonly budget: BudgetPolicy;
  readonly urgency: EscalationUrgency;
  /** Production window: the deadline offset (ms) applied to every compiled escalation. */
  readonly productionWindowMs: number;
  readonly expertRequirements: ExpertRequirements;
  readonly locale: string;
  readonly permittedActions: readonly PermittedAction[];
  readonly environmentSessionPolicy: EnvironmentSessionPolicy;
  readonly privacyPolicy: PrivacyPolicy;
  readonly learningPermissions: LearningPermissions;
  readonly retentionPolicy: RetentionPolicy;
  /** The customer's declared rights posture for the produced dataset (A002 RightsMetadata). */
  readonly rights: RightsMetadata;
  /** The customer's standing consent/rights declaration (must be GRANTED — the wall). */
  readonly consent: ConsentRightsStatement;
  readonly state: CommissionState;
  readonly createdAt: string;
  readonly submittedAt?: string;
  readonly deliveredAt?: string;
  /** The escalation request ids feeding the commission (set on submission). */
  readonly escalationRequestIds?: readonly string[];
  /** The delivered bundle reference (set on delivery). */
  readonly bundleRef?: CommissionBundleRef;
  /** sha256 over the canonical digest-free view. */
  readonly digest: string;
}

export interface CreateHumanDataCommissionInput {
  readonly tenantId: string;
  readonly clientAppId: string;
  readonly datasetName: string;
  readonly capabilityNeed: string;
  readonly deliverableKind: string;
  readonly escalationModes: readonly string[];
  readonly perItemOutputSchema: unknown;
  readonly quantity: number;
  readonly acceptanceCriteria: { criteria: readonly string[]; minAcceptedRatio: number };
  readonly budget: { amountMinorUnits: number; currency: string };
  readonly urgency: string;
  readonly productionWindowMs: number;
  readonly expertRequirements: {
    requiredCapabilities: readonly string[];
    preferredLocales?: readonly string[];
    jurisdictions?: readonly string[];
  };
  readonly locale: string;
  readonly permittedActions: readonly string[];
  readonly environmentSessionPolicy: { sessionMode: string; sanitization?: string };
  readonly privacyPolicy: { dataClassification: string; pii: string };
  readonly learningPermissions: {
    allowKnowledgeCapture: boolean;
    allowToolGapSignals: boolean;
    allowArtifactReuse: boolean;
    requireApproval: boolean;
  };
  readonly retentionPolicy: { retentionMs: number; disposition: string };
  readonly rights: unknown;
  readonly consent: { granted: boolean; statement: string };
  /** Injected creation time (epoch ms / ISO string / Date) — never a wall-clock read. */
  readonly now: number | string | Date;
  /** Fixed commission id (idempotent replays / tests); generated when omitted. */
  readonly commissionId?: string;
}

function digestFreeView(commission: Omit<HumanDataCommission, 'digest'>): Record<string, unknown> {
  return {
    commissionVersion: commission.commissionVersion,
    commissionId: commission.commissionId,
    tenantId: commission.tenantId,
    clientAppId: commission.clientAppId,
    datasetName: commission.datasetName,
    capabilityNeed: commission.capabilityNeed,
    deliverableKind: commission.deliverableKind,
    escalationModes: commission.escalationModes,
    perItemOutputSchema: commission.perItemOutputSchema,
    quantity: commission.quantity,
    acceptanceCriteria: commission.acceptanceCriteria,
    budget: commission.budget,
    urgency: commission.urgency,
    productionWindowMs: commission.productionWindowMs,
    expertRequirements: commission.expertRequirements,
    locale: commission.locale,
    permittedActions: commission.permittedActions,
    environmentSessionPolicy: commission.environmentSessionPolicy,
    privacyPolicy: commission.privacyPolicy,
    learningPermissions: commission.learningPermissions,
    retentionPolicy: commission.retentionPolicy,
    rights: commission.rights,
    consent: commission.consent,
    state: commission.state,
    createdAt: commission.createdAt,
    ...(commission.submittedAt !== undefined ? { submittedAt: commission.submittedAt } : {}),
    ...(commission.deliveredAt !== undefined ? { deliveredAt: commission.deliveredAt } : {}),
    ...(commission.escalationRequestIds !== undefined
      ? { escalationRequestIds: commission.escalationRequestIds }
      : {}),
    ...(commission.bundleRef !== undefined ? { bundleRef: commission.bundleRef } : {}),
  };
}

const DATASET_NAME_PATTERN = /^[a-z][a-z0-9-]{1,127}$/;

/**
 * Create a DRAFT commission (strict, fail-closed on every field; deep-frozen;
 * content-addressed). The customer's consent declaration MUST be granted —
 * a commission is a request to produce a dataset, and there is no dataset
 * without rights (the wall is declared up front with consequence exposure
 * in the studio, and re-enforced per deliverable and per bundle).
 */
export async function createHumanDataCommission(
  input: CreateHumanDataCommissionInput,
): Promise<HumanDataCommission> {
  if (typeof input !== 'object' || input === null) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: 'commission input must be an object',
    });
  }
  if (typeof input.tenantId !== 'string' || !/^[a-z][a-z0-9-]{1,62}$/.test(input.tenantId)) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: `tenantId is invalid: ${JSON.stringify(input.tenantId)} (expected ^[a-z][a-z0-9-]{1,62}$ — the dataset namespace is tenant-scoped)`,
    });
  }
  if (typeof input.clientAppId !== 'string' || !/^[a-z][a-z0-9-]{1,62}$/.test(input.clientAppId)) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: `clientAppId is invalid: ${JSON.stringify(input.clientAppId)}`,
    });
  }
  if (input.commissionId !== undefined) {
    toCommissionId(input.commissionId);
  }
  if (typeof input.datasetName !== 'string' || !DATASET_NAME_PATTERN.test(input.datasetName)) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: `datasetName is invalid: ${JSON.stringify(input.datasetName)} (expected an A002 artifact name ^[a-z][a-z0-9-]{1,127}$)`,
    });
  }
  if (typeof input.capabilityNeed !== 'string' || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){0,31}$/.test(input.capabilityNeed)) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: `capabilityNeed is invalid: ${JSON.stringify(input.capabilityNeed)} (dot-separated lowercase segments)`,
    });
  }
  if (!isCommissionDeliverableKind(input.deliverableKind)) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: `deliverableKind is not in the closed vocabulary: ${JSON.stringify(input.deliverableKind)}`,
      details: { approved: COMMISSION_DELIVERABLE_KINDS },
    });
  }
  if (!Array.isArray(input.escalationModes) || input.escalationModes.length === 0) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: 'escalationModes must be a non-empty array (>= 1 approved mode)',
    });
  }
  for (const mode of input.escalationModes) {
    if (!isEscalationMode(mode)) {
      throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
        message: `escalation mode is not in the approved closed vocabulary: ${JSON.stringify(mode)}`,
        details: { approved: 'ESCALATION_MODES (@arena/escalation)' },
      });
    }
  }
  if (typeof input.quantity !== 'number' || !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_COMMISSION_QUANTITY) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: `quantity must be an integer in [1, ${MAX_COMMISSION_QUANTITY}] (one escalation per commissioned item): ${JSON.stringify(input.quantity)}`,
    });
  }
  const quantity = input.quantity;
  if (
    !isPlainJsonValue(input.perItemOutputSchema) ||
    typeof input.perItemOutputSchema !== 'object' ||
    Array.isArray(input.perItemOutputSchema)
  ) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: 'perItemOutputSchema must be a plain-JSON object schema (the per-item desired output schema)',
    });
  }
  const perItemOutputSchema = input.perItemOutputSchema;
  if (!Array.isArray(input.acceptanceCriteria?.criteria) || input.acceptanceCriteria.criteria.length === 0) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: 'acceptanceCriteria.criteria must be a non-empty string array (per-commission acceptance criteria)',
    });
  }
  const criteria = requireStringArray(input.acceptanceCriteria.criteria, 'acceptanceCriteria.criteria');
  const minAcceptedRatio = requireUnitInterval(
    input.acceptanceCriteria.minAcceptedRatio,
    'acceptanceCriteria.minAcceptedRatio',
  );
  if (typeof input.budget?.amountMinorUnits !== 'number' || !Number.isInteger(input.budget.amountMinorUnits) || input.budget.amountMinorUnits < 0) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: 'budget.amountMinorUnits must be a safe integer >= 0 (per-item maximum spend)',
    });
  }
  if (typeof input.budget.currency !== 'string' || !/^[A-Z]{3}$/.test(input.budget.currency)) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: `budget.currency must be an ISO-4217-shaped code: ${JSON.stringify(input.budget?.currency)}`,
    });
  }
  if (!isEscalationUrgency(input.urgency)) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: `urgency is not in the closed vocabulary: ${JSON.stringify(input.urgency)}`,
      details: { approved: 'routine | priority | urgent | critical' },
    });
  }
  if (!Number.isInteger(input.productionWindowMs) || input.productionWindowMs < 1) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: 'productionWindowMs must be a positive integer (>= 1) — the per-escalation deadline offset',
    });
  }
  if (!Array.isArray(input.permittedActions) || input.permittedActions.length === 0) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: 'permittedActions must be a non-empty array (ES1.0 permitted actions)',
    });
  }
  for (const action of input.permittedActions) {
    if (!isPermittedAction(action)) {
      throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
        message: `permitted action is not in the closed vocabulary: ${JSON.stringify(action)}`,
        details: { approved: 'PERMITTED_ACTIONS (@arena/escalation)' },
      });
    }
  }
  if (BOUNDED_SESSION_KINDS.includes(input.deliverableKind)) {
    if (input.environmentSessionPolicy?.sessionMode !== 'bounded-replica') {
      throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
        message: `deliverableKind ${JSON.stringify(input.deliverableKind)} requires environmentSessionPolicy.sessionMode 'bounded-replica' (the EES1.0 replay law: a demonstration is visibly a bounded session, never a live-world mutation)`,
      });
    }
  }
  // Rights posture + consent wall: reuse the A002 guard; require GRANTED
  // consent (the customer's declaration of dataset rights).
  const rights = toRightsPosture(input.rights);
  const consent = requireGrantedConsent(
    toConsentRightsStatement(input.consent),
    'the commission declaration',
  );

  const commissionId =
    input.commissionId === undefined ? newCommissionId() : toCommissionId(input.commissionId);
  const createdAt = toIsoTimestamp(input.now);

  const view: Omit<HumanDataCommission, 'digest'> = deepFreeze({
    commissionVersion: COMMISSION_VERSION,
    commissionId,
    tenantId: input.tenantId,
    clientAppId: input.clientAppId,
    datasetName: input.datasetName,
    capabilityNeed: input.capabilityNeed,
    deliverableKind: input.deliverableKind,
    escalationModes: Object.freeze([...input.escalationModes] as readonly EscalationMode[]),
    perItemOutputSchema,
    quantity,
    acceptanceCriteria: Object.freeze({ criteria, minAcceptedRatio }),
    budget: Object.freeze({
      amountMinorUnits: input.budget.amountMinorUnits,
      currency: input.budget.currency,
    }),
    urgency: input.urgency,
    productionWindowMs: input.productionWindowMs,
    expertRequirements: Object.freeze({
      requiredCapabilities: Object.freeze([...input.expertRequirements.requiredCapabilities]),
      ...(input.expertRequirements.preferredLocales !== undefined
        ? { preferredLocales: Object.freeze([...input.expertRequirements.preferredLocales]) }
        : {}),
      ...(input.expertRequirements.jurisdictions !== undefined
        ? { jurisdictions: Object.freeze([...input.expertRequirements.jurisdictions]) }
        : {}),
    }),
    locale: input.locale,
    permittedActions: Object.freeze([...input.permittedActions] as readonly PermittedAction[]),
    environmentSessionPolicy: Object.freeze({
      sessionMode: input.environmentSessionPolicy.sessionMode,
      sanitization: input.environmentSessionPolicy.sanitization ?? 'standard',
    }),
    privacyPolicy: Object.freeze({
      dataClassification: input.privacyPolicy.dataClassification,
      pii: input.privacyPolicy.pii,
    }),
    learningPermissions: Object.freeze({ ...input.learningPermissions }),
    retentionPolicy: Object.freeze({
      retentionMs: input.retentionPolicy.retentionMs,
      disposition: input.retentionPolicy.disposition,
    }),
    rights,
    consent,
    state: 'draft' as CommissionState,
    createdAt,
  });

  const digest = await digestCanonical(digestFreeView(view));
  const commission: HumanDataCommission = Object.freeze({ ...view, digest });
  deepFreeze(commission as unknown as PlainJsonValue);
  return commission;
}

/** Recompute the commission digest and compare (tamper detection). */
export async function verifyHumanDataCommission(
  commission: HumanDataCommission,
): Promise<string> {
  const actual = await digestCanonical(digestFreeView(commission));
  if (actual !== commission.digest) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.TAMPERED, {
      message: `commission digest mismatch: expected ${commission.digest}, recomputed ${actual}`,
      details: { expected: commission.digest, actual },
    });
  }
  return actual;
}

// ---------------------------------------------------------------------------
// Compilation to ES1.0 EscalationRequests (THE C001 SEAM)
// ---------------------------------------------------------------------------

/** One compiled item: the ES1.0 input (for the C001 host port) + the built request. */
export interface CompiledEscalation {
  readonly itemIndex: number;
  readonly input: CreateEscalationRequestInput;
  readonly request: EscalationRequest;
}

/**
 * Compile a commission into its per-item escalation requests through the
 * C001 public port (createEscalationRequest — one seam, no new lifecycle).
 * Deterministic + idempotent: item i always compiles with the idempotency
 * key `hdcm_<commissionId>_<i+1>` and the correlation id `hd_<commissionId>`,
 * so a re-submission REPLAYS the original escalations (C001 idempotency).
 */
export async function compileCommissionEscalations(
  commission: HumanDataCommission,
  options: { readonly now: number | string | Date },
): Promise<readonly CompiledEscalation[]> {
  const compiled: CompiledEscalation[] = [];
  for (let itemIndex = 0; itemIndex < commission.quantity; itemIndex += 1) {
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(
      `hdcm_${commission.commissionId}_${itemIndex + 1}`,
    );
    const escalationInput: CreateEscalationRequestInput = {
      clientAppId: commission.clientAppId,
      tenantId: commission.tenantId,
      sourceWorkflowRef: 'human-data-studio',
      sourceRunRef: `hd-${commission.commissionId}`,
      taskRef: `hd-item-${itemIndex + 1}`,
      capabilityNeed: commission.capabilityNeed,
      escalationModes: [...commission.escalationModes],
      urgency: commission.urgency,
      now: options.now,
      deadlineInMs: commission.productionWindowMs,
      budget: {
        amountMinorUnits: commission.budget.amountMinorUnits,
        currency: commission.budget.currency,
      },
      expertRequirements: {
        requiredCapabilities: [...commission.expertRequirements.requiredCapabilities],
        ...(commission.expertRequirements.preferredLocales !== undefined
          ? { preferredLocales: [...commission.expertRequirements.preferredLocales] }
          : {}),
        ...(commission.expertRequirements.jurisdictions !== undefined
          ? { jurisdictions: [...commission.expertRequirements.jurisdictions] }
          : {}),
      },
      locale: commission.locale,
      desiredOutputSchema: commission.perItemOutputSchema,
      contextReferences: [
        { kind: 'task-ref', ref: `hd-${commission.commissionId}-item-${itemIndex + 1}` },
      ],
      environmentSessionPolicy: { ...commission.environmentSessionPolicy },
      privacyPolicy: { ...commission.privacyPolicy },
      permittedActions: [...commission.permittedActions],
      learningPermissions: { ...commission.learningPermissions },
      retentionPolicy: { ...commission.retentionPolicy },
      idempotencyKey,
      correlationId: `hd_${commission.commissionId}`,
    };
    const request = await createEscalationRequest(escalationInput);
    compiled.push(
      Object.freeze({
        itemIndex,
        input: Object.freeze(escalationInput),
        request,
      }),
    );
  }
  return Object.freeze(compiled);
}
