/**
 * REL1.0 lineage tests: append-only discipline, chain integrity,
 * adversarial tampering — plus the frozen v1 reference records.
 */

import { describe, expect, it } from 'vitest';
import {
  RELEASE_ERROR_CODES,
  ReleaseError,
  appendLaunchRecord,
  buildReferenceReleaseLineage,
  buildReferenceReleaseRecords,
  emptyLineage,
  lineageHeadDigest,
  verifyLaunchLineage,
} from './index.js';
import { launchRecordDigest } from './index.js';
import type { LaunchReadinessRecord, ReleaseEvidenceCitation } from './index.js';

const DIGEST = 'a'.repeat(64);

async function recordFor(
  releaseId: string,
  verdict: 'go' | 'no-go',
  prior: string | null,
  evidence: readonly ReleaseEvidenceCitation[] = [],
): Promise<LaunchReadinessRecord> {
  const core = {
    recordVersion: 1 as const,
    releaseId,
    releaseVersion: `v-${releaseId}`,
    verdict,
    evidence,
    decidedAt: 1_791_232_000_000,
    priorRecordDigest: prior,
  };
  return { ...core, recordDigest: await launchRecordDigest(core) };
}

function fullEvidence(): readonly ReleaseEvidenceCitation[] {
  return [
    { kind: 'health-gate-report', path: 'x', digest: DIGEST, note: null },
    { kind: 'performance-evidence', path: 'x', digest: DIGEST, note: null },
    { kind: 'security-audit', path: 'x', digest: DIGEST, note: null },
    { kind: 'checklist-evaluation', path: 'x', digest: DIGEST, note: null },
    { kind: 'manifest', path: 'x', digest: DIGEST, note: null },
  ];
}

describe('REL1.0 lineage — positive', () => {
  it('appends records in a digest chain and never mutates the predecessor', async () => {
    const first = await recordFor('rel-1', 'no-go', null);
    let lineage = await appendLaunchRecord(emptyLineage('test-lineage'), first);
    const snapshot = lineage.records;
    const second = await recordFor('rel-2', 'go', first.recordDigest, fullEvidence());
    lineage = await appendLaunchRecord(lineage, second);
    expect(lineage.records).toHaveLength(2);
    expect(lineageHeadDigest(lineage)).toBe(second.recordDigest);
    // Append-only: the predecessor list object is unchanged.
    expect(snapshot).toHaveLength(1);
    expect(lineage.records[0]).toBe(first);
    expect(await verifyLaunchLineage(lineage)).toBe(true);
  });

  it('the frozen v1 reference lineage verifies end-to-end (rc1 no-go → v1.0.0 go)', async () => {
    const lineage = await buildReferenceReleaseLineage();
    expect(await verifyLaunchLineage(lineage)).toBe(true);
    const [rc1, v1] = lineage.records;
    expect(rc1?.verdict).toBe('no-go');
    expect(v1?.verdict).toBe('go');
    expect(v1?.priorRecordDigest).toBe(rc1?.recordDigest);
  });

  it('the reference records are reproducible (same digests on every build)', async () => {
    const first = await buildReferenceReleaseRecords();
    const second = await buildReferenceReleaseRecords();
    expect(first.map((record) => record.recordDigest)).toEqual(
      second.map((record) => record.recordDigest),
    );
  });
});

describe('REL1.0 lineage — adversarial (fail-closed)', () => {
  it('rejects a record that does not chain onto the head (broken chain)', async () => {
    const first = await recordFor('rel-1', 'no-go', null);
    const lineage = await appendLaunchRecord(emptyLineage('test-lineage'), first);
    const orphan = await recordFor('rel-2', 'no-go', null);
    try {
      await appendLaunchRecord(lineage, orphan);
      expect.unreachable('orphan record must be rejected');
    } catch (error) {
      expect((error as ReleaseError).code).toBe(RELEASE_ERROR_CODES.BROKEN_CHAIN);
    }
  });

  it('rejects duplicate release ids', async () => {
    const first = await recordFor('rel-1', 'no-go', null);
    const lineage = await appendLaunchRecord(emptyLineage('test-lineage'), first);
    const duplicate = await recordFor('rel-1', 'no-go', first.recordDigest);
    try {
      await appendLaunchRecord(lineage, duplicate);
      expect.unreachable('duplicate release id must be rejected');
    } catch (error) {
      expect((error as ReleaseError).code).toBe(RELEASE_ERROR_CODES.DUPLICATE_RELEASE);
    }
  });

  it('rejects a GO record with missing required evidence (unsigned/unverified release)', async () => {
    const first = await recordFor('rel-1', 'no-go', null);
    const lineage = await appendLaunchRecord(emptyLineage('test-lineage'), first);
    const incompleteGo = await recordFor('rel-2', 'go', first.recordDigest, [
      { kind: 'performance-evidence', path: 'x', digest: DIGEST, note: null },
    ]);
    try {
      await appendLaunchRecord(lineage, incompleteGo);
      expect.unreachable('incomplete GO record must be rejected');
    } catch (error) {
      expect((error as ReleaseError).code).toBe(RELEASE_ERROR_CODES.MISSING_EVIDENCE);
    }
  });

  it('rejects a record whose stored digest does not match its content (tamper)', async () => {
    const core = {
      recordVersion: 1 as const,
      releaseId: 'rel-tamper',
      releaseVersion: 'v-tamper',
      verdict: 'no-go' as const,
      evidence: [] as readonly ReleaseEvidenceCitation[],
      decidedAt: 1_791_232_000_000,
      priorRecordDigest: null,
    };
    const tampered = {
      ...core,
      recordDigest: 'b'.repeat(64),
    };
    try {
      await appendLaunchRecord(emptyLineage('test-lineage'), tampered);
      expect.unreachable('tampered record must be rejected');
    } catch (error) {
      expect((error as ReleaseError).code).toBe(RELEASE_ERROR_CODES.INVALID_RECORD);
    }
  });

  it('a tampered chain fails full verification', async () => {
    const first = await recordFor('rel-1', 'no-go', null);
    const lineage = await appendLaunchRecord(emptyLineage('test-lineage'), first);
    const tamperedLineage = {
      ...lineage,
      records: [
        { ...first, releaseId: 'rel-tampered-id' },
      ],
    };
    expect(await verifyLaunchLineage(tamperedLineage)).toBe(false);
  });
});
