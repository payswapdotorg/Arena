/**
 * Trajectory binding (Work Order C007; issue #114; architecture-lock
 * rule 30) — every intervention emits an A011 trajectory-backed record
 * of OBSERVABLE WORK through @arena/trajectory's pure protocol (header
 * + append-only chain-linked entries + verification; never
 * reimplemented here):
 *
 *   human-action | tool-invocation  → `action` entries (what the expert DID);
 *   tool-result | artifact-change | annotation | tool-gap-signal
 *                                     → `observation` entries (what happened);
 *   checkpoint                        → `checkpoint` entries (snapshot digests);
 *   submit                            → terminal `completion` entry.
 *
 * FAIL-CLOSED SCREENS (the two adversarial invariants of C007):
 *   1. PRIVATE_REASONING — no private chain-of-thought is required,
 *      captured or transmitted: a payload key from the closed deny
 *      list (chainOfThought, privateReasoning, hiddenReasoning,
 *      internalReasoning, scratchpad, secretThoughts —
 *      case-insensitive, nested) is rejected before it can enter the
 *      trajectory;
 *   2. LIVE_WORLD_MUTATION — the bounded replica is never a live-world
 *      write path: string values referencing live-world endpoints
 *      (`live:`, `prod:`, `ws://live.`) are rejected.
 *
 * Timestamps are injected; the module never reads a wall clock.
 */

import { appendTrajectoryEntry, openTrajectory } from '@arena/trajectory';
import type {
  CreateTrajectoryEntryInput,
  CreateTrajectoryHeaderInput,
  TrajectoryRecord,
} from '@arena/trajectory';
import { INTERVENTION_ERROR_CODES, InterventionError } from './errors.js';
import type { TrajectoryBindingRef } from './results.js';

// ---------------------------------------------------------------------------
// Observable step vocabulary (what an intervention records)
// ---------------------------------------------------------------------------

export const INTERVENTION_STEP_KINDS = Object.freeze([
  'human-action',
  'tool-invocation',
  'tool-result',
  'artifact-change',
  'annotation',
  'checkpoint',
  'tool-gap-signal',
] as const);
export type InterventionStepKind = (typeof INTERVENTION_STEP_KINDS)[number];

export function isInterventionStepKind(value: unknown): value is InterventionStepKind {
  return (
    typeof value === 'string' &&
    (INTERVENTION_STEP_KINDS as readonly string[]).includes(value)
  );
}

/** One observable step of expert work (plain JSON payload). */
export interface InterventionStep {
  readonly kind: InterventionStepKind;
  /** Neutral step identifier (lowercase kebab, <= 64 chars). */
  readonly stepId: string;
  /** Observable payload — NEVER private chain-of-thought (screened). */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

// ---------------------------------------------------------------------------
// Fail-closed screens
// ---------------------------------------------------------------------------

/** The private-reasoning deny list (case-insensitive key match). */
export const PRIVATE_REASONING_KEY_DENY_LIST = Object.freeze([
  'chainofthought',
  'privatereasoning',
  'hiddenreasoning',
  'internalreasoning',
  'scratchpad',
  'secretthoughts',
] as const);

/** Live-world reference prefixes (the replica is never a live write path). */
export const LIVE_WORLD_REF_PREFIXES = Object.freeze([
  'live:',
  'prod:',
  'ws://live.',
] as const);

/** Throw PRIVATE_REASONING when a payload carries hidden reasoning keys. */
export function assertNoPrivateReasoning(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoPrivateReasoning(entry);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (
      (PRIVATE_REASONING_KEY_DENY_LIST as readonly string[]).includes(
        key.toLowerCase().replace(/[^a-z]/g, ''),
      )
    ) {
      throw new InterventionError(INTERVENTION_ERROR_CODES.PRIVATE_REASONING, {
        message: `payload key '${key}' carries private chain-of-thought — observable work only (architecture-lock rule 30)`,
        details: { key },
      });
    }
    assertNoPrivateReasoning(record[key]);
  }
}

/** Throw LIVE_WORLD_MUTATION when a payload references live-world endpoints. */
export function assertNoLiveWorldMutation(value: unknown): void {
  if (typeof value === 'string') {
    for (const prefix of LIVE_WORLD_REF_PREFIXES) {
      if (value.startsWith(prefix)) {
        throw new InterventionError(INTERVENTION_ERROR_CODES.LIVE_WORLD_MUTATION, {
          message: `payload references a live-world endpoint ('${prefix}…') — the bounded session is never a live-world write path`,
          details: { prefix },
        });
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertNoLiveWorldMutation(entry);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      assertNoLiveWorldMutation((value as Record<string, unknown>)[key]);
    }
  }
}

// ---------------------------------------------------------------------------
// The binding input
// ---------------------------------------------------------------------------

/** The A011 header inputs an intervention binds its trajectory with. */
export interface InterventionTrajectoryBinding {
  readonly trajectoryId: string;
  readonly run: CreateTrajectoryHeaderInput['run'];
  readonly agentBodyRef: string;
  readonly substrateRef: string;
  readonly seed: string | null;
  readonly startedAt: string;
}

export interface BuildInterventionTrajectoryInput {
  readonly binding: InterventionTrajectoryBinding;
  /** The observable steps, in order (occurredAt monotonic non-decreasing). */
  readonly steps: readonly InterventionStep[];
  /** Submission time — the terminal completion entry. */
  readonly completedAt: string;
  /** Digests of the evidence outputs the intervention produced. */
  readonly evidenceDigests?: readonly string[];
  /** Outcome of the completion entry (default 'completed'). */
  readonly outcome?: 'completed' | 'failed' | 'timed-out';
}

/** Map an intervention step kind to its trajectory entry kind. */
function trajectoryEntryForStep(
  step: InterventionStep,
): { kind: 'action' | 'observation' | 'checkpoint'; payload: Record<string, unknown> } {
  switch (step.kind) {
    case 'human-action':
    case 'tool-invocation':
      return { kind: 'action', payload: { actionId: step.stepId, input: step.payload } };
    case 'tool-result':
    case 'artifact-change':
    case 'annotation':
    case 'tool-gap-signal':
      return {
        kind: 'observation',
        payload: {
          observationId: step.stepId,
          channel: 'events',
          content: JSON.stringify(step.payload),
        },
      };
    case 'checkpoint': {
      const snapshotDigest = step.payload['snapshotDigest'];
      if (typeof snapshotDigest !== 'string' || !/^[0-9a-f]{64}$/.test(snapshotDigest)) {
        throw new InterventionError(INTERVENTION_ERROR_CODES.TRAJECTORY_INVALID, {
          message: `checkpoint step '${step.stepId}' requires payload.snapshotDigest (64-hex): ${JSON.stringify(snapshotDigest)}`,
        });
      }
      return {
        kind: 'checkpoint',
        payload: { checkpointId: step.stepId, snapshotDigest },
      };
    }
  }
}

/**
 * Build the A011 trajectory-backed record of one intervention's
 * observable work: opens the trajectory from the binding, appends one
 * entry per step (private-reasoning + live-world screened), then the
 * terminal completion entry. Returns the frozen TrajectoryRecord —
 * verify with @arena/trajectory's verifyTrajectoryRecord.
 */
export async function buildInterventionTrajectory(
  input: BuildInterventionTrajectoryInput,
): Promise<TrajectoryRecord> {
  const { binding } = input;
  if (binding.trajectoryId === undefined || binding.agentBodyRef === undefined) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.TRAJECTORY_INVALID, {
      message: 'trajectory binding requires trajectoryId and agentBodyRef',
    });
  }
  for (const step of input.steps) {
    if (!isInterventionStepKind(step.kind)) {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_REQUEST, {
        message: `intervention step kind is not in the closed vocabulary: ${JSON.stringify(step.kind)}`,
      });
    }
    if (typeof step.stepId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(step.stepId)) {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_REQUEST, {
        message: `intervention step id is invalid: ${JSON.stringify(step.stepId)}`,
      });
    }
    if (
      typeof step.payload !== 'object' ||
      step.payload === null ||
      Array.isArray(step.payload)
    ) {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_REQUEST, {
        message: `intervention step '${step.stepId}' payload must be a plain object`,
      });
    }
    // THE TWO SCREENS — fail closed BEFORE anything is captured.
    assertNoPrivateReasoning(step.payload);
    assertNoLiveWorldMutation(step.payload);
  }

  let record = await openTrajectory({
    trajectoryId: binding.trajectoryId,
    run: binding.run,
    agentBodyRef: binding.agentBodyRef,
    substrateRef: binding.substrateRef,
    startedAt: binding.startedAt,
    seed: binding.seed,
  });

  for (const step of input.steps) {
    const mapped = trajectoryEntryForStep(step);
    const entryInput: CreateTrajectoryEntryInput = {
      sequence: record.entries.length + 1,
      kind: mapped.kind,
      payload: mapped.payload,
      occurredAt: step.occurredAt,
    };
    record = await appendTrajectoryEntry(record, entryInput);
  }

  const completion: CreateTrajectoryEntryInput = {
    sequence: record.entries.length + 1,
    kind: 'completion',
    payload: {
      outcome: input.outcome ?? 'completed',
      ...(input.evidenceDigests !== undefined && input.evidenceDigests.length > 0
        ? { evidenceDigests: [...input.evidenceDigests] }
        : {}),
    },
    occurredAt: input.completedAt,
  };
  record = await appendTrajectoryEntry(record, completion);
  return record;
}

/** The trajectory binding reference for a built record. */
export function interventionTrajectoryRef(record: TrajectoryRecord): TrajectoryBindingRef {
  return Object.freeze({
    trajectoryId: record.header.trajectoryId,
    chainHead: record.chainHead,
  });
}
