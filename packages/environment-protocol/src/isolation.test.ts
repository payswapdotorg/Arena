/**
 * Isolation policy tests (Work Order A009 gate 6): ResourceLimits (bounded
 * CPU/memory/time — zero/negative rejected), NetworkPolicy (default-deny
 * egress, explicit allows), FilesystemPolicy (explicit mounts only, no
 * blanket write), SecretPolicy (isolation, declared injection points,
 * secrets never in canonical objects) and the least-privilege check.
 */

import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import {
  allowsEgress,
  declaresSecret,
  isFilesystemPolicy,
  isMountSpec,
  isNetworkPolicy,
  isResourceLimits,
  isSecretPolicy,
  isTimeLimits,
  isPathMounted,
  isPathWritable,
  toFilesystemPolicy,
  toNetworkPolicy,
  toResourceLimits,
  toSecretPolicy,
  toTimeLimits,
  toCheckpointRef,
  assertTimeLimitsFitWallClock,
} from './isolation.js';
import { DIGEST_C, makeDefinitionInput } from './test-support.js';
import { createEnvironmentDefinition } from './definition.js';

describe('resource limits (gate 6 — bounded CPU/memory/time)', () => {
  it('accepts positive integer bounds', () => {
    const limits = toResourceLimits({ cpuMillis: 1000, memoryMiB: 512, wallClockSeconds: 60 });
    expect(isResourceLimits(limits)).toBe(true);
    expect(Object.isFrozen(limits)).toBe(true);
  });

  it.each([
    { cpuMillis: 0, memoryMiB: 512, wallClockSeconds: 60 },
    { cpuMillis: -1, memoryMiB: 512, wallClockSeconds: 60 },
    { cpuMillis: 1.5, memoryMiB: 512, wallClockSeconds: 60 },
    { cpuMillis: 1000, memoryMiB: 0, wallClockSeconds: 60 },
    { cpuMillis: 1000, memoryMiB: -512, wallClockSeconds: 60 },
    { cpuMillis: 1000, memoryMiB: 512, wallClockSeconds: 0 },
    { cpuMillis: 1000, memoryMiB: 512, wallClockSeconds: -60 },
    { cpuMillis: '1000', memoryMiB: 512, wallClockSeconds: 60 },
  ] as unknown as readonly { cpuMillis: number; memoryMiB: number; wallClockSeconds: number }[])('rejects zero/negative/non-integer bounds %j', (bad) => {
    expect(() => toResourceLimits(bad)).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_RESOURCE_LIMITS }),
    );
    expect(isResourceLimits(bad)).toBe(false);
  });
});

describe('time limits (declare field 11)', () => {
  it('accepts positive budgets and freezes the object', () => {
    const limits = toTimeLimits({ startupSeconds: 30, cleanupGraceSeconds: 10, deadlineBehavior: 'hard-stop' });
    expect(isTimeLimits(limits)).toBe(true);
    expect(Object.isFrozen(limits)).toBe(true);
  });

  it.each([
    { startupSeconds: 0, cleanupGraceSeconds: 10, deadlineBehavior: 'hard-stop' },
    { startupSeconds: 30, cleanupGraceSeconds: 0, deadlineBehavior: 'hard-stop' },
    { startupSeconds: 30, cleanupGraceSeconds: 10, deadlineBehavior: 'soft' },
  ])('rejects invalid time limits %j', (bad) => {
    expect(() => toTimeLimits(bad)).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_TIME_LIMITS }),
    );
  });

  it('cleanup must fit inside the wall clock', () => {
    const time = toTimeLimits({ startupSeconds: 30, cleanupGraceSeconds: 120, deadlineBehavior: 'hard-stop' });
    const resources = toResourceLimits({ cpuMillis: 1000, memoryMiB: 512, wallClockSeconds: 60 });
    expect(() => assertTimeLimitsFitWallClock(time, resources)).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_TIME_LIMITS }),
    );
  });
});

describe('network policy (gate 6 — default-deny egress, explicit allows)', () => {
  it('default-deny with no allows is a valid fully-denied policy', () => {
    const policy = toNetworkPolicy({ egress: 'default-deny', allows: [] });
    expect(policy.egress).toBe('default-deny');
    expect(policy.allows).toEqual([]);
    expect(isNetworkPolicy(policy)).toBe(true);
  });

  it('explicit allows validate and freeze', () => {
    const policy = toNetworkPolicy({
      egress: 'default-deny',
      allows: [{ host: 'packages.internal', port: 443, protocol: 'https' }],
    });
    expect(policy.allows[0]?.host).toBe('packages.internal');
    expect(allowsEgress(policy, 'packages.internal', 443, 'https')).toBe(true);
    expect(allowsEgress(policy, 'packages.internal', 80, 'http')).toBe(false);
    expect(allowsEgress(policy, 'other.internal', 443, 'https')).toBe(false);
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('any other egress mode is rejected (no allow-all exists)', () => {
    expect(() => toNetworkPolicy({ egress: 'allow-all', allows: [] })).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_NETWORK_POLICY }),
    );
    expect(() => toNetworkPolicy({ egress: 'default-allow', allows: [] })).toThrowError(EnvironmentError);
  });

  it.each([
    { host: 'packages.internal', port: 0, protocol: 'https' },
    { host: 'packages.internal', port: 65536, protocol: 'https' },
    { host: 'packages.internal', port: 443.5, protocol: 'https' },
    { host: 'packages.internal', port: 443, protocol: 'grpc' },
    { host: 'Not A Host', port: 443, protocol: 'https' },
  ])('invalid allow entries are rejected: %j', (bad) => {
    expect(() => toNetworkPolicy({ egress: 'default-deny', allows: [bad] })).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_NETWORK_POLICY }),
    );
  });

  it('duplicate allows are rejected', () => {
    const allow = { host: 'packages.internal', port: 443, protocol: 'https' };
    expect(() => toNetworkPolicy({ egress: 'default-deny', allows: [allow, allow] })).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_NETWORK_POLICY }),
    );
  });
});

describe('filesystem policy (gate 6 — explicit mounts, no blanket write)', () => {
  it('declared mounts validate and freeze', () => {
    const policy = toFilesystemPolicy({
      writeMode: 'declared-mounts-only',
      mounts: [
        { mountPath: '/workspace', access: 'read-write', source: 'workspace' },
        { mountPath: '/task-inputs', access: 'read-only', source: 'initial-state' },
      ],
    });
    expect(isFilesystemPolicy(policy)).toBe(true);
    expect(isPathMounted(policy, '/workspace')).toBe(true);
    expect(isPathMounted(policy, '/workspace/out/file.txt')).toBe(true);
    expect(isPathWritable(policy, '/workspace')).toBe(true);
    expect(isPathWritable(policy, '/workspace/deep/file')).toBe(true);
    expect(isPathWritable(policy, '/task-inputs')).toBe(false);
    expect(isPathMounted(policy, '/elsewhere')).toBe(false);
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('blanket write modes do not exist in the vocabulary', () => {
    expect(() =>
      toFilesystemPolicy({ writeMode: 'read-write-anywhere', mounts: [] }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_FILESYSTEM_POLICY }),
    );
    expect(() => toFilesystemPolicy({ writeMode: 'read-write', mounts: [] })).toThrowError(
      EnvironmentError,
    );
  });

  it('read-write mounts require the declared-mounts-only mode (contradiction)', () => {
    expect(() =>
      toFilesystemPolicy({
        writeMode: 'read-only',
        mounts: [{ mountPath: '/workspace', access: 'read-write', source: 'workspace' }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_FILESYSTEM_POLICY }),
    );
  });

  it.each([
    { mountPath: 'relative', access: 'read-only', source: 'workspace' },
    { mountPath: '/a/../b', access: 'read-only', source: 'workspace' },
    { mountPath: '/workspace', access: 'write', source: 'workspace' },
    { mountPath: '/workspace', access: 'read-only', source: 'network-drive' },
  ])('invalid mount specs are rejected: %j', (bad) => {
    expect(() => toFilesystemPolicy({ writeMode: 'read-only', mounts: [bad] })).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_FILESYSTEM_POLICY }),
    );
    expect(isMountSpec(bad)).toBe(false);
  });

  it('duplicate mount paths are rejected', () => {
    const mount = { mountPath: '/workspace', access: 'read-only', source: 'workspace' };
    expect(() =>
      toFilesystemPolicy({ writeMode: 'read-only', mounts: [mount, mount] }),
    ).toThrowError(EnvironmentError);
  });
});

describe('secret policy (gate 6 — secret isolation, reference-only)', () => {
  it('declared injection points validate and freeze', () => {
    const policy = toSecretPolicy({
      isolation: 'isolation-boundary',
      injectionPoints: [
        { secretId: 'signing-reference', mountPath: '/bindings/signing', mechanism: 'file-mount' },
      ],
    });
    expect(isSecretPolicy(policy)).toBe(true);
    expect(declaresSecret(policy, 'signing-reference')).toBe(true);
    expect(declaresSecret(policy, 'unknown-reference')).toBe(false);
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('value-carrying field names are rejected (secrets never enter canonical objects)', () => {
    expect(() =>
      toSecretPolicy({
        isolation: 'isolation-boundary',
        injectionPoints: [
          { secretId: 'ref', mountPath: '/b', mechanism: 'file-mount', value: 'x' } as unknown as {
            secretId: string;
            mountPath: string;
            mechanism: string;
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_SECRET_POLICY }),
    );
    expect(() =>
      toSecretPolicy({
        isolation: 'isolation-boundary',
        injectionPoints: [
          { secretId: 'ref', mountPath: '/b', mechanism: 'file-mount', apiKey: 'x' } as unknown as {
            secretId: string;
            mountPath: string;
            mechanism: string;
          },
        ],
      }),
    ).toThrowError(EnvironmentError);
  });

  it('unknown mechanisms and isolation modes are rejected', () => {
    expect(() =>
      toSecretPolicy({
        isolation: 'shared-heap',
        injectionPoints: [],
      }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_SECRET_POLICY }),
    );
    expect(() =>
      toSecretPolicy({
        isolation: 'isolation-boundary',
        injectionPoints: [
          { secretId: 'ref', mountPath: '/b', mechanism: 'telepathy' },
        ],
      }),
    ).toThrowError(EnvironmentError);
  });

  it('the definition-level guard rejects secret material anywhere in the input', async () => {
    const input = makeDefinitionInput() as unknown as Record<string, unknown>;
    const seedPolicy = input['seedPolicy'] as Record<string, unknown>;
    seedPolicy['password'] = 'hunter2';
    await expect(
      createEnvironmentDefinition(input as unknown as Parameters<typeof createEnvironmentDefinition>[0]),
    ).rejects.toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.CREDENTIAL_REJECTED }),
    );
  });
});

describe('checkpoint refs (shared isolation/lifecycle object)', () => {
  it('validates and freezes a checkpoint ref', () => {
    const ref = toCheckpointRef({ checkpointId: 'checkpoint-phase-1', digest: DIGEST_C });
    expect(ref.checkpointId).toBe('checkpoint-phase-1');
    expect(Object.isFrozen(ref)).toBe(true);
  });

  it('rejects malformed refs', () => {
    expect(() => toCheckpointRef({ checkpointId: 'BAD', digest: DIGEST_C })).toThrowError(EnvironmentError);
    expect(() => toCheckpointRef({ checkpointId: 'ok', digest: 'nope' })).toThrowError(EnvironmentError);
  });
});
