/**
 * VerifierDescriptor tests (Work Order A013): construction, content
 * addressing, closed-method rejection, reproducibility-policy
 * consistency, required-evidence validation, tamper detection and
 * identity keys.
 */

import { describe, expect, it } from 'vitest';
import { VERIFICATION_ERROR_CODES } from './errors.js';
import {
  REPRODUCIBILITY_POLICIES,
  VERIFIER_DESCRIPTOR_FIELDS,
  VERIFIER_ID_PATTERN_SOURCE,
  VERIFIER_PROVENANCE_FIELDS,
  VERIFIER_REPRODUCIBILITY_FIELDS,
  createVerifierDescriptor,
  isVerifierDescriptor,
  isVerifierDescriptorView,
  recomputeVerifierDescriptorDigest,
  verifierDescriptorView,
  verifierIdentityKey,
} from './descriptor.js';
import { makeDescriptorInput } from './test-support.js';

describe('createVerifierDescriptor (positive path)', () => {
  it('builds a frozen, content-addressed descriptor with the declared fields', async () => {
    const descriptor = await createVerifierDescriptor(makeDescriptorInput());
    expect([...VERIFIER_DESCRIPTOR_FIELDS]).toEqual([
      'recordVersion',
      'verifierId',
      'version',
      'method',
      'requiredEvidence',
      'outcomeSemantics',
      'reproducibility',
      'inputSchema',
      'outputSchema',
      'provenance',
    ]);
    expect(descriptor.recordVersion).toBe(1);
    expect(descriptor.verifierId).toBe('verifier-000042');
    expect(descriptor.method).toBe('constraint_check');
    expect(descriptor.requiredEvidence).toHaveLength(2);
    expect(descriptor.outcomeSemantics.pass).toContain('every declared requirement');
    expect(descriptor.reproducibility.policy).toBe('deterministic');
    expect(descriptor.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.requiredEvidence)).toBe(true);
    expect(isVerifierDescriptor(descriptor)).toBe(true);
    expect(isVerifierDescriptorView(verifierDescriptorView(descriptor))).toBe(true);
  });

  it('is deterministic: same input ⇒ same digest; any change ⇒ different digest', async () => {
    const input = makeDescriptorInput();
    const a = await createVerifierDescriptor(input);
    const b = await createVerifierDescriptor(input);
    expect(a.digest).toBe(b.digest);
    const changed = await createVerifierDescriptor({
      ...input,
      verifierId: 'verifier-000043',
    });
    expect(changed.digest).not.toBe(a.digest);
    const changedSemantics = await createVerifierDescriptor({
      ...input,
      outcomeSemantics: { ...input.outcomeSemantics, pass: 'different declaration' },
    });
    expect(changedSemantics.digest).not.toBe(a.digest);
  });

  it('recomputeVerifierDescriptorDigest passes on honest descriptors', async () => {
    const descriptor = await createVerifierDescriptor(makeDescriptorInput());
    await expect(recomputeVerifierDescriptorDigest(descriptor)).resolves.toBe(descriptor.digest);
  });

  it('tamper detection: a mutated descriptor fails recomputation', async () => {
    const descriptor = await createVerifierDescriptor(makeDescriptorInput());
    const tampered = {
      ...descriptor,
      requiredEvidence: [
        ...descriptor.requiredEvidence,
        descriptor.requiredEvidence[0],
      ],
    } as typeof descriptor;
    await expect(recomputeVerifierDescriptorDigest(tampered)).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.TAMPERED }),
    );
  });

  it('identity key is verifierId@version', async () => {
    const descriptor = await createVerifierDescriptor(makeDescriptorInput());
    expect(verifierIdentityKey(descriptor)).toBe('verifier-000042@1.0.0');
  });
});

describe('closed vocabularies enforced at construction (negative gates)', () => {
  it('unknown methods are rejected (INVALID_METHOD)', async () => {
    await expect(createVerifierDescriptor(makeDescriptorInput({ method: 'heuristic' }))).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_METHOD }),
    );
  });

  it('empty required-evidence declarations are rejected', async () => {
    await expect(createVerifierDescriptor(makeDescriptorInput({ requirements: [] }))).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_REQUIREMENT }),
    );
  });

  it('duplicate requirement ids are rejected', async () => {
    const duplicate = [
      { requirementId: 'req-1', evidenceKind: 'test-report', claim: 'a', artifact: null, requiredProducer: null },
      { requirementId: 'req-1', evidenceKind: 'test-report', claim: 'b', artifact: null, requiredProducer: null },
    ];
    await expect(createVerifierDescriptor(makeDescriptorInput({ requirements: duplicate }))).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.DUPLICATE_REQUIREMENT }),
    );
  });

  it('unknown descriptor fields are rejected (strict shape)', async () => {
    const input = makeDescriptorInput() as unknown as Record<string, unknown>;
    input['confidence'] = 0.9; // the OTHER protocol's field — must not sneak in
    await expect(createVerifierDescriptor(input as never)).rejects.toThrowError(
      /unknown field 'confidence'/,
    );
  });
});

describe('reproducibility policy consistency', () => {
  it('the closed policy vocabulary', () => {
    expect([...REPRODUCIBILITY_POLICIES]).toEqual([
      'deterministic',
      'seeded-stochastic',
      'provider-dependent',
    ]);
    expect([...VERIFIER_REPRODUCIBILITY_FIELDS]).toEqual(['policy', 'seed', 'parameters']);
  });

  it('deterministic ⇒ NO seed (rejected when a seed is supplied)', async () => {
    await expect(
      createVerifierDescriptor(makeDescriptorInput({ policy: 'deterministic', seed: 'seed-1' })),
    ).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_REPRODUCIBILITY }),
    );
  });

  it('seeded-stochastic ⇒ seed REQUIRED', async () => {
    await expect(
      createVerifierDescriptor(makeDescriptorInput({ policy: 'seeded-stochastic', seed: null })),
    ).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_REPRODUCIBILITY }),
    );
    const seeded = await createVerifierDescriptor(
      makeDescriptorInput({ policy: 'seeded-stochastic', seed: 'seed-1234' }),
    );
    expect(seeded.reproducibility.seed).toBe('seed-1234');
  });

  it('provider-dependent ⇒ seed optional, parameters recorded', async () => {
    const noSeed = await createVerifierDescriptor(
      makeDescriptorInput({ policy: 'provider-dependent', seed: null, parameters: 'provider X, rev 2' }),
    );
    expect(noSeed.reproducibility.seed).toBe(null);
    expect(noSeed.reproducibility.parameters).toBe('provider X, rev 2');
    const withSeed = await createVerifierDescriptor(
      makeDescriptorInput({ policy: 'provider-dependent', seed: 'seed-77' }),
    );
    expect(withSeed.reproducibility.seed).toBe('seed-77');
  });

  it('unknown policies are rejected', async () => {
    await expect(
      createVerifierDescriptor(makeDescriptorInput({ policy: 'sometimes' })),
    ).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_REPRODUCIBILITY }),
    );
  });
});

describe('provenance validation', () => {
  it('field list and rejection of malformed provenance', async () => {
    expect([...VERIFIER_PROVENANCE_FIELDS]).toEqual(['authoredBy', 'submittedAt', 'notes']);
    const input = makeDescriptorInput();
    // a malformed author id fails the neutral-id guard (INVALID_IDENTITY)
    const badAuthor = { ...input, provenance: { authoredBy: 'BAD AUTHOR', submittedAt: 'x', notes: null } };
    await expect(createVerifierDescriptor(badAuthor)).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_IDENTITY }),
    );
    // an unknown provenance field fails the strict shape (INVALID_PROVENANCE)
    const rogueField = {
      ...input,
      provenance: { authoredBy: 'ok-author', submittedAt: '2026-01-15T09:30:00.000Z', notes: null, signedOffBy: 'x' },
    };
    await expect(createVerifierDescriptor(rogueField)).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_PROVENANCE }),
    );
  });

  it('malformed schemas are rejected (INVALID_SCHEMA_REF)', async () => {
    const input = makeDescriptorInput();
    const bad = { ...input, outputSchema: { namespace: '', name: 'x', version: '1.0.0' } };
    await expect(createVerifierDescriptor(bad)).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_SCHEMA_REF }),
    );
  });

  it('the verifier id pattern is the neutral-id charset', () => {
    expect(VERIFIER_ID_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{0,63}$');
  });
});
