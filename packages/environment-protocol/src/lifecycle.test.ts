/**
 * Reset and checkpoint semantics tests (Work Order A009 gate 7 — typed
 * enums + invariants):
 *
 *   - reset-to-checkpoint REQUIRES a valid checkpoint ref;
 *   - checkpoint refs are only meaningful for reset-to-checkpoint;
 *   - checkpoint support REQUIRES the initial state snapshot support flag;
 *   - supported checkpoints declare triggers and bounded retention;
 *   - unsupported checkpoints declare nothing (closed shape).
 */

import { describe, expect, it } from 'vitest';
import { createEnvironmentDefinition } from './definition.js';
import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import {
  assertLifecycleConsistency,
  isCheckpointSemantics,
  isResetSemantics,
  toCheckpointSemantics,
  toResetSemantics,
} from './lifecycle.js';
import {
  isInitialStateDeclaration,
  toInitialStateDeclaration,
  supportsSnapshotRestore,
} from './snapshot.js';
import { DIGEST_B, DIGEST_C, makeCheckpointingOverrides, makeDefinitionInput } from './test-support.js';

const SUPPORTED_STATE = toInitialStateDeclaration({
  snapshot: { snapshotId: 'snapshot-initial', digest: DIGEST_B },
  snapshotSupport: 'supported',
});

const UNSUPPORTED_STATE = toInitialStateDeclaration({
  snapshot: { snapshotId: 'snapshot-initial', digest: DIGEST_B },
  snapshotSupport: 'not-supported',
});

describe('reset semantics (gate 7)', () => {
  it('each reset mode validates with the right payload (typed enums)', () => {
    const recreate = toResetSemantics({ mode: 'recreate', checkpoint: null, cleanup: 'destroy' });
    const restore = toResetSemantics({ mode: 'restore-snapshot', checkpoint: null, cleanup: 'retain-evidence' });
    const toCheckpoint = toResetSemantics({
      mode: 'reset-to-checkpoint',
      checkpoint: { checkpointId: 'checkpoint-phase-1', digest: DIGEST_C },
      cleanup: 'retain-evidence',
    });
    expect(isResetSemantics(recreate)).toBe(true);
    expect(isResetSemantics(restore)).toBe(true);
    expect(isResetSemantics(toCheckpoint)).toBe(true);
    expect(Object.isFrozen(recreate)).toBe(true);
    expect(Object.isFrozen(toCheckpoint.checkpoint)).toBe(true);
  });

  it('reset-to-checkpoint without a checkpoint ref is rejected', () => {
    expect(() =>
      toResetSemantics({ mode: 'reset-to-checkpoint', checkpoint: null, cleanup: 'destroy' }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_RESET_SEMANTICS }),
    );
  });

  it('reset-to-checkpoint with a malformed checkpoint ref is rejected', () => {
    expect(() =>
      toResetSemantics({
        mode: 'reset-to-checkpoint',
        checkpoint: { checkpointId: 'BAD', digest: DIGEST_C },
        cleanup: 'destroy',
      }),
    ).toThrowError(EnvironmentError);
  });

  it('a checkpoint ref in another mode is rejected (unambiguous closed shape)', () => {
    expect(() =>
      toResetSemantics({
        mode: 'recreate',
        checkpoint: { checkpointId: 'checkpoint-phase-1', digest: DIGEST_C },
        cleanup: 'destroy',
      }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_RESET_SEMANTICS }),
    );
  });

  it('unknown modes and cleanups are rejected', () => {
    expect(() => toResetSemantics({ mode: 'never', checkpoint: null, cleanup: 'destroy' })).toThrowError(
      EnvironmentError,
    );
    expect(() => toResetSemantics({ mode: 'recreate', checkpoint: null, cleanup: 'linger' })).toThrowError(
      EnvironmentError,
    );
  });
});

describe('checkpoint semantics (gate 7)', () => {
  it('supported checkpoints declare triggers and bounded retention', () => {
    const semantics = toCheckpointSemantics({
      supported: true,
      triggers: ['manual', 'scheduled'],
      retention: 3,
    });
    expect(isCheckpointSemantics(semantics)).toBe(true);
    expect(Object.isFrozen(semantics)).toBe(true);
    expect(Object.isFrozen(semantics.triggers)).toBe(true);
  });

  it('unsupported checkpoints declare nothing (closed shape)', () => {
    const semantics = toCheckpointSemantics({ supported: false, triggers: [], retention: null });
    expect(isCheckpointSemantics(semantics)).toBe(true);
  });

  it('supported without triggers is rejected', () => {
    expect(() => toCheckpointSemantics({ supported: true, triggers: [], retention: 3 })).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS }),
    );
  });

  it('supported without bounded retention is rejected (checkpoints are not kept forever)', () => {
    expect(() =>
      toCheckpointSemantics({ supported: true, triggers: ['manual'], retention: null }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS }),
    );
    expect(() =>
      toCheckpointSemantics({ supported: true, triggers: ['manual'], retention: 0 }),
    ).toThrowError(EnvironmentError);
  });

  it('unsupported with stray declarations is rejected', () => {
    expect(() =>
      toCheckpointSemantics({ supported: false, triggers: ['manual'], retention: null }),
    ).toThrowError(EnvironmentError);
    expect(() =>
      toCheckpointSemantics({ supported: false, triggers: [], retention: 2 }),
    ).toThrowError(EnvironmentError);
  });

  it('unknown and duplicate triggers are rejected', () => {
    expect(() =>
      toCheckpointSemantics({ supported: true, triggers: ['automatic'], retention: 2 }),
    ).toThrowError(EnvironmentError);
    expect(() =>
      toCheckpointSemantics({ supported: true, triggers: ['manual', 'manual'], retention: 2 }),
    ).toThrowError(EnvironmentError);
  });
});

describe('lifecycle consistency invariants (gate 7, cross-object)', () => {
  it('checkpoint support requires the snapshot support flag', () => {
    const checkpointing = toCheckpointSemantics({
      supported: true,
      triggers: ['manual'],
      retention: 2,
    });
    expect(() =>
      assertLifecycleConsistency(UNSUPPORTED_STATE, toResetSemantics({ mode: 'recreate', checkpoint: null, cleanup: 'destroy' }), checkpointing),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS }),
    );
    expect(() =>
      assertLifecycleConsistency(SUPPORTED_STATE, toResetSemantics({ mode: 'recreate', checkpoint: null, cleanup: 'destroy' }), checkpointing),
    ).not.toThrow();
  });

  it('restore-snapshot resets require the snapshot support flag', () => {
    const restore = toResetSemantics({ mode: 'restore-snapshot', checkpoint: null, cleanup: 'destroy' });
    expect(() => assertLifecycleConsistency(UNSUPPORTED_STATE, restore, toCheckpointSemantics({ supported: false, triggers: [], retention: null }))).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_RESET_SEMANTICS }),
    );
  });

  it('the definition constructor enforces the same invariants end-to-end', async () => {
    const input = makeDefinitionInput({
      initialState: {
        snapshot: { snapshotId: 'snapshot-initial', digest: DIGEST_B },
        snapshotSupport: 'not-supported',
      },
      ...makeCheckpointingOverrides(),
    });
    await expect(createEnvironmentDefinition(input)).rejects.toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS }),
    );
  });
});

describe('initial state declaration (declare field 3)', () => {
  it('carries the snapshot ref + digest and the support flag', () => {
    expect(SUPPORTED_STATE.snapshot.snapshotId).toBe('snapshot-initial');
    expect(SUPPORTED_STATE.snapshot.digest).toBe(DIGEST_B);
    expect(supportsSnapshotRestore(SUPPORTED_STATE)).toBe(true);
    expect(supportsSnapshotRestore(UNSUPPORTED_STATE)).toBe(false);
    expect(isInitialStateDeclaration(SUPPORTED_STATE)).toBe(true);
    expect(isInitialStateDeclaration({ snapshot: 'x', snapshotSupport: 'supported' })).toBe(false);
  });

  it('rejects malformed snapshots and flags (strict shape)', () => {
    expect(() =>
      toInitialStateDeclaration({
        snapshot: { snapshotId: 'BAD', digest: DIGEST_B },
        snapshotSupport: 'supported',
      }),
    ).toThrowError(EnvironmentError);
    expect(() =>
      toInitialStateDeclaration({
        snapshot: { snapshotId: 'ok', digest: 'nope' },
        snapshotSupport: 'supported',
      }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_DIGEST }),
    );
    expect(() =>
      toInitialStateDeclaration({
        snapshot: { snapshotId: 'ok', digest: DIGEST_B },
        snapshotSupport: 'maybe',
      }),
    ).toThrowError(EnvironmentError);
  });
});
