/**
 * ToolGapSignalRecord — the staged, provenance-addressed, append-only
 * candidate record (Work Order C008; issue #115).
 *
 * Wraps the C006 session vocabulary ToolGapSignal (the full EES1.0 field
 * set: tool name, capability provided, why needed, inputs/outputs,
 * external/manual nature, access requirements, cost/latency if known,
 * evidence of use, recommended integration boundary, substitution
 * possibility) and adds the C008 capture pipeline envelope:
 *
 *   - provenance — correlation-linked to the ORIGINATING intervention
 *     (C007), escalation request (C001) and expert session (C006);
 *   - correlation — the causal flow's correlation id + the capture
 *     command's idempotency key (lock rule 17 addressability);
 *   - contentKey — deterministic content key over the signal payload:
 *     duplicate injections of the same signal deduplicate instead of
 *     inflating triage counts;
 *   - stage + stageHistory — the typed CLOSED stage machine
 *     (stages.ts); the record is deep-frozen and transitions APPEND a
 *     new history entry on a NEW record (append-only — the original
 *     stays addressable forever);
 *   - nothing auto-promotes: `advanceToolGapSignalStage` is the ONLY
 *     way a stage moves and it requires an explicit recorded decision.
 */

import type { ToolGapSignal } from '@arena/expert-session';
import { isToolGapSignal } from '@arena/expert-session';
import { TOOL_GAP_ERROR_CODES, ToolGapError } from './errors.js';
import {
  checkStageTransition,
  decisionCodeForTransition,
  isToolGapFeedStage,
  isToolGapStage,
  type StageDecisionCode,
  type StageTransitionReason,
  type ToolGapStage,
} from './stages.js';
import type { PlainJsonValue, ToolGapSignalId } from './shared.js';
import {
  canonicalContentKey,
  isToolGapSignalId,
  newToolGapSignalId,
  toToolGapTimestamp,
} from './shared.js';

/** Wire version of the tool-gap record shape. */
export const TOOL_GAP_SIGNAL_RECORD_VERSION = 1 as const;

/** Provenance linking the record to its originating intervention flow. */
export interface ToolGapSignalProvenance {
  readonly tenantId: string;
  /** The C007 intervention that produced the signal. */
  readonly interventionId: string;
  /** The C001 escalation request the intervention serves. */
  readonly requestId: string;
  /** The C006 expert session the signal was emitted in. */
  readonly sessionId: string;
  readonly expertRef: string | null;
  readonly capturedAt: string;
}

/** One append-only stage-history entry (never rewritten). */
export interface StageHistoryEntry {
  readonly from: ToolGapStage | null;
  readonly to: ToolGapStage;
  /** Machine-readable transition verdict reason for this step. */
  readonly reason: StageTransitionReason | 'capture';
  /** Machine-readable decision code (what the actor decided). */
  readonly decisionCode: StageDecisionCode;
  /** The recorded free-form decision statement (never silent). */
  readonly decision: string;
  readonly actor: string | null;
  readonly occurredAt: string;
}

/** The staged tool-gap signal record. */
export interface ToolGapSignalRecord {
  readonly recordVersion: typeof TOOL_GAP_SIGNAL_RECORD_VERSION;
  readonly signalId: ToolGapSignalId;
  /** The EES1.0 signal payload (C006 session vocabulary). */
  readonly signal: ToolGapSignal;
  readonly provenance: ToolGapSignalProvenance;
  readonly correlation: {
    readonly correlationId: string;
    readonly captureKey: string;
  };
  /** Deterministic content key over the signal payload (dedup). */
  readonly contentKey: string;
  readonly stage: ToolGapStage;
  /** Append-only stage history (first entry is the capture). */
  readonly stageHistory: readonly StageHistoryEntry[];
}

export interface CreateToolGapSignalRecordInput {
  /** The EES1.0 signal payload (must pass the C006 structural guard). */
  readonly signal: ToolGapSignal;
  readonly tenantId: string;
  readonly interventionId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly expertRef?: string;
  readonly correlationId: string;
  readonly captureKey: string;
  readonly now: number | string | Date;
  readonly signalId?: string;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new ToolGapError(TOOL_GAP_ERROR_CODES.INVALID_PROVENANCE, {
      message: `${field} must be a non-empty string (<= 512 chars): ${JSON.stringify(value)}`,
      details: { field },
    });
  }
  return value;
}

/**
 * Create a staged tool-gap signal record (stage CAPTURED). The payload
 * MUST be a valid C006 ToolGapSignal (structural guard, fail-closed) and
 * the provenance MUST be correlation-linked to the originating flow.
 */
export function createToolGapSignalRecord(
  input: CreateToolGapSignalRecordInput,
): ToolGapSignalRecord {
  if (typeof input !== 'object' || input === null) {
    throw new ToolGapError(TOOL_GAP_ERROR_CODES.INVALID_SIGNAL, {
      message: 'tool-gap record input must be an object',
    });
  }
  if (!isToolGapSignal(input.signal)) {
    throw new ToolGapError(TOOL_GAP_ERROR_CODES.INVALID_SIGNAL, {
      message: 'signal must be a valid EES1.0 ToolGapSignal (C006 session vocabulary)',
    });
  }
  if (input.signal.sessionId !== input.sessionId) {
    throw new ToolGapError(TOOL_GAP_ERROR_CODES.SCOPE_MISMATCH, {
      message: 'signal.sessionId must match the provenance sessionId of the capture',
      details: { signalSession: input.signal.sessionId, provenanceSession: input.sessionId },
    });
  }
  const tenantId = requireNonEmpty(input.tenantId, 'tenantId');
  const interventionId = requireNonEmpty(input.interventionId, 'interventionId');
  const requestId = requireNonEmpty(input.requestId, 'requestId');
  const sessionId = requireNonEmpty(input.sessionId, 'sessionId');
  const correlationId = requireNonEmpty(input.correlationId, 'correlationId');
  const captureKey = requireNonEmpty(input.captureKey, 'captureKey');
  const capturedAt = toToolGapTimestamp(input.now);

  const signalId =
    input.signalId === undefined
      ? newToolGapSignalId()
      : isToolGapSignalId(input.signalId)
        ? input.signalId
        : (() => {
            throw new ToolGapError(TOOL_GAP_ERROR_CODES.INVALID_SIGNAL, {
              message: `signalId is invalid: ${JSON.stringify(input.signalId)}`,
            });
          })();

  const record: ToolGapSignalRecord = Object.freeze({
    recordVersion: TOOL_GAP_SIGNAL_RECORD_VERSION,
    signalId,
    signal: input.signal,
    provenance: Object.freeze({
      tenantId,
      interventionId,
      requestId,
      sessionId,
      expertRef: input.expertRef ?? null,
      capturedAt,
    }),
    correlation: Object.freeze({ correlationId, captureKey }),
    contentKey: signalContentKey(input.signal),
    stage: 'captured',
    stageHistory: Object.freeze([
      Object.freeze({
        from: null,
        to: 'captured',
        reason: 'capture',
        decisionCode: 'capture',
        decision: `captured from intervention ${interventionId} (session ${sessionId})`,
        actor: input.expertRef ?? null,
        occurredAt: capturedAt,
      }),
    ]),
  });
  return record;
}

/** Deterministic content key over the EES1.0 payload (duplicate detection). */
export function signalContentKey(signal: ToolGapSignal): string {
  return canonicalContentKey({
    signalVersion: signal.signalVersion,
    sessionId: signal.sessionId,
    toolName: signal.toolName,
    capabilityProvided: signal.capabilityProvided,
    whyNeeded: signal.whyNeeded,
    inputs: signal.inputs as PlainJsonValue,
    outputs: signal.outputs as PlainJsonValue,
    nature: signal.nature,
    accessRequirements: [...signal.accessRequirements],
    cost: signal.cost === null ? null : { ...signal.cost },
    evidenceOfUse: [...signal.evidenceOfUse],
    recommendedIntegrationBoundary: signal.recommendedIntegrationBoundary,
    substitutionPossible: signal.substitutionPossible,
    recordedAt: signal.recordedAt,
  });
}

export interface AdvanceToolGapStageInput {
  readonly record: ToolGapSignalRecord;
  /** Destination stage (must be an edge in the closed machine). */
  readonly toStage: string;
  /** The recorded decision statement (REQUIRED — never silent). */
  readonly decision: string;
  readonly actor?: string;
  readonly now: number | string | Date;
}

/**
 * Advance a staged record through the CLOSED stage machine. Returns a
 * NEW record (append-only history; the original is untouched). Fail-closed
 * on every denied transition — the machine-readable reason travels in the
 * error details (never a silent no-op, never a coercion).
 */
export function advanceToolGapSignalStage(
  input: AdvanceToolGapStageInput,
): ToolGapSignalRecord {
  if (typeof input !== 'object' || input === null) {
    throw new ToolGapError(TOOL_GAP_ERROR_CODES.INVALID_TRANSITION, {
      message: 'advance input must be an object',
    });
  }
  const verdict = checkStageTransition(input.record.stage, input.toStage);
  if (!verdict.allowed) {
    const code = verdict.reason === 'transition_terminal_final'
      ? TOOL_GAP_ERROR_CODES.TERMINAL_STAGE
      : TOOL_GAP_ERROR_CODES.INVALID_TRANSITION;
    throw new ToolGapError(code, {
      message: `stage transition ${input.record.stage} -> ${input.toStage} denied (${verdict.reason})`,
      details: { reason: verdict.reason, from: verdict.from, to: verdict.to },
      correlationId: input.record.correlation.correlationId,
    });
  }
  if (typeof input.decision !== 'string' || input.decision.length === 0 || input.decision.length > 4096) {
    throw new ToolGapError(TOOL_GAP_ERROR_CODES.INVALID_TRANSITION, {
      message: 'stage transitions require a recorded decision (nothing auto-promotes)',
      details: { reason: 'transition_requires_decision' },
      correlationId: input.record.correlation.correlationId,
    });
  }
  const occurredAt = toToolGapTimestamp(input.now);
  const advanced: ToolGapSignalRecord = Object.freeze({
    ...input.record,
    stage: verdict.to,
    stageHistory: Object.freeze([
      ...input.record.stageHistory,
      Object.freeze({
        from: input.record.stage,
        to: verdict.to,
        reason: 'transition_ok',
        decisionCode: decisionCodeForTransition(verdict.to),
        decision: input.decision,
        actor: input.actor ?? null,
        occurredAt,
      }),
    ]),
  });
  return advanced;
}

/** Machine-readable provenance-integrity verdict reasons. */
export const PROVENANCE_INTEGRITY_REASONS = Object.freeze([
  'intact',
  'history_empty',
  'first_entry_not_capture',
  'history_discontiguous',
  'stage_mismatch',
  'record_version_unsupported',
] as const);
export type ProvenanceIntegrityReason = (typeof PROVENANCE_INTEGRITY_REASONS)[number];

export interface ProvenanceIntegrityCheck {
  readonly intact: boolean;
  readonly reason: ProvenanceIntegrityReason;
}

/**
 * Verify the append-only provenance chain of a record: the history starts
 * at the capture, every entry's `from` continues the previous `to`, and
 * the terminal entry's `to` equals the record's stage. Tampering (a spliced
 * or rewritten history) is detected as a machine-readable verdict.
 */
export function verifyProvenanceIntegrity(record: ToolGapSignalRecord): ProvenanceIntegrityCheck {
  if (record.recordVersion !== TOOL_GAP_SIGNAL_RECORD_VERSION) {
    return { intact: false, reason: 'record_version_unsupported' };
  }
  if (record.stageHistory.length === 0) {
    return { intact: false, reason: 'history_empty' };
  }
  const first = record.stageHistory[0];
  if (
    first === undefined ||
    first.from !== null ||
    first.to !== 'captured' ||
    first.decisionCode !== 'capture'
  ) {
    return { intact: false, reason: 'first_entry_not_capture' };
  }
  let cursor: ToolGapStage | null = null;
  for (const entry of record.stageHistory) {
    if (entry.from !== cursor) return { intact: false, reason: 'history_discontiguous' };
    if (!isToolGapStage(entry.to)) return { intact: false, reason: 'history_discontiguous' };
    if (entry.from === null) {
      // the capture entry: the only legal null-from, and it must land on captured
      if (entry.to !== 'captured') return { intact: false, reason: 'history_discontiguous' };
    } else {
      const verdict = checkStageTransition(entry.from, entry.to);
      if (!verdict.allowed) return { intact: false, reason: 'history_discontiguous' };
    }
    cursor = entry.to;
  }
  if (cursor !== record.stage) return { intact: false, reason: 'stage_mismatch' };
  return { intact: true, reason: 'intact' };
}

/** Structural guard for wire values claiming to be staged signal records. */
export function isToolGapSignalRecord(value: unknown): value is ToolGapSignalRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === TOOL_GAP_SIGNAL_RECORD_VERSION &&
    isToolGapSignalId(candidate['signalId']) &&
    isToolGapSignal(candidate['signal']) &&
    typeof candidate['contentKey'] === 'string' &&
    candidate['contentKey'].length > 0 &&
    isToolGapStage(candidate['stage']) &&
    Array.isArray(candidate['stageHistory']) &&
    candidate['stageHistory'].length > 0
  );
}

/** View helper: is the record disposed onto a terminal feed stage? */
export function isDisposed(record: ToolGapSignalRecord): boolean {
  return isToolGapFeedStage(record.stage);
}
