/**
 * Dataset entries (Work Order A014) — the declared entries of a
 * DatasetManifest: one content-addressed A002 artifact reference plus the
 * role the artifact plays in the dataset.
 *
 * The role vocabulary is CLOSED (spec work order: "artifact refs by digest +
 * role: input/output/eval/split"):
 *   - input  — an upstream artifact the dataset was derived from;
 *   - output — a produced/derived artifact carried by the dataset;
 *   - eval   — an A012 evaluation-record artifact for the dataset;
 *   - split  — a split/subset marker artifact (train/dev/test style splits).
 *
 * Guards (pure; typed DATASET_* errors):
 *   - the role must come from the closed vocabulary (DATASET_INVALID_ROLE);
 *   - the artifact reference is validated through the REUSED A002 validator
 *     toArtifactRef — never reimplemented here;
 *   - the same artifact may appear under multiple roles, but the exact
 *     (role, artifact) pair must be unique (DATASET_INVALID_ENTRY);
 *   - entries are deep-frozen; there is no mutation API.
 */

import type { ArtifactRef } from '@arena/artifact-protocol';
import { artifactRefKey, isArtifactRef, toArtifactRef } from '@arena/artifact-protocol';
import { DATASET_ERROR_CODES, DatasetError } from './errors.js';

/** Closed vocabulary of dataset entry roles. */
export const DATASET_ENTRY_ROLES = Object.freeze(['input', 'output', 'eval', 'split'] as const);
export type DatasetEntryRole = (typeof DATASET_ENTRY_ROLES)[number];

/** Field list of a dataset entry (parity-checked against the contracts). */
export const DATASET_ENTRY_FIELDS = Object.freeze(['role', 'artifact'] as const);

export interface DatasetEntry {
  readonly role: DatasetEntryRole;
  readonly artifact: ArtifactRef;
}

export function isDatasetEntryRole(value: unknown): value is DatasetEntryRole {
  return (
    typeof value === 'string' && (DATASET_ENTRY_ROLES as readonly string[]).includes(value)
  );
}

/** Validate and brand a dataset entry role; throws DATASET_INVALID_ROLE. */
export function toDatasetEntryRole(value: string): DatasetEntryRole {
  if (!isDatasetEntryRole(value)) {
    throw new DatasetError(DATASET_ERROR_CODES.INVALID_ROLE, {
      message: `unknown dataset entry role: ${JSON.stringify(value)} (known: ${DATASET_ENTRY_ROLES.join(', ')})`,
      details: { role: value, known: [...DATASET_ENTRY_ROLES] },
    });
  }
  return value;
}

export function isDatasetEntry(value: unknown): value is DatasetEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isDatasetEntryRole(candidate['role']) && isArtifactRef(candidate['artifact']);
}

/**
 * Validate and freeze one dataset entry. The artifact reference is validated
 * through the REUSED A002 guard; a bad role fails with DATASET_INVALID_ROLE.
 */
export function toDatasetEntry(value: {
  role: string;
  artifact: { namespace: string; name: string; version: string; digest: string };
}): DatasetEntry {
  const role = toDatasetEntryRole(value.role);
  const artifact = toArtifactRef(value.artifact);
  return Object.freeze({ role, artifact });
}

/** Stable key for an entry: `<role>|<namespace>/<name>@<version>#<digest>`. */
export function datasetEntryKey(entry: DatasetEntry): string {
  return `${entry.role}|${artifactRefKey(entry.artifact)}`;
}

/**
 * Deterministic ordering key for entries — the canonical order every
 * digest/checksum computation sorts by (role, then artifact ref key).
 */
export function compareDatasetEntries(a: DatasetEntry, b: DatasetEntry): number {
  const ka = datasetEntryKey(a);
  const kb = datasetEntryKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/** Validate a full entry list: non-empty, unique (role, artifact) pairs. */
export function toDatasetEntries(
  values: readonly {
    role: string;
    artifact: { namespace: string; name: string; version: string; digest: string };
  }[],
): readonly DatasetEntry[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new DatasetError(DATASET_ERROR_CODES.INVALID_ENTRY, {
      message: 'a dataset manifest requires at least one entry',
    });
  }
  const seen = new Set<string>();
  const entries: DatasetEntry[] = [];
  for (const value of values) {
    const entry = toDatasetEntry(value);
    const key = datasetEntryKey(entry);
    if (seen.has(key)) {
      throw new DatasetError(DATASET_ERROR_CODES.INVALID_ENTRY, {
        message: `duplicate dataset entry (role+artifact) ${key} — an artifact may appear under multiple roles, but each (role, artifact) pair is declared once`,
        details: { entry: key },
      });
    }
    seen.add(key);
    entries.push(entry);
  }
  return Object.freeze(entries);
}
