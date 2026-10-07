/**
 * ToolGapSignal records (Work Order C006; spec
 * expert-environment-session.md EES1.0 "Tool-gap discovery" —
 * architecture-lock rule 32).
 *
 * If the expert uses a tool unavailable to the agent, the expert can
 * emit a ToolGapSignal. The signal records the full EES1.0 field set:
 * tool name; capability provided; why it was needed; inputs/outputs;
 * external/manual nature; access requirements; cost/latency if known;
 * evidence of use; recommended integration boundary; whether
 * substitution was possible.
 *
 * A ToolGapSignal is a CANDIDATE improvement artifact. It can feed tool
 * specification → adapter request → body improvement → capability
 * benchmark → marketplace artifact (C008's pipeline), but it never
 * silently mutates the host application's live agent (lock rule 32).
 */

import { EXPERT_SESSION_ERROR_CODES, ExpertSessionError } from './errors.js';
import type { ExpertSessionId, ExpertSessionTimestamp, PlainJsonValue } from './shared.js';
import {
  deepFreeze,
  isExpertSessionId,
  isPlainJsonValue,
  toExpertSessionTimestamp,
} from './shared.js';

/** Wire version of the tool-gap signal shape. */
export const TOOL_GAP_SIGNAL_VERSION = 1 as const;

/** The nature of the tool the expert used (EES1.0 "external/manual nature"). */
export const TOOL_GAP_NATURES = Object.freeze([
  'external-tool',
  'manual-action',
  'environment-native',
] as const);
export type ToolGapNature = (typeof TOOL_GAP_NATURES)[number];

export function isToolGapNature(value: unknown): value is ToolGapNature {
  return typeof value === 'string' && (TOOL_GAP_NATURES as readonly string[]).includes(value);
}

/**
 * A ToolGapSignal — the full EES1.0 field set. Evidence of use is
 * REQUIRED (a signal without evidence is an unverifiable claim and can
 * never be constructed).
 */
export interface ToolGapSignal {
  readonly signalVersion: typeof TOOL_GAP_SIGNAL_VERSION;
  readonly sessionId: ExpertSessionId;
  /** Tool name (what the expert used that the agent lacks). */
  readonly toolName: string;
  /** Capability the tool provided. */
  readonly capabilityProvided: string;
  /** Why it was needed at this escalation point. */
  readonly whyNeeded: string;
  /** Observed inputs (plain JSON — screened by the stream projection). */
  readonly inputs: PlainJsonValue;
  /** Observed outputs (plain JSON — screened by the stream projection). */
  readonly outputs: PlainJsonValue;
  /** External / manual / environment-native nature. */
  readonly nature: ToolGapNature;
  /** Access requirements (e.g. network reach, credentials class, data). */
  readonly accessRequirements: readonly string[];
  /** Cost / latency if known (null when unknown). */
  readonly cost: {
    readonly amountMinorUnits?: number;
    readonly currency?: string;
    readonly latencyMs?: number;
  } | null;
  /** Evidence of use (non-empty refs into the session's event stream). */
  readonly evidenceOfUse: readonly string[];
  /** Recommended integration boundary for the agent. */
  readonly recommendedIntegrationBoundary: string;
  /** Whether substitution with an existing agent capability was possible. */
  readonly substitutionPossible: boolean;
  readonly recordedAt: ExpertSessionTimestamp;
}

export interface CreateToolGapSignalInput {
  readonly sessionId: string;
  readonly toolName: string;
  readonly capabilityProvided: string;
  readonly whyNeeded: string;
  readonly inputs?: unknown;
  readonly outputs?: unknown;
  readonly nature: string;
  readonly accessRequirements?: readonly string[];
  readonly cost?: { readonly amountMinorUnits?: number; readonly currency?: string; readonly latencyMs?: number };
  readonly evidenceOfUse: readonly string[];
  readonly recommendedIntegrationBoundary: string;
  readonly substitutionPossible: boolean;
  readonly now: number | string | Date;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TOOL_GAP, {
      message: `${field} must be a non-empty string (<= 2048 chars): ${JSON.stringify(value)}`,
    });
  }
  return value;
}

function requireStringList(values: readonly unknown[] | undefined, field: string): readonly string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TOOL_GAP, {
      message: `${field} must be an array of strings`,
    });
  }
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TOOL_GAP, {
        message: `${field} entries must be non-empty strings: ${JSON.stringify(value)}`,
      });
    }
  }
  return Object.freeze([...values]);
}

/** Create a validated ToolGapSignal (fail-closed on every EES1.0 field). */
export function createToolGapSignal(input: CreateToolGapSignalInput): ToolGapSignal {
  if (typeof input !== 'object' || input === null) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TOOL_GAP, {
      message: 'tool-gap signal input must be an object',
    });
  }
  if (!isExpertSessionId(input.sessionId)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TOOL_GAP, {
      message: `sessionId is invalid: ${JSON.stringify(input.sessionId)}`,
    });
  }
  requireNonEmptyString(input.toolName, 'toolName');
  requireNonEmptyString(input.capabilityProvided, 'capabilityProvided');
  requireNonEmptyString(input.whyNeeded, 'whyNeeded');
  requireNonEmptyString(input.recommendedIntegrationBoundary, 'recommendedIntegrationBoundary');
  if (!isToolGapNature(input.nature)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TOOL_GAP, {
      message: `nature must be one of ${JSON.stringify([...TOOL_GAP_NATURES])}: ${JSON.stringify(input.nature)}`,
    });
  }
  if (typeof input.substitutionPossible !== 'boolean') {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TOOL_GAP, {
      message: 'substitutionPossible must be an explicit boolean',
    });
  }
  const evidence = requireStringList(input.evidenceOfUse, 'evidenceOfUse');
  if (evidence.length === 0) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TOOL_GAP, {
      message: 'evidenceOfUse is required — a tool-gap signal without evidence of use is an unverifiable claim',
    });
  }
  for (const field of ['inputs', 'outputs'] as const) {
    const value = input[field];
    if (value !== undefined && !isPlainJsonValue(value)) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TOOL_GAP, {
        message: `${field} must be a plain-JSON value`,
      });
    }
  }
  if (input.cost !== undefined && input.cost !== null && typeof input.cost !== 'object') {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TOOL_GAP, {
      message: 'cost must be an object or null',
    });
  }

  const signal: ToolGapSignal = Object.freeze({
    signalVersion: TOOL_GAP_SIGNAL_VERSION,
    sessionId: input.sessionId,
    toolName: input.toolName,
    capabilityProvided: input.capabilityProvided,
    whyNeeded: input.whyNeeded,
    inputs: deepFreeze((input.inputs ?? null) as PlainJsonValue),
    outputs: deepFreeze((input.outputs ?? null) as PlainJsonValue),
    nature: input.nature,
    accessRequirements: requireStringList(input.accessRequirements, 'accessRequirements'),
    cost:
      input.cost === undefined || input.cost === null
        ? null
        : Object.freeze({
            ...(input.cost.amountMinorUnits !== undefined
              ? { amountMinorUnits: input.cost.amountMinorUnits }
              : {}),
            ...(input.cost.currency !== undefined ? { currency: input.cost.currency } : {}),
            ...(input.cost.latencyMs !== undefined ? { latencyMs: input.cost.latencyMs } : {}),
          }),
    evidenceOfUse: evidence,
    recommendedIntegrationBoundary: input.recommendedIntegrationBoundary,
    substitutionPossible: input.substitutionPossible,
    recordedAt: toExpertSessionTimestamp(input.now),
  });
  return signal;
}

/** Structural guard for wire values claiming to be tool-gap signals. */
export function isToolGapSignal(value: unknown): value is ToolGapSignal {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['signalVersion'] === TOOL_GAP_SIGNAL_VERSION &&
    isExpertSessionId(candidate['sessionId']) &&
    typeof candidate['toolName'] === 'string' &&
    candidate['toolName'].length > 0 &&
    typeof candidate['capabilityProvided'] === 'string' &&
    typeof candidate['whyNeeded'] === 'string' &&
    isToolGapNature(candidate['nature']) &&
    Array.isArray(candidate['evidenceOfUse']) &&
    candidate['evidenceOfUse'].length > 0 &&
    typeof candidate['recommendedIntegrationBoundary'] === 'string' &&
    typeof candidate['substitutionPossible'] === 'boolean'
  );
}
