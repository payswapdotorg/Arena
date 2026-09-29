/**
 * VerifierRegistry tests (Work Order A013): registration discipline —
 * idempotent by digest, identity conflicts, lookups and queries.
 */

import { describe, expect, it } from 'vitest';
import { VERIFICATION_ERROR_CODES } from '@arena/verification';
import { VerifierRegistry } from './registry.js';
import { makeConstraintCheckVerifier } from './verifiers.js';
import { makeConstraintDescriptorInput } from './test-support.js';
import { createVerifierDescriptor } from '@arena/verification';

describe('VerifierRegistry', () => {
  it('registers verifiers and resolves them by digest', async () => {
    const registry = new VerifierRegistry();
    const descriptor = await createVerifierDescriptor(makeConstraintDescriptorInput());
    const hook = makeConstraintCheckVerifier();
    const registration = registry.registerVerifier(descriptor, hook);
    expect(registration.descriptor.digest).toBe(descriptor.digest);
    expect(registration.hook).toBe(hook);
    expect(registry.getVerifier(descriptor.digest)?.descriptor.digest).toBe(descriptor.digest);
    expect(registry.getVerifier('0'.repeat(64))).toBeUndefined();
    expect(registry.listVerifiers()).toHaveLength(1);
    expect(registry.listVerifiersByMethod('constraint_check')).toHaveLength(1);
    expect(registry.listVerifiersByMethod('simulation')).toHaveLength(0);
  });

  it('re-registration of the SAME descriptor is idempotent (first hook wins)', async () => {
    const registry = new VerifierRegistry();
    const descriptor = await createVerifierDescriptor(makeConstraintDescriptorInput());
    const first = makeConstraintCheckVerifier();
    const second = makeConstraintCheckVerifier();
    registry.registerVerifier(descriptor, first);
    const again = registry.registerVerifier(descriptor, second);
    expect(again.hook).toBe(first);
    expect(registry.listVerifiers()).toHaveLength(1);
  });

  it('a DIFFERENT digest under the same identity is a conflict (adversarial)', async () => {
    const registry = new VerifierRegistry();
    const input = makeConstraintDescriptorInput();
    const descriptor = await createVerifierDescriptor(input);
    registry.registerVerifier(descriptor, makeConstraintCheckVerifier());
    const mutated = await createVerifierDescriptor({
      ...input,
      outcomeSemantics: { ...input.outcomeSemantics, pass: 'mutated declaration' },
    });
    expect(() => registry.registerVerifier(mutated, makeConstraintCheckVerifier())).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.IDENTITY_CONFLICT }),
    );
  });

  it('structurally invalid descriptors are rejected', () => {
    const registry = new VerifierRegistry();
    expect(() => registry.registerVerifier({ digest: 'x' } as never, makeConstraintCheckVerifier())).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_DESCRIPTOR }),
    );
  });

  it('same id, different VERSION registers cleanly (versioning discipline)', async () => {
    const registry = new VerifierRegistry();
    const input = makeConstraintDescriptorInput();
    const v1 = await createVerifierDescriptor(input);
    const v2 = await createVerifierDescriptor({ ...input, version: '1.1.0' });
    registry.registerVerifier(v1, makeConstraintCheckVerifier());
    registry.registerVerifier(v2, makeConstraintCheckVerifier());
    expect(registry.listVerifiers()).toHaveLength(2);
  });
});
