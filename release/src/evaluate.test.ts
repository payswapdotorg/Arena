/**
 * REL1.0 record + evaluator tests: positive and adversarial
 * (fail-closed).
 */

import { describe, expect, it } from 'vitest';
import type { HealthGateEvaluation } from '@arena/deploy';
import {
  EVIDENCE_KINDS,
  RELEASE_ERROR_CODES,
  ReleaseError,
  evaluateLaunchReadiness,
  isLaunchReadinessRecord,
  launchRecordDigest,
  verifyLaunchRecord,
} from './index.js';
import type { ReleaseEvidenceCitation } from './index.js';

const DIGEST = 'a'.repeat(64);

const PASSING_GATES: readonly HealthGateEvaluation[] = [
  {
    gateId: 'gate-console-slo-console-availability',
    sloId: 'slo-console-availability',
    serviceId: 'console',
    requiredVerdict: 'met',
    observedVerdict: 'met',
    passed: true,
  },
];

function fullEvidence(): readonly ReleaseEvidenceCitation[] {
  return [
    { kind: 'health-gate-report', path: 'deploy/src/reference.ts', digest: DIGEST, note: null },
    { kind: 'performance-evidence', path: 'tests/performance/src', digest: DIGEST, note: null },
    { kind: 'security-audit', path: 'packages/security', digest: DIGEST, note: null },
    { kind: 'checklist-evaluation', path: 'ops/src/reference.ts', digest: DIGEST, note: null },
    { kind: 'manifest', path: 'deploy/src/reference.ts', digest: DIGEST, note: null },
  ];
}

describe('REL1.0 evaluator — positive', () => {
  it('GO when gates, checklist, security, performance and evidence are all green', () => {
    const result = evaluateLaunchReadiness({
      gateEvaluations: PASSING_GATES,
      checklistVerdict: 'go',
      securityVerdict: 'pass',
      performanceVerdict: 'pass',
      evidence: fullEvidence(),
    });
    expect(result.verdict).toBe('go');
    expect(result.reasons).toEqual([]);
  });
});

describe('REL1.0 evaluator — adversarial (fail-closed)', () => {
  it('SLO-violating release is rejected (breached gate → no-go)', () => {
    const breached: readonly HealthGateEvaluation[] = [
      {
        gateId: 'gate-console-slo-console-availability',
        sloId: 'slo-console-availability',
        serviceId: 'console',
        requiredVerdict: 'met',
        observedVerdict: 'breached',
        passed: false,
      },
    ];
    const result = evaluateLaunchReadiness({
      gateEvaluations: breached,
      checklistVerdict: 'go',
      securityVerdict: 'pass',
      performanceVerdict: 'pass',
      evidence: fullEvidence(),
    });
    expect(result.verdict).toBe('no-go');
    expect(result.reasons.join(' ')).toContain('SLO-violating release rejected');
  });

  it('missing health gates fail closed (no-data is not a pass)', () => {
    for (const gates of [null, []] as const) {
      const result = evaluateLaunchReadiness({
        gateEvaluations: gates,
        checklistVerdict: 'go',
        securityVerdict: 'pass',
        performanceVerdict: 'pass',
        evidence: fullEvidence(),
      });
      expect(result.verdict).toBe('no-go');
    }
  });

  it('missing checklist / security / performance verdicts each force no-go', () => {
    for (const patch of [
      { checklistVerdict: null },
      { securityVerdict: null },
      { performanceVerdict: null },
    ] as const) {
      const result = evaluateLaunchReadiness({
        gateEvaluations: PASSING_GATES,
        checklistVerdict: 'go',
        securityVerdict: 'pass',
        performanceVerdict: 'pass',
        evidence: fullEvidence(),
        ...patch,
      });
      expect(result.verdict).toBe('no-go');
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });

  it('missing evidence of a required kind forces no-go', () => {
    const evidence = fullEvidence().filter((citation) => citation.kind !== 'manifest');
    const result = evaluateLaunchReadiness({
      gateEvaluations: PASSING_GATES,
      checklistVerdict: 'go',
      securityVerdict: 'pass',
      performanceVerdict: 'pass',
      evidence,
    });
    expect(result.verdict).toBe('no-go');
    expect(result.reasons.join(' ')).toContain('manifest');
  });

  it('unsigned evidence (malformed digest) is rejected with a typed error, never a pass', () => {
    const unsigned: readonly ReleaseEvidenceCitation[] = [
      ...fullEvidence().slice(0, 4),
      { kind: 'manifest', path: 'deploy/src/reference.ts', digest: 'deadbeef', note: null },
    ];
    expect(() =>
      evaluateLaunchReadiness({
        gateEvaluations: PASSING_GATES,
        checklistVerdict: 'go',
        securityVerdict: 'pass',
        performanceVerdict: 'pass',
        evidence: unsigned,
      }),
    ).toThrow(ReleaseError);
    try {
      evaluateLaunchReadiness({
        gateEvaluations: PASSING_GATES,
        checklistVerdict: 'go',
        securityVerdict: 'pass',
        performanceVerdict: 'pass',
        evidence: unsigned,
      });
    } catch (error) {
      expect((error as ReleaseError).code).toBe(RELEASE_ERROR_CODES.UNSIGNED_EVIDENCE);
    }
  });
});

describe('REL1.0 record — digests and validation', () => {
  it('a record verifies against its own content digest', async () => {
    const core = {
      recordVersion: 1 as const,
      releaseId: 'test-release',
      releaseVersion: 'v0.0.1',
      verdict: 'no-go' as const,
      evidence: [] as readonly ReleaseEvidenceCitation[],
      decidedAt: 1_791_232_000_000,
      priorRecordDigest: null,
    };
    const record = { ...core, recordDigest: await launchRecordDigest(core) };
    expect(isLaunchReadinessRecord(record)).toBe(true);
    expect(await verifyLaunchRecord(record)).toBe(true);
  });

  it('tampering with the content breaks the digest (fail-closed)', async () => {
    const core = {
      recordVersion: 1 as const,
      releaseId: 'test-release',
      releaseVersion: 'v0.0.1',
      verdict: 'no-go' as const,
      evidence: [] as readonly ReleaseEvidenceCitation[],
      decidedAt: 1_791_232_000_000,
      priorRecordDigest: null,
    };
    const record = { ...core, recordDigest: await launchRecordDigest(core) };
    const tampered = { ...record, verdict: 'go' as const };
    expect(await verifyLaunchRecord(tampered)).toBe(false);
  });

  it('the evidence-kind vocabulary is closed', () => {
    expect(EVIDENCE_KINDS).toContain('performance-evidence');
    expect(EVIDENCE_KINDS).toHaveLength(6);
  });
});
