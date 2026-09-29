/**
 * QualificationEvidence tests (Work Order A007 §3.1) — the four evidence
 * kinds, content addressing, append-only supersession, negative and
 * adversarial inputs.
 */

import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@arena/protocol-core';
import {
  QUALIFICATION_EVIDENCE_FIELDS,
  QUALIFICATION_EVIDENCE_KINDS,
  VERIFICATION_REF_OUTCOMES,
  createQualificationEvidence,
  isQualificationEvidence,
  isQualificationEvidenceKind,
  isQualificationEvidenceView,
  qualificationEvidenceView,
  recomputeQualificationEvidenceDigest,
  resolveActiveEvidenceDigests,
} from './evidence.js';
import { ExpertQualificationError } from './errors.js';
import {
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  T0,
  T_FRESH,
  makeCredentialEvidence,
  makeEvaluationEvidence,
  makeVerificationEvidence,
  makeWorkProductEvidence,
} from './test-support.js';

describe('the closed evidence-kind vocabulary', () => {
  it('is exactly the four Work-Order kinds', () => {
    expect([...QUALIFICATION_EVIDENCE_KINDS]).toEqual([
      'credential-ref',
      'work-product-ref',
      'verification-ref',
      'evaluation-ref',
    ]);
    expect(isQualificationEvidenceKind('credential-ref')).toBe(true);
    expect(isQualificationEvidenceKind('peer-review-ref')).toBe(false);
    expect([...VERIFICATION_REF_OUTCOMES]).toEqual(['pass', 'fail', 'unknown']);
  });
});

describe('evidence construction (all four kinds)', () => {
  it('creates a content-addressed, deep-frozen credential-ref record', async () => {
    const evidence = await makeCredentialEvidence();
    expect(evidence.kind).toBe('credential-ref');
    expect(evidence.credential?.reference).toBe('cert-rust-2026-0142');
    expect(evidence.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(isQualificationEvidence(evidence)).toBe(true);
    expect(isQualificationEvidenceView(qualificationEvidenceView(evidence))).toBe(true);
  });

  it('creates work-product-ref / verification-ref / evaluation-ref records', async () => {
    const work = await makeWorkProductEvidence(1);
    expect(work.workProduct?.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(work.workProduct?.description).toContain('work product 1');
    const pass = await makeVerificationEvidence('pass');
    expect(pass.verification?.outcome).toBe('pass');
    const evaluation = await makeEvaluationEvidence();
    expect(evaluation.evaluation?.recordDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic: identical inputs ⇒ identical digests; any change diverges', async () => {
    const a = await makeCredentialEvidence();
    const b = await makeCredentialEvidence();
    expect(a.digest).toBe(b.digest);
    const different = await makeCredentialEvidence({ observedAt: T0 });
    expect(different.digest).not.toBe(a.digest);
    // tamper tripwire
    await expect(recomputeQualificationEvidenceDigest(a)).resolves.toBe(a.digest);
    const tampered = { ...a, note: 'smuggled' } as typeof a;
    await expect(recomputeQualificationEvidenceDigest(tampered)).rejects.toThrow(
      ExpertQualificationError,
    );
  });

  it('carries append-only supersession references', async () => {
    const original = await makeWorkProductEvidence(1);
    const updated = await makeWorkProductEvidence(2, { supersedes: original.digest });
    expect(updated.supersedes).toBe(original.digest);
    expect(updated.digest).not.toBe(original.digest);
  });
});

describe('negative/adversarial evidence inputs', () => {
  it('rejects unknown kinds', async () => {
    await expect(
      createQualificationEvidence({
        kind: 'peer-review-ref',
        observedAt: T_FRESH,
      } as never),
    ).rejects.toThrow(/must be one of/);
  });

  it('rejects a kind carrying the WRONG payload (strict oneOf-by-kind)', async () => {
    await expect(
      createQualificationEvidence({
        kind: 'credential-ref',
        observedAt: T_FRESH,
        verification: { recordDigest: DIGEST_A, outcome: 'pass' },
      }),
    ).rejects.toThrow(/unexpected payload field 'verification'/);
    await expect(
      createQualificationEvidence({
        kind: 'verification-ref',
        observedAt: T_FRESH,
        // missing verification payload
      }),
    ).rejects.toThrow(/requires payload field 'verification'/);
  });

  it('rejects malformed payloads per kind', async () => {
    await expect(
      createQualificationEvidence({
        kind: 'work-product-ref',
        observedAt: T_FRESH,
        workProduct: { digest: 'not-a-digest', description: 'd' },
      }),
    ).rejects.toThrow(/invalid content digest/);
    await expect(
      createQualificationEvidence({
        kind: 'work-product-ref',
        observedAt: T_FRESH,
        workProduct: { digest: DIGEST_A, description: '' },
      }),
    ).rejects.toThrow(/invalid neutral text/);
    await expect(
      createQualificationEvidence({
        kind: 'verification-ref',
        observedAt: T_FRESH,
        verification: { recordDigest: DIGEST_A, outcome: 'maybe' },
      }),
    ).rejects.toThrow(/must be one of/);
  });

  it('rejects malformed observedAt and unknown fields', async () => {
    await expect(
      createQualificationEvidence({
        kind: 'credential-ref',
        observedAt: '2026-01-15T09:30:00Z',
        credential: { kind: 'certification', reference: 'cert-1' },
      }),
    ).rejects.toThrow(/ms-precision UTC/);
    await expect(
      createQualificationEvidence({
        kind: 'credential-ref',
        observedAt: T_FRESH,
        credential: { kind: 'certification', reference: 'cert-1' },
        rogue: true,
      } as never),
    ).rejects.toThrow(/unknown field 'rogue'/);
  });
});

describe('supersession resolution', () => {
  it('excludes superseded evidence from the active set, keeps it in input', async () => {
    const original = await makeWorkProductEvidence(1);
    const replacement = await makeWorkProductEvidence(2, { supersedes: original.digest });
    const unrelated = await makeVerificationEvidence('pass');
    const active = resolveActiveEvidenceDigests([original, replacement, unrelated]);
    expect(active).toContain(replacement.digest);
    expect(active).toContain(unrelated.digest);
    expect(active).not.toContain(original.digest);
  });

  it('keeps supersession references to records OUTSIDE the set (dangling is data)', async () => {
    const replacement = await makeWorkProductEvidence(3, { supersedes: DIGEST_B });
    const active = resolveActiveEvidenceDigests([replacement]);
    expect(active).toEqual([replacement.digest]);
  });

  it('is order-independent (pure projection)', async () => {
    const a = await makeWorkProductEvidence(1);
    const b = await makeWorkProductEvidence(2, { supersedes: a.digest });
    expect(resolveActiveEvidenceDigests([a, b])).toEqual(resolveActiveEvidenceDigests([b, a]));
  });

  it('never rewrites: the superseded record is untouched (immutability)', async () => {
    const original = await makeWorkProductEvidence(1);
    const before = canonicalJson(original);
    await makeWorkProductEvidence(2, { supersedes: original.digest });
    expect(canonicalJson(original)).toBe(before);
    expect(original.supersedes).toBeUndefined();
  });
});

describe('field list parity anchor', () => {
  it('exports the stable field list used by the contracts parity test', () => {
    expect([...QUALIFICATION_EVIDENCE_FIELDS]).toContain('kind');
    expect([...QUALIFICATION_EVIDENCE_FIELDS]).toContain('supersedes');
    expect([...QUALIFICATION_EVIDENCE_FIELDS]).toContain('digest');
    expect([...QUALIFICATION_EVIDENCE_FIELDS]).toContain('credential');
    expect([...QUALIFICATION_EVIDENCE_FIELDS]).toContain('workProduct');
    expect([...QUALIFICATION_EVIDENCE_FIELDS]).toContain('verification');
    expect([...QUALIFICATION_EVIDENCE_FIELDS]).toContain('evaluation');
  });

  it('isQualificationEvidence rejects structurally invalid shapes', async () => {
    const evidence = await makeCredentialEvidence();
    expect(isQualificationEvidence({ ...evidence, recordVersion: 2 })).toBe(false);
    expect(isQualificationEvidence({ ...evidence, kind: 'bogus' })).toBe(false);
    expect(isQualificationEvidence({ ...evidence, digest: DIGEST_C.slice(0, 63) })).toBe(false);
    expect(isQualificationEvidence(null)).toBe(false);
  });
});
