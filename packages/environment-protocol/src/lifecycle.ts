/**
 * Reset and checkpoint semantics (spec ENV1.0 declare fields 12 and 13;
 * Work Order A009 gate 7 — typed enums + invariants).
 *
 *   - ResetSemantics: how a run's world is reset. 'reset-to-checkpoint'
 *     REQUIRES a valid CheckpointRef; the snapshot/restore modes REQUIRE
 *     the initial state's snapshot support flag.
 *   - CheckpointSemantics: whether checkpointing is supported, its closed
 *     trigger set, and the bounded retention. Checkpoint support REQUIRES
 *     the snapshot support flag (a checkpoint IS a snapshot of the world).
 *
 * The cross-object invariants (checkpoint ⇒ snapshot support; reset modes
 * ⇒ snapshot support) are enforced at the definition level
 * (assertLifecycleConsistency) where all three objects meet.
 */

import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import type { CheckpointRef } from './isolation.js';
import { isCheckpointRef, toCheckpointRef } from './isolation.js';
import type { InitialStateDeclaration } from './snapshot.js';
import { expectEnumMember, expectFields, expectPositiveInteger } from './shared.js';

export { isCheckpointRef, toCheckpointRef } from './isolation.js';
export type { CheckpointRef } from './isolation.js';

// ---------------------------------------------------------------------------
// ResetSemantics (declare field 12)
// ---------------------------------------------------------------------------

/** Closed reset modes (typed enum; spec ENV1.0 reset semantics). */
export const RESET_MODES = Object.freeze(['recreate', 'restore-snapshot', 'reset-to-checkpoint'] as const);
export type ResetMode = (typeof RESET_MODES)[number];

/** What happens to the world's residue after a run (cleanup/reset). */
export const RESET_CLEANUPS = Object.freeze(['destroy', 'retain-evidence'] as const);
export type ResetCleanup = (typeof RESET_CLEANUPS)[number];

export interface ResetSemantics {
  readonly mode: ResetMode;
  readonly checkpoint: CheckpointRef | null;
  readonly cleanup: ResetCleanup;
}

export function isResetSemantics(value: unknown): value is ResetSemantics {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['mode'] === 'string' &&
    (RESET_MODES as readonly string[]).includes(candidate['mode']) &&
    (candidate['checkpoint'] === null || isCheckpointRef(candidate['checkpoint'])) &&
    typeof candidate['cleanup'] === 'string' &&
    (RESET_CLEANUPS as readonly string[]).includes(candidate['cleanup'])
  );
}

/** Validate and freeze reset semantics. */
export function toResetSemantics(value: {
  mode: string;
  checkpoint: { checkpointId: string; digest: string } | null;
  cleanup: string;
}): ResetSemantics {
  const record = expectFields(
    value,
    ['mode', 'checkpoint', 'cleanup'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_RESET_SEMANTICS,
    'reset semantics',
  );
  const mode = expectEnumMember(
    record['mode'],
    RESET_MODES,
    'mode',
    ENVIRONMENT_ERROR_CODES.INVALID_RESET_SEMANTICS,
    'reset semantics',
  );
  const rawCheckpoint = record['checkpoint'];
  if (rawCheckpoint !== null && (typeof rawCheckpoint !== 'object' || Array.isArray(rawCheckpoint))) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_RESET_SEMANTICS, {
      message: 'reset semantics: checkpoint must be a checkpoint ref or null',
    });
  }
  const checkpoint =
    rawCheckpoint === null
      ? null
      : toCheckpointRef(rawCheckpoint as { checkpointId: string; digest: string });
  const cleanup = expectEnumMember(
    record['cleanup'],
    RESET_CLEANUPS,
    'cleanup',
    ENVIRONMENT_ERROR_CODES.INVALID_RESET_SEMANTICS,
    'reset semantics',
  );

  // Invariant (gate 7): reset-to-checkpoint requires a valid checkpoint ref.
  if (mode === 'reset-to-checkpoint' && checkpoint === null) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_RESET_SEMANTICS, {
      message:
        "reset semantics: mode 'reset-to-checkpoint' requires a valid checkpoint reference",
      details: { mode },
    });
  }
  // Invariant: the checkpoint ref is only meaningful for reset-to-checkpoint —
  // carrying it in another mode is an ambiguous declaration.
  if (mode !== 'reset-to-checkpoint' && checkpoint !== null) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_RESET_SEMANTICS, {
      message: `reset semantics: checkpoint reference is only valid with mode 'reset-to-checkpoint' (got '${mode}')`,
      details: { mode },
    });
  }
  return Object.freeze({ mode, checkpoint, cleanup });
}

// ---------------------------------------------------------------------------
// CheckpointSemantics (declare field 13)
// ---------------------------------------------------------------------------

/** Closed checkpoint trigger set. */
export const CHECKPOINT_TRIGGERS = Object.freeze(['manual', 'scheduled', 'on-phase'] as const);
export type CheckpointTrigger = (typeof CHECKPOINT_TRIGGERS)[number];

export interface CheckpointSemantics {
  readonly supported: boolean;
  readonly triggers: readonly CheckpointTrigger[];
  readonly retention: number | null;
}

export function isCheckpointSemantics(value: unknown): value is CheckpointSemantics {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['supported'] !== 'boolean') return false;
  if (!Array.isArray(candidate['triggers'])) return false;
  if (
    !candidate['triggers'].every(
      (entry) =>
        typeof entry === 'string' &&
        (CHECKPOINT_TRIGGERS as readonly string[]).includes(entry),
    )
  ) {
    return false;
  }
  return (
    candidate['retention'] === null ||
    (typeof candidate['retention'] === 'number' &&
      Number.isInteger(candidate['retention']) &&
      candidate['retention'] > 0)
  );
}

/** Validate and freeze checkpoint semantics. */
export function toCheckpointSemantics(value: {
  supported: boolean;
  triggers: readonly string[];
  retention: number | null;
}): CheckpointSemantics {
  const record = expectFields(
    value,
    ['supported', 'triggers', 'retention'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS,
    'checkpoint semantics',
  );
  const supported = record['supported'];
  if (typeof supported !== 'boolean') {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS, {
      message: `checkpoint semantics: supported must be a boolean, got: ${String(supported)}`,
    });
  }
  const rawTriggers = record['triggers'];
  if (!Array.isArray(rawTriggers)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS, {
      message: 'checkpoint semantics: triggers must be an array of trigger kinds',
    });
  }
  const triggers = Object.freeze(
    rawTriggers.map((entry) =>
      expectEnumMember(
        entry,
        CHECKPOINT_TRIGGERS,
        'triggers',
        ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS,
        'checkpoint semantics',
      ),
    ),
  );
  const seen = new Set<string>();
  for (const trigger of triggers) {
    if (seen.has(trigger)) {
      throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS, {
        message: `checkpoint semantics: duplicate trigger '${trigger}'`,
      });
    }
    seen.add(trigger);
  }
  const rawRetention = record['retention'];
  if (rawRetention !== null && typeof rawRetention !== 'number') {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS, {
      message: 'checkpoint semantics: retention must be a positive integer or null',
    });
  }
  const retention =
    rawRetention === null
      ? null
      : expectPositiveInteger(
          rawRetention,
          'retention',
          ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS,
          'checkpoint semantics',
        );

  // Invariants: a supported checkpoint declaration must be usable — at
  // least one trigger, a bounded retention, and no retention/triggers
  // declared when unsupported (an unambiguous closed shape).
  if (supported) {
    if (triggers.length === 0) {
      throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS, {
        message:
          'checkpoint semantics: supported checkpoints must declare at least one trigger',
      });
    }
    if (retention === null) {
      throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS, {
        message:
          'checkpoint semantics: supported checkpoints must declare a bounded retention (checkpoints are not kept forever)',
      });
    }
  } else if (triggers.length > 0 || retention !== null) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS, {
      message:
        'checkpoint semantics: unsupported checkpoints must not declare triggers or retention (closed shape)',
    });
  }
  return Object.freeze({ supported, triggers, retention });
}

// ---------------------------------------------------------------------------
// Cross-object invariants (enforced at the definition level)
// ---------------------------------------------------------------------------

/**
 * Lifecycle consistency (Work Order A009 gate 7):
 *   - checkpoint semantics require the initial state's SNAPSHOT SUPPORT
 *     flag (a checkpoint IS a snapshot; without snapshot/restore support
 *     the declaration is unexecutable);
 *   - reset modes 'restore-snapshot' and 'reset-to-checkpoint' likewise
 *     require snapshot support.
 */
export function assertLifecycleConsistency(
  initialState: InitialStateDeclaration,
  resetSemantics: ResetSemantics,
  checkpointSemantics: CheckpointSemantics,
): void {
  if (checkpointSemantics.supported && initialState.snapshotSupport !== 'supported') {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS, {
      message:
        "checkpoint semantics require the snapshot support flag (initialState.snapshotSupport === 'supported')",
      details: { snapshotSupport: initialState.snapshotSupport },
    });
  }
  if (
    (resetSemantics.mode === 'restore-snapshot' ||
      resetSemantics.mode === 'reset-to-checkpoint') &&
    initialState.snapshotSupport !== 'supported'
  ) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_RESET_SEMANTICS, {
      message: `reset mode '${resetSemantics.mode}' requires the snapshot support flag (initialState.snapshotSupport === 'supported')`,
      details: { mode: resetSemantics.mode, snapshotSupport: initialState.snapshotSupport },
    });
  }
}
