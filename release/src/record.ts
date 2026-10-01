/**
 * Launch-readiness records (REL1.0): frozen, digest-bearing verdicts
 * with evidence citations.
 */

import { digestCanonical } from '@arena/protocol-core';
import {
  RELEASE_RECORD_VERSION,
  isDigestHex,
  isEvidenceKind,
  isLaunchVerdict,
  isReleaseId,
} from './shared.js';
import type { EvidenceKind, LaunchVerdict } from './shared.js';

/** One evidence citation backing a launch decision. */
export interface ReleaseEvidenceCitation {
  readonly kind: EvidenceKind;
  readonly path: string;
  /** sha256 content digest of the cited artifact (REQUIRED). */
  readonly digest: string;
  readonly note: string | null;
}

/** A frozen launch-readiness record. */
export interface LaunchReadinessRecord {
  readonly recordVersion: typeof RELEASE_RECORD_VERSION;
  readonly releaseId: string;
  /** Release train version (e.g. 'v1.0.0'). */
  readonly releaseVersion: string;
  readonly verdict: LaunchVerdict;
  readonly evidence: readonly ReleaseEvidenceCitation[];
  /** Epoch-ms decision instant (frozen at authoring). */
  readonly decidedAt: number;
  /** Digest of the previous record in the lineage (null = genesis). */
  readonly priorRecordDigest: string | null;
  /** sha256 over the canonical record WITHOUT this field. */
  readonly recordDigest: string;
}

const CITATION_FIELDS = 4;

export function isReleaseEvidenceCitation(value: unknown): value is ReleaseEvidenceCitation {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  if (Object.keys(c).length !== CITATION_FIELDS) return false;
  return (
    isEvidenceKind(c['kind']) &&
    typeof c['path'] === 'string' &&
    c['path'].length > 0 &&
    isDigestHex(c['digest']) &&
    (c['note'] === null || typeof c['note'] === 'string')
  );
}

export function isLaunchReadinessRecord(value: unknown): value is LaunchReadinessRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    r['recordVersion'] === RELEASE_RECORD_VERSION &&
    isReleaseId(r['releaseId']) &&
    typeof r['releaseVersion'] === 'string' &&
    r['releaseVersion'].length > 0 &&
    isLaunchVerdict(r['verdict']) &&
    Array.isArray(r['evidence']) &&
    (r['evidence'] as unknown[]).every(isReleaseEvidenceCitation) &&
    typeof r['decidedAt'] === 'number' &&
    Number.isSafeInteger(r['decidedAt']) &&
    (r['priorRecordDigest'] === null || isDigestHex(r['priorRecordDigest'])) &&
    isDigestHex(r['recordDigest'])
  );
}

/**
 * Compute the content digest of a record (canonical JSON over the
 * record WITHOUT its recordDigest field — self-reference excluded).
 */
export async function launchRecordDigest(
  record: Omit<LaunchReadinessRecord, 'recordDigest'>,
): Promise<string> {
  return digestCanonical(record);
}

/** Verify a record's stored digest matches its content. */
export async function verifyLaunchRecord(record: LaunchReadinessRecord): Promise<boolean> {
  const { recordDigest: _recordDigest, ...core } = record;
  return (await launchRecordDigest(core)) === record.recordDigest;
}
