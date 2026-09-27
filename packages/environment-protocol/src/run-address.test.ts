/**
 * RunAddress tests (Work Order A009 gate 5 — evidence addressability):
 * every part required; construction fails closed on any missing/malformed
 * part; the address is deep-frozen and carries a stable key.
 */

import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import {
  isRunAddress,
  isTaskVersionRef,
  runAddressKey,
  toRunAddress,
  toTaskVersionRef,
} from './run-address.js';
import { DIGEST_A, DIGEST_B, DIGEST_C, DIGEST_D } from './test-support.js';

const FULL_ADDRESS = {
  taskVersion: { taskId: 'task-build-website', version: '2.1.0' },
  environmentVersion: {
    namespace: 'tenant-a',
    name: 'engineering-sandbox',
    version: '1.2.0',
    digest: DIGEST_A,
  },
  runId: 'run-000042',
  initialSnapshotDigest: DIGEST_B,
  trajectoryDigest: DIGEST_C,
  evidenceDigests: [DIGEST_D, DIGEST_A],
};

describe('task version ref', () => {
  it('validates and freezes', () => {
    const ref = toTaskVersionRef({ taskId: 'task-build-website', version: '2.1.0' });
    expect(isTaskVersionRef(ref)).toBe(true);
    expect(Object.isFrozen(ref)).toBe(true);
  });

  it('rejects malformed ids and versions', () => {
    expect(() => toTaskVersionRef({ taskId: 'BAD', version: '1.0.0' })).toThrowError(EnvironmentError);
    expect(() => toTaskVersionRef({ taskId: 'ok', version: 'has spaces' })).toThrowError(EnvironmentError);
  });
});

describe('run address (gate 5 — all parts required)', () => {
  it('a full address validates and deep-freezes', () => {
    const address = toRunAddress(FULL_ADDRESS);
    expect(isRunAddress(address)).toBe(true);
    expect(address.evidenceDigests).toHaveLength(2);
    expect(Object.isFrozen(address)).toBe(true);
    expect(Object.isFrozen(address.evidenceDigests)).toBe(true);
    expect(Object.isFrozen(address.environmentVersion)).toBe(true);
    expect(runAddressKey(address)).toContain('run:run-000042');
    expect(runAddressKey(address)).toContain('task:task-build-website@2.1.0');
    expect(runAddressKey(address)).toContain('trajectory');
  });

  it.each([
    ['taskVersion'],
    ['environmentVersion'],
    ['runId'],
    ['initialSnapshotDigest'],
    ['trajectoryDigest'],
    ['evidenceDigests'],
  ])('missing %s is rejected (construction fails)', (field) => {
    const partial = { ...FULL_ADDRESS } as unknown as Record<string, unknown>;
    delete partial[field];
    expect(() =>
      toRunAddress(partial as unknown as Parameters<typeof toRunAddress>[0]),
    ).toThrowError(
      expect.objectContaining({
        code: ENVIRONMENT_ERROR_CODES.INVALID_RUN_ADDRESS,
        message: expect.stringContaining(String(field)),
      }),
    );
  });

  it('an empty evidence digest list is rejected (evidence outputs are part of the address)', () => {
    expect(() =>
      toRunAddress({ ...FULL_ADDRESS, evidenceDigests: [] }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_RUN_ADDRESS }),
    );
  });

  it('malformed digests anywhere are rejected', () => {
    expect(() =>
      toRunAddress({ ...FULL_ADDRESS, initialSnapshotDigest: 'nope' }),
    ).toThrowError(EnvironmentError);
    expect(() =>
      toRunAddress({ ...FULL_ADDRESS, evidenceDigests: [DIGEST_D, 'nope'] }),
    ).toThrowError(EnvironmentError);
    expect(() =>
      toRunAddress({
        ...FULL_ADDRESS,
        environmentVersion: { ...FULL_ADDRESS.environmentVersion, digest: 'zzz' },
      }),
    ).toThrowError(EnvironmentError);
  });

  it('malformed environment version refs are rejected (strict shape)', () => {
    expect(() =>
      toRunAddress({
        ...FULL_ADDRESS,
        environmentVersion: {
          namespace: 'tenant-a',
          name: 'engineering-sandbox',
          version: '1.2.0',
        } as unknown as typeof FULL_ADDRESS.environmentVersion,
      }),
    ).toThrowError(EnvironmentError);
    expect(() =>
      toRunAddress({
        ...FULL_ADDRESS,
        environmentVersion: {
          namespace: 'tenant-a',
          name: 'engineering-sandbox',
          version: '1.2.0',
          digest: DIGEST_B,
          registry: 'somewhere',
        } as unknown as typeof FULL_ADDRESS.environmentVersion,
      }),
    ).toThrowError(EnvironmentError);
  });

  it('isRunAddress rejects malformed structures', () => {
    expect(isRunAddress(null)).toBe(false);
    expect(isRunAddress({})).toBe(false);
    expect(isRunAddress({ ...FULL_ADDRESS, runId: 'BAD' })).toBe(false);
    expect(
      isRunAddress({ ...FULL_ADDRESS, taskVersion: { taskId: 'x', version: 1 } }),
    ).toBe(false);
  });
});
