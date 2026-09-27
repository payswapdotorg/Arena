/**
 * Substrate records — the materialization of a Cognitive Substrate through
 * the model adapter protocol (Work Order A016; spec AB1.0; architecture-lock
 * rules 2, 10; requirement R19).
 *
 * `createSubstrateRecord` builds EXACTLY the @arena/agent-body
 * CognitiveSubstrate shape (spec AB1.0 "Must identify" — all eight items):
 *
 *   1. provider adapter          → `adapterId` (neutral; the adapter is the
 *                                   isolation boundary behind which the
 *                                   actual provider lives — lock rule 10);
 *   2. model family / id         → `modelFamily` + `modelId` (neutral
 *                                   identifiers registered through the
 *                                   adapter, never provider brand names);
 *   3. model revision            → `modelRevision`;
 *   4. modality profile          → `modalityProfile` (closed enum);
 *   5. tool-calling profile      → `toolCallingProfile` (closed enum);
 *   6. context / profile limits  → `contextLimits` (adapter-native units);
 *   7. adapter version           → `adapterVersion`;
 *   8. integrity metadata        → `integrity` (sha256 content digest of the
 *                                   digest-free view).
 *
 * The RECORD TYPE IS the agent-body type (type-only import; runtime imports
 * from @arena/agent-body are forbidden by the A016 domain purity gate) and
 * the integrity digest is computed with the SAME @arena/protocol-core
 * primitive agent-body uses (`digestCanonical` over the digest-free view),
 * so identical inputs produce byte-identical, interop-verified records
 * (substrate.test.ts pins the golden cross-implementation digest).
 *
 * Credentials never enter canonical objects; provider brand names are
 * rejected in every identifier; records are deep-frozen at creation; there
 * is no mutation API. A substrate is distinct from an Agent Body and no API
 * in this package may assert otherwise (lock rule 2).
 */

import { digestCanonical } from '@arena/protocol-core';
import type {
  CognitiveSubstrate,
  CognitiveSubstrateView,
  SubstrateCondition,
  SubstrateContextLimits,
  SubstrateIntegrity,
  SubstrateModality,
  ToolCallingLevel,
} from '@arena/agent-body';
import { MODEL_SUBSTRATE_ERROR_CODES, ModelSubstrateError } from './errors.js';
import {
  SUBSTRATE_CONDITIONS,
  SUBSTRATE_MODALITIES,
  TOOL_CALLING_LEVELS,
  assertNoCredentialFields,
  assertProviderNeutralString,
  deepFreeze,
  isContentDigest,
  isModelFamily,
  isModelId,
  isModelRevision,
  isModelSubstrateSemver,
  isNeutralId,
  isSubstrateCondition,
  isSubstrateModality,
  isToolCallingLevel,
  toContentDigest,
  toModelSubstrateSemver,
} from './shared.js';

// ---------------------------------------------------------------------------
// Substrate context limits (structurally identical to the agent-body shape)
// ---------------------------------------------------------------------------

export const SUBSTRATE_MAX_UNITS_LIMIT = 2_147_483_647;

function isContextLimits(value: unknown): value is SubstrateContextLimits {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['maxContextUnits'] === 'number' &&
    Number.isInteger(candidate['maxContextUnits']) &&
    candidate['maxContextUnits'] >= 1 &&
    candidate['maxContextUnits'] <= SUBSTRATE_MAX_UNITS_LIMIT &&
    typeof candidate['maxOutputUnits'] === 'number' &&
    Number.isInteger(candidate['maxOutputUnits']) &&
    candidate['maxOutputUnits'] >= 1 &&
    candidate['maxOutputUnits'] <= SUBSTRATE_MAX_UNITS_LIMIT
  );
}
export { isContextLimits };

// ---------------------------------------------------------------------------
// The substrate record (agent-body CognitiveSubstrate shape)
// ---------------------------------------------------------------------------

/** Wire version of the cognitive substrate shape (matches AB1.0 / A003). */
export const SUBSTRATE_RECORD_VERSION = 1 as const;

/**
 * Input to `createSubstrateRecord`: the neutral registration fields of the
 * substrate. The ADAPTER contributes its own `adapterId` /
 * `adapterVersion` (its version identity) — provider semantics stay behind
 * the adapter (lock rule 10).
 */
export interface CreateSubstrateRecordInput {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly modelFamily: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly modalityProfile: readonly string[];
  readonly toolCallingProfile: string;
  readonly contextLimits: { maxContextUnits: number; maxOutputUnits: number };
  readonly conditions?: readonly string[];
}

function invalidSubstrate(message: string, details?: Record<string, unknown>): never {
  throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_SUBSTRATE, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

/**
 * Create an immutable, content-addressed substrate record in the exact
 * @arena/agent-body CognitiveSubstrate shape: validates every field, rejects
 * credential-shaped fields and provider brand names, computes the sha256
 * integrity digest over the canonical serialization of the digest-free view
 * (the same primitive and the same view agent-body digests), and deep-freezes
 * the result. Identical input yields an identical digest — registry-style
 * dedup keys on this content address.
 */
export async function createSubstrateRecord(
  input: CreateSubstrateRecordInput,
): Promise<CognitiveSubstrate> {
  // Credentials never enter canonical objects (spec AB1.0).
  assertNoCredentialFields(input, 'substrateRecord');

  if (!isNeutralId(input.adapterId)) {
    invalidSubstrate(
      `invalid adapter identifier: ${JSON.stringify(input.adapterId)} (neutral identifier required; provider details remain behind adapters)`,
    );
  }
  assertProviderNeutralString(input.adapterId, 'adapterId');

  const adapterVersion = toModelSubstrateSemver(input.adapterVersion);
  assertProviderNeutralString(adapterVersion, 'adapterVersion');

  if (typeof input.modelFamily !== 'string' || !isModelFamily(input.modelFamily)) {
    invalidSubstrate(`invalid model family: ${JSON.stringify(input.modelFamily)}`);
  }
  assertProviderNeutralString(input.modelFamily, 'modelFamily');

  if (typeof input.modelId !== 'string' || !isModelId(input.modelId)) {
    invalidSubstrate(`invalid model id: ${JSON.stringify(input.modelId)}`);
  }
  assertProviderNeutralString(input.modelId, 'modelId');

  if (typeof input.modelRevision !== 'string' || !isModelRevision(input.modelRevision)) {
    invalidSubstrate(`invalid model revision: ${JSON.stringify(input.modelRevision)}`);
  }
  assertProviderNeutralString(input.modelRevision, 'modelRevision');

  if (!Array.isArray(input.modalityProfile) || input.modalityProfile.length === 0) {
    invalidSubstrate('modality profile must be a non-empty array of substrate modalities');
  }
  const seenModalities = new Set<string>();
  const modalityProfile: SubstrateModality[] = input.modalityProfile.map((modality) => {
    if (!isSubstrateModality(modality)) {
      invalidSubstrate(`unknown substrate modality: ${JSON.stringify(modality)}`, {
        known: [...SUBSTRATE_MODALITIES],
      });
    }
    if (seenModalities.has(modality)) {
      invalidSubstrate(`duplicate substrate modality: ${JSON.stringify(modality)}`);
    }
    seenModalities.add(modality);
    return modality;
  });

  if (!isToolCallingLevel(input.toolCallingProfile)) {
    invalidSubstrate(
      `unknown tool-calling profile: ${JSON.stringify(input.toolCallingProfile)}`,
      { known: [...TOOL_CALLING_LEVELS] },
    );
  }

  if (!isContextLimits(input.contextLimits)) {
    invalidSubstrate(
      'context limits must carry integer maxContextUnits and maxOutputUnits between 1 and ' +
        String(SUBSTRATE_MAX_UNITS_LIMIT),
    );
  }

  const conditions: SubstrateCondition[] = (input.conditions ?? []).map((condition) => {
    if (!isSubstrateCondition(condition)) {
      invalidSubstrate(`unknown substrate condition: ${JSON.stringify(condition)}`, {
        known: [...SUBSTRATE_CONDITIONS],
      });
    }
    return condition;
  });
  const uniqueConditions = new Set<SubstrateCondition>(conditions);
  if (uniqueConditions.size !== conditions.length) {
    invalidSubstrate('duplicate substrate condition');
  }

  const view: CognitiveSubstrateView = {
    recordVersion: SUBSTRATE_RECORD_VERSION,
    adapterId: input.adapterId,
    adapterVersion,
    modelFamily: input.modelFamily,
    modelId: input.modelId,
    modelRevision: input.modelRevision,
    modalityProfile: Object.freeze(modalityProfile),
    toolCallingProfile: input.toolCallingProfile,
    contextLimits: Object.freeze({ ...input.contextLimits }),
    conditions: Object.freeze(conditions),
  };

  const contentDigest = toContentDigest(await substrateRecordViewDigest(view));
  const substrate: CognitiveSubstrate = deepFreeze({
    ...view,
    integrity: Object.freeze({
      digestAlgorithm: 'sha256',
      // The digest is a validated sha256 hex string; cast to the agent-body
      // branded view type (brands are compile-time only).
      contentDigest: contentDigest as CognitiveSubstrate['integrity']['contentDigest'],
    }),
  });
  return substrate;
}

/** sha256 content digest over the canonical serialization of the digest-free view. */
export async function substrateRecordViewDigest(view: CognitiveSubstrateView): Promise<string> {
  return digestCanonical(view);
}

/** The digest-free view of a substrate record (what the integrity digest commits to). */
export function substrateRecordView(substrate: CognitiveSubstrate): CognitiveSubstrateView {
  return {
    recordVersion: substrate.recordVersion,
    adapterId: substrate.adapterId,
    adapterVersion: substrate.adapterVersion,
    modelFamily: substrate.modelFamily,
    modelId: substrate.modelId,
    modelRevision: substrate.modelRevision,
    modalityProfile: substrate.modalityProfile,
    toolCallingProfile: substrate.toolCallingProfile,
    contextLimits: substrate.contextLimits,
    conditions: substrate.conditions,
  };
}

/** Content address of a substrate record (equals its integrity digest). */
export async function substrateRecordDigest(substrate: CognitiveSubstrate): Promise<string> {
  return substrateRecordViewDigest(substrateRecordView(substrate));
}

/**
 * Structural guard for a substrate record — accepts any value shaped like
 * the agent-body CognitiveSubstrate (the type re-exported from this package).
 */
export function isSubstrateRecord(value: unknown): value is CognitiveSubstrate {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === SUBSTRATE_RECORD_VERSION &&
    typeof candidate['adapterId'] === 'string' &&
    isNeutralId(candidate['adapterId']) &&
    typeof candidate['adapterVersion'] === 'string' &&
    isModelSubstrateSemver(candidate['adapterVersion']) &&
    typeof candidate['modelFamily'] === 'string' &&
    isModelFamily(candidate['modelFamily']) &&
    typeof candidate['modelId'] === 'string' &&
    isModelId(candidate['modelId']) &&
    typeof candidate['modelRevision'] === 'string' &&
    isModelRevision(candidate['modelRevision']) &&
    Array.isArray(candidate['modalityProfile']) &&
    candidate['modalityProfile'].every((modality) => isSubstrateModality(modality)) &&
    isToolCallingLevel(candidate['toolCallingProfile']) &&
    isContextLimits(candidate['contextLimits']) &&
    Array.isArray(candidate['conditions']) &&
    candidate['conditions'].every((condition) => isSubstrateCondition(condition)) &&
    isIntegrityView(candidate['integrity'])
  );
}

function isIntegrityView(value: unknown): value is SubstrateIntegrity {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['digestAlgorithm'] === 'sha256' &&
    typeof candidate['contentDigest'] === 'string' &&
    isContentDigest(candidate['contentDigest'])
  );
}

/**
 * Re-compute a substrate record's integrity digest and compare it with the
 * claimed one. FAILS CLOSED with MODEL_SUBSTRATE_TAMPERED on any mismatch —
 * a mutation of any substrate field is always detected.
 */
export async function verifySubstrateRecord(substrate: CognitiveSubstrate): Promise<string> {
  if (!isSubstrateRecord(substrate)) {
    invalidSubstrate('not a structurally valid substrate record');
  }
  const actual = await substrateRecordViewDigest(substrateRecordView(substrate));
  if (actual !== substrate.integrity.contentDigest) {
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.TAMPERED, {
      message: `substrate record integrity mismatch: expected ${substrate.integrity.contentDigest}, recomputed ${actual}`,
      details: { expected: substrate.integrity.contentDigest, actual },
    });
  }
  return actual;
}

// ---------------------------------------------------------------------------
// Substrate registration descriptors — the neutral input an ADAPTER accepts
// through SubstrateAdapter.registerSubstrate (gate 2)
// ---------------------------------------------------------------------------

/**
 * The neutral descriptor a SubstrateAdapter accepts in
 * `registerSubstrate(descriptor)`. The ADAPTER contributes its own identity
 * (adapterId/adapterVersion) and translates any provider-side semantics;
 * nothing provider-specific may appear here (lock rule 10).
 */
export interface SubstrateRegistrationDescriptor {
  readonly modelFamily: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly modalityProfile: readonly SubstrateModality[];
  readonly toolCallingProfile: ToolCallingLevel;
  readonly contextLimits: SubstrateContextLimits;
  readonly conditions: readonly SubstrateCondition[];
}

/** Exact field set of a registration descriptor (unknown fields are rejected). */
export const SUBSTRATE_REGISTRATION_DESCRIPTOR_FIELDS = Object.freeze([
  'modelFamily',
  'modelId',
  'modelRevision',
  'modalityProfile',
  'toolCallingProfile',
  'contextLimits',
  'conditions',
] as const);

export interface CreateSubstrateRegistrationDescriptorInput {
  readonly modelFamily: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly modalityProfile: readonly string[];
  readonly toolCallingProfile: string;
  readonly contextLimits: { maxContextUnits: number; maxOutputUnits: number };
  readonly conditions?: readonly string[];
}

/**
 * Validate and freeze a substrate registration descriptor: closed shape,
 * neutral identifier patterns, no credential-shaped fields, no provider
 * brand names, closed vocabularies, sane context limits.
 */
export function toSubstrateRegistrationDescriptor(
  input: CreateSubstrateRegistrationDescriptorInput,
): SubstrateRegistrationDescriptor {
  assertNoCredentialFields(input, 'registrationDescriptor');

  const knownFields = new Set<string>(SUBSTRATE_REGISTRATION_DESCRIPTOR_FIELDS);
  for (const key of Object.keys(input as unknown as Record<string, unknown>)) {
    if (!knownFields.has(key)) {
      throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_SUBSTRATE, {
        message: `unknown registration descriptor field: ${JSON.stringify(key)} (closed shape; provider details remain behind the adapter)`,
        details: { known: [...SUBSTRATE_REGISTRATION_DESCRIPTOR_FIELDS] },
      });
    }
  }

  if (typeof input.modelFamily !== 'string' || !isModelFamily(input.modelFamily)) {
    invalidSubstrate(`invalid model family: ${JSON.stringify(input.modelFamily)}`);
  }
  assertProviderNeutralString(input.modelFamily, 'modelFamily');

  if (typeof input.modelId !== 'string' || !isModelId(input.modelId)) {
    invalidSubstrate(`invalid model id: ${JSON.stringify(input.modelId)}`);
  }
  assertProviderNeutralString(input.modelId, 'modelId');

  if (typeof input.modelRevision !== 'string' || !isModelRevision(input.modelRevision)) {
    invalidSubstrate(`invalid model revision: ${JSON.stringify(input.modelRevision)}`);
  }
  assertProviderNeutralString(input.modelRevision, 'modelRevision');

  if (!Array.isArray(input.modalityProfile) || input.modalityProfile.length === 0) {
    invalidSubstrate('modality profile must be a non-empty array of substrate modalities');
  }
  const seenModalities = new Set<string>();
  const modalityProfile: SubstrateModality[] = input.modalityProfile.map((modality) => {
    if (!isSubstrateModality(modality)) {
      invalidSubstrate(`unknown substrate modality: ${JSON.stringify(modality)}`, {
        known: [...SUBSTRATE_MODALITIES],
      });
    }
    if (seenModalities.has(modality)) {
      invalidSubstrate(`duplicate substrate modality: ${JSON.stringify(modality)}`);
    }
    seenModalities.add(modality);
    return modality;
  });

  if (!isToolCallingLevel(input.toolCallingProfile)) {
    invalidSubstrate(
      `unknown tool-calling profile: ${JSON.stringify(input.toolCallingProfile)}`,
      { known: [...TOOL_CALLING_LEVELS] },
    );
  }

  if (!isContextLimits(input.contextLimits)) {
    invalidSubstrate(
      'context limits must carry integer maxContextUnits and maxOutputUnits between 1 and ' +
        String(SUBSTRATE_MAX_UNITS_LIMIT),
    );
  }

  const conditions: SubstrateCondition[] = (input.conditions ?? []).map((condition) => {
    if (!isSubstrateCondition(condition)) {
      invalidSubstrate(`unknown substrate condition: ${JSON.stringify(condition)}`, {
        known: [...SUBSTRATE_CONDITIONS],
      });
    }
    return condition;
  });
  const uniqueConditions = new Set<SubstrateCondition>(conditions);
  if (uniqueConditions.size !== conditions.length) {
    invalidSubstrate('duplicate substrate condition');
  }

  return deepFreeze({
    modelFamily: input.modelFamily,
    modelId: input.modelId,
    modelRevision: input.modelRevision,
    modalityProfile: Object.freeze(modalityProfile),
    toolCallingProfile: input.toolCallingProfile,
    contextLimits: Object.freeze({ ...input.contextLimits }),
    conditions: Object.freeze(conditions),
  });
}

/** Structural guard for a frozen substrate registration descriptor. */
export function isSubstrateRegistrationDescriptor(
  value: unknown,
): value is SubstrateRegistrationDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isModelFamily(candidate['modelFamily']) &&
    isModelId(candidate['modelId']) &&
    isModelRevision(candidate['modelRevision']) &&
    Array.isArray(candidate['modalityProfile']) &&
    candidate['modalityProfile'].length > 0 &&
    candidate['modalityProfile'].every((modality) => isSubstrateModality(modality)) &&
    isToolCallingLevel(candidate['toolCallingProfile']) &&
    isContextLimits(candidate['contextLimits']) &&
    Array.isArray(candidate['conditions']) &&
    candidate['conditions'].every((condition) => isSubstrateCondition(condition))
  );
}
