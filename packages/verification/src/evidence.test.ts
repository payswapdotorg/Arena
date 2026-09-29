/**
 * Evidence object tests (Work Order A013): evidence kinds (open,
 * charset-validated), evidence provenance, evidence references (real
 * A002 artifact refs), the required-evidence declaration (unique ids,
 * pins) and the support summary (closed statuses, consistency rules).
 */

import { describe, expect, it } from 'vitest';
import { createMaterialArtifact } from '@arena/artifact-protocol';
import { VERIFICATION_ERROR_CODES } from './errors.js';
import {
  EVIDENCE_PROVENANCE_FIELDS,
  EVIDENCE_REFERENCE_FIELDS,
  EVIDENCE_REQUIREMENT_FIELDS,
  EVIDENCE_SUPPORT_STATUSES,
  REQUIREMENT_SUPPORT_FIELDS,
  evidenceReferenceKey,
  isEvidenceKind,
  isEvidenceProvenance,
  isEvidenceReference,
  isEvidenceRequirement,
  isEvidenceSupportStatus,
  isEvidenceSupportSummary,
  isRequirementSupport,
  isSupportEvidenceConsistent,
  toEvidenceBundle,
  toEvidenceSupportSummary,
  toRequiredEvidence,
} from './evidence.js';
import {
  T1,
  defaultRequirements,
  evidenceFor,
  makeArtifact,
  support,
} from './test-support.js';

describe('evidence kinds (open, charset-validated vocabulary)', () => {
  it('accepts neutral-id kinds and rejects malformed ones', () => {
    expect(isEvidenceKind('test-report')).toBe(true);
    expect(isEvidenceKind('balance-proof')).toBe(true);
    expect(isEvidenceKind('Expert Review')).toBe(false);
    expect(isEvidenceKind('')).toBe(false);
    expect(isEvidenceKind(42)).toBe(false);
  });
});

describe('evidence provenance', () => {
  it('field list and guard', () => {
    expect([...EVIDENCE_PROVENANCE_FIELDS]).toEqual(['producedBy', 'producedAt', 'notes']);
    expect(
      isEvidenceProvenance({ producedBy: 'erp-close-sandbox', producedAt: T1, notes: null }),
    ).toBe(true);
    expect(isEvidenceProvenance({ producedBy: 'ERP!', producedAt: T1, notes: null })).toBe(false);
    expect(isEvidenceProvenance({ producedBy: 'ok', producedAt: 'yesterday', notes: null })).toBe(false);
    expect(isEvidenceProvenance({ producedBy: 'ok', producedAt: T1, notes: 7 })).toBe(false);
  });
});

describe('evidence references (A002 artifact refs, reused validators)', () => {
  it('binds kind + artifact ref + provenance over a REAL A002 artifact', async () => {
    const artifact = await makeArtifact(1);
    const ref = evidenceFor(artifact, 'test-report');
    expect([...EVIDENCE_REFERENCE_FIELDS]).toEqual(['evidenceKind', 'artifact', 'provenance']);
    expect(isEvidenceReference(ref)).toBe(true);
    expect(ref.artifact.digest).toBe(artifact.digest);
    expect(ref.artifact.namespace).toBe('tenant-a');
  });

  it('evidenceReferenceKey is stable and names kind + artifact', async () => {
    const artifact = await makeArtifact(2);
    const ref = evidenceFor(artifact, 'balance-proof');
    expect(evidenceReferenceKey(ref as never)).toBe(
      `balance-proof:tenant-a/evidence-artifact-002@1.0.0#${artifact.digest}`,
    );
  });

  it('rejects malformed artifact refs through the REAL A002 validators', async () => {
    const artifact = await makeArtifact(3);
    const base = evidenceFor(artifact, 'test-report');
    const badNamespace = { ...base, artifact: { ...base.artifact, namespace: 'BAD_NS' } };
    expect(isEvidenceReference(badNamespace)).toBe(false);
    const badDigest = { ...base, artifact: { ...base.artifact, digest: 'z'.repeat(64) } };
    expect(isEvidenceReference(badDigest)).toBe(false);
  });
});

describe('toEvidenceBundle', () => {
  it('validates, freezes and preserves order', async () => {
    const a = await makeArtifact(4);
    const b = await makeArtifact(5);
    const bundle = toEvidenceBundle([
      evidenceFor(a, 'test-report'),
      evidenceFor(b, 'balance-proof', 'erp-close-sandbox'),
    ]);
    expect(bundle).toHaveLength(2);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(bundle[0]?.evidenceKind).toBe('test-report');
    expect(bundle[1]?.provenance.producedBy).toBe('erp-close-sandbox');
  });

  it('rejects empty bundles and malformed entries (adversarial)', async () => {
    expect(() => toEvidenceBundle([])).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_EVIDENCE }),
    );
    expect(() => toEvidenceBundle(['nope'])).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_EVIDENCE }),
    );
    const artifact = await makeArtifact(6);
    const ref = evidenceFor(artifact, 'test-report') as unknown as Record<string, unknown>;
    ref['rogueField'] = 1;
    expect(() => toEvidenceBundle([ref])).toThrowError(/unknown field/);
  });
});

describe('evidence requirements (the required-evidence declaration)', () => {
  it('field list and structural guard', () => {
    expect([...EVIDENCE_REQUIREMENT_FIELDS]).toEqual([
      'requirementId',
      'evidenceKind',
      'claim',
      'artifact',
      'requiredProducer',
    ]);
    const requirement = {
      requirementId: 'requirement-001',
      evidenceKind: 'test-report',
      claim: 'the suite passes',
      artifact: null,
      requiredProducer: null,
    };
    expect(isEvidenceRequirement(requirement)).toBe(true);
    expect(isEvidenceRequirement({ ...requirement, claim: '' })).toBe(false);
    expect(isEvidenceRequirement({ ...requirement, evidenceKind: 'BAD' })).toBe(false);
  });

  it('toRequiredEvidence freezes and preserves declaration order', () => {
    const requirements = toRequiredEvidence(defaultRequirements());
    expect(requirements).toHaveLength(2);
    expect(Object.isFrozen(requirements)).toBe(true);
    expect(requirements[0]?.requirementId).toBe('requirement-001');
    expect(requirements[1]?.requiredProducer).toBe('erp-close-sandbox');
  });

  it('rejects empty declarations (a verifier must declare evidence)', () => {
    expect(() => toRequiredEvidence([])).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_REQUIREMENT }),
    );
  });

  it('rejects duplicate requirement ids (adversarial)', () => {
    const duplicate = [
      { requirementId: 'req-x', evidenceKind: 'test-report', claim: 'a', artifact: null, requiredProducer: null },
      { requirementId: 'req-x', evidenceKind: 'balance-proof', claim: 'b', artifact: null, requiredProducer: null },
    ];
    expect(() => toRequiredEvidence(duplicate)).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.DUPLICATE_REQUIREMENT }),
    );
  });

  it('artifact pins are validated by the REAL A002 ref validators (fail-closed)', async () => {
    const artifact = await createMaterialArtifact({
      identity: { namespace: 'tenant-a', name: 'pinned-report', version: '1.0.0' },
      content: { pinned: true },
    });
    const pinned = toRequiredEvidence([
      {
        requirementId: 'req-pin',
        evidenceKind: 'test-report',
        claim: 'exactly this report',
        artifact: {
          namespace: artifact.identity.namespace,
          name: artifact.identity.name,
          version: artifact.identity.version,
          digest: artifact.digest,
        },
        requiredProducer: null,
      },
    ]);
    expect(pinned[0]?.artifact?.digest).toBe(artifact.digest);
    // a malformed pin is rejected by A002's own ArtifactError — the real
    // artifact validators are the gate, never a local re-implementation
    expect(() =>
      toRequiredEvidence([
        {
          requirementId: 'req-pin',
          evidenceKind: 'test-report',
          claim: 'x',
          artifact: { namespace: 'x', name: 'y', version: '99', digest: 'nope' },
          requiredProducer: null,
        },
      ]),
    ).toThrowError(/namespace|digest/);
  });
});

describe('support statuses and summaries', () => {
  it('the closed status vocabulary has exactly five members, no quantitative ones', () => {
    expect([...EVIDENCE_SUPPORT_STATUSES]).toEqual([
      'present-supported',
      'present-unsupported',
      'present-unverified',
      'present-indeterminate',
      'missing',
    ]);
    expect(Object.isFrozen(EVIDENCE_SUPPORT_STATUSES)).toBe(true);
    for (const status of EVIDENCE_SUPPORT_STATUSES) {
      expect(isEvidenceSupportStatus(status)).toBe(true);
    }
    expect(isEvidenceSupportStatus('present-excellent')).toBe(false);
    expect(isEvidenceSupportStatus('0.9')).toBe(false);
  });

  it('requirement support: field list, guard, summary validation', () => {
    expect([...REQUIREMENT_SUPPORT_FIELDS]).toEqual([
      'requirementId',
      'status',
      'evidenceDigest',
      'notes',
    ]);
    const entry = {
      requirementId: 'requirement-001',
      status: 'present-supported',
      evidenceDigest: 'a'.repeat(64),
      notes: null,
    };
    expect(isRequirementSupport(entry)).toBe(true);
    expect(isRequirementSupport({ ...entry, status: 'meh' })).toBe(false);
    expect(isRequirementSupport({ ...entry, evidenceDigest: 'short' })).toBe(false);
    const summary = toEvidenceSupportSummary([
      entry,
      { requirementId: 'requirement-002', status: 'missing', evidenceDigest: null, notes: 'absent' },
    ]);
    expect(isEvidenceSupportSummary(summary)).toBe(true);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(isEvidenceSupportSummary([])).toBe(false);
    expect(isEvidenceSupportSummary('nope' as never)).toBe(false);
    // duplicate requirement ids are rejected by the throwing parser (construction gate)
    expect(() => toEvidenceSupportSummary([entry, { ...entry }])).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.DUPLICATE_REQUIREMENT }),
    );
  });

  it('the evidence-consistency rule: missing names no evidence; present must name it', () => {
    expect(
      isSupportEvidenceConsistent(support('r', 'missing', null) as never),
    ).toBe(true);
    expect(
      isSupportEvidenceConsistent(support('r', 'missing', 'a'.repeat(64)) as never),
    ).toBe(false);
    expect(
      isSupportEvidenceConsistent(support('r', 'present-supported', 'a'.repeat(64)) as never),
    ).toBe(true);
    expect(
      isSupportEvidenceConsistent(support('r', 'present-supported', null) as never),
    ).toBe(false);
  });
});
