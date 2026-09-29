/**
 * Fabric property tests (Work Order A013) — randomized end-to-end runs
 * through the REAL fabric with seeded LCG inputs.
 *
 * Invariants:
 *   P1 outcome totality — random constraint outcomes (satisfied or not,
 *      per requirement, with random missing evidence) always produce
 *      exactly one of the three closed outcomes;
 *   P2 run determinism — the same random scenario, run twice through
 *      independent fabrics, yields the identical record digest;
 *   P3 ledger consistency — every ledger entry is content-addressed
 *      (unique digests) and queryable by verifier and correlation id.
 */

import { describe, expect, it } from 'vitest';
import { createVerifierDescriptor } from '@arena/verification';
import { createVerificationFabric } from './fabric.js';
import { makeConstraintCheckVerifier } from './verifiers.js';
import {
  TestLcg,
  evidenceInput,
  makeBalanceProof,
  makeConstraintDescriptorInput,
  makeConstraintReport,
  runOptions,
} from './test-support.js';

const SEEDS = [1, 42, 20260928, 777, 314159];

interface WiredScenario {
  readonly fabric: ReturnType<typeof createVerificationFabric>;
  readonly descriptor: Awaited<ReturnType<typeof createVerifierDescriptor>>;
  readonly evidence: readonly ReturnType<typeof evidenceInput>[];
  readonly reportSatisfied: boolean;
  readonly omitBalance: boolean;
}

/** Build a fully wired random scenario: registry + artifacts + evidence bundle. */
async function buildScenario(seed: number): Promise<WiredScenario> {
  const rng = new TestLcg(seed);
  const reportSatisfied = rng.bool();
  const omitBalance = rng.bool();
  const fabric = createVerificationFabric();
  const descriptor = await createVerifierDescriptor(
    makeConstraintDescriptorInput({ verifierId: `verifier-prop-${String(seed)}` }),
  );
  fabric.registry.registerVerifier(descriptor, makeConstraintCheckVerifier());
  const report = await makeConstraintReport(seed % 50, [
    { requirementId: 'requirement-001', satisfied: reportSatisfied },
  ]);
  const balance = await makeBalanceProof(100 + (seed % 50));
  fabric.putArtifact(report);
  fabric.putArtifact(balance);
  const evidence = omitBalance
    ? [evidenceInput(report, 'test-report')]
    : [evidenceInput(report, 'test-report'), evidenceInput(balance, 'balance-proof', 'erp-close-sandbox')];
  return { fabric, descriptor, evidence, reportSatisfied, omitBalance };
}

describe('property: fabric outcome totality (P1)', () => {
  for (const seed of SEEDS) {
    it(`seed ${String(seed)}: random scenarios always yield a closed outcome`, async () => {
      const { fabric, descriptor, evidence } = await buildScenario(seed);
      const record = await fabric.verify(
        descriptor.digest,
        evidence,
        runOptions({ correlationId: `corr-prop-${String(seed)}`, idempotencyKey: `idem-prop-${String(seed)}` }),
      );
      expect(['pass', 'fail', 'unknown']).toContain(record.outcome);
      expect((record.outcome === 'unknown') === (record.unknownCause !== null)).toBe(true);
      if (record.unknownCause !== null) {
        expect(['missing-evidence', 'unverifiable-provenance', 'method-limitation']).toContain(
          record.unknownCause.reason,
        );
      }
    });
  }
});

describe('property: fabric run determinism (P2)', () => {
  for (const seed of SEEDS.slice(0, 3)) {
    it(`seed ${String(seed)}: independent fabrics produce the identical digest`, async () => {
      const a = await buildScenario(seed);
      const b = await buildScenario(seed);
      const options = runOptions({
        correlationId: `corr-prop-${String(seed)}`,
        idempotencyKey: `idem-prop-${String(seed)}`,
      });
      const first = await a.fabric.verify(a.descriptor.digest, a.evidence, options);
      const second = await b.fabric.verify(b.descriptor.digest, b.evidence, options);
      expect(second.digest).toBe(first.digest);
      expect(second.outcome).toBe(first.outcome);
    });
  }
});

describe('property: ledger consistency (P3)', () => {
  for (const seed of SEEDS.slice(0, 3)) {
    it(`seed ${String(seed)}: ledger entries are unique and queryable`, async () => {
      const { fabric, descriptor, evidence } = await buildScenario(seed);
      const options = runOptions({
        correlationId: `corr-prop-${String(seed)}`,
        idempotencyKey: `idem-prop-${String(seed)}`,
      });
      const record = await fabric.verify(descriptor.digest, evidence, options);
      // idempotent replay does not duplicate
      const replayed = await fabric.verify(descriptor.digest, evidence, options);
      expect(replayed.digest).toBe(record.digest);
      const digests = fabric.listRecords().map((entry) => entry.digest);
      expect(new Set(digests).size).toBe(digests.length);
      expect(fabric.listRecordsByVerifier(descriptor.digest)).toHaveLength(digests.length);
      expect(fabric.listRecordsByCorrelation(`corr-prop-${String(seed)}`)).toHaveLength(digests.length);
    });
  }
});
