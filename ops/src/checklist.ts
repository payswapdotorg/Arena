/**
 * Release checklists as typed records (OPS1.0).
 *
 * A required item without evidence FAILS the checklist (no-go).
 * Advisory items are recorded but never block. Evidence citations
 * carry content digests — unsigned evidence (missing digest) is
 * rejected fail-closed, mirroring the A034 artifact-verification
 * posture.
 */

import { digestCanonical } from '@arena/protocol-core';
import {
  OPS_ERROR_CODES,
  OPS_SCHEMA_VERSION,
  OpsError,
  isChecklistItemKind,
  isDigestHex,
  isOpsId,
} from './shared.js';
import type { ChecklistItemKind, ChecklistVerdict } from './shared.js';

/** One evidence citation attached to a checklist item. */
export interface EvidenceCitation {
  /** What kind of artifact this cites. */
  readonly kind: string;
  /** Repository path of the artifact. */
  readonly path: string;
  /** sha256 content digest of the cited artifact. */
  readonly digest: string;
}

/** One checklist item. */
export interface ChecklistItem {
  readonly itemId: string;
  readonly kind: ChecklistItemKind;
  readonly description: string;
  readonly evidence: readonly EvidenceCitation[];
}

/** A frozen release checklist record. */
export interface ReleaseChecklist {
  readonly checklistVersion: typeof OPS_SCHEMA_VERSION;
  readonly checklistId: string;
  readonly items: readonly ChecklistItem[];
  readonly authoredBy: string;
  readonly createdAt: number;
}

export function isReleaseChecklist(value: unknown): value is ReleaseChecklist {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  if (c['checklistVersion'] !== OPS_SCHEMA_VERSION) return false;
  if (!isOpsId(c['checklistId'])) return false;
  if (typeof c['authoredBy'] !== 'string' || c['authoredBy'].length === 0) return false;
  if (typeof c['createdAt'] !== 'number' || !Number.isSafeInteger(c['createdAt'])) return false;
  if (!Array.isArray(c['items']) || c['items'].length === 0) return false;
  return (c['items'] as unknown[]).every((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const i = item as Record<string, unknown>;
    return (
      isOpsId(i['itemId']) &&
      isChecklistItemKind(i['kind']) &&
      typeof i['description'] === 'string' &&
      i['description'].length > 0 &&
      Array.isArray(i['evidence']) &&
      (i['evidence'] as unknown[]).every(
        (citation) =>
          typeof citation === 'object' &&
          citation !== null &&
          typeof (citation as Record<string, unknown>)['kind'] === 'string' &&
          typeof (citation as Record<string, unknown>)['path'] === 'string' &&
          isDigestHex((citation as Record<string, unknown>)['digest']),
      )
    );
  });
}

/** Strict, fail-closed conversion into a ReleaseChecklist. */
export function toReleaseChecklist(value: unknown): ReleaseChecklist {
  if (!isReleaseChecklist(value)) {
    throw new OpsError(
      OPS_ERROR_CODES.INVALID_CHECKLIST,
      'release checklist must be a structurally valid OPS1.0 record',
    );
  }
  const seen = new Set<string>();
  for (const item of value.items) {
    if (seen.has(item.itemId)) {
      throw new OpsError(
        OPS_ERROR_CODES.INVALID_CHECKLIST,
        `duplicate checklist itemId: ${item.itemId}`,
      );
    }
    seen.add(item.itemId);
  }
  return value;
}

/** The frozen evaluation of one checklist. */
export interface ChecklistEvaluation {
  readonly checklistId: string;
  readonly verdict: ChecklistVerdict;
  readonly failedRequiredItems: readonly string[];
  readonly advisoryNotes: readonly string[];
}

/**
 * Evaluate a release checklist. Verdict is 'go' IFF every required
 * item carries at least one digest-bearing evidence citation.
 * Advisory items never block; their notes are surfaced.
 */
export function evaluateChecklist(checklist: ReleaseChecklist): ChecklistEvaluation {
  const failedRequiredItems: string[] = [];
  const advisoryNotes: string[] = [];
  for (const item of checklist.items) {
    if (item.kind === 'required') {
      if (item.evidence.length === 0) {
        failedRequiredItems.push(item.itemId);
      }
    } else if (item.evidence.length === 0) {
      advisoryNotes.push(`${item.itemId}: ${item.description} (unevidenced advisory)`);
    }
  }
  return {
    checklistId: checklist.checklistId,
    verdict: failedRequiredItems.length === 0 ? 'go' : 'no-go',
    failedRequiredItems,
    advisoryNotes,
  };
}

/** Content digest of a checklist (canonical JSON). */
export async function checklistDigest(checklist: ReleaseChecklist): Promise<string> {
  return digestCanonical(checklist);
}
