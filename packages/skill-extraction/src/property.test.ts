/**
 * Property tests (Work Order A019): seeded-LCG corpora exercising the
 * end-to-end package pipeline (ref → policy → mining → draft) for
 * determinism, content-addressing injectivity and guard totality — the
 * universal acceptance bar (positive + adversarial properties).
 */

import { describe, expect, it } from 'vitest';
import type { CorrelationId } from '@arena/protocol-core';
import { buildSkillDraft } from './draft.js';
import { createExtractionPolicy } from './policy.js';
import { mineSkillCandidates } from './candidate.js';
import { toValidatedTrajectoryRef } from './validated-ref.js';
import {
  CORR_ID,
  makePolicyInput,
  makeTrajectoryRecord,
  makeValidatedRef,
  makeEvaluationRecord,
  makeVerificationRecord,
  TestLcg,
  T7,
} from './test-support.js';

const ACTION_POOL = ['act-alpha', 'act-beta', 'act-gamma', 'act-delta', 'act-epsilon'];

interface Corpus {
  readonly actionIds: readonly string[];
  readonly meetsCriteria: boolean;
  readonly verificationMode: 'pass' | 'fail' | 'unknown-missing';
}

describe('property — the full package pipeline over seeded corpora', () => {
  it('P1 determinism: identical corpora + policies ⇒ byte-identical full results', async () => {
    const lcg = new TestLcg(0xa019);
    for (let scenario = 0; scenario < 5; scenario += 1) {
      const corpora: Corpus[] = [];
      const corpusSize = 1 + lcg.int(4);
      for (let index = 0; index < corpusSize; index += 1) {
        corpora.push({
          actionIds: Array.from(
            { length: 1 + lcg.int(4) },
            () => ACTION_POOL[lcg.int(ACTION_POOL.length)] as string,
          ),
          meetsCriteria: lcg.bool(),
          verificationMode: lcg.bool() ? 'pass' : (lcg.bool() ? 'fail' : 'unknown-missing'),
        });
      }
      const policy = await createExtractionPolicy(
        makePolicyInput({
          policyId: `policy-p-${String(scenario).padStart(2, '0')}`,
          minTrajectories: 1 + lcg.int(2),
        }),
      );
      const context = {
        correlationId: CORR_ID as CorrelationId,
        extractedAt: T7,
      };
      const run = async () => {
        const refs = [];
        for (const [index, corpus] of corpora.entries()) {
          const trajectory = await makeTrajectoryRecord({
            trajectoryId: `trajectory-p${String(scenario)}-${String(index)}`,
            runId: `tenant-a/run-p${String(scenario)}-${String(index)}`,
            actionIds: corpus.actionIds,
          });
          refs.push(
            await toValidatedTrajectoryRef({
              trajectory,
              evaluations: [
                await makeEvaluationRecord(trajectory.chainHead as string, {
                  meetsCriteria: corpus.meetsCriteria,
                }),
              ],
              verifications: [
                await makeVerificationRecord(trajectory.chainHead as string, {
                  mode: corpus.verificationMode,
                }),
              ],
            }),
          );
        }
        const mining = await mineSkillCandidates(refs, policy, context);
        const drafts = [];
        for (const candidate of mining.candidates) {
          drafts.push(await buildSkillDraft(candidate, policy, refs));
        }
        return JSON.stringify({ mining, drafts });
      };
      const first = await run();
      const second = await run();
      expect(first).toBe(second);
    }
  });

  it('P2 injectivity: distinct candidate content ⇒ distinct digests (across a seeded corpus)', async () => {
    const lcg = new TestLcg(0x51ce);
    const digests = new Set<string>();
    const contents = new Set<string>();
    for (let index = 0; index < 20; index += 1) {
      const actionIds = Array.from(
        { length: 1 + lcg.int(3) },
        () => ACTION_POOL[lcg.int(ACTION_POOL.length)] as string,
      );
      const ref = await makeValidatedRef({
        trajectoryId: `trajectory-i-${String(index).padStart(3, '0')}`,
        runId: `tenant-a/run-i-${String(index).padStart(3, '0')}`,
        actionIds,
      });
      const policy = await createExtractionPolicy(
        makePolicyInput({ policyId: `policy-i-${String(index).padStart(3, '0')}` }),
      );
      const context = { correlationId: CORR_ID as CorrelationId, extractedAt: T7 };
      const mining = await mineSkillCandidates([ref], policy, context);
      for (const candidate of mining.candidates) {
        digests.add(candidate.digest as string);
        contents.add(
          JSON.stringify([candidate.signature, candidate.evidence, candidate.provenance]),
        );
      }
    }
    expect(contents.size).toBe(digests.size);
  });

  it('P3 guard totality: the validated-ref guard accepts or rejects every generated bundle consistently', async () => {
    const lcg = new TestLcg(0xfeed);
    for (let index = 0; index < 12; index += 1) {
      const trajectory = await makeTrajectoryRecord({
        trajectoryId: `trajectory-g-${String(index).padStart(3, '0')}`,
        runId: `tenant-a/run-g-${String(index).padStart(3, '0')}`,
        actionIds: [ACTION_POOL[lcg.int(ACTION_POOL.length)] as string],
      });
      const evaluation = await makeEvaluationRecord(trajectory.chainHead as string);
      const verification = await makeVerificationRecord(trajectory.chainHead as string);
      const ref = await toValidatedTrajectoryRef({
        trajectory,
        evaluations: [evaluation],
        verifications: [verification],
      });
      // Same bundle twice ⇒ same digest (idempotent construction).
      const again = await toValidatedTrajectoryRef({
        trajectory,
        evaluations: [evaluation],
        verifications: [verification],
      });
      expect(again.digest).toBe(ref.digest);
    }
  });

  it('P4 unvalidated evidence is ALWAYS refused, never silently mined', async () => {
    const lcg = new TestLcg(0xdead);
    for (let index = 0; index < 6; index += 1) {
      const trajectory = await makeTrajectoryRecord({
        trajectoryId: `trajectory-u-${String(index).padStart(3, '0')}`,
        runId: `tenant-a/run-u-${String(index).padStart(3, '0')}`,
        actionIds: [ACTION_POOL[lcg.int(ACTION_POOL.length)] as string],
      });
      const evaluation = await makeEvaluationRecord(trajectory.chainHead as string);
      await expect(
        toValidatedTrajectoryRef({ trajectory, evaluations: [evaluation], verifications: [] }),
      ).rejects.toThrow();
    }
  });

  it('P5 non-pass verification never yields candidates under the default policy', async () => {
    const lcg = new TestLcg(0xbeef);
    for (const mode of ['fail', 'unknown-missing'] as const) {
      const refs = [];
      for (let index = 0; index < 2; index += 1) {
        refs.push(
          await makeValidatedRef({
            trajectoryId: `trajectory-v-${mode}-${String(index)}`,
            runId: `tenant-a/run-v-${mode}-${String(index)}`,
            actionIds: [ACTION_POOL[lcg.int(ACTION_POOL.length)] as string],
            verificationOverrides: { mode },
          }),
        );
      }
      const policy = await createExtractionPolicy(makePolicyInput());
      const mining = await mineSkillCandidates(refs, policy, {
        correlationId: CORR_ID as CorrelationId,
        extractedAt: T7,
      });
      expect(mining.candidates).toHaveLength(0);
      expect(mining.trajectoryDecisions.every((d) => !d.accepted)).toBe(true);
    }
  });
});
