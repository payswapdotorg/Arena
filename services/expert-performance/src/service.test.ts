/**
 * Integration tests (Work Order C005): the profile ASSEMBLED from injected
 * dep fakes, the two lenses over the same canonical object, idempotent
 * ingestion, attribution threading across appends, and envelope
 * conventions.
 */

import { describe, expect, it } from 'vitest';
import { toIdempotencyKey } from '@arena/protocol-core';
import { ExpertPerformanceError } from '@arena/expert-performance';
import type { PerformanceEvidenceRecord } from '@arena/expert-performance';
import { ExpertPerformanceService, fakeSourcePorts } from './index.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);
const CAPABILITY = Object.freeze({
  kind: 'skill',
  id: 'rust-code-review',
  version: '1.0.0',
  digest: DIGEST_A,
});
const AT = '2026-10-01T00:00:00.000Z';
const LATER = '2026-10-05T00:00:00.000Z';

function makeService() {
  const fakes = fakeSourcePorts();
  fakes.calibration
    .add('tenant-1', 'expert-1', {
      verdict: 'calibrated',
      capability: CAPABILITY,
      evaluatorVersion: DIGEST_A,
      freshSampleCount: 4,
      totalSampleCount: 6,
      observedAt: '2026-09-10T00:00:00.000Z',
      recordDigest: DIGEST_B,
    })
    .add('tenant-1', 'expert-1', {
      verdict: 'overconfident',
      capability: CAPABILITY,
      evaluatorVersion: DIGEST_C,
      freshSampleCount: 3,
      totalSampleCount: 5,
      observedAt: '2026-09-25T00:00:00.000Z',
      recordDigest: DIGEST_A,
    });
  fakes.qualification
    .addQualification('tenant-1', 'expert-1', {
      status: 'qualified',
      capability: CAPABILITY,
      domain: 'software',
      jurisdiction: 'eu',
      conflicts: [],
      limitations: ['no-formal-signoff'],
      observedAt: '2026-09-12T00:00:00.000Z',
      recordDigest: DIGEST_C,
    })
    .addMatch('tenant-1', 'expert-1', {
      engagementOutcome: 'completed',
      reviewOutcome: 'accepted',
      agreedWithEvaluator: true,
      taskFamily: 'bug-fix-review',
      domain: 'software',
      jurisdiction: 'eu',
      evaluatorVersion: null,
      sampleSize: 2,
      observedAt: '2026-09-20T00:00:00.000Z',
      recordDigest: DIGEST_B,
    });
  fakes.skillExtraction.add('tenant-1', 'expert-1', {
    skill: CAPABILITY,
    outcome: 'demonstrated',
    consistency: 'stable',
    sampleSize: 7,
    observedAt: '2026-09-18T00:00:00.000Z',
    recordDigest: DIGEST_A,
  });
  fakes.learning.add('tenant-1', 'expert-1', {
    attributionKind: 'measurement-variance',
    evaluatorVersionBefore: null,
    evaluatorVersionAfter: null,
    capability: CAPABILITY,
    observedAt: '2026-09-22T00:00:00.000Z',
    recordDigest: DIGEST_C,
  });
  return { service: new ExpertPerformanceService(fakes.ports), fakes };
}

const OPTIONS = { correlationId: 'corr-1', idempotencyKey: toIdempotencyKey('key-1'), at: AT };

describe('appendEvidence (provenance-verified append-only ingestion)', () => {
  it('assembles a dimensional profile from injected dep fakes across all four seams', async () => {
    const { service } = makeService();
    await service.appendEvidence(
      { recordId: 'perf-001', tenant: 'tenant-1', expertId: 'expert-1', family: 'expert-calibration-verdict', dimension: 'skill-competency', refDigest: DIGEST_B },
      OPTIONS,
    );
    await service.appendEvidence(
      { recordId: 'perf-002', tenant: 'tenant-1', expertId: 'expert-1', family: 'expert-qualification-record', dimension: 'domain-jurisdiction-fit', refDigest: DIGEST_C },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-2') },
    );
    await service.appendEvidence(
      { recordId: 'perf-003', tenant: 'tenant-1', expertId: 'expert-1', family: 'expert-match-history', dimension: 'task-family-outcome', refDigest: DIGEST_B },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-3') },
    );
    await service.appendEvidence(
      { recordId: 'perf-004', tenant: 'tenant-1', expertId: 'expert-1', family: 'skill-extraction-outcome', dimension: 'skill-competency', refDigest: DIGEST_A },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-4') },
    );
    await service.appendEvidence(
      { recordId: 'perf-005', tenant: 'tenant-1', expertId: 'expert-1', family: 'learning-experiment-attribution', dimension: 'skill-competency', refDigest: DIGEST_C },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-5') },
    );

    const { profile } = await service.getRoutingInput(
      { tenant: 'tenant-1', expertId: 'expert-1' },
      { correlationId: 'corr-2', at: AT },
    );
    expect(profile.dimensions['skill-competency'].recordCount).toBe(3);
    expect(profile.dimensions['domain-jurisdiction-fit'].recordCount).toBe(1);
    expect(profile.dimensions['task-family-outcome'].recordCount).toBe(1);
    expect(profile.dimensions['skill-competency'].attributionCounts['measurement-variance']).toBe(1);
    expect(service.recordCount()).toBe(5);
    expect(service.emittedEvents()).toHaveLength(5);
    expect(service.emittedEvents()[0]?.kind).toBe('evidence-appended');
  });

  it('threads the prior evaluator version: a changed evaluator version lands as evaluator-change', async () => {
    const { service } = makeService();
    await service.appendEvidence(
      { recordId: 'perf-010', tenant: 'tenant-1', expertId: 'expert-1', family: 'expert-calibration-verdict', dimension: 'skill-competency', refDigest: DIGEST_B },
      OPTIONS,
    );
    const second = await service.appendEvidence(
      { recordId: 'perf-011', tenant: 'tenant-1', expertId: 'expert-1', family: 'expert-calibration-verdict', dimension: 'skill-competency', refDigest: DIGEST_A },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-11') },
    );
    expect(second.record.attribution.kind).toBe('evaluator-change');
    expect(second.record.attribution.evaluatorVersion).toBe(DIGEST_C);

    const { profile } = await service.getRoutingInput(
      { tenant: 'tenant-1', expertId: 'expert-1' },
      { correlationId: 'corr-3', at: AT },
    );
    const evidence = profile.dimensions['skill-competency'];
    expect(evidence.attributionCounts['expert-change']).toBe(1);
    expect(evidence.attributionCounts['evaluator-change']).toBe(1);
    expect(evidence.evaluatorVersions).toEqual([DIGEST_A, DIGEST_C]);
  });

  it('is idempotent: the same key + payload replays the stored record without double counting', async () => {
    const { service } = makeService();
    const first = await service.appendEvidence(
      { recordId: 'perf-020', tenant: 'tenant-1', expertId: 'expert-1', family: 'expert-calibration-verdict', dimension: 'skill-competency', refDigest: DIGEST_B },
      OPTIONS,
    );
    const replay = await service.appendEvidence(
      { recordId: 'perf-020', tenant: 'tenant-1', expertId: 'expert-1', family: 'expert-calibration-verdict', dimension: 'skill-competency', refDigest: DIGEST_B },
      OPTIONS,
    );
    expect(replay.replayed).toBe(true);
    expect(first.replayed).toBe(false);
    expect(replay.record.digest).toBe(first.record.digest);
    expect(service.recordCount()).toBe(1);
  });

  it('rejects the same idempotency key bound to a different payload', async () => {
    const { service } = makeService();
    await service.appendEvidence(
      { recordId: 'perf-030', tenant: 'tenant-1', expertId: 'expert-1', family: 'expert-calibration-verdict', dimension: 'skill-competency', refDigest: DIGEST_B },
      OPTIONS,
    );
    await expect(
      service.appendEvidence(
        { recordId: 'perf-031', tenant: 'tenant-1', expertId: 'expert-1', family: 'skill-extraction-outcome', dimension: 'skill-competency', refDigest: DIGEST_A },
        OPTIONS,
      ),
    ).rejects.toThrow(ExpertPerformanceError);
  });
});

describe('the two lenses over the same canonical profile', () => {
  it('serves the routing lens and the capability-history lens anchored to one profile digest', async () => {
    const { service } = makeService();
    await service.appendEvidence(
      { recordId: 'perf-040', tenant: 'tenant-1', expertId: 'expert-1', family: 'expert-match-history', dimension: 'task-family-outcome', refDigest: DIGEST_B },
      OPTIONS,
    );
    await service.appendEvidence(
      { recordId: 'perf-041', tenant: 'tenant-1', expertId: 'expert-1', family: 'expert-match-history', dimension: 'review-outcome', refDigest: DIGEST_B },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-41') },
    );
    const routing = await service.getRoutingInput(
      { tenant: 'tenant-1', expertId: 'expert-1' },
      { correlationId: 'corr-4', at: AT },
    );
    const history = await service.getCapabilityHistory(
      { tenant: 'tenant-1', expertId: 'expert-1' },
      { correlationId: 'corr-5', at: AT },
    );
    expect(routing.lens.profileDigest).toBe(history.profile.digest);
    expect(history.history.profileDigest).toBe(routing.profile.digest);
    expect(history.history.totalRecords).toBe(2);
    expect(routing.lens.dimensions).toHaveLength(8);
    const taskFamily = routing.lens.dimensions.find((s) => s.dimension === 'task-family-outcome');
    expect(taskFamily?.latestOutcome).toBe('completed');
    expect(taskFamily?.freshness.status).toBe('fresh');
  });

  it('is deterministic: identical state + projection time ⇒ identical profile digest', async () => {
    const left = makeService();
    const right = makeService();
    for (const service of [left.service, right.service]) {
      await service.appendEvidence(
        { recordId: 'perf-050', tenant: 'tenant-1', expertId: 'expert-1', family: 'expert-calibration-verdict', dimension: 'skill-competency', refDigest: DIGEST_B },
        OPTIONS,
      );
    }
    const leftProfile = await left.service.getRoutingInput(
      { tenant: 'tenant-1', expertId: 'expert-1' },
      { correlationId: 'corr-6', at: AT },
    );
    const rightProfile = await right.service.getRoutingInput(
      { tenant: 'tenant-1', expertId: 'expert-1' },
      { correlationId: 'corr-7', at: AT },
    );
    expect(leftProfile.profile.digest).toBe(rightProfile.profile.digest);
  });

  it('serves the single-dimension aggregate with mandatory disclosures', async () => {
    const { service } = makeService();
    await service.appendEvidence(
      { recordId: 'perf-060', tenant: 'tenant-1', expertId: 'expert-1', family: 'skill-extraction-outcome', dimension: 'skill-competency', refDigest: DIGEST_A },
      OPTIONS,
    );
    const aggregate = await service.getDimensionAggregate(
      { tenant: 'tenant-1', expertId: 'expert-1', dimension: 'skill-competency' },
      { correlationId: 'corr-8', at: LATER },
    );
    expect(aggregate.formula).toBe('dimensional-outcome-frequency');
    expect(aggregate.outcomeCounts).toEqual({ demonstrated: 1 });
    expect(aggregate.limitations.length).toBeGreaterThanOrEqual(3);
  });

  it('serves the provenance-addressable record read for the owning tenant', async () => {
    const { service } = makeService();
    const appended = await service.appendEvidence(
      { recordId: 'perf-070', tenant: 'tenant-1', expertId: 'expert-1', family: 'skill-extraction-outcome', dimension: 'skill-competency', refDigest: DIGEST_A },
      OPTIONS,
    );
    const fetched = await service.getEvidenceRecord(
      { tenant: 'tenant-1', recordId: 'perf-070' },
      { correlationId: 'corr-9' },
    );
    expect(fetched.digest).toBe(appended.record.digest);
  });

  it('fails closed on unknown records and invalid inputs', async () => {
    const { service } = makeService();
    await expect(
      service.getEvidenceRecord({ tenant: 'tenant-1', recordId: 'perf-nope' }, { correlationId: 'corr-10' }),
    ).rejects.toThrow(ExpertPerformanceError);
    await expect(
      service.appendEvidence(
        { recordId: 'perf-bad', tenant: 'tenant-1', expertId: 'expert-1', family: 'skill-extraction-outcome', dimension: 'not-a-dimension', refDigest: DIGEST_A },
        OPTIONS,
      ),
    ).rejects.toThrow(ExpertPerformanceError);
  });

  it('a tampered store entry fails closed on read (digest re-verification)', async () => {
    const { service } = makeService();
    await service.appendEvidence(
      { recordId: 'perf-080', tenant: 'tenant-1', expertId: 'expert-1', family: 'skill-extraction-outcome', dimension: 'skill-competency', refDigest: DIGEST_A },
      OPTIONS,
    );
    const internals = service as unknown as {
      readonly records: Map<string, PerformanceEvidenceRecord>;
    };
    const stored = internals.records.get('perf-080');
    expect(stored).toBeDefined();
    internals.records.set('perf-080', { ...stored!, outcome: 'improved' } as PerformanceEvidenceRecord);
    await expect(
      service.getEvidenceRecord({ tenant: 'tenant-1', recordId: 'perf-080' }, { correlationId: 'corr-11' }),
    ).rejects.toThrow(ExpertPerformanceError);
    await expect(
      service.getRoutingInput({ tenant: 'tenant-1', expertId: 'expert-1' }, { correlationId: 'corr-12', at: AT }),
    ).rejects.toThrow(ExpertPerformanceError);
  });
});
