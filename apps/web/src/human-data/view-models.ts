/**
 * The human-data studio view models (Work Order C012;
 * apps/web/src/human-data) — presentation-shaped projections of the REAL
 * domain objects (never a parallel data model).
 */

import type { HumanDataCommission } from '../../../../packages/human-data/src/index.js';
import { rightsDeclarationConsequences } from '../../../../packages/human-data/src/index.js';
import type { ProductionProjection } from '../../../../services/human-data/src/index.js';
import type { HumanDatasetDeliveryDescriptor } from '../../../../packages/human-data/src/index.js';

/** The commission builder view model (the declaration + consequence exposure). */
export interface CommissionBuilderViewModel {
  readonly commissionId: string;
  readonly datasetName: string;
  readonly capabilityNeed: string;
  readonly deliverableKind: string;
  readonly quantity: number;
  readonly escalationModes: readonly string[];
  readonly urgency: string;
  readonly budget: string;
  readonly acceptanceCriteria: readonly string[];
  readonly minAcceptedRatio: number;
  readonly rightsConsequences: readonly string[];
  readonly retention: string;
  readonly learningPermissions: readonly string[];
  readonly consentStatement: string;
}

export function commissionBuilderViewModel(
  commission: HumanDataCommission,
): CommissionBuilderViewModel {
  return Object.freeze({
    commissionId: commission.commissionId,
    datasetName: commission.datasetName,
    capabilityNeed: commission.capabilityNeed,
    deliverableKind: commission.deliverableKind,
    quantity: commission.quantity,
    escalationModes: Object.freeze([...commission.escalationModes]),
    urgency: commission.urgency,
    budget: `${commission.budget.amountMinorUnits} ${commission.budget.currency} (per item)`,
    acceptanceCriteria: Object.freeze([...commission.acceptanceCriteria.criteria]),
    minAcceptedRatio: commission.acceptanceCriteria.minAcceptedRatio,
    rightsConsequences: rightsDeclarationConsequences(commission.rights),
    retention: `${commission.retentionPolicy.retentionMs}ms (${commission.retentionPolicy.disposition})`,
    learningPermissions: Object.freeze([
      `knowledge capture: ${commission.learningPermissions.allowKnowledgeCapture ? 'allowed' : 'denied'}`,
      `tool-gap signals: ${commission.learningPermissions.allowToolGapSignals ? 'allowed' : 'denied'}`,
      `artifact reuse: ${commission.learningPermissions.allowArtifactReuse ? 'allowed' : 'denied'}`,
      `approval required: ${commission.learningPermissions.requireApproval ? 'yes' : 'no'}`,
    ]),
    consentStatement: commission.consent.statement,
  });
}

/** One live escalation row feeding a commission (the dashboard projection). */
export interface ProductionRowViewModel {
  readonly requestId: string;
  readonly state: string;
  readonly validationStatus: string;
  readonly updatedAt: string;
}

export interface ProductionDashboardViewModel {
  readonly commissionId: string;
  readonly datasetName: string;
  readonly deliverableKind: string;
  readonly state: string;
  readonly quantity: number;
  readonly rows: readonly ProductionRowViewModel[];
  readonly unreadableCount: number;
}

export function productionDashboardViewModel(
  projection: ProductionProjection,
): ProductionDashboardViewModel {
  return Object.freeze({
    commissionId: projection.commission.commissionId,
    datasetName: projection.commission.datasetName,
    deliverableKind: projection.commission.deliverableKind,
    state: projection.commission.state,
    quantity: projection.commission.quantity,
    rows: Object.freeze(
      projection.rows.map((row) =>
        Object.freeze({
          requestId: row.requestId,
          state: row.state,
          validationStatus: row.validationStatus ?? 'pending',
          updatedAt: row.updatedAt,
        }),
      ),
    ),
    unreadableCount: projection.unreadable.length,
  });
}

/** The dataset delivery view model (manifest, rights/lineage, download gate). */
export interface DatasetDeliveryViewModel {
  readonly manifestDigest: string;
  readonly identity: string;
  readonly version: string;
  readonly entriesChecksum: string;
  readonly deliverableCount: number;
  readonly verificationCount: number;
  readonly rights: readonly string[];
  readonly lineage: readonly { readonly parent: string; readonly relation: string }[];
  readonly downloadPermitted: boolean;
}

export function datasetDeliveryViewModel(
  descriptor: HumanDatasetDeliveryDescriptor,
): DatasetDeliveryViewModel {
  const rights = descriptor.rights as Readonly<Record<string, unknown>>;
  return Object.freeze({
    manifestDigest: descriptor.manifestDigest,
    identity: `${descriptor.identity.namespace}/${descriptor.identity.name}`,
    version: descriptor.identity.version,
    entriesChecksum: descriptor.entriesChecksum,
    deliverableCount: descriptor.deliverableCount,
    verificationCount: descriptor.verificationCount,
    rights: Object.freeze(
      Object.entries(rights).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
    ),
    lineage: Object.freeze(descriptor.lineage.map((edge) => Object.freeze({ ...edge }))),
    downloadPermitted: descriptor.downloadPermitted,
  });
}
