/**
 * Escalation observability projections (Work Order C017) — per-client-app
 * read models of the C001 escalation lifecycle + the C010 commercial
 * fields, for the developer portal's observability dashboard.
 *
 * PROJECTIONS ONLY — NO DOMAIN TRUTH (the service-boundaries law): the
 * canonical record stays in the C001 escalation domain; these read
 * models are derived, never authoritative, and never mutate a record.
 *
 * Projected per ES1.0 response fields: request status (lifecycle
 * state), validation status, cost, Arena fee, expert payout status +
 * SLA-relevant timestamps (created/updated/deadline + terminal time).
 */

import type {
  EscalationRecord,
  EscalationState,
  EscalationValidationStatus,
} from '@arena/escalation';
import { isTerminalEscalationState } from '@arena/escalation';
import {
  ARENA_REFERENCE_FEE_SCHEDULE,
  computeFeeSplit,
  toMoney,
} from '@arena/payments';
import type { FeeSchedule, FeeSplit } from '@arena/payments';

import type { DeveloperTruthLabel } from './shared.js';

// ---------------------------------------------------------------------------
// The per-client-app projection
// ---------------------------------------------------------------------------

export const CLIENT_ESCALATION_PROJECTION_VERSION = 1 as const;

/** Cost/fee projection (mirrors the ES1.0 response cost fields). */
export interface ProjectionCostFields {
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly arenaFeeMinorUnits: number;
  readonly expertPayoutStatus: 'pending' | 'paid';
}

/** The C010 fee-split projection of a recorded cost (platform fee + expert payout legs). */
export interface ProjectionFeeSplit {
  readonly scheduleId: string;
  readonly scheduleVersion: number;
  readonly currency: string;
  readonly grossMinorUnits: string;
  readonly platformFeeMinorUnits: string;
  readonly expertPayoutMinorUnits: string;
  readonly truthLabel: DeveloperTruthLabel;
}

/** One projected escalation (a pure read model — never canonical truth). */
export interface ClientEscalationProjection {
  readonly projectionVersion: typeof CLIENT_ESCALATION_PROJECTION_VERSION;
  readonly requestId: string;
  readonly clientAppId: string;
  readonly tenantId: string;
  readonly state: EscalationState;
  readonly validationStatus?: EscalationValidationStatus;
  readonly resultKind?: string;
  readonly expertRef?: string;
  readonly sessionRef?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deadline: string;
  /** True iff the deadline passed while the escalation is NOT terminal. */
  readonly slaBreached: boolean;
  readonly historyEntryCount: number;
  readonly cost?: ProjectionCostFields;
  readonly feeSplit?: ProjectionFeeSplit;
  readonly environment: 'live' | 'sandbox';
  readonly truthLabel: DeveloperTruthLabel;
}

export interface BuildProjectionOptions {
  /** The environment the escalation belongs to (sandbox runs are labelled). */
  readonly environment: 'live' | 'sandbox';
  /** Injected "now" for the SLA-breach computation (never a wall clock). */
  readonly now: number | string | Date;
  /** The fee schedule used for the C010 split projection (reference default). */
  readonly feeSchedule?: FeeSchedule;
}

function toEpochMs(value: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new TypeError(`not an ISO timestamp: ${JSON.stringify(value)}`);
  }
  return ms;
}

function projectFeeSplit(
  cost: ProjectionCostFields,
  truthLabel: DeveloperTruthLabel,
  schedule: FeeSchedule,
): ProjectionFeeSplit {
  const split: FeeSplit = computeFeeSplit(schedule, toMoney({
    amount: cost.amountMinorUnits,
    currency: cost.currency,
  }));
  return Object.freeze({
    scheduleId: split.scheduleId,
    scheduleVersion: split.scheduleVersion,
    currency: split.currency,
    grossMinorUnits: split.grossMinorUnits,
    platformFeeMinorUnits: split.platformFeeMinorUnits,
    expertPayoutMinorUnits: split.expertPayoutMinorUnits,
    truthLabel,
  });
}

/** Build one projection from a canonical C001 record (pure; never mutates). */
export function buildClientEscalationProjection(
  record: EscalationRecord,
  options: BuildProjectionOptions,
): ClientEscalationProjection {
  const nowMs =
    typeof options.now === 'number'
      ? options.now
      : options.now instanceof Date
        ? options.now.getTime()
        : Date.parse(options.now);
  const truthLabel: DeveloperTruthLabel = options.environment === 'sandbox' ? 'sandbox' : 'live';
  const terminal = isTerminalEscalationState(record.state);
  return Object.freeze({
    projectionVersion: CLIENT_ESCALATION_PROJECTION_VERSION,
    requestId: record.request.requestId,
    clientAppId: record.request.clientAppId,
    tenantId: record.request.tenantId,
    state: record.state,
    ...(record.validationStatus !== undefined
      ? { validationStatus: record.validationStatus }
      : {}),
    ...(record.result !== undefined ? { resultKind: record.result.kind } : {}),
    ...(record.expertRef !== undefined ? { expertRef: record.expertRef } : {}),
    ...(record.sessionRef !== undefined ? { sessionRef: record.sessionRef } : {}),
    createdAt: record.request.createdAt,
    updatedAt: record.updatedAt,
    deadline: record.request.deadline,
    slaBreached: !terminal && toEpochMs(record.request.deadline) <= nowMs,
    historyEntryCount: record.history.length,
    ...(record.cost !== undefined
      ? {
          cost: Object.freeze({ ...record.cost }),
          feeSplit: projectFeeSplit(
            { ...record.cost },
            truthLabel,
            options.feeSchedule ?? ARENA_REFERENCE_FEE_SCHEDULE,
          ),
        }
      : {}),
    environment: options.environment,
    truthLabel,
  });
}

// ---------------------------------------------------------------------------
// Summary aggregate (the dashboard roll-up)
// ---------------------------------------------------------------------------

export interface ClientEscalationProjectionSummary {
  readonly total: number;
  readonly byState: Readonly<Record<string, number>>;
  readonly validationPassed: number;
  readonly validationFailed: number;
  readonly validationPending: number;
  readonly slaBreachedCount: number;
  /** Cost totals per currency (minor units — BigInt-free sums over safe integers). */
  readonly costTotals: Readonly<Record<string, { readonly amountMinorUnits: number; readonly arenaFeeMinorUnits: number }>>;
  readonly truthLabel: DeveloperTruthLabel;
}

/** Summarize a projection list (deterministic; pure). */
export function summarizeClientEscalationProjections(
  projections: readonly ClientEscalationProjection[],
): ClientEscalationProjectionSummary {
  const byState: Record<string, number> = {};
  const costTotals: Record<string, { amountMinorUnits: number; arenaFeeMinorUnits: number }> = {};
  let validationPassed = 0;
  let validationFailed = 0;
  let validationPending = 0;
  let slaBreachedCount = 0;
  for (const projection of projections) {
    byState[projection.state] = (byState[projection.state] ?? 0) + 1;
    if (projection.validationStatus === 'passed') validationPassed += 1;
    else if (projection.validationStatus === 'failed') validationFailed += 1;
    else validationPending += 1;
    if (projection.slaBreached) slaBreachedCount += 1;
    if (projection.cost !== undefined) {
      const totals = costTotals[projection.cost.currency] ?? {
        amountMinorUnits: 0,
        arenaFeeMinorUnits: 0,
      };
      costTotals[projection.cost.currency] = {
        amountMinorUnits: totals.amountMinorUnits + projection.cost.amountMinorUnits,
        arenaFeeMinorUnits: totals.arenaFeeMinorUnits + projection.cost.arenaFeeMinorUnits,
      };
    }
  }
  return Object.freeze({
    total: projections.length,
    byState: Object.freeze({ ...byState }),
    validationPassed,
    validationFailed,
    validationPending,
    slaBreachedCount,
    costTotals: Object.freeze({ ...costTotals }),
    truthLabel: projections.every((p) => p.truthLabel === 'sandbox')
      ? 'sandbox'
      : projections.every((p) => p.truthLabel === 'demo')
        ? 'demo'
        : 'live',
  });
}

/** Wire projection of a projection (list rows) — no secret material exists here by construction. */
export function clientEscalationProjectionWire(
  projection: ClientEscalationProjection,
): Record<string, unknown> {
  return Object.freeze({ ...projection });
}
