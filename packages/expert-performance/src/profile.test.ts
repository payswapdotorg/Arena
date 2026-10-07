/**
 * Profile, lens and freshness tests (Work Order C005): determinism of the
 * fold, per-dimension separation, freshness policy behavior (never silent
 * decay), the two lenses over the SAME canonical profile, cross-tenant
 * assembly fail-closed, and the structural no-global-score invariant.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRESHNESS_POLICY,
  EXPERT_PERFORMANCE_ERROR_CODES,
  EXPERT_PERFORMANCE_ERROR_CODES as CODES,
  ExpertPerformanceError,
  PERFORMANCE_DIMENSIONS,
  assemblePerformanceProfile,
  createEvidenceRecord,
  createFreshnessPolicy,
  evaluateFreshness,
  toCapabilityHistoryLens,
  toRoutingLens,
} from './index.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const CAPABILITY = Object.freeze({
  kind: 'skill',
  id: 'rust-code-review',
  version: '1.0.0',
  digest: DIGEST_A,
});

async function record(overrides: Record<string, unknown>, index: number) {
  return createEvidenceRecord({
    recordId: `perf-${String(index).padStart(3, '0')}`,
    tenant: 'tenant-1',
    expertId: 'expert-1',
    dimension: 'skill-competency',
    outcome: 'demonstrated',
    applicability: { capability: CAPABILITY },
    sampleSize: 2,
    confidence: null,
    observedAt: `2026-09-0${(index % 9) + 1}T00:00:00.000Z`,
    recordedAt: `2026-09-0${(index % 9) + 1}T01:00:00.000Z`,
    source: { family: 'skill-extraction-outcome', refDigest: DIGEST_B, locator: DIGEST_B },
    attribution: { kind: 'expert-change', evaluatorVersion: DIGEST_A },
    ...overrides,
  } as Parameters<typeof createEvidenceRecord>[0]);
}

describe('assemblePerformanceProfile (the canonical dimensional fold)', () => {
  it('folds all eight quality-model dimensions with zero-evidence defaults', async () => {
    const profile = await assemblePerformanceProfile({
      tenant: 'tenant-1',
      expertId: 'expert-1',
      records: [],
      policy: DEFAULT_FRESHNESS_POLICY,
      asOf: '2026-10-01T00:00:00.000Z',
    });
    expect(Object.keys(profile.dimensions).sort()).toEqual([...PERFORMANCE_DIMENSIONS].sort());
    for (const dimension of PERFORMANCE_DIMENSIONS) {
      expect(profile.dimensions[dimension].recordCount).toBe(0);
      expect(profile.dimensions[dimension].freshness.status).toBe('no-evidence');
    }
  });

  it('separates dimensions — records never leak across families', async () => {
    const skill = await record({}, 1);
    const taskFamily = await record(
      {
        dimension: 'task-family-outcome',
        outcome: 'completed',
        applicability: { taskFamily: 'bug-fix-review' },
      },
      2,
    );
    const profile = await assemblePerformanceProfile({
      tenant: 'tenant-1',
      expertId: 'expert-1',
      records: [skill, taskFamily],
      policy: DEFAULT_FRESHNESS_POLICY,
      asOf: '2026-10-01T00:00:00.000Z',
    });
    expect(profile.dimensions['skill-competency'].recordCount).toBe(1);
    expect(profile.dimensions['task-family-outcome'].recordCount).toBe(1);
    expect(profile.dimensions.agreement.recordCount).toBe(0);
    expect(profile.dimensions['skill-competency'].totalSampleSize).toBe(2);
  });

  it('is DETERMINISTIC: same records (any input order) + policy + asOf ⇒ same digest', async () => {
    const first = await record({}, 1);
    const second = await record({ outcome: 'improved' }, 2);
    const left = await assemblePerformanceProfile({
      tenant: 'tenant-1',
      expertId: 'expert-1',
      records: [first, second],
      policy: DEFAULT_FRESHNESS_POLICY,
      asOf: '2026-10-01T00:00:00.000Z',
    });
    const right = await assemblePerformanceProfile({
      tenant: 'tenant-1',
      expertId: 'expert-1',
      records: [second, first],
      policy: DEFAULT_FRESHNESS_POLICY,
      asOf: '2026-10-01T00:00:00.000Z',
    });
    expect(left.digest).toBe(right.digest);
    expect(left.dimensions['skill-competency'].recordDigests).toEqual(
      right.dimensions['skill-competency'].recordDigests,
    );
  });

  it('excludes records recorded after asOf (no time travel) and orders by observedAt', async () => {
    const first = await record({ observedAt: '2026-09-01T00:00:00.000Z', recordedAt: '2026-09-01T01:00:00.000Z' }, 1);
    const later = await record(
      {
        observedAt: '2026-09-02T00:00:00.000Z',
        recordedAt: '2026-10-02T00:00:00.000Z',
      },
      2,
    );
    const profile = await assemblePerformanceProfile({
      tenant: 'tenant-1',
      expertId: 'expert-1',
      records: [first, later],
      policy: DEFAULT_FRESHNESS_POLICY,
      asOf: '2026-10-01T00:00:00.000Z',
    });
    expect(profile.dimensions['skill-competency'].recordCount).toBe(1);
    expect(profile.dimensions['skill-competency'].latestOutcome).toBe('demonstrated');
  });

  it('fails closed on cross-tenant record assembly', async () => {
    const foreign = await record({ tenant: 'tenant-2' }, 1);
    await expect(
      assemblePerformanceProfile({
        tenant: 'tenant-1',
        expertId: 'expert-1',
        records: [foreign],
        policy: DEFAULT_FRESHNESS_POLICY,
        asOf: '2026-10-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(ExpertPerformanceError);
  });

  it('carries attribution separation and the evaluator-version lineage per dimension', async () => {
    const first = await record({ attribution: { kind: 'expert-change', evaluatorVersion: DIGEST_A } }, 1);
    const second = await record(
      {
        priorEvaluatorVersion: DIGEST_A,
        attribution: { kind: 'evaluator-change', evaluatorVersion: DIGEST_B },
      },
      2,
    );
    const profile = await assemblePerformanceProfile({
      tenant: 'tenant-1',
      expertId: 'expert-1',
      records: [first, second],
      policy: DEFAULT_FRESHNESS_POLICY,
      asOf: '2026-10-01T00:00:00.000Z',
    });
    const evidence = profile.dimensions['skill-competency'];
    expect(evidence.attributionCounts['expert-change']).toBe(1);
    expect(evidence.attributionCounts['evaluator-change']).toBe(1);
    expect(evidence.evaluatorVersions).toEqual([DIGEST_A, DIGEST_B]);
  });
});

describe('the two lenses (same canonical object, different lens)', () => {
  it('projects the routing lens with all eight dimensions and NO composite field', async () => {
    const first = await record({}, 1);
    const profile = await assemblePerformanceProfile({
      tenant: 'tenant-1',
      expertId: 'expert-1',
      records: [first],
      policy: DEFAULT_FRESHNESS_POLICY,
      asOf: '2026-10-01T00:00:00.000Z',
    });
    const lens = toRoutingLens(profile);
    expect(lens.profileDigest).toBe(profile.digest);
    expect(lens.dimensions.map((summary) => summary.dimension)).toEqual([
      ...PERFORMANCE_DIMENSIONS,
    ]);
    expect(Object.keys(lens)).not.toContain('score');
    expect(Object.keys(lens)).not.toContain('globalScore');
    const demonstrated = lens.dimensions.find((s) => s.dimension === 'skill-competency');
    const historical = lens.dimensions.find((s) => s.dimension === 'task-family-outcome');
    expect(demonstrated?.recordCount).toBe(1);
    expect(historical?.freshness.status).toBe('no-evidence');
  });

  it('projects the capability-history lens anchored to the same profile digest', async () => {
    const first = await record({}, 1);
    const second = await record({ outcome: 'improved' }, 2);
    const profile = await assemblePerformanceProfile({
      tenant: 'tenant-1',
      expertId: 'expert-1',
      records: [first, second],
      policy: DEFAULT_FRESHNESS_POLICY,
      asOf: '2026-10-01T00:00:00.000Z',
    });
    const history = toCapabilityHistoryLens(profile, [first, second]);
    expect(history.profileDigest).toBe(profile.digest);
    expect(history.totalRecords).toBe(2);
    expect(history.timeline.map((entry) => entry.outcome)).toEqual(['demonstrated', 'improved']);
    expect(history.timeline.every((entry) => 'attributionKind' in entry)).toBe(true);
  });
});

describe('freshness policy (explicit, versioned — never silent decay)', () => {
  it('assesses fresh / stale / no-evidence with reasons and the window', () => {
    const fresh = evaluateFreshness(
      'skill-competency',
      '2026-09-15T00:00:00.000Z',
      DEFAULT_FRESHNESS_POLICY,
      '2026-10-01T00:00:00.000Z',
    );
    expect(fresh.status).toBe('fresh');
    expect(fresh.reasons[0]).toContain('within-staleness-window');

    const stale = evaluateFreshness(
      'skill-competency',
      '2026-06-01T00:00:00.000Z',
      DEFAULT_FRESHNESS_POLICY,
      '2026-10-01T00:00:00.000Z',
    );
    expect(stale.status).toBe('stale');
    expect(stale.reasons.join(' ')).toContain('staleness-window-elapsed');

    const none = evaluateFreshness(
      'skill-competency',
      null,
      DEFAULT_FRESHNESS_POLICY,
      '2026-10-01T00:00:00.000Z',
    );
    expect(none.status).toBe('no-evidence');
  });

  it('rejects projection times that run backwards', () => {
    expect(() =>
      evaluateFreshness(
        'skill-competency',
        '2026-10-02T00:00:00.000Z',
        DEFAULT_FRESHNESS_POLICY,
        '2026-10-01T00:00:00.000Z',
      ),
    ).toThrow(ExpertPerformanceError);
  });

  it('stale evidence SURFACES as stale — records are never dropped or decayed', async () => {
    const old = await record(
      { observedAt: '2026-01-01T00:00:00.000Z', recordedAt: '2026-01-01T01:00:00.000Z' },
      1,
    );
    const profile = await assemblePerformanceProfile({
      tenant: 'tenant-1',
      expertId: 'expert-1',
      records: [old],
      policy: DEFAULT_FRESHNESS_POLICY,
      asOf: '2026-10-01T00:00:00.000Z',
    });
    const evidence = profile.dimensions['skill-competency'];
    expect(evidence.recordCount).toBe(1);
    expect(evidence.freshness.status).toBe('stale');
    expect(evidence.recordDigests).toHaveLength(1);
  });

  it('custom policies require all eight dimensions (no silent defaults)', () => {
    expect(() => createFreshnessPolicy({ windowsMs: { recency: 1000 } })).toThrow(
      ExpertPerformanceError,
    );
    const policy = createFreshnessPolicy({
      windowsMs: Object.fromEntries(
        PERFORMANCE_DIMENSIONS.map((dimension) => [dimension, 60 * 60 * 1000]),
      ),
    });
    expect(policy.policyVersion).toBe(1);
    const assessment = evaluateFreshness(
      'recency',
      '2026-09-30T00:00:00.000Z',
      policy,
      '2026-10-01T00:00:00.000Z',
    );
    expect(assessment.status).toBe('stale');
  });

  it('the error-code vocabulary is closed (code/category mapping intact)', () => {
    expect(CODES.TENANT_MISMATCH).toBe(EXPERT_PERFORMANCE_ERROR_CODES.TENANT_MISMATCH);
    expect(Object.keys(EXPERT_PERFORMANCE_ERROR_CODES)).toContain('GLOBAL_SCORE_REJECTED');
  });
});
