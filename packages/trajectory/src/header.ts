/**
 * TrajectoryHeader — the content-addressed declaration of a trajectory
 * (Work Order A011 gate 2; spec ENV1.0 "Evidence"; requirements R10, R11;
 * docs/architecture.md §5).
 *
 * A header binds:
 *   - the trajectory's own neutral id (`trajectoryId`);
 *   - the run it records, via the four RunAddress-shaped digest refs of
 *     TrajectoryRunRef (task version, environment version, run id,
 *     initial snapshot digest — plus the optional A010 RunRecord digest
 *     pin; see run-ref.ts);
 *   - the acting agent/body by DIGEST (`agentBodyRef` — the A003
 *     BodyVersion/AgentBody digest: a model is a cognitive substrate,
 *     NOT the durable identity of a professional Agent Body);
 *   - the cognitive substrate by DIGEST (`substrateRef` — the A016
 *     model-substrate declaration digest);
 *   - `startedAt` — when the recorded activity began;
 *   - `seed` — the deterministic seed the run declared (or null when the
 *     environment's seed policy admits none; mirrors A010 RunRecord).
 *
 * Content addressing: the sha256 digest is computed over the canonical
 * JSON serialization of the digest-free view with @arena/protocol-core's
 * digestCanonical — NEVER reimplemented here. Same header ⇒ same digest;
 * ANY field change ⇒ a different digest (gate 2 tests). The header is
 * deep-frozen at creation — there is no mutation API.
 */

import { digestCanonical } from '@arena/protocol-core';
import { TRAJECTORY_ERROR_CODES, TrajectoryError } from './errors.js';
import type { TrajectoryRunRef } from './run-ref.js';
import { isTrajectoryRunRef, toTrajectoryRunRef } from './run-ref.js';
import type { TrajectoryRunRefInput } from './run-ref.js';
import {
  deepFreeze,
  expectFields,
  isContentDigest,
  isTrajectorySeed,
  isTrajectoryTimestamp,
  toContentDigest,
  toTrajectorySeed,
  toTrajectoryTimestamp,
} from './shared.js';
import type { ContentDigest, TrajectoryId, TrajectorySeed, TrajectoryTimestamp } from './shared.js';
import { toTrajectoryId } from './shared.js';

/** Wire version of the trajectory header shape. */
export const TRAJECTORY_HEADER_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// TrajectoryHeader
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the header digest commits to. */
export interface TrajectoryHeaderView {
  readonly recordVersion: typeof TRAJECTORY_HEADER_VERSION;
  readonly trajectoryId: TrajectoryId;
  readonly run: TrajectoryRunRef;
  /** Digest of the acting agent/body version (A003 — digest-addressed). */
  readonly agentBodyRef: ContentDigest;
  /** Digest of the cognitive substrate declaration (A016). */
  readonly substrateRef: ContentDigest;
  readonly startedAt: TrajectoryTimestamp;
  readonly seed: TrajectorySeed | null;
}

/** A frozen trajectory header: the view plus its sha256 content digest. */
export interface TrajectoryHeader extends TrajectoryHeaderView {
  readonly digest: ContentDigest;
}

/** Stable field list for the header view (tests + contracts mirror it). */
export const TRAJECTORY_HEADER_FIELDS = Object.freeze([
  'recordVersion',
  'trajectoryId',
  'run',
  'agentBodyRef',
  'substrateRef',
  'startedAt',
  'seed',
] as const) as readonly string[];

export interface CreateTrajectoryHeaderInput {
  readonly trajectoryId: string;
  readonly run: TrajectoryRunRefInput;
  readonly agentBodyRef: string;
  readonly substrateRef: string;
  readonly startedAt: string;
  readonly seed: string | null;
}

/** Structural (non-throwing) check for the digest-free view. */
export function isTrajectoryHeaderView(value: unknown): value is TrajectoryHeaderView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === TRAJECTORY_HEADER_VERSION &&
    typeof candidate['trajectoryId'] === 'string' &&
    /^[a-z][a-z0-9-]{0,63}$/.test(candidate['trajectoryId']) &&
    isTrajectoryRunRef(candidate['run']) &&
    isContentDigest(candidate['agentBodyRef']) &&
    isContentDigest(candidate['substrateRef']) &&
    isTrajectoryTimestamp(candidate['startedAt']) &&
    (candidate['seed'] === null || isTrajectorySeed(candidate['seed']))
  );
}

/** Structural (non-throwing) check for the full header (view + digest). */
export function isTrajectoryHeader(value: unknown): value is TrajectoryHeader {
  if (!isTrajectoryHeaderView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed trajectory header.
 * Throws a typed TrajectoryError on any malformed input.
 */
export async function createTrajectoryHeader(
  input: CreateTrajectoryHeaderInput,
): Promise<TrajectoryHeader> {
  const record = expectFields(
    input,
    [
      'trajectoryId',
      'run',
      'agentBodyRef',
      'substrateRef',
      'startedAt',
      'seed',
    ],
    [],
    TRAJECTORY_ERROR_CODES.INVALID_HEADER,
    'trajectory header',
  );

  const trajectoryId = toTrajectoryId(
    typeof record['trajectoryId'] === 'string' ? record['trajectoryId'] : '',
  );
  const rawRun = record['run'];
  if (typeof rawRun !== 'object' || rawRun === null) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_RUN_REF, {
      message: 'trajectory header: run must be a trajectory run ref',
    });
  }
  const run = toTrajectoryRunRef(rawRun as TrajectoryRunRefInput);
  const agentBodyRef = toContentDigest(
    typeof record['agentBodyRef'] === 'string' ? record['agentBodyRef'] : '',
    'trajectory header agentBodyRef',
  );
  const substrateRef = toContentDigest(
    typeof record['substrateRef'] === 'string' ? record['substrateRef'] : '',
    'trajectory header substrateRef',
  );
  const startedAt = toTrajectoryTimestamp(
    typeof record['startedAt'] === 'string' ? record['startedAt'] : '',
    'trajectory header startedAt',
  );
  const rawSeed = record['seed'];
  if (rawSeed !== null && typeof rawSeed !== 'string') {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_HEADER, {
      message: 'trajectory header: seed must be a neutral seed string or null',
    });
  }
  const seed = rawSeed === null ? null : toTrajectorySeed(rawSeed);

  const view: TrajectoryHeaderView = {
    recordVersion: TRAJECTORY_HEADER_VERSION,
    trajectoryId,
    run,
    agentBodyRef,
    substrateRef,
    startedAt,
    seed,
  };
  const digest = toContentDigest(await digestCanonical(view), 'trajectory header digest');
  return deepFreeze({ ...view, digest }) as TrajectoryHeader;
}

/** The digest-free view of a header (what the digest commits to). */
export function trajectoryHeaderView(header: TrajectoryHeader): TrajectoryHeaderView {
  const { digest: _digest, ...view } = header;
  return deepFreeze({ ...view }) as TrajectoryHeaderView;
}

/**
 * Verify a trajectory header: recompute the digest over the digest-free
 * view and compare (optionally against an expected digest). Throws
 * TRAJECTORY_TAMPERED on any mismatch.
 */
export async function verifyTrajectoryHeader(
  header: TrajectoryHeader,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isTrajectoryHeader(header)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_HEADER, {
      message: 'trajectory header verification requires a structurally valid header',
    });
  }
  const actual = await digestCanonical(trajectoryHeaderView(header));
  if (actual !== header.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.TAMPERED, {
      message: `trajectory header digest mismatch: expected ${expectedDigest ?? header.digest}, got ${actual}`,
      details: {
        trajectoryId: header.trajectoryId,
        expected: expectedDigest ?? header.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'verified header digest');
}
