/**
 * TrajectoryHeader tests — content addressing, digest determinism
 * (same header ⇒ same digest; ANY field change ⇒ a different digest),
 * positive AND negative paths (Work Order A011 gates 2, 11).
 */

import { describe, expect, it } from 'vitest';
import { digestCanonical } from '@arena/protocol-core';
import {
  TRAJECTORY_HEADER_FIELDS,
  TRAJECTORY_HEADER_VERSION,
  createTrajectoryHeader,
  isTrajectoryHeader,
  isTrajectoryHeaderView,
  trajectoryHeaderView,
  verifyTrajectoryHeader,
} from './header.js';
import { TRAJECTORY_ERROR_CODES } from './errors.js';
import { DIGEST_A, DIGEST_D, makeHeaderInput } from './test-support.js';

describe('createTrajectoryHeader (positive paths)', () => {
  it('creates a validated, deep-frozen, content-addressed header', async () => {
    const header = await createTrajectoryHeader(makeHeaderInput());
    expect(header.recordVersion).toBe(TRAJECTORY_HEADER_VERSION);
    expect(header.trajectoryId).toBe('trajectory-000042');
    expect(header.agentBodyRef).toBe(DIGEST_D);
    expect(header.seed).toBe('seed-1234');
    expect(header.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(header)).toBe(true);
    expect(Object.isFrozen(header.run)).toBe(true);
    expect(Object.isFrozen(header.run.taskVersion)).toBe(true);
  });

  it('same header ⇒ same digest (gate 2 determinism test)', async () => {
    const a = await createTrajectoryHeader(makeHeaderInput());
    const b = await createTrajectoryHeader(makeHeaderInput());
    expect(a.digest).toBe(b.digest);
    // and the digest is exactly the canonical sha256 of the digest-free view
    expect(a.digest).toBe(await digestCanonical(trajectoryHeaderView(a)));
  });

  it('ANY field change ⇒ a different digest', async () => {
    const base = await createTrajectoryHeader(makeHeaderInput());
    const variants = await Promise.all([
      createTrajectoryHeader(makeHeaderInput({ trajectoryId: 'trajectory-000043' })),
      createTrajectoryHeader(makeHeaderInput({ taskVersion: '2.1.1' })),
      createTrajectoryHeader(makeHeaderInput({ environmentDigest: DIGEST_A.replace(/^1/, '9') })),
      createTrajectoryHeader(makeHeaderInput({ runKey: 'run-000043' })),
      createTrajectoryHeader(makeHeaderInput({ initialSnapshotDigest: DIGEST_A })),
      createTrajectoryHeader(makeHeaderInput({ runRecordDigest: null })),
      createTrajectoryHeader(makeHeaderInput({ agentBodyRef: DIGEST_A })),
      createTrajectoryHeader(makeHeaderInput({ substrateRef: DIGEST_D })),
      createTrajectoryHeader(makeHeaderInput({ startedAt: '2026-01-15T09:30:01.000Z' })),
      createTrajectoryHeader(makeHeaderInput({ seed: 'seed-5678' })),
      createTrajectoryHeader(makeHeaderInput({ seed: null })),
    ]);
    for (const variant of variants) {
      expect(variant.digest).not.toBe(base.digest);
    }
    // sanity: all variants distinct pairwise for the mutated fields
    expect(new Set(variants.map((v) => v.digest)).size).toBe(variants.length);
  });

  it('accepts a null seed (environments whose seed policy admits none)', async () => {
    const header = await createTrajectoryHeader(makeHeaderInput({ seed: null }));
    expect(header.seed).toBeNull();
  });
});

describe('createTrajectoryHeader (negative paths)', () => {
  it('rejects missing required fields and unknown fields', async () => {
    const input = makeHeaderInput() as unknown as Record<string, unknown>;
    delete input.startedAt;
    await expect(createTrajectoryHeader(input as never)).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_HEADER }),
    );
    await expect(
      createTrajectoryHeader({ ...makeHeaderInput(), rogue: 1 } as never),
    ).rejects.toThrowError(/unknown field 'rogue'/);
  });

  it('rejects invalid trajectory ids, digests, timestamps and seeds', async () => {
    await expect(createTrajectoryHeader(makeHeaderInput({ trajectoryId: 'UPPER' }))).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_IDENTITY }),
    );
    await expect(createTrajectoryHeader(makeHeaderInput({ agentBodyRef: 'x' }))).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_DIGEST }),
    );
    await expect(createTrajectoryHeader(makeHeaderInput({ startedAt: 'yesterday' }))).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_TIMESTAMP }),
    );
    await expect(createTrajectoryHeader(makeHeaderInput({ seed: 'bad seed' }))).rejects.toThrowError(
      /seed/,
    );
    await expect(
      createTrajectoryHeader({ ...makeHeaderInput(), seed: 42 } as never),
    ).rejects.toThrowError(/seed must be a neutral seed string or null/);
  });

  it('rejects a malformed run ref with the run-ref error code', async () => {
    await expect(
      createTrajectoryHeader(
        makeHeaderInput({ initialSnapshotDigest: 'not-a-digest' }),
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_DIGEST }),
    );
  });
});

describe('structural predicates', () => {
  it('isTrajectoryHeaderView / isTrajectoryHeader discriminate', async () => {
    const header = await createTrajectoryHeader(makeHeaderInput());
    expect(isTrajectoryHeaderView(trajectoryHeaderView(header))).toBe(true);
    expect(isTrajectoryHeader(header)).toBe(true);
    expect(isTrajectoryHeader(trajectoryHeaderView(header))).toBe(false); // no digest
    expect(isTrajectoryHeader(null)).toBe(false);
    expect(isTrajectoryHeaderView({ ...trajectoryHeaderView(header), recordVersion: 2 } as never)).toBe(false);
    expect(isTrajectoryHeader({ ...header, digest: 'x'.repeat(64) })).toBe(false);
  });
});

describe('trajectoryHeaderView / verifyTrajectoryHeader', () => {
  it('the view excludes exactly the digest', async () => {
    const header = await createTrajectoryHeader(makeHeaderInput());
    const view = trajectoryHeaderView(header);
    expect(Object.keys(view).sort()).toEqual([...TRAJECTORY_HEADER_FIELDS].sort());
    expect('digest' in view).toBe(false);
  });

  it('verification recomputes and confirms the digest', async () => {
    const header = await createTrajectoryHeader(makeHeaderInput());
    await expect(verifyTrajectoryHeader(header)).resolves.toBe(header.digest);
    await expect(verifyTrajectoryHeader(header, header.digest)).resolves.toBe(header.digest);
  });

  it('verification throws TAMPERED on digest mismatch or pin mismatch', async () => {
    const header = await createTrajectoryHeader(makeHeaderInput());
    const tampered = { ...header, trajectoryId: 'trajectory-hacked' } as never;
    await expect(verifyTrajectoryHeader(tampered)).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.TAMPERED }),
    );
    await expect(verifyTrajectoryHeader(header, '0'.repeat(64))).rejects.toThrowError(
      /digest mismatch/,
    );
    await expect(verifyTrajectoryHeader(null as never)).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_HEADER }),
    );
  });
});
