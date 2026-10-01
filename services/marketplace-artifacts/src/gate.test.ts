import { describe, expect, it } from 'vitest';
import {
  MARKETPLACE_GATE_REJECTION_REASONS,
  evaluateListingGate,
  toMarketplaceEvidenceRef,
  toMarketplaceEvidenceRefs,
} from './gate.js';
import { MARKETPLACE_ERROR_CODES, MarketplaceError } from './errors.js';
import {
  TENANT_A,
  makeEvidenceArtifact,
  makeEvidencedSubject,
  makePassingVerificationFor,
  makeProvenanceRecordFor,
  evidenceRefsOf,
} from './test-support.js';
import { provenanceRecordDigest } from '@arena/provenance';

describe('listing admission gate: positive path', () => {
  it('admits a listing with provenance + passing verification about the subject', async () => {
    const subject = await makeEvidenceArtifact(10, { namespace: TENANT_A, name: 'gate-subject' });
    const fixture = await makeEvidencedSubject(subject);
    const stores = {
      provenance: async (digest: string) =>
        digest === fixture.provenanceDigest ? fixture.provenanceRecord : null,
      verification: (digest: string) =>
        digest === fixture.verification.record.digest ? fixture.verification.record : null,
    };
    const verdict = await evaluateListingGate(
      fixture.artifact as never,
      evidenceRefsOf(fixture),
      stores,
    );
    expect(verdict.admitted).toBe(true);
    expect(verdict.rejections).toHaveLength(0);
    expect(Object.isFrozen(verdict)).toBe(true);
  });
});

describe('listing admission gate: adversarial rejections (fail closed)', () => {
  it('rejects listings with no evidence citations at all', async () => {
    const subject = await makeEvidenceArtifact(11);
    const fixture = await makeEvidencedSubject(subject);
    const verdict = await evaluateListingGate(fixture.artifact as never, [], {
      provenance: () => null,
      verification: () => null,
    });
    expect(verdict.admitted).toBe(false);
    expect(verdict.rejections[0]?.reason).toBe('evidence-missing');
  });

  it('rejects unresolvable evidence (store resolves nothing)', async () => {
    const subject = await makeEvidenceArtifact(12);
    const fixture = await makeEvidencedSubject(subject);
    const verdict = await evaluateListingGate(fixture.artifact as never, evidenceRefsOf(fixture), {
      provenance: () => null,
      verification: () => null,
    });
    expect(verdict.admitted).toBe(false);
    expect(verdict.rejections.some((r) => r.reason === 'evidence-unresolvable')).toBe(true);
  });

  it('rejects when the evidence store throws (infrastructure failure is a rejection, not a crash)', async () => {
    const subject = await makeEvidenceArtifact(13);
    const fixture = await makeEvidencedSubject(subject);
    const verdict = await evaluateListingGate(fixture.artifact as never, evidenceRefsOf(fixture), {
      provenance: () => {
        throw new Error('store exploded');
      },
      verification: () => {
        throw new Error('store exploded');
      },
    });
    expect(verdict.admitted).toBe(false);
    expect(verdict.rejections.every((r) => r.reason === 'evidence-unresolvable')).toBe(true);
  });

  it('rejects structurally invalid evidence records', async () => {
    const subject = await makeEvidenceArtifact(14);
    const fixture = await makeEvidencedSubject(subject);
    const verdict = await evaluateListingGate(fixture.artifact as never, evidenceRefsOf(fixture), {
      provenance: () => ({ recordVersion: 1, nonsense: true }),
      verification: () => ({ recordVersion: 1, nonsense: true }),
    });
    expect(verdict.admitted).toBe(false);
    expect(verdict.rejections.some((r) => r.reason === 'evidence-structurally-invalid')).toBe(true);
  });

  it('rejects DIGEST-MISMATCHED (tampered) evidence records', async () => {
    const subject = await makeEvidenceArtifact(15);
    const fixture = await makeEvidencedSubject(subject);
    // Tampered copies: content mutated, digest field kept.
    const tamperedProvenance = { ...fixture.provenanceRecord, recordedAt: '2027-01-01T00:00:00.000Z' };
    const tamperedVerification = { ...fixture.verification.record, outcome: 'pass' } as typeof fixture.verification.record;
    const tamperedVerification2 = {
      ...fixture.verification.record,
      provenance: { ...fixture.verification.record.provenance, notes: 'mutated' },
    };
    const verdict = await evaluateListingGate(fixture.artifact as never, evidenceRefsOf(fixture), {
      provenance: () => tamperedProvenance,
      verification: (digest) =>
        digest === fixture.verification.record.digest ? tamperedVerification2 ?? tamperedVerification : null,
    });
    expect(verdict.admitted).toBe(false);
    expect(verdict.rejections.some((r) => r.reason === 'evidence-digest-mismatch')).toBe(true);
  });

  it('rejects provenance that is not about the listed subject', async () => {
    const subject = await makeEvidenceArtifact(16);
    const other = await makeEvidenceArtifact(17, { name: 'a-different-subject' });
    const fixture = await makeEvidencedSubject(subject);
    const otherProvenance = await makeProvenanceRecordFor({
      namespace: other.identity.namespace,
      name: other.identity.name,
      version: other.identity.version,
      digest: other.digest,
    });
    const otherDigest = await provenanceRecordDigest(otherProvenance);
    const verdict = await evaluateListingGate(
      fixture.artifact as never,
      [
        // cite the OTHER record's true digest — valid + tamper-checked, but
        // its lineage addresses a different artifact
        { kind: 'provenance', digest: otherDigest },
        { kind: 'verification', digest: fixture.verification.record.digest },
      ],
      {
        provenance: (digest) => (digest === otherDigest ? otherProvenance : null),
        verification: (digest) =>
          digest === fixture.verification.record.digest ? fixture.verification.record : null,
      },
    );
    expect(verdict.admitted).toBe(false);
    expect(verdict.rejections.some((r) => r.reason === 'provenance-subject-mismatch')).toBe(true);
  });

  it('rejects when the verification outcome is not pass (fail/unknown never admit)', async () => {
    for (const outcome of ['fail', 'unknown'] as const) {
      const subject = await makeEvidenceArtifact(18);
      const fixture = await makeEvidencedSubject(subject, { outcomeOverride: outcome });
      const verdict = await evaluateListingGate(fixture.artifact as never, evidenceRefsOf(fixture), {
        provenance: (digest) => (digest === fixture.provenanceDigest ? fixture.provenanceRecord : null),
        verification: (digest) => (digest === fixture.verification.record.digest ? fixture.verification.record : null),
      });
      expect(verdict.admitted).toBe(false);
      expect(verdict.rejections.some((r) => r.reason === 'verification-outcome-not-pass')).toBe(true);
    }
  });

  it('rejects verification that covers a different artifact', async () => {
    const subject = await makeEvidenceArtifact(19);
    const other = await makeEvidenceArtifact(20, { name: 'verification-other-subject' });
    const fixture = await makeEvidencedSubject(subject);
    const otherVerification = await makePassingVerificationFor({
      namespace: other.identity.namespace,
      name: other.identity.name,
      version: other.identity.version,
      digest: other.digest,
    });
    const verdict = await evaluateListingGate(fixture.artifact as never, [
      { kind: 'provenance', digest: fixture.provenanceDigest },
      { kind: 'verification', digest: otherVerification.record.digest },
    ], {
      provenance: (digest) => (digest === fixture.provenanceDigest ? fixture.provenanceRecord : null),
      verification: (digest) => (digest === otherVerification.record.digest ? otherVerification.record : null),
    });
    expect(verdict.admitted).toBe(false);
    expect(verdict.rejections.some((r) => r.reason === 'verification-subject-mismatch')).toBe(true);
  });

  it('rejects provenance-missing when only verification is cited', async () => {
    const subject = await makeEvidenceArtifact(21);
    const fixture = await makeEvidencedSubject(subject);
    const verdict = await evaluateListingGate(fixture.artifact as never, [
      { kind: 'verification', digest: fixture.verification.record.digest },
    ], {
      provenance: () => null,
      verification: (digest) => (digest === fixture.verification.record.digest ? fixture.verification.record : null),
    });
    expect(verdict.admitted).toBe(false);
    expect(verdict.rejections.some((r) => r.reason === 'provenance-missing')).toBe(true);
  });

  it('every rejection reason drawn by the gate belongs to the closed vocabulary', () => {
    expect(Object.isFrozen(MARKETPLACE_GATE_REJECTION_REASONS)).toBe(true);
    expect(MARKETPLACE_GATE_REJECTION_REASONS).toContain('evidence-digest-mismatch');
  });
});

describe('evidence citation validation', () => {
  it('accepts well-formed citations and rejects malformed ones', () => {
    expect(toMarketplaceEvidenceRef({ kind: 'provenance', digest: 'a'.repeat(64) })).toEqual({
      kind: 'provenance',
      digest: 'a'.repeat(64),
    });
    expect(() => toMarketplaceEvidenceRef({ kind: 'rumor', digest: 'a'.repeat(64) })).toThrowError(
      MarketplaceError,
    );
    expect(() => toMarketplaceEvidenceRef({ kind: 'provenance', digest: 'not-hex' })).toThrowError(
      MarketplaceError,
    );
  });

  it('requires a non-empty, duplicate-free citation list', () => {
    expect(() => toMarketplaceEvidenceRefs([])).toThrowError(MarketplaceError);
    const ref = { kind: 'verification' as const, digest: 'a'.repeat(64) };
    expect(() => toMarketplaceEvidenceRefs([ref, ref])).toThrowError(MarketplaceError);
    expect(toMarketplaceEvidenceRefs([ref, { kind: 'provenance', digest: 'b'.repeat(64) }])).toHaveLength(2);
  });

  it('MARKETPLACE_INVALID_EVIDENCE is the closed code for citation failures', () => {
    try {
      toMarketplaceEvidenceRef({ kind: 'rumor', digest: 'a'.repeat(64) });
      expect.unreachable();
    } catch (error) {
      expect(error instanceof MarketplaceError).toBe(true);
      expect((error as MarketplaceError).code).toBe(MARKETPLACE_ERROR_CODES.INVALID_EVIDENCE);
    }
  });
});
