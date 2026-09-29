/**
 * Property suite for @arena/certification-fabric (Work Order A023) —
 * seeded generative invariants over the reference fabric:
 *
 *   1. the ledger is append-only: N distinct runs produce N distinct
 *      records, every historical digest stays addressable and effective
 *      statuses project correctly over random supersession chains;
 *   2. idempotency holds under randomized command tuples: identical
 *      tuples replay, any mutation conflicts.
 */

import { describe, expect, it } from 'vitest';
import { CertificationFabric } from './fabric.js';
import {
  DIGEST_B,
  DIGEST_C,
  makeCompatibilityRecord,
  makeEvaluationRecord,
  makeSubject,
  makeSuite,
  makeVerificationRecord,
  verificationStage,
  compatibilityStage,
  evaluationStage,
} from './test-support.js';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('property: the append-only ledger with supersession chains', () => {
  it('random chains keep every record addressable and project statuses correctly (40 seeded rounds)', async () => {
    const random = mulberry32(0xc0ffee);
    const fabric = new CertificationFabric();
    const suite = await makeSuite([
      verificationStage('verify-constraints', DIGEST_C),
      evaluationStage('judge-design', DIGEST_B, DIGEST_C),
      compatibilityStage('body-substrate'),
    ]);
    fabric.registry.registerSuite(suite);
    const evidenceRefs = [
      fabric.putVerificationRecord(makeVerificationRecord()),
      fabric.putEvaluationRecord(makeEvaluationRecord()),
      fabric.putCompatibilityRecord(makeCompatibilityRecord()),
    ];
    const seen: string[] = [];
    let previous: string | null = null;
    for (let round = 0; round < 40; round += 1) {
      const supersedesPrevious = previous !== null && random() < 0.6;
      const record = await fabric.certify(suite.digest, makeSubject(), evidenceRefs, {
        correlationId: `corr-prop-${round}`,
        idempotencyKey: `idem-prop-${round}`,
        supersedes: supersedesPrevious ? previous : null,
      });
      expect(fabric.getRecord(record.digest)).toBe(record);
      if (supersedesPrevious && previous !== null) {
        expect(fabric.effectiveStatus(previous)).toBe('superseded');
      }
      seen.push(record.digest);
      previous = record.digest;
    }
    // every historical record is still addressable, forever
    for (const digest of seen) {
      expect(fabric.getRecord(digest)).toBeDefined();
    }
    // distinct runs produced distinct records
    expect(new Set(seen).size).toBe(seen.length);
    // the current certification is the last one, active
    const current = fabric.currentCertification(makeSubject());
    expect(current?.digest).toBe(previous);
    expect(fabric.effectiveStatus(current!.digest)).toBe('active');
  });
});

describe('property: idempotency under randomized tuples', () => {
  it('identical tuples replay byte-identically; mutations conflict (40 seeded rounds)', async () => {
    const random = mulberry32(0xbeef);
    const fabric = new CertificationFabric();
    const suite = await makeSuite([verificationStage('verify', DIGEST_C)]);
    fabric.registry.registerSuite(suite);
    const fullEvidence = [fabric.putVerificationRecord(makeVerificationRecord())];
    for (let round = 0; round < 40; round += 1) {
      const key = `idem-rnd-${round}`;
      const useFull = random() < 0.5;
      const refs = useFull ? fullEvidence : [];
      const first = await fabric.certify(suite.digest, makeSubject(), refs, {
        correlationId: `corr-rnd-${round}`,
        idempotencyKey: key,
      });
      const replay = await fabric.certify(suite.digest, makeSubject(), refs, {
        correlationId: `corr-rnd-${round}-replay`,
        idempotencyKey: key,
      });
      expect(replay.digest).toBe(first.digest);
      if (!useFull) {
        // same key + different evidence tuple ⇒ conflict
        await expect(
          fabric.certify(suite.digest, makeSubject(), fullEvidence, {
            correlationId: `corr-rnd-${round}-conflict`,
            idempotencyKey: key,
          }),
        ).rejects.toThrow(/IDEMPOTENCY|already bound/);
      }
    }
  });
});
