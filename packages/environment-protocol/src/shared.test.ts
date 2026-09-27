/**
 * Shared primitive tests: pattern sources, validators, strict shape
 * enforcement (missing + unknown fields), deep freeze, runtime-neutrality
 * guard and the secret-material guard (positive + negative).
 */

import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import {
  assertNoSecretMaterialFields,
  assertRuntimeNeutralString,
  assertRuntimeNeutralTree,
  containsRuntimeLeak,
  deepFreeze,
  expectFields,
  isHostname,
  isMountPath,
  isNeutralId,
  isNeutralText,
  toHostname,
  toMountPath,
  toNeutralId,
  toNeutralText,
} from './shared.js';

describe('pattern validators (positive)', () => {
  it('accepts canonical values', () => {
    expect(isNeutralId('run-0001')).toBe(true);
    expect(isMountPath('/')).toBe(true);
    expect(isMountPath('/workspace/out')).toBe(true);
    expect(isHostname('packages.internal')).toBe(true);
    expect(isHostname('host-1')).toBe(true);
    expect(isNeutralText('a normal description')).toBe(true);
  });
});

describe('pattern validators (negative)', () => {
  it('rejects malformed values with structured errors', () => {
    expect(() => toNeutralId('Bad_ID')).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_IDENTITY }),
    );
    expect(() => toMountPath('relative/path')).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_FILESYSTEM_POLICY }),
    );
    expect(isMountPath('/a/../b')).toBe(false);
    expect(isMountPath('/a/./b')).toBe(false);
    expect(() => toHostname('Not A Host')).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_NETWORK_POLICY }),
    );
    expect(isHostname('-bad')).toBe(false);
    expect(() => toNeutralText('', 'field')).toThrowError(EnvironmentError);
    // 513 characters exceeds the 512 bound:
    expect(() => toNeutralText('a'.repeat(513), 'field')).toThrowError(EnvironmentError);
  });
});

describe('strict shape enforcement', () => {
  it('missing required fields are rejected', () => {
    expect(() =>
      expectFields({ a: 1 }, ['a', 'b'], [], ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION, 'ctx'),
    ).toThrowError(
      expect.objectContaining({
        code: ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION,
        message: expect.stringContaining("missing required field 'b'"),
      }),
    );
  });

  it('unknown fields are rejected (additionalProperties: false semantics)', () => {
    expect(() =>
      expectFields({ a: 1, z: 2 }, ['a'], [], ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION, 'ctx'),
    ).toThrowError(
      expect.objectContaining({ message: expect.stringContaining("unknown field 'z'") }),
    );
  });

  it('optional fields may be absent but must be declared', () => {
    expect(() =>
      expectFields({ a: 1 }, ['a'], ['note'], ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION, 'ctx'),
    ).not.toThrow();
    expect(() =>
      expectFields({ a: 1, note: 'x', extra: true }, ['a'], ['note'], ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION, 'ctx'),
    ).toThrowError(EnvironmentError);
  });

  it('non-objects are rejected', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      expect(() =>
        expectFields(bad, ['a'], [], ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION, 'ctx'),
      ).toThrowError(EnvironmentError);
    }
  });
});

describe('deep freeze', () => {
  it('freezes nested objects and arrays', () => {
    const frozen = deepFreeze({ a: { b: [{ c: 1 }] } });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.a)).toBe(true);
    expect(Object.isFrozen(frozen.a.b)).toBe(true);
    expect(Object.isFrozen(frozen.a.b[0])).toBe(true);
  });

  it('leaves primitives alone', () => {
    expect(deepFreeze(42)).toBe(42);
    expect(deepFreeze(null)).toBeNull();
  });
});

describe('runtime neutrality guard (gate 10, construction side)', () => {
  it('detects the gate-listed runner/provider tokens', () => {
    for (const leak of [
      'docker',
      'k8s-cluster',
      'podman-machine',
      'firecracker-vm',
      'aws-region',
      'gcp-project',
      'azure-subscription',
      'containerd-runtime',
      'runc-binary',
      'gvisor-sandbox',
      'qemu-image',
      'vmware-host',
      'kubernetes-namespace',
    ]) {
      expect(containsRuntimeLeak(leak), leak).toBe(true);
    }
  });

  it('does not false-positive on protocol vocabulary', () => {
    for (const clean of [
      'engineering-sandbox',
      'packages.internal',
      'isolation-boundary',
      'content-addressed-image',
      'snapshot-initial',
      'the environment governs all flows',
      'some flaws remain',
    ]) {
      expect(containsRuntimeLeak(clean), clean).toBe(false);
    }
  });

  it('assertRuntimeNeutralString throws ENVIRONMENT_RUNTIME_LEAKAGE', () => {
    expect(() => assertRuntimeNeutralString('pull from docker hub', 'image.note')).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.RUNTIME_LEAKAGE }),
    );
  });

  it('assertRuntimeNeutralTree walks every string in a tree', () => {
    expect(() =>
      assertRuntimeNeutralTree({ a: { b: ['fine', 'podman note'] } }),
    ).toThrowError(EnvironmentError);
    expect(() => assertRuntimeNeutralTree({ a: { b: ['fine', 'still fine'] } })).not.toThrow();
  });
});

describe('secret-material guard (gate 6, construction side)', () => {
  it('accepts legitimate reference vocabulary (secretId, secretPolicy)', () => {
    expect(() =>
      assertNoSecretMaterialFields({ secretPolicy: { injectionPoints: [{ secretId: 'ref-1' }] } }),
    ).not.toThrow();
  });

  it('rejects value-carrying field names anywhere in the tree', () => {
    for (const field of [
      'value',
      'secret',
      'plaintext',
      'password',
      'token',
      'credential',
      'apiKey',
      'api_key',
      'clientSecret',
      'secretValue',
      'accessToken',
    ]) {
      expect(() => assertNoSecretMaterialFields({ [field]: 'x' }, 'input'), field).toThrowError(
        expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.CREDENTIAL_REJECTED }),
      );
    }
  });

  it('rejects nested credential-shaped compounds', () => {
    expect(() =>
      assertNoSecretMaterialFields({ policy: { mounts: [{ privateKey: 'x' }] } }),
    ).toThrowError(EnvironmentError);
    expect(() =>
      assertNoSecretMaterialFields({ list: [{ fine: 'x' }, { bearerToken: 'y' }] }),
    ).toThrowError(EnvironmentError);
  });
});
