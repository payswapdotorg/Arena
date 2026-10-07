/**
 * Ingestion mapping tests (Work Order C020): C009 validation outcomes and
 * C013 competition outcomes map into dimensional reputation records
 * through pure closed tables; findings propose profile evidence into the
 * C005 ingestion ports and requalification triggers into owning surfaces.
 */

import { describe, expect, it } from 'vitest';
import {
  mapValidationOutcomeToReputation,
  mapCompetitionOutcomeToReputation,
  mapDisputeOutcomeToReputation,
  mapCoiRecordToReputation,
  mapFindingToConductFlag,
  proposeProfileEvidence,
  proposeRequalificationTrigger,
  createReputationRecord,
  createFinding,
  NETWORK_QUALITY_ERROR_CODES,
} from './index.js';

const DIGEST_A = 'a'.repeat(64);
const AT = '2026-10-01T00:00:00.000Z';
const LATER = '2026-10-05T00:00:00.000Z';

describe('mapValidationOutcomeToReputation (the C009 seam)', () => {
  const cases: [string, string][] = [
    ['accepted', 'accepted'],
    ['revision_required', 'accepted-with-revision'],
    ['rejected', 'rejected'],
    ['needs_more_evidence', 'inconclusive'],
  ];
  for (const [verdict, outcome] of cases) {
    it(`maps C009 verdict '${verdict}' -> '${outcome}'`, () => {
      const input = mapValidationOutcomeToReputation({
        recordId: 'nq-rep-101',
        recordedAt: LATER,
        source: {
          verdict: verdict as never,
          requestId: 'req-1',
          tenantId: 'tenant-1',
          expertRef: 'expert-1',
          taskFamily: 'bug-fix-review',
          recordDigest: DIGEST_A,
          observedAt: AT,
        },
      });
      expect(input.family).toBe('validation-outcome');
      expect(input.outcome).toBe(outcome);
      expect(input.applicability.taskFamily).toBe('bug-fix-review');
      expect(input.source.surface).toBe('escalation-validation');
      expect(input.source.refDigest).toBe(DIGEST_A);
    });
  }

  it('the mapped input constructs a valid reputation record', async () => {
    const input = mapValidationOutcomeToReputation({
      recordId: 'nq-rep-102',
      recordedAt: LATER,
      source: {
        verdict: 'rejected',
        requestId: 'req-2',
        tenantId: 'tenant-1',
        expertRef: 'expert-1',
        taskFamily: 'bug-fix-review',
        recordDigest: DIGEST_A,
        observedAt: AT,
      },
    });
    const record = await createReputationRecord(input);
    expect(record.outcome).toBe('rejected');
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('mapCompetitionOutcomeToReputation (the C013 seam)', () => {
  it('maps an agreement outcome with competition provenance', async () => {
    const input = mapCompetitionOutcomeToReputation({
      recordId: 'nq-rep-201',
      recordedAt: LATER,
      source: {
        agreement: 'disagreed',
        competitionId: 'comp-1',
        tenantId: 'tenant-1',
        expertRef: 'expert-2',
        taskFamily: 'code-review-arena',
        recordDigest: DIGEST_A,
        observedAt: AT,
      },
    });
    expect(input.family).toBe('competition-agreement');
    expect(input.outcome).toBe('disagreed');
    expect(input.source.locator).toBe('comp-1');
    const record = await createReputationRecord(input);
    expect(record.family).toBe('competition-agreement');
  });
});

describe('the C020-owned record mappers', () => {
  it('maps a resolved dispute into a dispute-outcome record', async () => {
    const input = mapDisputeOutcomeToReputation({
      recordId: 'nq-rep-301',
      recordedAt: LATER,
      dispute: { tenant: 'tenant-1', expertRef: 'expert-2', recordDigest: DIGEST_A, observedAt: AT },
      resolutionOutcome: 'upheld',
      domain: 'software',
    });
    expect(input.family).toBe('dispute-outcome');
    expect(input.outcome).toBe('upheld');
    expect(input.applicability.domain).toBe('software');
    const record = await createReputationRecord(input);
    expect(record.source.surface).toBe('network-quality');
  });

  it('maps a COI record into a coi-record family record', async () => {
    const input = mapCoiRecordToReputation({
      recordId: 'nq-rep-302',
      recordedAt: LATER,
      coi: { tenant: 'tenant-1', expertRef: 'expert-3', recordDigest: DIGEST_A, observedAt: AT },
      outcome: 'conflict-derived',
      domain: 'software',
    });
    const record = await createReputationRecord(input);
    expect(record.family).toBe('coi-record');
    expect(record.outcome).toBe('conflict-derived');
  });
});

describe('mapFindingToConductFlag', () => {
  it('maps a finding into a conduct-flag reputation record', async () => {
    const finding = await createFinding({
      findingId: 'nq-find-001',
      tenant: 'tenant-1',
      subjectParty: 'expert-4',
      kind: 'coordinated-brigading',
      severity: 'high',
      evidence: [{ surface: 'adversarial-evaluation', refId: 'judg-1', refDigest: null }],
      reasons: [{ code: 'coordinated-brigading-pattern', detail: '3 clusters voted in lockstep' }],
      observedAt: AT,
      detectedAt: LATER,
      summary: 'brigading detected',
    });
    const input = mapFindingToConductFlag({
      recordId: 'nq-rep-401',
      recordedAt: LATER,
      finding: {
        tenant: finding.tenant,
        subjectParty: finding.subjectParty,
        digest: finding.digest,
        observedAt: finding.observedAt,
        evidenceSurface: 'adversarial-evaluation',
        kind: finding.kind,
        severity: finding.severity,
        domain: 'software',
      },
    });
    expect(input.family).toBe('conduct-flag');
    expect(input.outcome).toBe('flag-raised');
    expect(input.source.refDigest).toBe(finding.digest);
    const record = await createReputationRecord(input);
    expect(record.notes).toContain('coordinated-brigading');
  });

  it('rejects a finding surface outside the closed conduct-flag mapping', () => {
    expect(() =>
      mapFindingToConductFlag({
        recordId: 'nq-rep-402',
        recordedAt: LATER,
        finding: {
          tenant: 'tenant-1',
          subjectParty: 'expert-4',
          digest: DIGEST_A,
          observedAt: AT,
          evidenceSurface: 'not-a-surface',
          kind: 'capacity-gaming',
          severity: 'medium',
          domain: 'software',
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE }),
    );
  });
});

describe('the proposal surface (PROPOSE, never write)', () => {
  it('builds a profile-evidence proposal targeting a closed C005 family', () => {
    const proposal = proposeProfileEvidence({
      tenant: 'tenant-1',
      expertId: 'expert-1',
      targetFamily: 'expert-match-history',
      targetDimension: 'review-outcome',
      targetOutcome: 'rejected',
      sampleSize: 1,
      refDigest: DIGEST_A,
      provenanceSurface: 'escalation-validation',
      reason: 'C009 adjudication outcome for request req-2',
    });
    expect(proposal.proposalKind).toBe('profile-evidence-proposal');
    expect(proposal.targetFamily).toBe('expert-match-history');
    expect(proposal.provenanceSurface).toBe('escalation-validation');
  });

  it('rejects proposals outside the C005 closed family vocabulary (AQ-1)', () => {
    expect(() =>
      proposeProfileEvidence({
        tenant: 'tenant-1',
        expertId: 'expert-1',
        targetFamily: 'network-quality-finding',
        targetDimension: 'review-outcome',
        targetOutcome: 'rejected',
        sampleSize: 1,
        refDigest: DIGEST_A,
        provenanceSurface: 'escalation-validation',
        reason: 'unknown family',
      }),
    ).toThrowError(
      expect.objectContaining({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE }),
    );
  });

  it('builds a requalification-trigger proposal with evidence digests', () => {
    const proposal = proposeRequalificationTrigger({
      tenant: 'tenant-1',
      expertRef: 'expert-4',
      trigger: 'anti-gaming-finding',
      evidenceDigests: [DIGEST_A],
      reason: 'brigading pattern detected',
    });
    expect(proposal.proposalKind).toBe('requalification-trigger-proposal');
    expect(proposal.evidenceDigests).toEqual([DIGEST_A]);
  });

  it('rejects requalification proposals without evidence', () => {
    expect(() =>
      proposeRequalificationTrigger({
        tenant: 'tenant-1',
        expertRef: 'expert-4',
        trigger: 'fraud-finding',
        evidenceDigests: [],
        reason: 'no evidence',
      }),
    ).toThrowError(
      expect.objectContaining({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD }),
    );
  });
});
