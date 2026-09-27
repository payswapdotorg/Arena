/**
 * Substrate compatibility test harness types (Work Order A016; requirement
 * R20; docs/architecture.md §13: compatibility is a claim about
 * `Body × Substrate × Environment × Runtime Profile × Certification Suite`
 * — a Body can be compatible with multiple substrates WITHOUT implying the
 * substrates are equivalent models).
 *
 * PURE DATA CONTRACTS ONLY:
 *
 *   - `SubstrateCompatibilityTest` binds a BodyVersion reference + a
 *     substrate reference (content digest) + the profile requirements the
 *     test asserts (required modalities, minimum tool-calling, minimum
 *     context units, prohibited substrate conditions).
 *   - `SubstrateCompatibilityResult` is the typed RESULT record: outcome
 *     pass / fail / inconclusive + reasons + content-addressed evidence
 *     references.
 *
 * The compatibility ENGINE (how outcomes are decided) is Work Order A022 —
 * this module deliberately implements NO decision logic beyond result
 * typing and the shape invariants documented below. Nothing here may
 * assert a substrate/model ≡ body identity alias: alias-shaped fields are
 * rejected at construction (MODEL_SUBSTRATE_SUBSTRATE_ALIAS_FORBIDDEN),
 * mirroring the @arena/agent-body compatibility-profile tripwire.
 */

import type { BodyVersionRef, SubstrateCondition, SubstrateModality, ToolCallingLevel, VersionedArtifactRef } from '@arena/agent-body';
import { MODEL_SUBSTRATE_ERROR_CODES, ModelSubstrateError } from './errors.js';
import {
  assertNoCredentialFields,
  assertNoSubstrateAliasFields,
  assertProviderNeutralString,
  deepFreeze,
  isContentDigest,
  isNameView,
  isNamespaceView,
  isNeutralId,
  isSubstrateCondition,
  isSubstrateModality,
  isToolCallingLevel,
  isVersionedArtifactRefView,
  toContentDigest,
  toVersionedArtifactRefView,
} from './shared.js';

// ---------------------------------------------------------------------------
// The test descriptor
// ---------------------------------------------------------------------------

/** Wire version of the compatibility test shape. */
export const SUBSTRATE_COMPATIBILITY_TEST_RECORD_VERSION = 1 as const;

/** Profile requirements asserted by a compatibility test (R20). */
export interface SubstrateCompatibilityTestSpec {
  readonly requiredModalities: readonly SubstrateModality[];
  readonly requiredToolCalling: ToolCallingLevel;
  readonly minContextUnits: number;
  readonly prohibitedConditions: readonly SubstrateCondition[];
}

export interface SubstrateCompatibilityTest {
  readonly recordVersion: typeof SUBSTRATE_COMPATIBILITY_TEST_RECORD_VERSION;
  /** Neutral test id (closed charset, provider-neutral). */
  readonly testId: string;
  /** The body version under test (content-addressed). */
  readonly bodyVersion: BodyVersionRef;
  /** The substrate under test (content-addressed). */
  readonly substrateDigest: string;
  /** Profile requirements the test asserts. */
  readonly spec: SubstrateCompatibilityTestSpec;
}

export interface CreateSubstrateCompatibilityTestInput {
  readonly testId: string;
  readonly bodyVersion: {
    tenant: string;
    name: string;
    version: string;
    digest: string;
  };
  readonly substrateDigest: string;
  readonly requiredModalities: readonly string[];
  readonly requiredToolCalling: string;
  readonly minContextUnits: number;
  readonly prohibitedConditions?: readonly string[];
}

/** Exact field set of a compatibility test input (unknown fields are rejected). */
export const SUBSTRATE_COMPATIBILITY_TEST_INPUT_FIELDS = Object.freeze([
  'testId',
  'bodyVersion',
  'substrateDigest',
  'requiredModalities',
  'requiredToolCalling',
  'minContextUnits',
  'prohibitedConditions',
] as const);

/** Upper bound for context unit requirements (mirrors substrate limits). */
export const COMPATIBILITY_MAX_UNITS_LIMIT = 2_147_483_647;

function invalidTest(message: string, details?: Record<string, unknown>): never {
  throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_COMPATIBILITY_TEST, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

function isBodyVersionRefView(
  value: unknown,
): value is { tenant: string; name: string; version: string; digest: string } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNamespaceView(candidate['tenant']) &&
    isNameView(candidate['name']) &&
    typeof candidate['version'] === 'string' &&
    candidate['version'].length > 0 &&
    isContentDigest(candidate['digest'])
  );
}

/** Validate and freeze a body version reference (agent-body BodyVersionRef shape). */
function toBodyVersionRefView(value: {
  tenant: string;
  name: string;
  version: string;
  digest: string;
}): { tenant: string; name: string; version: string; digest: string } {
  if (!isBodyVersionRefView(value)) {
    invalidTest(
      `invalid body version reference: ${JSON.stringify(value)} (tenant/name/version/digest required; tenant is a neutral namespace, digest is lowercase sha256 hex)`,
    );
  }
  return Object.freeze({ ...value });
}

/**
 * Validate and freeze a substrate compatibility TEST descriptor: closed
 * shape, alias-free (no substrate/model ≡ body identity fields), neutral
 * test id, content-addressed body version + substrate digest, closed
 * profile vocabularies, sane context requirement.
 */
export function createSubstrateCompatibilityTest(
  input: CreateSubstrateCompatibilityTestInput,
): SubstrateCompatibilityTest {
  assertNoCredentialFields(input, 'compatibilityTest');
  assertNoSubstrateAliasFields(input as unknown as Record<string, unknown>);

  const knownFields = new Set<string>(SUBSTRATE_COMPATIBILITY_TEST_INPUT_FIELDS);
  for (const key of Object.keys(input as unknown as Record<string, unknown>)) {
    if (!knownFields.has(key)) {
      invalidTest(
        `unknown compatibility test field: ${JSON.stringify(key)} (closed shape; compatibility is a per-test capability predicate, never an identity claim)`,
        { known: [...SUBSTRATE_COMPATIBILITY_TEST_INPUT_FIELDS] },
      );
    }
  }

  if (typeof input.testId !== 'string' || !isNeutralId(input.testId)) {
    invalidTest(
      `invalid compatibility test id: ${JSON.stringify(input.testId)} (lowercase neutral identifier required)`,
    );
  }
  assertProviderNeutralString(input.testId, 'testId');

  if (!isBodyVersionRefView(input.bodyVersion)) {
    invalidTest(
      `invalid body version reference: ${JSON.stringify(input.bodyVersion)} (content-addressed tenant/name/version/digest required)`,
    );
  }

  if (typeof input.substrateDigest !== 'string' || !isContentDigest(input.substrateDigest)) {
    invalidTest(
      `invalid substrate digest: ${JSON.stringify(input.substrateDigest)} (expected lowercase sha256 hex)`,
    );
  }

  if (!Array.isArray(input.requiredModalities) || input.requiredModalities.length === 0) {
    invalidTest('requiredModalities must be a non-empty array of substrate modalities');
  }
  const seen = new Set<string>();
  const requiredModalities: SubstrateModality[] = input.requiredModalities.map((modality) => {
    if (!isSubstrateModality(modality)) {
      invalidTest(`unknown substrate modality: ${JSON.stringify(modality)}`, {
        known: 'see SUBSTRATE_MODALITIES',
      });
    }
    if (seen.has(modality)) {
      invalidTest(`duplicate required modality: ${JSON.stringify(modality)}`);
    }
    seen.add(modality);
    return modality;
  });

  if (!isToolCallingLevel(input.requiredToolCalling)) {
    invalidTest(
      `unknown required tool-calling level: ${JSON.stringify(input.requiredToolCalling)}`,
      { known: 'see TOOL_CALLING_LEVELS' },
    );
  }

  if (
    typeof input.minContextUnits !== 'number' ||
    !Number.isInteger(input.minContextUnits) ||
    input.minContextUnits < 1 ||
    input.minContextUnits > COMPATIBILITY_MAX_UNITS_LIMIT
  ) {
    invalidTest(
      `invalid minContextUnits: ${JSON.stringify(input.minContextUnits ?? null)} (integer between 1 and ${String(COMPATIBILITY_MAX_UNITS_LIMIT)})`,
    );
  }

  const prohibitedConditions: SubstrateCondition[] = (
    input.prohibitedConditions ?? []
  ).map((condition) => {
    if (!isSubstrateCondition(condition)) {
      invalidTest(`unknown prohibited substrate condition: ${JSON.stringify(condition)}`, {
        known: 'see SUBSTRATE_CONDITIONS',
      });
    }
    return condition;
  });
  const uniqueConditions = new Set<SubstrateCondition>(prohibitedConditions);
  if (uniqueConditions.size !== prohibitedConditions.length) {
    invalidTest('duplicate prohibited substrate condition');
  }

  return deepFreeze({
    recordVersion: SUBSTRATE_COMPATIBILITY_TEST_RECORD_VERSION,
    testId: input.testId,
    bodyVersion: toBodyVersionRefView(input.bodyVersion),
    substrateDigest: toContentDigest(input.substrateDigest),
    spec: deepFreeze({
      requiredModalities: Object.freeze(requiredModalities),
      requiredToolCalling: input.requiredToolCalling,
      minContextUnits: input.minContextUnits,
      prohibitedConditions: Object.freeze(prohibitedConditions),
    }),
  });
}

/** Structural guard for a substrate compatibility test. */
export function isSubstrateCompatibilityTest(
  value: unknown,
): value is SubstrateCompatibilityTest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['recordVersion'] !== SUBSTRATE_COMPATIBILITY_TEST_RECORD_VERSION ||
    typeof candidate['testId'] !== 'string' ||
    !isNeutralId(candidate['testId']) ||
    !isBodyVersionRefView(candidate['bodyVersion']) ||
    typeof candidate['substrateDigest'] !== 'string' ||
    !isContentDigest(candidate['substrateDigest'])
  ) {
    return false;
  }
  const spec = candidate['spec'];
  if (typeof spec !== 'object' || spec === null) return false;
  const specRecord = spec as Record<string, unknown>;
  return (
    Array.isArray(specRecord['requiredModalities']) &&
    specRecord['requiredModalities'].length > 0 &&
    specRecord['requiredModalities'].every((modality) => isSubstrateModality(modality)) &&
    isToolCallingLevel(specRecord['requiredToolCalling']) &&
    typeof specRecord['minContextUnits'] === 'number' &&
    Number.isInteger(specRecord['minContextUnits']) &&
    specRecord['minContextUnits'] >= 1 &&
    specRecord['minContextUnits'] <= COMPATIBILITY_MAX_UNITS_LIMIT &&
    Array.isArray(specRecord['prohibitedConditions']) &&
    specRecord['prohibitedConditions'].every((condition) => isSubstrateCondition(condition))
  );
}

// ---------------------------------------------------------------------------
// The result record (typed outcomes — the ENGINE is A022)
// ---------------------------------------------------------------------------

/** Wire version of the compatibility result shape. */
export const SUBSTRATE_COMPATIBILITY_RESULT_RECORD_VERSION = 1 as const;

/** Closed outcome vocabulary (no "equivalent" verdict — only tested claims). */
export const SUBSTRATE_COMPATIBILITY_OUTCOMES = Object.freeze(['pass', 'fail', 'inconclusive'] as const);
export type SubstrateCompatibilityOutcome = (typeof SUBSTRATE_COMPATIBILITY_OUTCOMES)[number];

export function isSubstrateCompatibilityOutcome(
  value: unknown,
): value is SubstrateCompatibilityOutcome {
  return (
    typeof value === 'string' &&
    (SUBSTRATE_COMPATIBILITY_OUTCOMES as readonly string[]).includes(value)
  );
}

/**
 * The typed RESULT of running a compatibility test: outcome + reasons +
 * content-addressed evidence references. Shape invariants (typing-level
 * only — the DECISION is A022's engine):
 *   - `pass` carries ZERO reasons (nothing to explain);
 *   - `fail` and `inconclusive` carry AT LEAST ONE reason;
 *   - `inconclusive` should cite evidence when available (not enforced —
 *     the engine decides what evidence exists).
 */
export interface SubstrateCompatibilityResult {
  readonly recordVersion: typeof SUBSTRATE_COMPATIBILITY_RESULT_RECORD_VERSION;
  /** Neutral id of the test this result answers. */
  readonly testId: string;
  /** Digest of the body version actually under test (binds the claim to bytes). */
  readonly bodyVersionDigest: string;
  /** Digest of the substrate actually under test (binds the claim to bytes). */
  readonly substrateDigest: string;
  readonly outcome: SubstrateCompatibilityOutcome;
  readonly reasons: readonly string[];
  /** Content-addressed evidence artifacts backing the claim (may be empty). */
  readonly evidenceRefs: readonly VersionedArtifactRef[];
}

export interface CreateSubstrateCompatibilityResultInput {
  readonly testId: string;
  readonly bodyVersionDigest: string;
  readonly substrateDigest: string;
  readonly outcome: string;
  readonly reasons?: readonly string[];
  readonly evidenceRefs?: readonly {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }[];
}

/** Exact field set of a compatibility result input (unknown fields are rejected). */
export const SUBSTRATE_COMPATIBILITY_RESULT_INPUT_FIELDS = Object.freeze([
  'testId',
  'bodyVersionDigest',
  'substrateDigest',
  'outcome',
  'reasons',
  'evidenceRefs',
] as const);

function invalidResult(message: string, details?: Record<string, unknown>): never {
  throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_COMPATIBILITY_RESULT, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

/**
 * Validate and freeze a substrate compatibility RESULT record (typed
 * outcome + evidence refs; no decision logic — that is A022's engine).
 */
export function createSubstrateCompatibilityResult(
  input: CreateSubstrateCompatibilityResultInput,
): SubstrateCompatibilityResult {
  assertNoCredentialFields(input, 'compatibilityResult');
  assertNoSubstrateAliasFields(input as unknown as Record<string, unknown>);

  const knownFields = new Set<string>(SUBSTRATE_COMPATIBILITY_RESULT_INPUT_FIELDS);
  for (const key of Object.keys(input as unknown as Record<string, unknown>)) {
    if (!knownFields.has(key)) {
      invalidResult(
        `unknown compatibility result field: ${JSON.stringify(key)} (closed shape; a result is a tested claim, never an identity claim)`,
        { known: [...SUBSTRATE_COMPATIBILITY_RESULT_INPUT_FIELDS] },
      );
    }
  }

  if (typeof input.testId !== 'string' || !isNeutralId(input.testId)) {
    invalidResult(
      `invalid compatibility test id: ${JSON.stringify(input.testId)} (lowercase neutral identifier required)`,
    );
  }
  if (
    typeof input.bodyVersionDigest !== 'string' ||
    !isContentDigest(input.bodyVersionDigest)
  ) {
    invalidResult(
      `invalid body version digest: ${JSON.stringify(input.bodyVersionDigest)} (expected lowercase sha256 hex)`,
    );
  }
  if (typeof input.substrateDigest !== 'string' || !isContentDigest(input.substrateDigest)) {
    invalidResult(
      `invalid substrate digest: ${JSON.stringify(input.substrateDigest)} (expected lowercase sha256 hex)`,
    );
  }
  if (!isSubstrateCompatibilityOutcome(input.outcome)) {
    invalidResult(`unknown compatibility outcome: ${JSON.stringify(input.outcome)}`, {
      known: [...SUBSTRATE_COMPATIBILITY_OUTCOMES],
    });
  }

  const reasons: string[] = [];
  for (const reason of input.reasons ?? []) {
    if (typeof reason !== 'string' || reason.length === 0) {
      invalidResult('reasons must be non-empty strings');
    }
    reasons.push(reason);
  }

  const evidenceRefs: VersionedArtifactRef[] = [];
  const seenEvidence = new Set<string>();
  for (const ref of input.evidenceRefs ?? []) {
    if (!isVersionedArtifactRefView(ref)) {
      invalidResult(`invalid evidence reference: ${JSON.stringify(ref)}`);
    }
    const frozen = toVersionedArtifactRefView(ref);
    const key = `${frozen.namespace}/${frozen.name}@${frozen.version}#${frozen.digest}`;
    if (seenEvidence.has(key)) {
      invalidResult(`duplicate evidence reference: ${key}`);
    }
    seenEvidence.add(key);
    evidenceRefs.push(frozen);
  }

  // Typing-level invariants (NOT decision logic — shape semantics only).
  if (input.outcome === 'pass' && reasons.length > 0) {
    invalidResult('a passing result carries no reasons (nothing failed)');
  }
  if (input.outcome !== 'pass' && reasons.length === 0) {
    invalidResult(`a ${input.outcome} result requires at least one reason`);
  }

  return deepFreeze({
    recordVersion: SUBSTRATE_COMPATIBILITY_RESULT_RECORD_VERSION,
    testId: input.testId,
    bodyVersionDigest: toContentDigest(input.bodyVersionDigest),
    substrateDigest: toContentDigest(input.substrateDigest),
    outcome: input.outcome,
    reasons: Object.freeze(reasons),
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

/** Structural guard for a substrate compatibility result. */
export function isSubstrateCompatibilityResult(
  value: unknown,
): value is SubstrateCompatibilityResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === SUBSTRATE_COMPATIBILITY_RESULT_RECORD_VERSION &&
    typeof candidate['testId'] === 'string' &&
    isNeutralId(candidate['testId']) &&
    typeof candidate['bodyVersionDigest'] === 'string' &&
    isContentDigest(candidate['bodyVersionDigest']) &&
    typeof candidate['substrateDigest'] === 'string' &&
    isContentDigest(candidate['substrateDigest']) &&
    typeof candidate['outcome'] === 'string' &&
    (SUBSTRATE_COMPATIBILITY_OUTCOMES as readonly string[]).includes(candidate['outcome']) &&
    Array.isArray(candidate['reasons']) &&
    candidate['reasons'].every((reason) => typeof reason === 'string' && reason.length > 0) &&
    Array.isArray(candidate['evidenceRefs']) &&
    candidate['evidenceRefs'].every((ref) => isVersionedArtifactRefView(ref))
  );
}
