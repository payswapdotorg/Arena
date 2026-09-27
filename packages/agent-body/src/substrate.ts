/**
 * CognitiveSubstrate — the provider-neutral reference to a model/runtime
 * capability (spec AB1.0; architecture-lock rules 2, 10; requirement R19).
 *
 * A substrate is NOT an Agent Body (lock rule 2: Cognitive Substrate is
 * distinct from Agent Body) and never carries professional identity: it
 * only describes what a model runtime can DO. It must identify (spec
 * AB1.0, "Must identify"):
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
 *   6. context / profile limits  → `contextLimits` (measured in the
 *                                   adapter's native context units —
 *                                   provider-specific counting stays behind
 *                                   the adapter);
 *   7. adapter version           → `adapterVersion`;
 *   8. integrity metadata        → `integrity` (sha256 content digest of
 *                                   the substrate's digest-free view).
 *
 * It additionally declares `conditions` (preview / deprecated / ...) so a
 * body's compatibility profile can prohibit substrate conditions.
 *
 * Credentials NEVER enter canonical objects: credential-shaped field names
 * anywhere in the input are rejected
 * (AGENT_BODY_SUBSTRATE_CREDENTIAL_REJECTED). Provider brand names are
 * likewise rejected in every identifier (AGENT_BODY_PROVIDER_NAME_REJECTED)
 * — provider details remain behind adapters.
 *
 * Substrates are immutable, content-addressed and deep-frozen at creation.
 * There is no mutation API, and NO API anywhere in this package may assert
 * that a substrate IS a body (spec AB1.0 Compatibility Profile: "It may not
 * declare any model as semantically identical to the Body").
 */

import { digestCanonical } from '@arena/protocol-core';
import { AGENT_BODY_ERROR_CODES, AgentBodyError } from './errors.js';
import type { ContentDigest } from './shared.js';
import {
  assertNoCredentialFields,
  assertProviderNeutralString,
  deepFreeze,
  isContentDigest,
  isNeutralId,
  toAgentBodySemver,
  toContentDigest,
} from './shared.js';

// ---------------------------------------------------------------------------
// Closed capability vocabulary
// ---------------------------------------------------------------------------

/** Closed modality vocabulary (input/output channels a substrate supports). */
export const SUBSTRATE_MODALITIES = [
  'text-input',
  'text-output',
  'image-input',
  'image-output',
  'audio-input',
  'audio-output',
  'video-input',
  'structured-input',
  'structured-output',
] as const;
export type SubstrateModality = (typeof SUBSTRATE_MODALITIES)[number];

/**
 * Closed tool-calling vocabulary, ordered by capability level: a substrate
 * at a higher level satisfies a requirement at a lower level. `none` means
 * the substrate cannot invoke tools at all.
 */
export const TOOL_CALLING_LEVELS = ['none', 'text-protocol', 'json-schema', 'function-calling'] as const;
export type ToolCallingLevel = (typeof TOOL_CALLING_LEVELS)[number];

/** Closed condition vocabulary a substrate may declare about itself. */
export const SUBSTRATE_CONDITIONS = [
  'stable',
  'preview',
  'deprecated',
  'rate-limited',
  'region-restricted',
  'sovereign-only',
  'capacity-constrained',
] as const;
export type SubstrateCondition = (typeof SUBSTRATE_CONDITIONS)[number];

export function isSubstrateModality(value: unknown): value is SubstrateModality {
  return (
    typeof value === 'string' && (SUBSTRATE_MODALITIES as readonly string[]).includes(value)
  );
}

export function isToolCallingLevel(value: unknown): value is ToolCallingLevel {
  return (
    typeof value === 'string' && (TOOL_CALLING_LEVELS as readonly string[]).includes(value)
  );
}

export function isSubstrateCondition(value: unknown): value is SubstrateCondition {
  return (
    typeof value === 'string' && (SUBSTRATE_CONDITIONS as readonly string[]).includes(value)
  );
}

/** Capability level of a tool-calling profile (higher = more capable). */
export function toolCallingLevelIndex(level: ToolCallingLevel): number {
  return TOOL_CALLING_LEVELS.indexOf(level);
}

// ---------------------------------------------------------------------------
// Identifier patterns (neutral; provider brand names are rejected on top)
// ---------------------------------------------------------------------------

export const SUBSTRATE_MODEL_FAMILY_PATTERN_SOURCE = '^[a-z0-9][a-z0-9-]{0,63}$';
export const SUBSTRATE_MODEL_ID_PATTERN_SOURCE = '^[a-z0-9][a-z0-9._-]{0,127}$';
export const SUBSTRATE_MODEL_REVISION_PATTERN_SOURCE = '^[a-z0-9][a-z0-9._-]{0,63}$';

const MODEL_FAMILY_PATTERN = new RegExp(SUBSTRATE_MODEL_FAMILY_PATTERN_SOURCE);
const MODEL_ID_PATTERN = new RegExp(SUBSTRATE_MODEL_ID_PATTERN_SOURCE);
const MODEL_REVISION_PATTERN = new RegExp(SUBSTRATE_MODEL_REVISION_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Context limits and integrity metadata
// ---------------------------------------------------------------------------

/**
 * Context/profile limits, measured in the provider adapter's NATIVE context
 * units (lock rule 10: provider-specific counting — tokenization — stays
 * behind the adapter; the substrate speaks only neutral units).
 */
export interface SubstrateContextLimits {
  readonly maxContextUnits: number;
  readonly maxOutputUnits: number;
}

/** Integrity metadata: the sha256 content digest of the digest-free view. */
export interface SubstrateIntegrity {
  readonly digestAlgorithm: 'sha256';
  readonly contentDigest: ContentDigest;
}

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

function isIntegrity(value: unknown): value is SubstrateIntegrity {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['digestAlgorithm'] === 'sha256' &&
    typeof candidate['contentDigest'] === 'string' &&
    isContentDigest(candidate['contentDigest'])
  );
}

// ---------------------------------------------------------------------------
// CognitiveSubstrate
// ---------------------------------------------------------------------------

/** Wire version of the cognitive substrate shape. */
export const SUBSTRATE_RECORD_VERSION = 1 as const;

export interface CognitiveSubstrate {
  readonly recordVersion: typeof SUBSTRATE_RECORD_VERSION;
  /** 1. provider adapter — neutral identifier of the adapter boundary. */
  readonly adapterId: string;
  /** 7. adapter version. */
  readonly adapterVersion: string;
  /** 2a. model family (neutral, registered through the adapter). */
  readonly modelFamily: string;
  /** 2b. model id (neutral, registered through the adapter). */
  readonly modelId: string;
  /** 3. model revision. */
  readonly modelRevision: string;
  /** 4. modality profile (closed enum, at least one modality). */
  readonly modalityProfile: readonly SubstrateModality[];
  /** 5. tool-calling profile (closed enum). */
  readonly toolCallingProfile: ToolCallingLevel;
  /** 6. context/profile limits, in adapter-native units. */
  readonly contextLimits: SubstrateContextLimits;
  /** Declared substrate conditions (may be empty). */
  readonly conditions: readonly SubstrateCondition[];
  /** 8. integrity metadata (sha256 over the digest-free view). */
  readonly integrity: SubstrateIntegrity;
}

/** Digest-free view of a substrate — exactly what the integrity digest covers. */
export interface CognitiveSubstrateView {
  readonly recordVersion: typeof SUBSTRATE_RECORD_VERSION;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly modelFamily: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly modalityProfile: readonly SubstrateModality[];
  readonly toolCallingProfile: ToolCallingLevel;
  readonly contextLimits: SubstrateContextLimits;
  readonly conditions: readonly SubstrateCondition[];
}

export interface CreateCognitiveSubstrateInput {
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
  throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_SUBSTRATE, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

/**
 * Create an immutable, content-addressed CognitiveSubstrate: validates every
 * field, rejects credential-shaped fields and provider brand names, computes
 * the sha256 integrity digest over the canonical serialization of the
 * digest-free view, and deep-freezes the result.
 */
export async function createCognitiveSubstrate(
  input: CreateCognitiveSubstrateInput,
): Promise<CognitiveSubstrate> {
  // Credentials never enter canonical objects (spec AB1.0).
  assertNoCredentialFields(input, 'substrate');

  if (!isNeutralId(input.adapterId)) {
    invalidSubstrate(
      `invalid adapter identifier: ${JSON.stringify(input.adapterId)} (neutral identifier required; provider details remain behind adapters)`,
    );
  }
  assertProviderNeutralString(input.adapterId, 'adapterId');

  const adapterVersion = toAgentBodySemver(input.adapterVersion);
  assertProviderNeutralString(adapterVersion, 'adapterVersion');

  if (
    typeof input.modelFamily !== 'string' ||
    !MODEL_FAMILY_PATTERN.test(input.modelFamily)
  ) {
    invalidSubstrate(`invalid model family: ${JSON.stringify(input.modelFamily)}`);
  }
  assertProviderNeutralString(input.modelFamily, 'modelFamily');

  if (typeof input.modelId !== 'string' || !MODEL_ID_PATTERN.test(input.modelId)) {
    invalidSubstrate(`invalid model id: ${JSON.stringify(input.modelId)}`);
  }
  assertProviderNeutralString(input.modelId, 'modelId');

  if (
    typeof input.modelRevision !== 'string' ||
    !MODEL_REVISION_PATTERN.test(input.modelRevision)
  ) {
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
    invalidSubstrate(`unknown tool-calling profile: ${JSON.stringify(input.toolCallingProfile)}`, {
      known: [...TOOL_CALLING_LEVELS],
    });
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

  const contentDigest = toContentDigest(await cognitiveSubstrateViewDigest(view));
  const substrate: CognitiveSubstrate = deepFreeze({
    ...view,
    integrity: Object.freeze({ digestAlgorithm: 'sha256', contentDigest }),
  });
  return substrate;
}

/** sha256 content digest over the canonical serialization of the digest-free view. */
export async function cognitiveSubstrateViewDigest(
  view: CognitiveSubstrateView,
): Promise<string> {
  return digestCanonical(view);
}

/** The digest-free view of a substrate (what the integrity digest commits to). */
export function cognitiveSubstrateView(substrate: CognitiveSubstrate): CognitiveSubstrateView {
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

/** Content address of a substrate (equals its integrity digest). */
export async function cognitiveSubstrateDigest(substrate: CognitiveSubstrate): Promise<string> {
  return cognitiveSubstrateViewDigest(cognitiveSubstrateView(substrate));
}

export function isCognitiveSubstrate(value: unknown): value is CognitiveSubstrate {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === SUBSTRATE_RECORD_VERSION &&
    typeof candidate['adapterId'] === 'string' &&
    isNeutralId(candidate['adapterId']) &&
    typeof candidate['adapterVersion'] === 'string' &&
    typeof candidate['modelFamily'] === 'string' &&
    typeof candidate['modelId'] === 'string' &&
    typeof candidate['modelRevision'] === 'string' &&
    Array.isArray(candidate['modalityProfile']) &&
    candidate['modalityProfile'].every((modality) => isSubstrateModality(modality)) &&
    isToolCallingLevel(candidate['toolCallingProfile']) &&
    isContextLimits(candidate['contextLimits']) &&
    Array.isArray(candidate['conditions']) &&
    candidate['conditions'].every((condition) => isSubstrateCondition(condition)) &&
    isIntegrity(candidate['integrity'])
  );
}

/**
 * Re-compute a substrate's integrity digest and compare it with the claimed
 * one. FAILS CLOSED with AGENT_BODY_TAMPERED on any mismatch — a mutation of
 * any substrate field is always detected.
 */
export async function verifyCognitiveSubstrate(substrate: CognitiveSubstrate): Promise<string> {
  if (!isCognitiveSubstrate(substrate)) {
    invalidSubstrate('not a structurally valid cognitive substrate');
  }
  const actual = await cognitiveSubstrateViewDigest(cognitiveSubstrateView(substrate));
  if (actual !== substrate.integrity.contentDigest) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.TAMPERED, {
      message: `substrate integrity mismatch: expected ${substrate.integrity.contentDigest}, recomputed ${actual}`,
      details: { expected: substrate.integrity.contentDigest, actual },
    });
  }
  return actual;
}
