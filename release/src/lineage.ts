/**
 * Append-only release lineage (REL1.0).
 *
 * The lineage is a digest chain: every record cites the digest of
 * its predecessor. Appending never mutates the existing lineage — a
 * new lineage value is returned (structural immutability). Records
 * with a verdict 'go' must carry the complete required-evidence set;
 * 'no-go' records are the audit trail of rejected releases.
 */

import { RELEASE_ERROR_CODES, ReleaseError } from './shared.js';
import { isLaunchReadinessRecord, verifyLaunchRecord } from './record.js';
import type { LaunchReadinessRecord } from './record.js';
import { REQUIRED_EVIDENCE_KINDS } from './evaluate.js';

/** A frozen release lineage. */
export interface ReleaseLineage {
  readonly lineageId: string;
  readonly records: readonly LaunchReadinessRecord[];
}

/** The empty (genesis) lineage. */
export function emptyLineage(lineageId: string): ReleaseLineage {
  return { lineageId, records: [] };
}

/** Append one record to a lineage (returns a NEW lineage value). */
export async function appendLaunchRecord(
  lineage: ReleaseLineage,
  record: LaunchReadinessRecord,
): Promise<ReleaseLineage> {
  if (!isLaunchReadinessRecord(record)) {
    throw new ReleaseError(
      RELEASE_ERROR_CODES.INVALID_RECORD,
      'launch-readiness record is not a structurally valid REL1.0 record',
    );
  }
  if (!(await verifyLaunchRecord(record))) {
    throw new ReleaseError(
      RELEASE_ERROR_CODES.INVALID_RECORD,
      `record "${record.releaseId}" digest does not match its content`,
    );
  }
  if (lineage.records.some((existing) => existing.releaseId === record.releaseId)) {
    throw new ReleaseError(
      RELEASE_ERROR_CODES.DUPLICATE_RELEASE,
      `release id already in lineage: ${record.releaseId}`,
    );
  }
  const last = lineage.records[lineage.records.length - 1];
  const expectedPrior = last === undefined ? null : last.recordDigest;
  if (record.priorRecordDigest !== expectedPrior) {
    throw new ReleaseError(
      RELEASE_ERROR_CODES.BROKEN_CHAIN,
      `record "${record.releaseId}" does not chain onto the lineage head (expected prior ${expectedPrior ?? 'null'}, got ${record.priorRecordDigest ?? 'null'})`,
    );
  }
  // GO records must cite the complete required-evidence set.
  if (record.verdict === 'go') {
    for (const kind of REQUIRED_EVIDENCE_KINDS) {
      if (!record.evidence.some((citation) => citation.kind === kind)) {
        throw new ReleaseError(
          RELEASE_ERROR_CODES.MISSING_EVIDENCE,
          `GO record "${record.releaseId}" is missing evidence of kind "${kind}"`,
        );
      }
    }
  }
  return { ...lineage, records: [...lineage.records, record] };
}

/** Full-chain verification: structure, digests, chaining. */
export async function verifyLaunchLineage(lineage: ReleaseLineage): Promise<boolean> {
  let prior: string | null = null;
  const seen = new Set<string>();
  for (const record of lineage.records) {
    if (!isLaunchReadinessRecord(record)) return false;
    if (!(await verifyLaunchRecord(record))) return false;
    if (record.priorRecordDigest !== prior) return false;
    if (seen.has(record.releaseId)) return false;
    seen.add(record.releaseId);
    prior = record.recordDigest;
  }
  return true;
}

/** The current head digest (null for the empty lineage). */
export function lineageHeadDigest(lineage: ReleaseLineage): string | null {
  const last = lineage.records[lineage.records.length - 1];
  return last === undefined ? null : last.recordDigest;
}
