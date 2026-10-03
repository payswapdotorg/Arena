/**
 * Provenance summary view models (Work Order B013; issue #88;
 * packages/marketplace-ui).
 *
 * Provenance is EVIDENCE-CHAIN based: the summary projects an A002
 * `ProvenanceRecord`-shaped payload (artifact ref, creator, lineage edges,
 * transformation, verification refs) honestly and carries the evidence truth
 * class as data. Every digest in the chain is surfaced as an append-only
 * EVIDENCE ADDRESS — the addresses the detail screens render so a buyer can
 * audit exactly what the listing's evidence chain is.
 *
 * Malformed input degrades truthfully: unreadable fields land in
 * `unknownFields`; the summary never invents a creator, a lineage edge, or a
 * transformation.
 */

import {
  asRecord,
  deepFreezeView,
  MARKETPLACE_UI_VIEW_VERSION,
  PROVENANCE_EVIDENCE_NOTE,
  readString,
} from './shared.js';

/** One content-addressed artifact reference (honest: fields may be unknown). */
export interface ProvenanceRefView {
  readonly namespace: string | undefined;
  readonly name: string | undefined;
  readonly version: string | undefined;
  readonly digest: string | undefined;
  /** The canonical display key `ns/name@version#digest` (unknowns explicit). */
  readonly key: string;
}

/** One lineage edge: a parent artifact plus the typed relation. */
export interface ProvenanceLineageEdgeView {
  readonly relation: string | undefined;
  readonly parent: ProvenanceRefView;
}

/** One verification reference carried on the provenance record. */
export interface ProvenanceVerificationRefView {
  readonly kind: string | undefined;
  readonly evidence: ProvenanceRefView;
}

/** The provenance summary every listing view model carries. */
export interface ProvenanceSummary {
  readonly viewVersion: typeof MARKETPLACE_UI_VIEW_VERSION;
  /** Provenance/rights metadata renders under the evidence truth class. */
  readonly truthClass: 'evidence';
  readonly artifact: ProvenanceRefView | undefined;
  readonly creator:
    | { readonly type: string | undefined; readonly tenant: string; readonly principalId: string }
    | undefined;
  readonly createdAt: string | undefined;
  readonly recordedAt: string | undefined;
  readonly parents: readonly ProvenanceLineageEdgeView[];
  readonly transformation:
    | { readonly transform: ProvenanceRefView; readonly inputs: readonly ProvenanceRefView[] }
    | undefined;
  readonly verificationRefs: readonly ProvenanceVerificationRefView[];
  /** Every evidence address in the chain (append-only record order, deduped). */
  readonly evidenceAddresses: readonly string[];
  readonly scopeNote: string;
  readonly unknownFields: readonly string[];
}

/** The canonical display key of an artifact ref (unknowns explicit). */
export function provenanceRefKey(ref: {
  readonly namespace: string | undefined;
  readonly name: string | undefined;
  readonly version: string | undefined;
  readonly digest: string | undefined;
}): string {
  return `${ref.namespace ?? 'unknown'}/${ref.name ?? 'unknown'}@${
    ref.version ?? 'unknown'
  }#${ref.digest ?? 'unknown'}`;
}

/** Read one artifact ref honestly (all fields may be unknown). */
export function readProvenanceRef(value: unknown): ProvenanceRefView {
  const data = asRecord(value);
  const ref = {
    namespace: readString(data, 'namespace'),
    name: readString(data, 'name'),
    version: readString(data, 'version'),
    digest: readString(data, 'digest'),
  };
  return deepFreezeView({ ...ref, key: provenanceRefKey(ref) } satisfies ProvenanceRefView);
}

function isUnknownRef(ref: ProvenanceRefView): boolean {
  return (
    ref.namespace === undefined &&
    ref.name === undefined &&
    ref.version === undefined &&
    ref.digest === undefined
  );
}

/**
 * Build the provenance summary from an A002 `ProvenanceRecord`-shaped payload.
 * Honest: missing/foreign-typed fields degrade to unknown (listed), never
 * guessed; an unreadable record still yields a summary with the artifact
 * marked unknown.
 */
export function buildProvenanceSummary(record: unknown): ProvenanceSummary {
  const data = asRecord(record);
  const unknownFields: string[] = [];

  const artifactRef = readProvenanceRef(data['artifact']);
  const artifact = isUnknownRef(artifactRef) ? undefined : artifactRef;
  if (artifact === undefined) unknownFields.push('artifact');

  const creatorData = asRecord(data['creator']);
  const creatorTenant = readString(creatorData, 'tenant');
  const creatorPrincipalId = readString(creatorData, 'principalId');
  const creator =
    creatorTenant !== undefined && creatorPrincipalId !== undefined
      ? Object.freeze({
          type: readString(creatorData, 'type'),
          tenant: creatorTenant,
          principalId: creatorPrincipalId,
        })
      : undefined;
  if (creator === undefined) unknownFields.push('creator');

  const createdAt = readString(data, 'createdAt');
  if (createdAt === undefined) unknownFields.push('createdAt');
  const recordedAt = readString(data, 'recordedAt');
  if (recordedAt === undefined) unknownFields.push('recordedAt');

  const parents: ProvenanceLineageEdgeView[] = [];
  const parentsValue = data['parents'];
  if (!Array.isArray(parentsValue)) {
    unknownFields.push('parents');
  } else {
    parentsValue.forEach((entry, index) => {
      const edgeData = asRecord(entry);
      const parent = readProvenanceRef(edgeData['parent']);
      const relation = readString(edgeData, 'relation');
      if (isUnknownRef(parent)) {
        unknownFields.push(`parents[${String(index)}] (malformed)`);
        return;
      }
      parents.push(Object.freeze({ relation, parent }));
    });
  }

  let transformation:
    | { readonly transform: ProvenanceRefView; readonly inputs: readonly ProvenanceRefView[] }
    | undefined;
  const transformationData = asRecord(data['transformation']);
  const transformRef = readProvenanceRef(transformationData['transform']);
  const inputsValue = transformationData['inputs'];
  if (!isUnknownRef(transformRef) && Array.isArray(inputsValue)) {
    const inputs: ProvenanceRefView[] = [];
    inputsValue.forEach((entry, index) => {
      const inputRef = readProvenanceRef(entry);
      if (isUnknownRef(inputRef)) {
        unknownFields.push(`transformation.inputs[${String(index)}] (malformed)`);
        return;
      }
      inputs.push(inputRef);
    });
    transformation = Object.freeze({ transform: transformRef, inputs: Object.freeze(inputs) });
  } else {
    unknownFields.push('transformation');
  }

  const verificationRefs: ProvenanceVerificationRefView[] = [];
  const verificationValue = data['verification'];
  if (!Array.isArray(verificationValue)) {
    unknownFields.push('verification');
  } else {
    verificationValue.forEach((entry, index) => {
      const refData = asRecord(entry);
      const evidence = readProvenanceRef(refData['evidence']);
      if (isUnknownRef(evidence)) {
        unknownFields.push(`verification[${String(index)}] (malformed)`);
        return;
      }
      verificationRefs.push(
        Object.freeze({ kind: readString(refData, 'kind'), evidence }),
      );
    });
  }

  // Evidence addresses: the append-only chain in record order, deduped.
  const addresses: string[] = [];
  const pushAddress = (digest: string | undefined): void => {
    if (digest !== undefined && !addresses.includes(digest)) addresses.push(digest);
  };
  pushAddress(artifact?.digest);
  for (const edge of parents) pushAddress(edge.parent.digest);
  if (transformation !== undefined) {
    pushAddress(transformation.transform.digest);
    for (const input of transformation.inputs) pushAddress(input.digest);
  }
  for (const ref of verificationRefs) pushAddress(ref.evidence.digest);

  return deepFreezeView({
    viewVersion: MARKETPLACE_UI_VIEW_VERSION,
    truthClass: 'evidence',
    artifact,
    creator,
    createdAt,
    recordedAt,
    parents: Object.freeze(parents),
    transformation,
    verificationRefs: Object.freeze(verificationRefs),
    evidenceAddresses: Object.freeze(addresses),
    scopeNote: PROVENANCE_EVIDENCE_NOTE,
    unknownFields: Object.freeze(unknownFields),
  } satisfies ProvenanceSummary);
}
