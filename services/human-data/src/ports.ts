/**
 * Human-data service ports (Work Order C012) — the ONLY things
 * services/human-data depends on besides the domain package
 * (@arena/human-data) and the merged domain vocabularies it re-exports.
 *
 * Mirroring the sibling services' ports.ts discipline
 * (services/escalation-validation, services/intervention):
 *   - Clock               — time is INJECTED (never a wall-clock read;
 *                           architecture-lock rule 17);
 *   - EscalationPort      — THE C001 SEAM: compiled commissions create and
 *                           track ES1.0 escalations through this injected
 *                           port (never another service, never a C001 edit);
 *   - DeliverableSourcePort — THE C006/C009 SEAM: the host collects, per
 *                           escalation, the C009-ACCEPTED adjudication
 *                           outcome + result + the EES1.0 consent/rights
 *                           statement (+ replay trace for demonstrations);
 *                           the validation gate and the consent wall live
 *                           in @arena/human-data and fail closed here too;
 *   - CommissionStore     — tenant-scoped persistence for the commission
 *                           record (the reference fabric is in-process;
 *                           hosts wire the A015-era fabric);
 *   - HumanDataEventSink  — event delivery (commission.* events).
 *
 * Authority boundary (lock rule 16): the service OWNS commission lifecycle
 * orchestration only. It NEVER judges validation outcomes (the C009 seam
 * does), NEVER grants rights (the wall is structural) and NEVER touches
 * another tenant's data.
 */

import type { CreateEscalationRequestInput, EscalationRecord } from '@arena/escalation';
import type { EscalationResult } from '@arena/escalation';
import type { AdjudicationOutcome } from '@arena/escalation-validation';
import type { ReplayTrace } from '@arena/expert-session';
import type {
  CommissionBundleRef,
  CommissionState,
  HumanDataCommission,
  PlainJsonValue,
} from '@arena/human-data';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

/** THE C001 SEAM — escalations created and tracked through injected ports. */
export interface EscalationPort {
  /** Create one escalation from a compiled ES1.0 input (idempotent per input key). */
  create(input: CreateEscalationRequestInput): Promise<{ readonly requestId: string }>;
  /** Tenant-scoped lookup (cross-tenant reads return undefined). */
  get(requestId: string, tenantId: string): Promise<EscalationRecord | undefined>;
}

/**
 * The C006/C009 seam payload: everything a deliverable derivation needs
 * for one escalation, collected by the host from ACCEPTED validation
 * outcomes and session-completion consent statements.
 */
export interface AcceptedDeliverableSource {
  readonly result: EscalationResult;
  readonly adjudication: AdjudicationOutcome;
  readonly consent: { readonly granted: boolean; readonly statement: string };
  readonly demonstrationTrace?: ReplayTrace;
  readonly originalSnapshot?: PlainJsonValue;
}

/** THE C006/C009 SEAM — accepted deliverable sources per escalation. */
export interface DeliverableSourcePort {
  /** Tenant-scoped collection (cross-tenant reads return undefined). */
  collect(requestId: string, tenantId: string): Promise<AcceptedDeliverableSource | undefined>;
}

/** Tenant-scoped persistence for the commission record. */
export interface CommissionStore {
  insert(commission: HumanDataCommission): Promise<void>;
  update(commission: HumanDataCommission): Promise<void>;
  get(commissionId: string, tenantId: string): Promise<HumanDataCommission | undefined>;
  list(tenantId: string): Promise<readonly HumanDataCommission[]>;
}

// ---------------------------------------------------------------------------
// Events (envelope conventions per sibling services)
// ---------------------------------------------------------------------------

export const HUMAN_DATA_EVENT_TYPES = Object.freeze([
  'commission.created',
  'commission.submitted',
  'commission.assembling',
  'commission.delivered',
  'commission.failed',
  'commission.abandoned',
] as const);
export type HumanDataEventType = (typeof HUMAN_DATA_EVENT_TYPES)[number];

/** A commission lifecycle event (idempotent consumer key = eventId). */
export interface HumanDataEvent {
  readonly eventVersion: 1;
  readonly eventId: string;
  readonly eventType: HumanDataEventType;
  readonly commissionId: string;
  readonly tenantId: string;
  readonly state: CommissionState;
  readonly occurredAt: string;
  /** Machine-readable event data (bundle ref, escalation ids, reason). */
  readonly data?: Readonly<Record<string, unknown>>;
}

/** Event delivery (commission.* events). */
export interface HumanDataEventSink {
  emit(event: HumanDataEvent): Promise<void>;
}

/** A delivered bundle reference + the assembly digest (event data shape). */
export interface CommissionDeliveryEventData {
  readonly bundleRef: CommissionBundleRef;
  readonly deliverableCount: number;
}
