/**
 * Suite descriptor tests (Work Order A023).
 */

import { describe, expect, it } from 'vitest';
import { CertificationError } from './errors.js';
import {
  CERTIFICATION_SUITE_DESCRIPTOR_FIELDS,
  CERTIFICATION_SUITE_VERSION,
  SUITE_PROVENANCE_FIELDS,
  SUITE_COMPONENT_REFS_FIELDS,
  SUITE_ID_PATTERN_SOURCE,
  certificationSuiteDescriptorView,
  certificationSuiteIdentityKey,
  createCertificationSuite,
  isCertificationSuiteDescriptor,
  isCertificationSuiteDescriptorView,
  recomputeCertificationSuiteDigest,
  suiteComponentRefs,
} from './suite.js';
import { makeSuiteInput, makeThreeComponentSuiteInput, digestOf } from './test-support.js';

describe('suite descriptor — happy path', () => {
  it('builds a content-addressed descriptor with a sha256 digest', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    expect(suite.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(suite.recordVersion).toBe(CERTIFICATION_SUITE_VERSION);
    expect(suite.suiteId).toBe('suite-reference-0001');
    expect(suite.version).toBe('1.0.0');
    expect(suite.components).toHaveLength(2);
    expect(suiteComponentRefs(suite)).toHaveLength(2);
  });

  it('a different identity produces a different digest', async () => {
    const a = await createCertificationSuite(await makeSuiteInput({ suiteId: 'suite-a' }));
    const b = await createCertificationSuite(await makeSuiteInput({ suiteId: 'suite-b' }));
    expect(a.digest).not.toBe(b.digest);
  });

  it('identical inputs produce identical digests (content-addressed determinism)', async () => {
    const a = await createCertificationSuite(await makeSuiteInput());
    const b = await createCertificationSuite(await makeSuiteInput());
    expect(a.digest).toBe(b.digest);
  });

  it('the descriptor is deep-frozen at creation', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    expect(Object.isFrozen(suite)).toBe(true);
    expect(Object.isFrozen(suite.components[0])).toBe(true);
    expect(Object.isFrozen(suite.verdictSemantics)).toBe(true);
    expect(Object.isFrozen(suite.provenance)).toBe(true);
  });

  it('recomputeCertificationSuiteDigest returns the same digest on the same view', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const recomputed = await recomputeCertificationSuiteDigest(suite);
    expect(recomputed).toBe(suite.digest);
  });

  it('recomputeCertificationSuiteDigest detects tampering', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const tampered = { ...suite, title: 'TAMPERED' as never };
    await expect(recomputeCertificationSuiteDigest(tampered)).rejects.toThrow();
    // the function returns the recomputed digest only if it MATCHES suite.digest;
    // here tampered view should not match.
  });

  it('certificationSuiteIdentityKey is suiteId@version', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    expect(certificationSuiteIdentityKey(suite)).toBe('suite-reference-0001@1.0.0');
  });

  it('certificationSuiteDescriptorView strips the digest', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const view = certificationSuiteDescriptorView(suite);
    expect(Object.keys(view).sort()).toEqual(
      [...CERTIFICATION_SUITE_DESCRIPTOR_FIELDS].sort(),
    );
  });

  it('accepts a three-component suite (evaluation + verification + compatibility)', async () => {
    const suite = await createCertificationSuite(await makeThreeComponentSuiteInput());
    expect(suite.components).toHaveLength(3);
    expect(suiteComponentRefs(suite)).toHaveLength(3);
    const kinds = suite.components.map((c) => c.kind).sort();
    expect(kinds).toEqual(['compatibility', 'evaluation', 'verification']);
  });

  it('the descriptor view fields mirror the contract field list', async () => {
    expect([...CERTIFICATION_SUITE_DESCRIPTOR_FIELDS]).toEqual([
      'recordVersion',
      'suiteId',
      'version',
      'title',
      'scopeStatement',
      'components',
      'verdictSemantics',
      'inputSchema',
      'outputSchema',
      'provenance',
    ]);
  });

  it('the provenance field list mirrors the contract', () => {
    expect([...SUITE_PROVENANCE_FIELDS]).toEqual([
      'authoredBy',
      'submittedAt',
      'notes',
    ]);
  });

  it('the component-refs field list mirrors the contract', () => {
    expect([...SUITE_COMPONENT_REFS_FIELDS]).toEqual(['kind', 'refs']);
  });

  it('the suite id pattern source is exported (mirrors contract)', () => {
    expect(SUITE_ID_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{0,63}$');
  });
});

describe('suite descriptor — structural guards', () => {
  it('isCertificationSuiteDescriptorView rejects non-objects', async () => {
    expect(isCertificationSuiteDescriptorView(null)).toBe(false);
    expect(isCertificationSuiteDescriptorView('bad')).toBe(false);
    expect(isCertificationSuiteDescriptorView({})).toBe(false);
  });
  it('isCertificationSuiteDescriptor rejects view-only objects (no digest)', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const view = certificationSuiteDescriptorView(suite);
    expect(isCertificationSuiteDescriptor(view)).toBe(false);
    expect(isCertificationSuiteDescriptor(suite)).toBe(true);
  });
});

describe('suite descriptor — adversarial / negative (fail-closed)', () => {
  it('rejects an unknown component kind (closed enum)', async () => {
    const input = await makeSuiteInput();
    (input as unknown as { components: Array<{ kind: string; refs: readonly string[] }> }).components = [
      { kind: 'evidence-creation', refs: [await digestOf(1)] },
    ];
    await expect(createCertificationSuite(input)).rejects.toThrowError(CertificationError);
  });

  it('rejects a suite with zero components of every kind', async () => {
    const input = await makeSuiteInput();
    (input as unknown as { components: never[] }).components = [];
    await expect(createCertificationSuite(input)).rejects.toThrowError(CertificationError);
  });

  it('rejects a component list with zero refs (a kind must carry ≥1 ref)', async () => {
    const input = await makeSuiteInput();
    (input as unknown as { components: Array<{ kind: string; refs: readonly string[] }> }).components = [
      { kind: 'evaluation', refs: [] },
    ];
    await expect(createCertificationSuite(input)).rejects.toThrowError(CertificationError);
  });

  it('rejects duplicate component refs within the same list', async () => {
    const ref = await digestOf(1);
    const input = await makeSuiteInput();
    (input as unknown as { components: Array<{ kind: string; refs: readonly string[] }> }).components = [
      { kind: 'evaluation', refs: [ref, ref] },
    ];
    await expect(createCertificationSuite(input)).rejects.toThrowError(CertificationError);
  });

  it('rejects a duplicate component ref across two lists', async () => {
    const ref = await digestOf(1);
    const input = await makeSuiteInput();
    (input as unknown as { components: Array<{ kind: string; refs: readonly string[] }> }).components = [
      { kind: 'evaluation', refs: [ref] },
      { kind: 'verification', refs: [ref] },
    ];
    await expect(createCertificationSuite(input)).rejects.toThrowError(CertificationError);
  });

  it('rejects a duplicate component kind across two lists', async () => {
    const ref1 = await digestOf(1);
    const ref2 = await digestOf(2);
    const input = await makeSuiteInput();
    (input as unknown as { components: Array<{ kind: string; refs: readonly string[] }> }).components = [
      { kind: 'evaluation', refs: [ref1] },
      { kind: 'evaluation', refs: [ref2] },
    ];
    await expect(createCertificationSuite(input)).rejects.toThrowError(CertificationError);
  });

  it('rejects a malformed suite id (uppercase)', async () => {
    const input = await makeSuiteInput({ suiteId: 'Suite-UPPER' });
    await expect(createCertificationSuite(input)).rejects.toThrowError(CertificationError);
  });

  it('rejects an incomplete verdict semantics (missing any of the four)', async () => {
    const input = (await makeSuiteInput()) as unknown as {
      verdictSemantics: {
        pass: string;
        fail: string;
        unknown: string;
      };
    };
    input.verdictSemantics = {
      pass: 'p',
      fail: 'f',
      unknown: 'u',
    };
    await expect(createCertificationSuite(input as never)).rejects.toThrowError(
      CertificationError,
    );
  });

  it('rejects an unknown field in the input (strict shape)', async () => {
    const input = (await makeSuiteInput()) as unknown as Record<string, unknown>;
    input['rogueField'] = 'no';
    await expect(createCertificationSuite(input as never)).rejects.toThrowError(
      CertificationError,
    );
  });

  it('rejects a malformed suite ref digest (not 64-char hex)', async () => {
    const input = (await makeSuiteInput()) as unknown as {
      components: Array<{ kind: string; refs: readonly string[] }>;
    };
    input.components = [{ kind: 'evaluation', refs: ['not-a-digest'] }];
    await expect(createCertificationSuite(input as never)).rejects.toThrowError(
      CertificationError,
    );
  });
});
