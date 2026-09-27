/**
 * Initial state declaration — the "initial state snapshot" field group
 * (spec ENV1.0 Declare bullet 3; Work Order A009 gate 2).
 *
 *   - StateSnapshotRef: a content-addressed reference to the initial state
 *     snapshot (snapshotId + digest). The snapshot is the deterministic
 *     starting world of every run.
 *   - InitialStateDeclaration: the snapshot reference PLUS the snapshot
 *     support flag — whether the substrate backing this environment
 *     supports snapshot/restore machinery. Checkpoint semantics and
 *     snapshot-restore resets REQUIRE this flag (see lifecycle.ts
 *     invariants; Work Order A009 gate 7).
 */

import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import type { ContentDigest, NeutralId } from './shared.js';
import {
  expectEnumMember,
  expectFields,
  isContentDigest,
  isNeutralId,
  toContentDigest,
  toNeutralId,
} from './shared.js';

/** Snapshot capability classification of the backing substrate. */
export const SNAPSHOT_SUPPORT_MODES = Object.freeze(['supported', 'not-supported'] as const);
export type SnapshotSupport = (typeof SNAPSHOT_SUPPORT_MODES)[number];

/** Content-addressed reference to a state snapshot. */
export interface StateSnapshotRef {
  readonly snapshotId: NeutralId;
  readonly digest: ContentDigest;
}

export function isStateSnapshotRef(value: unknown): value is StateSnapshotRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isNeutralId(candidate['snapshotId']) && isContentDigest(candidate['digest']);
}

/** Validate and freeze a snapshot reference. */
export function toStateSnapshotRef(value: {
  snapshotId: string;
  digest: string;
}): StateSnapshotRef {
  const record = expectFields(
    value,
    ['snapshotId', 'digest'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_SNAPSHOT,
    'state snapshot ref',
  );
  const snapshotId = toNeutralId(
    typeof record['snapshotId'] === 'string' ? record['snapshotId'] : '',
  );
  const digest = toContentDigest(typeof record['digest'] === 'string' ? record['digest'] : '');
  return Object.freeze({ snapshotId, digest });
}

/** The "initial state snapshot" declaration (ref + digest + support flag). */
export interface InitialStateDeclaration {
  readonly snapshot: StateSnapshotRef;
  readonly snapshotSupport: SnapshotSupport;
}

export function isInitialStateDeclaration(value: unknown): value is InitialStateDeclaration {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isStateSnapshotRef(candidate['snapshot']) &&
    typeof candidate['snapshotSupport'] === 'string' &&
    (SNAPSHOT_SUPPORT_MODES as readonly string[]).includes(candidate['snapshotSupport'])
  );
}

/** Validate and freeze the initial state declaration. */
export function toInitialStateDeclaration(value: {
  snapshot: { snapshotId: string; digest: string };
  snapshotSupport: string;
}): InitialStateDeclaration {
  const record = expectFields(
    value,
    ['snapshot', 'snapshotSupport'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_SNAPSHOT,
    'initial state',
  );
  const rawSnapshot = record['snapshot'];
  if (typeof rawSnapshot !== 'object' || rawSnapshot === null) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_SNAPSHOT, {
      message: 'initial state: snapshot must be a state snapshot ref object',
    });
  }
  const snapshot = toStateSnapshotRef(rawSnapshot as { snapshotId: string; digest: string });
  const snapshotSupport = expectEnumMember(
    record['snapshotSupport'],
    SNAPSHOT_SUPPORT_MODES,
    'snapshotSupport',
    ENVIRONMENT_ERROR_CODES.INVALID_SNAPSHOT,
    'initial state',
  );
  return Object.freeze({ snapshot, snapshotSupport });
}

/** True iff the substrate supports snapshot/restore machinery. */
export function supportsSnapshotRestore(state: InitialStateDeclaration): boolean {
  return state.snapshotSupport === 'supported';
}
