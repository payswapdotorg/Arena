/**
 * Human-data DATASET ASSEMBLY (Work Order C012; issue #118) — versioned,
 * immutable bundles over the A014 `@arena/datasets` vocabulary.
 *
 * assembleHumanDataset funnels EVERY deliverable through
 * assertDeliverableRightsGated (THE RIGHTS WALL) before any manifest entry
 * is declared: a deliverable without GRANTED consent, outside the
 * commission's tenant, or with a tampered digest can NEVER enter a bundle
 * (tested adversarially — assembly fails closed).
 *
 * The produced manifest carries:
 *   - the commission SPEC as an `input` entry (the declaration itself,
 *     content-addressed — the customer's declared dataset shape);
 *   - one `output` entry per deliverable (content-addressed material
 *     artifacts in the tenant namespace);
 *   - one `eval` entry + provenance.verification ref per deliverable's C009
 *     ACCEPTED adjudication verdict (no self-certified deliverables — the
 *     validation evidence ships WITH the dataset);
 *   - §15 provenance: creator (tenant-scoped principal), createdAt,
 *     parent edges (supersession — a corrected composition is a NEW
 *     manifest version derived-from its parent), rights (the commission's
 *     declared posture) and verification refs.
 *
 * Determinism: same commission + same deliverable set ⇒ same entry digests
 * ⇒ same manifest digest (entry names are derived deterministically).
 */

import type { MaterialArtifact } from '@arena/artifact-protocol';
import { createMaterialArtifact } from '@arena/artifact-protocol';
import type { DatasetManifest } from '@arena/datasets';
import { createDatasetManifest } from '@arena/datasets';
import { HUMAN_DATA_ERROR_CODES, HumanDataError } from './errors.js';
import type { HumanDataCommission } from './commission.js';
import { verifyHumanDataCommission } from './commission.js';
import type { DeliverableRecord } from './deliverables.js';
import { assertDeliverableRightsGated } from './deliverables.js';

/** Wire version of the assembly input/output shapes. */
export const HUMAN_DATA_BUNDLE_VERSION = 1 as const;

/** The manifest version a first assembly uses. */
export const INITIAL_BUNDLE_VERSION = '1.0.0';

export interface AssembleHumanDatasetInput {
  readonly commission: HumanDataCommission;
  readonly deliverables: readonly DeliverableRecord[];
  /** Injected assembly time (epoch ms / ISO string / Date) — never a wall-clock read. */
  readonly now: number | string | Date;
  /** The manifest version being assembled (semver; defaults to 1.0.0). */
  readonly version?: string;
  /**
   * SUPERSESSION (house pattern): the manifest this assembly supersedes —
   * recorded as a derived-from parent edge (a corrected bundle composition
   * is a NEW immutable manifest, never a mutation).
   */
  readonly supersedes?: {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
}

export interface HumanDatasetAssembly {
  readonly manifest: DatasetManifest;
  /** The material artifacts the manifest's entries address (host persists them). */
  readonly artifacts: readonly MaterialArtifact[];
  readonly deliverableCount: number;
}

function isoNow(value: number | string | Date): string {
  const date = value instanceof Date ? value : new Date(typeof value === 'number' ? value : Date.parse(value));
  if (Number.isNaN(date.getTime())) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: `assembly time is not a valid instant: ${JSON.stringify(value)}`,
    });
  }
  return date.toISOString();
}

function artifactNameFor(datasetName: string, suffix: string): string {
  const name = `${datasetName}-${suffix}`;
  if (!/^[a-z][a-z0-9-]{1,127}$/.test(name)) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION, {
      message: `derived artifact name is invalid: ${JSON.stringify(name)} (datasetName must be an A002 artifact name and the suffix lowercase-hyphenated)`,
    });
  }
  return name;
}

/**
 * Assemble the commissioned dataset bundle (fail-closed). Steps:
 *   1. verify the commission digest (tamper detection);
 *   2. gate EVERY deliverable through the rights wall;
 *   3. materialize the spec artifact, the deliverable artifacts and the
 *      C009 verdict artifacts (content-addressed, tenant namespace);
 *   4. build the immutable DatasetManifest through the REUSED A014 guard
 *      (createDatasetManifest — never reimplemented here).
 */
export async function assembleHumanDataset(
  input: AssembleHumanDatasetInput,
): Promise<HumanDatasetAssembly> {
  const { commission } = input;
  await verifyHumanDataCommission(commission);

  if (!Array.isArray(input.deliverables) || input.deliverables.length === 0) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_DELIVERABLE, {
      message: 'a dataset bundle requires at least one rights-gated deliverable (empty assemblies are rejected — the honest state is a not-yet-delivered commission, not an empty dataset)',
    });
  }
  for (const deliverable of input.deliverables) {
    // THE RIGHTS WALL — fail closed on consent, tenant scope or tampering.
    await assertDeliverableRightsGated(deliverable, commission.tenantId);
    if (deliverable.commissionId !== commission.commissionId) {
      throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_DELIVERABLE, {
        message: `deliverable ${deliverable.deliverableId} belongs to commission ${JSON.stringify(deliverable.commissionId)}, not ${JSON.stringify(commission.commissionId)}`,
      });
    }
  }

  const namespace = commission.tenantId;
  const createdAt = isoNow(input.now);
  const version = input.version ?? INITIAL_BUNDLE_VERSION;
  const artifacts: MaterialArtifact[] = [];
  const entries: {
    role: string;
    artifact: { namespace: string; name: string; version: string; digest: string };
  }[] = [];
  const verification: {
    kind: string;
    evidence: { namespace: string; name: string; version: string; digest: string };
  }[] = [];

  // 1. The commission SPEC artifact (input entry — the declared dataset shape).
  const specArtifact = await createMaterialArtifact({
    identity: { namespace, name: artifactNameFor(commission.datasetName, 'spec'), version },
    content: {
      commissionVersion: commission.commissionVersion,
      commissionId: commission.commissionId,
      capabilityNeed: commission.capabilityNeed,
      deliverableKind: commission.deliverableKind,
      quantity: commission.quantity,
      acceptanceCriteria: commission.acceptanceCriteria,
      perItemOutputSchema: commission.perItemOutputSchema,
      rights: commission.rights,
      retentionPolicy: commission.retentionPolicy,
    },
  });
  artifacts.push(specArtifact);
  entries.push({
    role: 'input',
    artifact: {
      namespace,
      name: specArtifact.identity.name,
      version: specArtifact.identity.version,
      digest: specArtifact.digest,
    },
  });

  // 2. One output entry per deliverable + one eval/verification ref per
  //    C009-ACCEPTED adjudication verdict (the validation evidence ships
  //    with the dataset — no self-certified deliverables).
  const deliverableArtifacts = await Promise.all(
    input.deliverables.map((deliverable, index) =>
      createMaterialArtifact({
        identity: {
          namespace,
          name: artifactNameFor(
            commission.datasetName,
            `${deliverable.recordKind}-${String(index + 1).padStart(4, '0')}`,
          ),
          version,
        },
        content: {
          deliverableVersion: deliverable.deliverableVersion,
          deliverableId: deliverable.deliverableId,
          commissionId: deliverable.commissionId,
          recordKind: deliverable.recordKind,
          sourceProvenance: deliverable.sourceProvenance,
          rights: deliverable.rights,
          consent: deliverable.consent,
          payload: deliverable.payload,
        },
      }),
    ),
  );
  const verdictArtifacts = await Promise.all(
    input.deliverables.map((deliverable, index) =>
      createMaterialArtifact({
        identity: {
          namespace,
          name: artifactNameFor(
            commission.datasetName,
            `verdict-${String(index + 1).padStart(4, '0')}`,
          ),
          version,
        },
        content: {
          verdict: 'ACCEPTED',
          verdictId: deliverable.sourceProvenance.adjudicationVerdictId,
          requestId: deliverable.sourceProvenance.escalationRequestId,
          adjudicatedAt: deliverable.sourceProvenance.adjudicatedAt,
          attemptNumber: deliverable.sourceProvenance.attemptNumber,
        },
      }),
    ),
  );
  for (let index = 0; index < input.deliverables.length; index += 1) {
    const deliverableArtifact = deliverableArtifacts[index];
    const verdictArtifact = verdictArtifacts[index];
    artifacts.push(deliverableArtifact, verdictArtifact);
    entries.push({
      role: 'output',
      artifact: {
        namespace,
        name: deliverableArtifact.identity.name,
        version: deliverableArtifact.identity.version,
        digest: deliverableArtifact.digest,
      },
    });
    entries.push({
      role: 'eval',
      artifact: {
        namespace,
        name: verdictArtifact.identity.name,
        version: verdictArtifact.identity.version,
        digest: verdictArtifact.digest,
      },
    });
    verification.push({
      kind: 'verification',
      evidence: {
        namespace,
        name: verdictArtifact.identity.name,
        version: verdictArtifact.identity.version,
        digest: verdictArtifact.digest,
      },
    });
  }

  // 3. The immutable manifest through the REUSED A014 guard.
  const manifest = await createDatasetManifest({
    identity: { namespace, name: commission.datasetName, version },
    entries,
    provenance: {
      creator: { type: 'user', tenant: commission.tenantId, principalId: commission.clientAppId },
      createdAt,
      parents:
        input.supersedes === undefined
          ? []
          : [{ parent: input.supersedes, relation: 'derived-from' }],
      rights: commission.rights,
      verification,
    },
  });

  return Object.freeze({
    manifest,
    artifacts: Object.freeze([...artifacts]),
    deliverableCount: input.deliverables.length,
  });
}

/**
 * The delivery descriptor for the studio's dataset delivery page: the
 * rights/lineage view + the download permission (redistribution policy
 * decides whether a downloadable export is permitted at all).
 */
export interface HumanDatasetDeliveryDescriptor {
  readonly manifestDigest: string;
  readonly identity: { readonly namespace: string; readonly name: string; readonly version: string };
  readonly entriesChecksum: string;
  readonly deliverableCount: number;
  readonly rights: Readonly<Record<string, unknown>>;
  readonly lineage: readonly {
    readonly parent: string;
    readonly relation: string;
  }[];
  readonly verificationCount: number;
  readonly downloadPermitted: boolean;
}

export function describeHumanDatasetDelivery(
  manifest: DatasetManifest,
  deliverableCount: number,
): HumanDatasetDeliveryDescriptor {
  return Object.freeze({
    manifestDigest: manifest.digest,
    identity: Object.freeze({ ...manifest.identity }),
    entriesChecksum: manifest.entriesChecksum,
    deliverableCount,
    rights: Object.freeze({ ...manifest.provenance.rights } as unknown as Readonly<
      Record<string, unknown>
    >),
    lineage: Object.freeze(
      manifest.provenance.parents.map((edge) =>
        Object.freeze({
          parent: `${edge.parent.namespace}/${edge.parent.name}@${edge.parent.version}#${edge.parent.digest}`,
          relation: edge.relation,
        }),
      ),
    ),
    verificationCount: manifest.provenance.verification.length,
    downloadPermitted: manifest.provenance.rights.redistribution !== 'prohibited',
  });
}
