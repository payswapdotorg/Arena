/**
 * SubstrateCompatibilityProfile — what a BodyVersion requires from a
 * cognitive substrate (spec AB1.0 "Compatibility Profile"; requirement R20;
 * architecture-lock rules 2, 3, 4).
 *
 * A profile declares:
 *   - required modalities (closed enum);
 *   - required tool semantics (minimum tool-calling level);
 *   - context characteristics (minimum context units);
 *   - cost/latency constraints where relevant (optional, declarative);
 *   - required evaluation suites (certification prerequisites);
 *   - prohibited substrate conditions (closed enum);
 *   - optional substrate-specific adaptations (content-addressed by
 *     SUBSTRATE DIGEST, never by model identity).
 *
 * THE HARD RULE (spec AB1.0): "It may NOT declare any model as semantically
 * identical to the Body." This package therefore has NO API that asserts a
 * substrate ≡ body equality alias: no `substrateEqualsBody`, no model alias
 * list, no identity field anywhere in the profile. Compatibility is a
 * per-profile capability predicate (`evaluateSubstrateCompatibility`),
 * never an identity claim. Any attempt to smuggle a model-identity
 * assertion into a profile — an `equivalentModels`, `identicalToBody`,
 * `modelAliases` (or similar) field — is rejected at construction with
 * AGENT_BODY_SUBSTRATE_ALIAS_FORBIDDEN. src/aliasing.test.ts pins both the
 * absence of any equality-alias export and this construction tripwire.
 *
 * Certification interpretation (spec AB1.0): anything downstream of this
 * profile proves claims about `BodyVersion × Substrate × Environment ×
 * Runtime × CertificationSuite` — never `Substrate = Profession`
 * (requirements R43, R46).
 */

import { AGENT_BODY_ERROR_CODES, AgentBodyError } from './errors.js';
import type {
  CognitiveSubstrate,
  SubstrateCondition,
  SubstrateModality,
  ToolCallingLevel,
} from './substrate.js';
import {
  isSubstrateCondition,
  isSubstrateModality,
  isToolCallingLevel,
  toolCallingLevelIndex,
} from './substrate.js';
import type { SuiteRef } from './shared.js';
import {
  assertNoCredentialFields,
  deepFreeze,
  isContentDigest,
  isVersionedArtifactRef,
  toContentDigest,
  toVersionedArtifactRef,
} from './shared.js';

// ---------------------------------------------------------------------------
// Cost/latency constraints (declarative; "where relevant")
// ---------------------------------------------------------------------------

/** Optional cost/latency constraints a body declares for its possessions. */
export interface CostLatencyConstraints {
  readonly maxCostPerMillionRequests?: number;
  readonly maxP95LatencyMs?: number;
}

export const COMPATIBILITY_MIN_COST = 0.000001;
export const COMPATIBILITY_MAX_LATENCY_MS = 86_400_000;

function isCostLatencyConstraints(value: unknown): value is CostLatencyConstraints {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const cost = candidate['maxCostPerMillionRequests'];
  const latency = candidate['maxP95LatencyMs'];
  if (
    cost !== undefined &&
    (typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0)
  ) {
    return false;
  }
  if (
    latency !== undefined &&
    (typeof latency !== 'number' ||
      !Number.isInteger(latency) ||
      latency <= 0 ||
      latency > COMPATIBILITY_MAX_LATENCY_MS)
  ) {
    return false;
  }
  return cost !== undefined || latency !== undefined;
}

// ---------------------------------------------------------------------------
// Context characteristics
// ---------------------------------------------------------------------------

/** Minimum context characteristics the body requires from a substrate. */
export interface ContextRequirements {
  readonly minContextUnits: number;
}

export const COMPATIBILITY_MAX_UNITS_LIMIT = 2_147_483_647;

function isContextRequirements(value: unknown): value is ContextRequirements {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['minContextUnits'] === 'number' &&
    Number.isInteger(candidate['minContextUnits']) &&
    candidate['minContextUnits'] >= 1 &&
    candidate['minContextUnits'] <= COMPATIBILITY_MAX_UNITS_LIMIT
  );
}

// ---------------------------------------------------------------------------
// Substrate-specific adaptations
// ---------------------------------------------------------------------------

/**
 * An adaptation applied when a specific substrate (identified BY CONTENT
 * DIGEST — an immutable content address, never a model identity) is bound
 * to the body. Adaptations are content-addressed artifacts.
 */
export interface SubstrateAdaptation {
  readonly substrateDigest: string;
  readonly adaptation: SuiteRef;
}

function isSubstrateAdaptation(value: unknown): value is SubstrateAdaptation {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['substrateDigest'] === 'string' &&
    isContentDigest(candidate['substrateDigest']) &&
    isVersionedArtifactRef(candidate['adaptation'])
  );
}

// ---------------------------------------------------------------------------
// The anti-aliasing tripwire
// ---------------------------------------------------------------------------

/**
 * Field-name shapes that would assert a substrate/model ≡ body identity
 * alias. Any of these — as fields of a compatibility profile input — is
 * rejected with AGENT_BODY_SUBSTRATE_ALIAS_FORBIDDEN (spec AB1.0: the
 * profile "may not declare any model as semantically identical to the
 * Body"). Normalized comparison: lowercase, non-alphanumerics stripped,
 * so `equivalent-models`, `EQUIVALENT_MODELS` and `equivalentModels` all
 * trip the same wire.
 */
const SUBSTRATE_ALIAS_FIELD_NAMES = [
  'equivalentmodels',
  'equivalentsubstrates',
  'identicaltobody',
  'identicaltomodel',
  'ismodelfor',
  'modelaliases',
  'modelidentity',
  'samemodelas',
  'samesubstrateas',
  'semanticalequivalents',
  'semanticequivalents',
  'bodyalias',
  'bodyidentity',
  'aliases',
];

function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function assertNoSubstrateAliasFields(
  input: Record<string, unknown>,
): void {
  for (const key of Object.keys(input)) {
    if (SUBSTRATE_ALIAS_FIELD_NAMES.includes(normalizeFieldName(key))) {
      throw new AgentBodyError(AGENT_BODY_ERROR_CODES.SUBSTRATE_ALIAS_FORBIDDEN, {
        message: `compatibility profile field ${JSON.stringify(key)} would assert a substrate/model ≡ body identity alias; a compatibility profile may not declare any model as semantically identical to the Body (spec AB1.0) — declare per-profile capability requirements instead`,
        details: { field: key },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// SubstrateCompatibilityProfile
// ---------------------------------------------------------------------------

export interface SubstrateCompatibilityProfile {
  readonly requiredModalities: readonly SubstrateModality[];
  readonly requiredToolCalling: ToolCallingLevel;
  readonly contextRequirements: ContextRequirements;
  readonly costConstraints?: CostLatencyConstraints;
  readonly requiredEvaluationSuites: readonly SuiteRef[];
  readonly prohibitedConditions: readonly SubstrateCondition[];
  readonly substrateAdaptations: readonly SubstrateAdaptation[];
}

/** Exact field set of a compatibility profile (unknown fields are rejected). */
export const SUBSTRATE_COMPATIBILITY_PROFILE_FIELDS = [
  'requiredModalities',
  'requiredToolCalling',
  'contextRequirements',
  'costConstraints',
  'requiredEvaluationSuites',
  'prohibitedConditions',
  'substrateAdaptations',
] as const;

export interface CreateSubstrateCompatibilityProfileInput {
  readonly requiredModalities: readonly string[];
  readonly requiredToolCalling: string;
  readonly contextRequirements: { minContextUnits: number };
  readonly costConstraints?: { maxCostPerMillionRequests?: number; maxP95LatencyMs?: number };
  readonly requiredEvaluationSuites?: readonly {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }[];
  readonly prohibitedConditions?: readonly string[];
  readonly substrateAdaptations?: readonly {
    substrateDigest: string;
    adaptation: { namespace: string; name: string; version: string; digest: string };
  }[];
}

function invalidProfile(message: string, details?: Record<string, unknown>): never {
  throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_COMPATIBILITY_PROFILE, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

/**
 * Validate and freeze a substrate compatibility profile. Rejects unknown
 * fields (closed shape), credential-shaped fields, provider brand names and
 * — explicitly — any field that would declare a substrate/model ≡ body
 * identity alias (AGENT_BODY_SUBSTRATE_ALIAS_FORBIDDEN).
 */
export function toSubstrateCompatibilityProfile(
  input: CreateSubstrateCompatibilityProfileInput,
): SubstrateCompatibilityProfile {
  assertNoCredentialFields(input, 'compatibilityProfile');
  assertNoSubstrateAliasFields(input as unknown as Record<string, unknown>);

  const knownFields = new Set<string>(SUBSTRATE_COMPATIBILITY_PROFILE_FIELDS);
  for (const key of Object.keys(input as unknown as Record<string, unknown>)) {
    if (!knownFields.has(key)) {
      invalidProfile(
        `unknown compatibility profile field: ${JSON.stringify(key)} (closed shape; compatibility is declared per-profile, never as identity)`,
        { known: [...SUBSTRATE_COMPATIBILITY_PROFILE_FIELDS] },
      );
    }
  }

  if (!Array.isArray(input.requiredModalities) || input.requiredModalities.length === 0) {
    invalidProfile('requiredModalities must be a non-empty array of substrate modalities');
  }
  const seenModalities = new Set<string>();
  const requiredModalities: SubstrateModality[] = input.requiredModalities.map((modality) => {
    if (!isSubstrateModality(modality)) {
      invalidProfile(`unknown substrate modality: ${JSON.stringify(modality)}`, {
        known: 'see SUBSTRATE_MODALITIES',
      });
    }
    if (seenModalities.has(modality)) {
      invalidProfile(`duplicate required modality: ${JSON.stringify(modality)}`);
    }
    seenModalities.add(modality);
    return modality;
  });

  if (!isToolCallingLevel(input.requiredToolCalling)) {
    invalidProfile(
      `unknown required tool-calling level: ${JSON.stringify(input.requiredToolCalling)}`,
      { known: 'see TOOL_CALLING_LEVELS' },
    );
  }

  if (!isContextRequirements(input.contextRequirements)) {
    invalidProfile(
      `invalid context requirements: ${JSON.stringify(input.contextRequirements ?? null)}`,
    );
  }

  let costConstraints: CostLatencyConstraints | undefined;
  if (input.costConstraints !== undefined) {
    if (!isCostLatencyConstraints(input.costConstraints)) {
      invalidProfile(
        `invalid cost constraints: ${JSON.stringify(input.costConstraints)} (at least one positive constraint required)`,
      );
    }
    costConstraints = Object.freeze({ ...input.costConstraints });
  }

  const requiredEvaluationSuites = (input.requiredEvaluationSuites ?? []).map((ref) =>
    toVersionedArtifactRef(ref),
  );
  const suiteKeys = new Set<string>();
  for (const suite of requiredEvaluationSuites) {
    const key = `${suite.namespace}/${suite.name}@${suite.version}#${suite.digest}`;
    if (suiteKeys.has(key)) {
      invalidProfile(`duplicate required evaluation suite: ${key}`);
    }
    suiteKeys.add(key);
  }

  const prohibitedConditions: SubstrateCondition[] = (
    input.prohibitedConditions ?? []
  ).map((condition) => {
    if (!isSubstrateCondition(condition)) {
      invalidProfile(`unknown prohibited substrate condition: ${JSON.stringify(condition)}`, {
        known: 'see SUBSTRATE_CONDITIONS',
      });
    }
    return condition;
  });
  const prohibitedSet = new Set<SubstrateCondition>(prohibitedConditions);
  if (prohibitedSet.size !== prohibitedConditions.length) {
    invalidProfile('duplicate prohibited substrate condition');
  }

  const substrateAdaptations: SubstrateAdaptation[] = (
    input.substrateAdaptations ?? []
  ).map((adaptation) => {
    if (!isSubstrateAdaptation(adaptation)) {
      invalidProfile(`invalid substrate adaptation: ${JSON.stringify(adaptation)}`);
    }
    const digest = toContentDigest(adaptation.substrateDigest);
    return {
      substrateDigest: digest,
      adaptation: toVersionedArtifactRef(adaptation.adaptation),
    };
  });
  const adaptationTargets = new Set<string>();
  for (const adaptation of substrateAdaptations) {
    if (adaptationTargets.has(adaptation.substrateDigest)) {
      invalidProfile(
        `duplicate substrate adaptation target digest: ${adaptation.substrateDigest}`,
      );
    }
    adaptationTargets.add(adaptation.substrateDigest);
  }

  const profile: SubstrateCompatibilityProfile = deepFreeze({
    requiredModalities: Object.freeze(requiredModalities),
    requiredToolCalling: input.requiredToolCalling,
    contextRequirements: Object.freeze({ ...input.contextRequirements }),
    ...(costConstraints !== undefined ? { costConstraints } : {}),
    requiredEvaluationSuites: Object.freeze(requiredEvaluationSuites),
    prohibitedConditions: Object.freeze(prohibitedConditions),
    substrateAdaptations: Object.freeze(substrateAdaptations),
  });
  return profile;
}

export function isSubstrateCompatibilityProfile(
  value: unknown,
): value is SubstrateCompatibilityProfile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate['requiredModalities']) ||
    candidate['requiredModalities'].length === 0 ||
    !candidate['requiredModalities'].every((modality) => isSubstrateModality(modality)) ||
    !isToolCallingLevel(candidate['requiredToolCalling']) ||
    !isContextRequirements(candidate['contextRequirements']) ||
    !Array.isArray(candidate['requiredEvaluationSuites']) ||
    !candidate['requiredEvaluationSuites'].every((ref) => isVersionedArtifactRef(ref)) ||
    !Array.isArray(candidate['prohibitedConditions']) ||
    !candidate['prohibitedConditions'].every((condition) => isSubstrateCondition(condition)) ||
    !Array.isArray(candidate['substrateAdaptations']) ||
    !candidate['substrateAdaptations'].every((adaptation) => isSubstrateAdaptation(adaptation))
  ) {
    return false;
  }
  const cost = candidate['costConstraints'];
  if (cost !== undefined && !isCostLatencyConstraints(cost)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Compatibility evaluation — a capability predicate, NEVER an identity claim
// ---------------------------------------------------------------------------

export interface SubstrateCompatibilityResult {
  readonly compatible: boolean;
  /** Human-readable, non-identifying reasons for every failed requirement. */
  readonly reasons: readonly string[];
}

/**
 * Evaluate whether a substrate's DECLARED CAPABILITIES satisfy a profile's
 * requirements. This is a per-profile capability predicate:
 *   - it never compares the substrate to the body as an identity;
 *   - it never returns an "equivalence" verdict — only satisfied/failed
 *     requirements with reasons;
 *   - cost constraints, required evaluation suites and substrate
 *     adaptations are declarative certification inputs and are evaluated
 *     by the compatibility/certification services, not here.
 *
 * Certification built on top of this result proves a claim about
 * `BodyVersion × Substrate × Environment × Runtime × CertificationSuite`
 * — it does NOT prove `Substrate = Profession` (spec AB1.0).
 */
export function evaluateSubstrateCompatibility(
  profile: SubstrateCompatibilityProfile,
  substrate: CognitiveSubstrate,
): SubstrateCompatibilityResult {
  if (!isSubstrateCompatibilityProfile(profile)) {
    invalidProfile('not a structurally valid substrate compatibility profile');
  }
  const reasons: string[] = [];

  const substrateModalities = new Set<string>(substrate.modalityProfile);
  for (const required of profile.requiredModalities) {
    if (!substrateModalities.has(required)) {
      reasons.push(`substrate lacks required modality: ${required}`);
    }
  }

  const substrateLevel = toolCallingLevelIndex(substrate.toolCallingProfile);
  const requiredLevel = toolCallingLevelIndex(profile.requiredToolCalling);
  if (substrateLevel < requiredLevel) {
    reasons.push(
      `substrate tool-calling level ${substrate.toolCallingProfile} is below the required level ${profile.requiredToolCalling}`,
    );
  }

  if (substrate.contextLimits.maxContextUnits < profile.contextRequirements.minContextUnits) {
    reasons.push(
      `substrate context limit ${String(substrate.contextLimits.maxContextUnits)} is below the required minimum ${String(profile.contextRequirements.minContextUnits)}`,
    );
  }

  const prohibited = new Set<string>(profile.prohibitedConditions);
  for (const condition of substrate.conditions) {
    if (prohibited.has(condition)) {
      reasons.push(`substrate declares a prohibited condition: ${condition}`);
    }
  }

  return { compatible: reasons.length === 0, reasons: Object.freeze(reasons) };
}

/** Boolean convenience wrapper around evaluateSubstrateCompatibility. */
export function isSubstrateCompatible(
  profile: SubstrateCompatibilityProfile,
  substrate: CognitiveSubstrate,
): boolean {
  return evaluateSubstrateCompatibility(profile, substrate).compatible;
}
