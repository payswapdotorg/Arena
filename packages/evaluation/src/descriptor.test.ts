/**
 * EvaluatorDescriptor tests (Work Order A012 gate 2): content-addressed,
 * versioned evaluator declarations — positive AND negative coverage,
 * including the closed-kind negative gate, the reproducibility
 * consistency rule, digest determinism and mutation-API-absence.
 */

import { describe, expect, it } from 'vitest';
import {
  EVALUATOR_DESCRIPTOR_FIELDS,
  EVALUATOR_DESCRIPTOR_VERSION,
  EVALUATOR_ID_PATTERN_SOURCE,
  EVALUATOR_INPUT_FIELDS,
  EVALUATOR_PROVENANCE_FIELDS,
  EVALUATOR_REPRODUCIBILITY_FIELDS,
  createEvaluatorDescriptor,
  evaluatorDescriptorView,
  evaluatorIdentityKey,
  isEvaluatorDescriptor,
  isEvaluatorDescriptorView,
  isEvaluatorInputContract,
  isEvaluatorProvenance,
  isEvaluatorReproducibility,
  recomputeEvaluatorDescriptorDigest,
} from './descriptor.js';
import { EVALUATION_ERROR_CODES } from './errors.js';
import {
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  DIGEST_D,
  DIGEST_E,
  makeDescriptorInput,
} from './test-support.js';

describe('createEvaluatorDescriptor (positive)', () => {
  it('creates a validated, deep-frozen, digest-addressed descriptor', async () => {
    const descriptor = await createEvaluatorDescriptor(makeDescriptorInput());
    expect(descriptor.recordVersion).toBe(EVALUATOR_DESCRIPTOR_VERSION);
    expect(descriptor.evaluatorId).toBe('eval-000042');
    expect(descriptor.version).toBe('1.0.0');
    expect(descriptor.kind).toBe('deterministic-test');
    expect(descriptor.inputs).toEqual({
      caseRef: DIGEST_A,
      trajectoryRef: DIGEST_B,
      bodyRef: DIGEST_D,
      substrateRef: DIGEST_E,
    });
    expect(descriptor.criteriaRef).toBe(DIGEST_C);
    expect(descriptor.outputSchema).toEqual({
      namespace: 'evaluation',
      name: 'evaluation-record',
      version: '1.0.0',
    });
    expect(descriptor.reproducibility).toEqual({
      deterministic: true,
      seeded: true,
      requiresHuman: false,
    });
    expect(descriptor.confidence).toBe(0.9);
    expect(descriptor.limitations).toMatch(/^reference evaluator/);
    expect(descriptor.provenance.authoredBy).toBe('arena-reference-fabric');
    expect(descriptor.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.inputs)).toBe(true);
    expect(Object.isFrozen(descriptor.reproducibility)).toBe(true);
    expect(Object.isFrozen(descriptor.provenance)).toBe(true);
  });

  it('accepts all seven EV1. kinds (closed enum members pass)', async () => {
    for (const kind of [
      'deterministic-test',
      'model-based',
      'expert',
      'rubric',
      'simulation',
      'comparative',
      'adversarial',
    ]) {
      const descriptor = await createEvaluatorDescriptor(
        makeDescriptorInput({ kind, requiresHuman: kind === 'expert' || kind === 'model-based', deterministic: !(kind === 'expert' || kind === 'model-based') }),
      );
      expect(descriptor.kind).toBe(kind);
    }
  });

  it('accepts null body/substrate refs (optional pins)', async () => {
    const descriptor = await createEvaluatorDescriptor(
      makeDescriptorInput({ bodyRef: null, substrateRef: null }),
    );
    expect(descriptor.inputs.bodyRef).toBeNull();
    expect(descriptor.inputs.substrateRef).toBeNull();
  });

  it('accepts prerelease versions (semver without build metadata)', async () => {
    const descriptor = await createEvaluatorDescriptor(
      makeDescriptorInput({ version: '2.0.0-rc.1' }),
    );
    expect(descriptor.version).toBe('2.0.0-rc.1');
  });
});

describe('content addressing (gate 2 — same descriptor ⇒ same digest)', () => {
  it('identical inputs ⇒ identical digests (positive)', async () => {
    const a = await createEvaluatorDescriptor(makeDescriptorInput());
    const b = await createEvaluatorDescriptor(makeDescriptorInput());
    expect(a.digest).toBe(b.digest);
  });

  it('ANY field change ⇒ a different digest (version discipline — positive)', async () => {
    const base = await createEvaluatorDescriptor(makeDescriptorInput());
    const variants = [
      makeDescriptorInput({ evaluatorId: 'eval-000043' }),
      makeDescriptorInput({ version: '1.0.1' }),
      makeDescriptorInput({ kind: 'rubric' }),
      makeDescriptorInput({ caseRef: 'f'.repeat(64) }),
      makeDescriptorInput({ trajectoryRef: 'e'.repeat(64) }),
      makeDescriptorInput({ bodyRef: null }),
      makeDescriptorInput({ substrateRef: null }),
      makeDescriptorInput({ criteriaRef: 'd'.repeat(64) }),
      makeDescriptorInput({ deterministic: false, requiresHuman: true }),
      makeDescriptorInput({ seeded: false }),
      makeDescriptorInput({ confidence: 0.4 }),
    ];
    for (const variant of variants) {
      const built = await createEvaluatorDescriptor(variant);
      expect(built.digest).not.toBe(base.digest);
    }
  });

  it('recomputeEvaluatorDescriptorDigest passes on genuine descriptors (positive)', async () => {
    const descriptor = await createEvaluatorDescriptor(makeDescriptorInput());
    await expect(recomputeEvaluatorDescriptorDigest(descriptor)).resolves.toBe(descriptor.digest);
    await expect(
      recomputeEvaluatorDescriptorDigest(descriptor, descriptor.digest),
    ).resolves.toBe(descriptor.digest);
  });

  it('recomputeEvaluatorDescriptorDigest throws TAMPERED on mismatch (negative)', async () => {
    const descriptor = await createEvaluatorDescriptor(makeDescriptorInput());
    await expect(
      recomputeEvaluatorDescriptorDigest(descriptor, '9'.repeat(64)),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.TAMPERED }),
    );
    await expect(
      recomputeEvaluatorDescriptorDigest({ digest: 'x' } as never),
    ).rejects.toThrowError(/structurally valid/);
  });
});

describe('createEvaluatorDescriptor validation (negative)', () => {
  it('rejects non-object input', async () => {
    for (const bad of [null, undefined, 42, 'descriptor', [1], true]) {
      await expect(createEvaluatorDescriptor(bad as never)).rejects.toThrowError(
        /expected a plain object/,
      );
    }
  });

  it('rejects unknown fields (strict shape)', async () => {
    const extra = { ...makeDescriptorInput(), surprise: 'no' };
    await expect(createEvaluatorDescriptor(extra as never)).rejects.toThrowError(
      /unknown field 'surprise'/,
    );
  });

  it('rejects UNKNOWN evaluator kinds (gate 2 negative — closed enum)', async () => {
    for (const badKind of ['heuristic', 'llm-judge', 'deterministic', '']) {
      await expect(
        createEvaluatorDescriptor(makeDescriptorInput({ kind: badKind })),
      ).rejects.toThrowError(
        expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_KIND }),
      );
    }
  });

  it('rejects invalid evaluator ids and versions (negative)', async () => {
    await expect(
      createEvaluatorDescriptor(makeDescriptorInput({ evaluatorId: 'BAD_ID' })),
    ).rejects.toThrowError(/invalid evaluator id/i);
    await expect(
      createEvaluatorDescriptor(makeDescriptorInput({ version: '1.2' })),
    ).rejects.toThrowError(/invalid evaluation version/i);
  });

  it('rejects malformed input contracts (negative)', async () => {
    for (const bad of ['', 'short', 'UPPER', 'nope']) {
      // bad digest refs fail the content-digest guard inside the contract parser
      await expect(
        createEvaluatorDescriptor(makeDescriptorInput({ caseRef: bad })),
      ).rejects.toThrowError(
        expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_DIGEST }),
      );
      await expect(
        createEvaluatorDescriptor(makeDescriptorInput({ trajectoryRef: bad })),
      ).rejects.toThrowError(
        expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_DIGEST }),
      );
    }
    // body/substrate must be digest or null — numbers rejected
    await expect(
      createEvaluatorDescriptor(
        makeDescriptorInput({ bodyRef: 42 as unknown as string }),
      ),
    ).rejects.toThrowError(/bodyRef must be a content digest or null/);
    // unknown fields inside the contract carry the input-contract code
    await expect(
      createEvaluatorDescriptor({
        ...makeDescriptorInput(),
        inputs: { ...makeDescriptorInput().inputs, extra: 1 } as never,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_INPUT_CONTRACT }),
    );
  });

  it('rejects contradictory reproducibility: deterministic AND requiresHuman (negative)', async () => {
    await expect(
      createEvaluatorDescriptor(
        makeDescriptorInput({ deterministic: true, requiresHuman: true }),
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_REPRODUCIBILITY }),
    );
    await expect(
      createEvaluatorDescriptor(
        makeDescriptorInput({ deterministic: true, requiresHuman: true }),
      ),
    ).rejects.toThrowError(/cannot require human judgment/);
  });

  it('rejects non-boolean reproducibility fields (negative)', async () => {
    await expect(
      createEvaluatorDescriptor({
        ...makeDescriptorInput(),
        reproducibility: { deterministic: 'yes' as unknown as boolean, seeded: true, requiresHuman: false },
      }),
    ).rejects.toThrowError(/must all be booleans/);
    await expect(
      createEvaluatorDescriptor({
        ...makeDescriptorInput(),
        reproducibility: { seeded: true, requiresHuman: false } as never,
      }),
    ).rejects.toThrowError(/missing required field 'deterministic'/);
  });

  it('rejects out-of-range confidence (negative)', async () => {
    for (const bad of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        createEvaluatorDescriptor(makeDescriptorInput({ confidence: bad })),
      ).rejects.toThrowError(
        expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_DESCRIPTOR }),
      );
    }
  });

  it('rejects malformed provenance (negative)', async () => {
    await expect(
      createEvaluatorDescriptor({
        ...makeDescriptorInput(),
        provenance: { ...makeDescriptorInput().provenance, authoredBy: 'BAD AUTHOR' },
      }),
    ).rejects.toThrowError(/invalid neutral identifier/i);
    await expect(
      createEvaluatorDescriptor({
        ...makeDescriptorInput(),
        provenance: { ...makeDescriptorInput().provenance, submittedAt: 'yesterday' },
      }),
    ).rejects.toThrowError(/invalid evaluation timestamp/i);
    await expect(
      createEvaluatorDescriptor({
        ...makeDescriptorInput(),
        provenance: { ...makeDescriptorInput().provenance, notes: 42 as unknown as string },
      }),
    ).rejects.toThrowError(/notes must be neutral text or null/);
  });

  it('rejects malformed output schema refs (negative)', async () => {
    await expect(
      createEvaluatorDescriptor({
        ...makeDescriptorInput(),
        outputSchema: { namespace: 'EVAL', name: 'record', version: '1.0.0' },
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_SCHEMA_REF }),
    );
    await expect(
      createEvaluatorDescriptor({
        ...makeDescriptorInput(),
        outputSchema: { namespace: 'evaluation', name: 'record', version: '1.0.0-rc1' },
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_SCHEMA_REF }),
    );
    await expect(
      createEvaluatorDescriptor({
        ...makeDescriptorInput(),
        outputSchema: { namespace: 'evaluation', name: 'record', version: '1.0.0-rc1' },
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_SCHEMA_REF }),
    );
  });
});

describe('structural guards (positive + negative)', () => {
  it('isEvaluatorDescriptorView / isEvaluatorDescriptor (positive + negative)', async () => {
    const descriptor = await createEvaluatorDescriptor(makeDescriptorInput());
    expect(isEvaluatorDescriptorView(evaluatorDescriptorView(descriptor))).toBe(true);
    expect(isEvaluatorDescriptor(descriptor)).toBe(true);
    expect(isEvaluatorDescriptor({ ...descriptor, digest: 'x' })).toBe(false);
    expect(isEvaluatorDescriptor({ ...descriptor, kind: 'heuristic' })).toBe(false);
    expect(isEvaluatorDescriptor({ ...descriptor, confidence: 1.5 })).toBe(false);
    expect(isEvaluatorDescriptor(null)).toBe(false);
    expect(isEvaluatorDescriptor(42)).toBe(false);
  });

  it('isEvaluatorInputContract (positive + negative)', async () => {
    const descriptor = await createEvaluatorDescriptor(makeDescriptorInput());
    expect(isEvaluatorInputContract(descriptor.inputs)).toBe(true);
    expect(isEvaluatorInputContract({ ...descriptor.inputs, caseRef: 'x' })).toBe(false);
    expect(isEvaluatorInputContract({ ...descriptor.inputs, bodyRef: 5 })).toBe(false);
    expect(isEvaluatorInputContract(null)).toBe(false);
    expect(isEvaluatorInputContract('ref')).toBe(false);
  });

  it('isEvaluatorReproducibility (positive + negative)', () => {
    expect(
      isEvaluatorReproducibility({ deterministic: true, seeded: false, requiresHuman: false }),
    ).toBe(true);
    expect(
      isEvaluatorReproducibility({ deterministic: 'true', seeded: false, requiresHuman: false }),
    ).toBe(false);
    expect(isEvaluatorReproducibility(null)).toBe(false);
  });

  it('isEvaluatorProvenance (positive + negative)', async () => {
    const descriptor = await createEvaluatorDescriptor(makeDescriptorInput());
    expect(isEvaluatorProvenance(descriptor.provenance)).toBe(true);
    expect(isEvaluatorProvenance({ ...descriptor.provenance, submittedAt: 'nope' })).toBe(false);
    expect(isEvaluatorProvenance(null)).toBe(false);
  });
});

describe('identity key (any change ⇒ new version enforcement point)', () => {
  it('evaluatorIdentityKey formats evaluatorId@version (positive)', async () => {
    const descriptor = await createEvaluatorDescriptor(makeDescriptorInput());
    expect(evaluatorIdentityKey(descriptor)).toBe('eval-000042@1.0.0');
  });

  it('different content under the same identity ⇒ same key but different digest (the conflict the registry rejects)', async () => {
    const a = await createEvaluatorDescriptor(makeDescriptorInput());
    const b = await createEvaluatorDescriptor(
      makeDescriptorInput({ confidence: 0.5 }), // same id+version, different bytes
    );
    expect(evaluatorIdentityKey(a)).toBe(evaluatorIdentityKey(b));
    expect(a.digest).not.toBe(b.digest);
  });
});

describe('field-list constants (positive)', () => {
  it('declares stable field lists for tests + contracts parity', () => {
    expect([...EVALUATOR_INPUT_FIELDS]).toEqual([
      'caseRef',
      'trajectoryRef',
      'bodyRef',
      'substrateRef',
    ]);
    expect([...EVALUATOR_REPRODUCIBILITY_FIELDS]).toEqual([
      'deterministic',
      'seeded',
      'requiresHuman',
    ]);
    expect([...EVALUATOR_PROVENANCE_FIELDS]).toEqual([
      'authoredBy',
      'submittedAt',
      'notes',
    ]);
    expect([...EVALUATOR_DESCRIPTOR_FIELDS]).toEqual([
      'recordVersion',
      'evaluatorId',
      'version',
      'kind',
      'inputs',
      'criteriaRef',
      'outputSchema',
      'reproducibility',
      'confidence',
      'limitations',
      'provenance',
    ]);
    expect(EVALUATOR_ID_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{0,63}$');
  });
});

describe('no mutation API (gate 2 negative — descriptors are frozen)', () => {
  it('mutating a frozen descriptor throws TypeError; the digest still commits to the original bytes', async () => {
    const descriptor = await createEvaluatorDescriptor(makeDescriptorInput());
    const mutate = descriptor as unknown as { confidence?: number };
    expect(() => {
      mutate['confidence'] = 0.1;
    }).toThrowError(TypeError);
    expect(descriptor.confidence).toBe(0.9);
    await expect(recomputeEvaluatorDescriptorDigest(descriptor)).resolves.toBe(descriptor.digest);
  });
});
