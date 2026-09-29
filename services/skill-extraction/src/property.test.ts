/**
 * Property tests for the fabric (Work Order A019): seeded-LCG scenarios
 * over the full service pipeline — determinism, replay stability, the
 * R17 gate totality and ledger invariants.
 */

import { describe, expect, it } from 'vitest';
import { createExtractionPolicy } from '@arena/skill-extraction';
import { ExtractionService } from './fabric.js';
import { verifyExtractionRunRecord } from './record.js';
import {
  CORR,
  makeRef,
  makeTargetNodeAndPolicyInput,
  TestLcg,
  T5,
  T6,
} from './test-support.js';

const ACTION_POOL = ['act-alpha', 'act-beta', 'act-gamma', 'act-delta'];

describe('property — the fabric over seeded corpora', () => {
  it('P1 every run record verifies and every draft is retrievable', async () => {
    const lcg = new TestLcg(0xfab1);
    for (let scenario = 0; scenario < 5; scenario += 1) {
      const service = new ExtractionService();
      const { input } = await makeTargetNodeAndPolicyInput({
        minTrajectories: 1 + lcg.int(2),
      });
      const policy = await service.registerPolicy(await createExtractionPolicy(input));
      const refs = [];
      const refCount = 1 + lcg.int(3);
      for (let index = 0; index < refCount; index += 1) {
        refs.push(
          await makeRef({
            trajectoryId: `trajectory-pp${String(scenario)}-${String(index)}`,
            runId: `tenant-a/run-pp${String(scenario)}-${String(index)}`,
            actionIds: Array.from(
              { length: 1 + lcg.int(3) },
              () => ACTION_POOL[lcg.int(ACTION_POOL.length)] as string,
            ),
          }),
        );
      }
      const record = await service.extract(policy.digest, refs, {
        runKey: `run-key-pp-${String(scenario)}`,
        correlationId: CORR,
        startedAt: T5,
        finishedAt: T6,
      });
      await expect(verifyExtractionRunRecord(record)).resolves.toBe(record.digest);
      expect(record.inputs).toEqual(refs.map((ref) => ref.digest as string));
      expect(record.drafts).toHaveLength(record.candidates.length);
      for (const draftDigest of record.drafts) {
        expect(service.getDraft(draftDigest as string)).toBeDefined();
      }
    }
  });

  it('P2 ledger invariants: N distinct run keys ⇒ N records; replays never grow the ledger', async () => {
    const service = new ExtractionService();
    const { input } = await makeTargetNodeAndPolicyInput();
    const policy = await service.registerPolicy(await createExtractionPolicy(input));
    const refs = [await makeRef(), await makeRef()];
    for (let index = 0; index < 3; index += 1) {
      await service.extract(policy.digest, refs, {
        runKey: `run-key-ledger-${String(index)}`,
        correlationId: CORR,
        startedAt: T5,
        finishedAt: T6,
      });
    }
    expect(service.listRuns()).toHaveLength(3);
    // Replays with the same keys are no-ops.
    await service.extract(policy.digest, refs, {
      runKey: 'run-key-ledger-0',
      correlationId: CORR,
      startedAt: T5,
      finishedAt: T6,
    });
    await service.extract(policy.digest, refs, {
      runKey: 'run-key-ledger-2',
      correlationId: CORR,
      startedAt: T5,
      finishedAt: T6,
    });
    expect(service.listRuns()).toHaveLength(3);
    // All digests distinct.
    const digests = service.listRuns().map((record) => record.digest);
    expect(new Set(digests).size).toBe(3);
  });

  it('P3 the R17 gate holds for every generated unvalidated bundle', async () => {
    const lcg = new TestLcg(0x9a1d);
    const service = new ExtractionService();
    const { input } = await makeTargetNodeAndPolicyInput();
    const policy = await service.registerPolicy(await createExtractionPolicy(input));
    for (let index = 0; index < 4; index += 1) {
      const good = await makeRef({
        actionIds: [ACTION_POOL[lcg.int(ACTION_POOL.length)] as string],
      });
      const unvalidated = { ...good, verifications: Object.freeze([]) } as never;
      await expect(
        service.extract(policy.digest, [unvalidated], {
          runKey: `run-key-unvalidated-${String(index)}`,
          correlationId: CORR,
          startedAt: T5,
          finishedAt: T6,
        }),
      ).rejects.toThrow();
    }
    expect(service.listRuns()).toHaveLength(0);
  });

  it('P4 deterministic end-to-end: same scenario, fresh service ⇒ byte-identical record', async () => {
    const buildRefs = async () => [
      await makeRef({ trajectoryId: 'trajectory-det-a', runId: 'tenant-a/run-det-a', actionIds: ['q', 'r'] }),
      await makeRef({ trajectoryId: 'trajectory-det-b', runId: 'tenant-a/run-det-b', actionIds: ['q', 'r'] }),
    ];
    const run = async () => {
      const service = new ExtractionService();
      const { input } = await makeTargetNodeAndPolicyInput({ minTrajectories: 2 });
      const policy = await service.registerPolicy(await createExtractionPolicy(input));
      const refs = await buildRefs();
      return service.extract(policy.digest, refs, {
        runKey: 'run-key-det',
        correlationId: CORR,
        startedAt: T5,
        finishedAt: T6,
      });
    };
    const a = await run();
    const b = await run();
    expect(a.digest).toBe(b.digest);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
