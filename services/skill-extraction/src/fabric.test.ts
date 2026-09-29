/**
 * ExtractionService tests (Work Order A019 item 6): the golden path —
 * policy → validated refs → candidates → drafts → run record — plus
 * idempotent replay (byte-identical), supersession by append, and the
 * pure query projections.
 */

import { describe, expect, it } from 'vitest';
import {
  isCapabilityNode,
} from '@arena/capability-graph';
import { ExtractionService } from './fabric.js';
import { SkillExtractionError } from '@arena/skill-extraction';
import { verifyExtractionRunRecord } from './record.js';
import {
  CORR,
  makeRef,
  registerDefaultPolicy,
  RUN_KEY,
  T5,
  T6,
} from './test-support.js';

describe('ExtractionService — the golden path', () => {
  it('runs a policy over validated refs and emits candidates, drafts and the run record', async () => {
    const service = new ExtractionService();
    const policy = await registerDefaultPolicy(service);
    const ref = await makeRef();
    const record = await service.extract(policy.digest, [ref], {
      runKey: RUN_KEY,
      correlationId: CORR,
      startedAt: T5,
      finishedAt: T6,
    });

    expect(record.policyRef).toBe(policy.digest);
    expect(record.inputs).toEqual([ref.digest]);
    expect(record.candidates).toHaveLength(1);
    expect(record.drafts).toHaveLength(1);
    expect(record.trajectoryDecisions).toHaveLength(1);
    expect(record.trajectoryDecisions[0]?.reason).toBe('accepted');
    expect(record.correlationId).toBe(CORR);
    expect(record.runKey).toBe(RUN_KEY);
    await expect(verifyExtractionRunRecord(record)).resolves.toBe(record.digest);

    // The draft is retrievable and A004-ready.
    const draftDigest = record.drafts[0];
    expect(draftDigest).toBeDefined();
    const draft = service.getDraft(draftDigest as string);
    expect(draft).toBeDefined();
    expect(isCapabilityNode(draft!.skillNode)).toBe(true);
    expect(service.getDraftForCandidate(record.candidates[0] as string)?.digest).toBe(
      draftDigest,
    );
  });

  it('records reject decisions when evidence does not meet the policy (no candidates, still a record)', async () => {
    const service = new ExtractionService();
    const policy = await registerDefaultPolicy(service);
    const failingRef = await makeRef({ outcome: 'failed' });
    const record = await service.extract(policy.digest, [failingRef], {
      runKey: RUN_KEY,
      correlationId: CORR,
      startedAt: T5,
      finishedAt: T6,
    });
    expect(record.candidates).toHaveLength(0);
    expect(record.drafts).toHaveLength(0);
    expect(record.trajectoryDecisions[0]?.reason).toBe('outcome-not-completed');
    expect(record.patternDecisions).toHaveLength(0);
  });

  it('mixes accepted and rejected trajectories in one run (full decision log)', async () => {
    const service = new ExtractionService();
    const policy = await registerDefaultPolicy(service);
    const good = await makeRef({ actionIds: ['shared-a', 'shared-b'] });
    const bad = await makeRef({ actionIds: ['shared-a', 'shared-b'], outcome: 'timed-out' });
    const record = await service.extract(policy.digest, [good, bad], {
      runKey: RUN_KEY,
      correlationId: CORR,
      startedAt: T5,
      finishedAt: T6,
    });
    expect(record.trajectoryDecisions).toHaveLength(2);
    const reasons = record.trajectoryDecisions.map((d) => d.reason);
    expect(reasons).toContain('accepted');
    expect(reasons).toContain('outcome-not-completed');
    expect(record.candidates).toHaveLength(1);
  });
});

describe('ExtractionService — idempotency (lock rule 17)', () => {
  it('the same run key + same command replays the STORED record, byte-identical, never duplicated', async () => {
    const service = new ExtractionService();
    const policy = await registerDefaultPolicy(service);
    const ref = await makeRef();
    const first = await service.extract(policy.digest, [ref], {
      runKey: RUN_KEY,
      correlationId: CORR,
      startedAt: T5,
      finishedAt: T6,
    });
    const second = await service.extract(policy.digest, [ref], {
      runKey: RUN_KEY,
      correlationId: CORR,
      // Different options are IGNORED on replay: the stored record is
      // authoritative (same key + same command tuple).
      startedAt: T5,
      finishedAt: T6,
    });
    expect(second).toBe(first);
    expect(service.listRuns()).toHaveLength(1);
  });

  it('the same run key + a DIFFERENT command is an IDEMPOTENCY_CONFLICT', async () => {
    const service = new ExtractionService();
    const policy = await registerDefaultPolicy(service);
    const refA = await makeRef({ actionIds: ['a'] });
    const refB = await makeRef({ actionIds: ['b'] });
    await service.extract(policy.digest, [refA], {
      runKey: RUN_KEY,
      correlationId: CORR,
      startedAt: T5,
      finishedAt: T6,
    });
    await expect(
      service.extract(policy.digest, [refB], {
        runKey: RUN_KEY,
        correlationId: CORR,
        startedAt: T5,
        finishedAt: T6,
      }),
    ).rejects.toMatchObject({ code: 'SKILL_EXTRACTION_IDEMPOTENCY_CONFLICT' });
  });

  it('deterministic replay: two FRESH services, same fixed timestamps ⇒ identical record digests', async () => {
    const runOnce = async () => {
      const service = new ExtractionService();
      const policy = await registerDefaultPolicy(service);
      const refA = await makeRef({
        trajectoryId: 'trajectory-det-1',
        runId: 'tenant-a/run-det-1',
        actionIds: ['x', 'y'],
      });
      const refB = await makeRef({
        trajectoryId: 'trajectory-det-2',
        runId: 'tenant-a/run-det-2',
        actionIds: ['x', 'y'],
      });
      return service.extract(policy.digest, [refA, refB], {
        runKey: RUN_KEY,
        correlationId: CORR,
        startedAt: T5,
        finishedAt: T6,
      });
    };
    const first = await runOnce();
    const second = await runOnce();
    expect(second.digest).toBe(first.digest);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('ExtractionService — supersession by append', () => {
  it('a re-extraction can supersede the prior draft by APPEND (the original stays addressable)', async () => {
    const service = new ExtractionService();
    const policy = await registerDefaultPolicy(service);
    const ref = await makeRef({ actionIds: ['supersede-me'] });

    const first = await service.extract(policy.digest, [ref], {
      runKey: 'run-key-supersede-0001',
      correlationId: CORR,
      startedAt: T5,
      finishedAt: T6,
    });
    const firstDraft = service.getDraft(first.drafts[0] as string);
    expect(firstDraft).toBeDefined();

    const second = await service.extract(policy.digest, [ref], {
      runKey: 'run-key-supersede-0002',
      correlationId: CORR,
      startedAt: T5,
      finishedAt: T6,
      supersessions: new Map([
        [first.candidates[0] as string, { supersedes: firstDraft!.skillNode.digest, skillVersion: '1.1.0' }],
      ]),
    });
    const secondDraft = service.getDraft(second.drafts[0] as string);
    expect(secondDraft).toBeDefined();
    expect(secondDraft!.supersedes).toBe(firstDraft!.skillNode.digest);
    expect(secondDraft!.skillNode.version).toBe('1.1.0');
    // Both drafts stay addressable (append-only store).
    expect(service.getDraft(first.drafts[0] as string)?.digest).toBe(firstDraft!.digest);
    expect(service.listDrafts().length).toBeGreaterThanOrEqual(2);
  });
});

describe('ExtractionService — queries (pure projections)', () => {
  it('queries by policy, correlation id, time range and full ledger', async () => {
    const service = new ExtractionService();
    const policy = await registerDefaultPolicy(service);
    const ref = await makeRef();
    const recordA = await service.extract(policy.digest, [ref], {
      runKey: 'run-key-query-0001',
      correlationId: CORR,
      startedAt: T5,
      finishedAt: T5,
    });
    const recordB = await service.extract(policy.digest, [ref], {
      runKey: 'run-key-query-0002',
      correlationId: 'corr-fabric-extraction-0002',
      startedAt: T6,
      finishedAt: T6,
    });

    expect(service.getRunRecord(recordA.digest)?.digest).toBe(recordA.digest);
    expect(service.listRunsByPolicy(policy.digest)).toHaveLength(2);
    expect(service.listRunsByCorrelation(CORR)).toHaveLength(1);
    expect(service.listRunsByCorrelation(CORR)[0]?.digest).toBe(recordA.digest);
    expect(service.listRunsByTimeRange({ from: T6 })).toHaveLength(1);
    expect(service.listRunsByTimeRange({ from: T5, to: T6 })).toHaveLength(2);
    expect(service.listRunsByTimeRange({})).toHaveLength(2);
    expect(service.listRuns()).toHaveLength(2);
    expect(() => service.listRunsByTimeRange({ from: 'not-a-time' })).toThrow(
      SkillExtractionError,
    );
    try {
      service.listRunsByTimeRange({ from: 'not-a-time' });
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as SkillExtractionError).code).toBe('SKILL_EXTRACTION_INVALID_TIMESTAMP');
    }
    // recordA !== recordB (different keys + different correlation ids)
    expect(recordA.digest).not.toBe(recordB.digest);
  });
});
