/**
 * Shared model-substrate view types and provider-neutrality tripwires
 * (Work Order A016; architecture-lock rules 2, 10; requirement R19).
 *
 * @arena/model-substrate is a domain package whose ONLY runtime workspace
 * import is @arena/protocol-core (protocol layer). @arena/agent-body is used
 * EXCLUSIVELY through type-only imports (see substrate.ts /
 * compatibility.ts / upgrade.ts): the substrate records this package
 * materializes ARE the agent-body CognitiveSubstrate shape, re-exported as
 * types so adapters never need to import agent-body directly.
 *
 * The structural validators below therefore duplicate — deliberately and
 * character-for-character — the screening conventions of
 * @arena/agent-body/src/shared.ts and substrate.ts:
 *
 *   - assertNoCredentialFields: credential-shaped FIELD NAMES never enter
 *     canonical model-substrate objects (spec AB1.0);
 *   - assertProviderNeutralString: model/provider brand names never enter
 *     canonical objects (lock rule 10: provider details remain behind
 *     adapters);
 *   - assertNoSubstrateAliasFields: no field may assert a substrate/model ≡
 *     body identity alias (spec AB1.0 compatibility profile hard rule);
 *   - assertNoPossessionRebindFields: an upgrade never silently rebinds a
 *     Possession (requirement R45).
 *
 * Runtime imports from @arena/agent-body are forbidden by the A016 domain
 * purity gate (gate 10), so these helpers are vendored rather than imported
 * — exactly the fallback the work order prescribes ("else re-implement
 * identically and note it"). contracts.parity.test.ts pins the pattern
 * sources and closed vocabularies against BOTH the generated
 * contracts/model-substrate/*.json and the committed
 * contracts/agent-body/cognitive-substrate.v1.json, so the vendored copies
 * cannot drift from A003.
 */

import type {
  SubstrateCondition,
  SubstrateModality,
  ToolCallingLevel,
} from '@arena/agent-body';
import { MODEL_SUBSTRATE_ERROR_CODES, ModelSubstrateError } from './errors.js';
import type { ModelSubstrateErrorCode } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — MUST equal the @arena/agent-body constants
// (character-for-character). Kept in sync with the generated contracts by
// contracts.parity.test.ts.
// ---------------------------------------------------------------------------

export const MODEL_SUBSTRATE_NAMESPACE_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const MODEL_SUBSTRATE_NAME_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,127}$';
export const MODEL_SUBSTRATE_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
export const MODEL_SUBSTRATE_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
/** Identifier charset for neutral ids minted inside this package (closed). */
export const MODEL_SUBSTRATE_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
export const SUBSTRATE_MODEL_FAMILY_PATTERN_SOURCE = '^[a-z0-9][a-z0-9-]{0,63}$';
export const SUBSTRATE_MODEL_ID_PATTERN_SOURCE = '^[a-z0-9][a-z0-9._-]{0,127}$';
export const SUBSTRATE_MODEL_REVISION_PATTERN_SOURCE = '^[a-z0-9][a-z0-9._-]{0,63}$';

const NAMESPACE_PATTERN = new RegExp(MODEL_SUBSTRATE_NAMESPACE_PATTERN_SOURCE);
const NAME_PATTERN = new RegExp(MODEL_SUBSTRATE_NAME_PATTERN_SOURCE);
const VERSION_PATTERN = new RegExp(MODEL_SUBSTRATE_VERSION_PATTERN_SOURCE);
const DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(MODEL_SUBSTRATE_TIMESTAMP_PATTERN_SOURCE);
const ID_PATTERN = new RegExp(MODEL_SUBSTRATE_ID_PATTERN_SOURCE);
const MODEL_FAMILY_PATTERN = new RegExp(SUBSTRATE_MODEL_FAMILY_PATTERN_SOURCE);
const MODEL_ID_PATTERN = new RegExp(SUBSTRATE_MODEL_ID_PATTERN_SOURCE);
const MODEL_REVISION_PATTERN = new RegExp(SUBSTRATE_MODEL_REVISION_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Closed capability vocabulary — vendored, MUST equal the @arena/agent-body
// constants character-for-character (parity asserted by
// contracts.parity.test.ts against contracts/agent-body/cognitive-substrate.v1.json).
// ---------------------------------------------------------------------------

/** Closed modality vocabulary (input/output channels a substrate supports). */
export const SUBSTRATE_MODALITIES = Object.freeze([
  'text-input',
  'text-output',
  'image-input',
  'image-output',
  'audio-input',
  'audio-output',
  'video-input',
  'structured-input',
  'structured-output',
] as const);

/**
 * Closed tool-calling vocabulary, ordered by capability level: a substrate
 * at a higher level satisfies a requirement at a lower level. `none` means
 * the substrate cannot invoke tools at all.
 */
export const TOOL_CALLING_LEVELS = Object.freeze([
  'none',
  'text-protocol',
  'json-schema',
  'function-calling',
] as const);

/** Closed condition vocabulary a substrate may declare about itself. */
export const SUBSTRATE_CONDITIONS = Object.freeze([
  'stable',
  'preview',
  'deprecated',
  'rate-limited',
  'region-restricted',
  'sovereign-only',
  'capacity-constrained',
] as const);

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
// Scalar validators (plain, pattern-checked strings)
// ---------------------------------------------------------------------------

export function isContentDigest(value: unknown): value is string {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

export function isNeutralId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function isModelSubstrateSemver(value: unknown): value is string {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

export function isTimestampView(value: unknown): value is string {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function isNamespaceView(value: unknown): value is string {
  return typeof value === 'string' && NAMESPACE_PATTERN.test(value);
}

export function isNameView(value: unknown): value is string {
  return typeof value === 'string' && NAME_PATTERN.test(value);
}

export function isModelFamily(value: unknown): value is string {
  return typeof value === 'string' && MODEL_FAMILY_PATTERN.test(value);
}

export function isModelId(value: unknown): value is string {
  return typeof value === 'string' && MODEL_ID_PATTERN.test(value);
}

export function isModelRevision(value: unknown): value is string {
  return typeof value === 'string' && MODEL_REVISION_PATTERN.test(value);
}

function invalid(message: string, code: ModelSubstrateErrorCode, details?: Record<string, unknown>): never {
  throw new ModelSubstrateError(code, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

export function toContentDigest(value: string): string {
  if (!isContentDigest(value)) {
    invalid(
      `invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      MODEL_SUBSTRATE_ERROR_CODES.INVALID_DIGEST,
      { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toNeutralId(value: string): string {
  if (!isNeutralId(value)) {
    invalid(
      `invalid model-substrate identifier: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      MODEL_SUBSTRATE_ERROR_CODES.INVALID_IDENTITY,
      { pattern: MODEL_SUBSTRATE_ID_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toModelSubstrateSemver(value: string): string {
  if (!isModelSubstrateSemver(value)) {
    invalid(
      `invalid version: ${JSON.stringify(value)} (semver major.minor.patch with optional prerelease; build metadata is not allowed)`,
      MODEL_SUBSTRATE_ERROR_CODES.INVALID_VERSION,
      { pattern: MODEL_SUBSTRATE_VERSION_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toTimestampView(value: string): string {
  if (!isTimestampView(value)) {
    invalid(
      `invalid model-substrate timestamp: ${JSON.stringify(value)} (expected UTC ISO-8601 with exactly millisecond precision, e.g. 2026-09-26T12:34:56.789Z)`,
      MODEL_SUBSTRATE_ERROR_CODES.INVALID_TIMESTAMP,
      { pattern: MODEL_SUBSTRATE_TIMESTAMP_PATTERN_SOURCE },
    );
  }
  return value;
}

/** Current time as a canonical timestamp view (Date#toISOString is always ms UTC). */
export function nowTimestampView(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Content-addressed reference views (structurally identical to the
// @arena/agent-body VersionedArtifactRef; type re-exported from there)
// ---------------------------------------------------------------------------

/** Structural guard for a content-addressed versioned artifact reference. */
export function isVersionedArtifactRefView(
  value: unknown,
): value is { namespace: string; name: string; version: string; digest: string } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNamespaceView(candidate['namespace']) &&
    isNameView(candidate['name']) &&
    isModelSubstrateSemver(candidate['version']) &&
    isContentDigest(candidate['digest'])
  );
}

/** Validate and freeze a versioned artifact reference view. */
export function toVersionedArtifactRefView(value: {
  namespace: string;
  name: string;
  version: string;
  digest: string;
}): { namespace: string; name: string; version: string; digest: string } {
  if (!isVersionedArtifactRefView(value)) {
    invalid(
      `invalid versioned artifact reference: ${JSON.stringify(value)}`,
      MODEL_SUBSTRATE_ERROR_CODES.INVALID_REF,
      {
        namespace: MODEL_SUBSTRATE_NAMESPACE_PATTERN_SOURCE,
        name: MODEL_SUBSTRATE_NAME_PATTERN_SOURCE,
        version: MODEL_SUBSTRATE_VERSION_PATTERN_SOURCE,
        digest: CONTENT_DIGEST_PATTERN_SOURCE,
      },
    );
  }
  return Object.freeze({ ...value });
}

// ---------------------------------------------------------------------------
// Provider-neutrality tripwires (vendored from @arena/agent-body — runtime
// imports are forbidden by the A016 domain purity gate; parity is pinned by
// contracts.parity.test.ts)
// ---------------------------------------------------------------------------

/**
 * Credential-shaped field names that must NEVER appear in a canonical
 * model-substrate object (spec AB1.0: "Credentials never enter canonical
 * objects"). Substring semantics, case-insensitive.
 */
const CREDENTIAL_FIELD_PATTERN =
  /api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key|bearer|authorization|password|passwd|secret|credential|token/i;

/**
 * Recursively reject any credential-shaped FIELD NAME anywhere in a value
 * about to enter a canonical model-substrate object. Throws
 * MODEL_SUBSTRATE_CREDENTIAL_REJECTED naming the offending path.
 */
export function assertNoCredentialFields(value: unknown, path = 'value'): void {
  if (typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCredentialFields(item, `${path}[${String(index)}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (CREDENTIAL_FIELD_PATTERN.test(key)) {
      throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.CREDENTIAL_REJECTED, {
        message: `credential-shaped field ${JSON.stringify(key)} at ${path} is rejected: credentials never enter canonical model substrate objects (spec AB1.0)`,
        details: { field: key, path },
      });
    }
    assertNoCredentialFields(child, `${path}.${key}`);
  }
}

/**
 * Model/provider brand names that must never appear in a canonical
 * model-substrate object (architecture-lock rule 10: model/provider details
 * remain behind adapters). Mirrors the @arena/agent-body deny vocabulary
 * character-for-character.
 */
const PROVIDER_NAME_PATTERN =
  /openai|anthropic|claude|gemini|gpt-|bedrock|mistral|groq|ollama|deepseek|copilot/i;

/** Reject provider brand names in a string entering a canonical object. */
export function assertProviderNeutralString(value: string, field: string): void {
  if (PROVIDER_NAME_PATTERN.test(value)) {
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.PROVIDER_NAME_REJECTED, {
      message: `provider brand name in ${field} is rejected: model/provider details remain behind adapters (architecture-lock rule 10); use the provider-neutral adapter identifier instead`,
      details: { field },
    });
  }
}

// ---------------------------------------------------------------------------
// Anti-aliasing and anti-rebinding tripwires
// ---------------------------------------------------------------------------

/**
 * Field-name shapes that would assert a substrate/model ≡ body identity
 * alias. Identical (character-for-character after normalization) to the
 * @arena/agent-body list: whichever of these appears as a field of a compatibility
 * test or result input is rejected with MODEL_SUBSTRATE_SUBSTRATE_ALIAS_FORBIDDEN.
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

/**
 * Field-name shapes that would smuggle a Possession reference (or a rebind
 * instruction) into a SubstrateUpgrade — forbidden by requirement R45: an
 * upgrade NEVER silently rebinds a Possession; a NEW possession version is
 * required. Rejected with MODEL_SUBSTRATE_POSSESSION_REBIND_FORBIDDEN.
 */
const POSSESSION_REBIND_FIELD_NAMES = [
  'possession',
  'possessionid',
  'possessiondigest',
  'possessionref',
  'targetpossession',
  'rebind',
  'rebinds',
  'rebindpossession',
  'rebindstopossession',
  'silentlyrebind',
  'updatepossession',
  'replacepossession',
  'mutatepossession',
];

function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function screenFieldNames(
  input: Record<string, unknown>,
  denyList: readonly string[],
  code: ModelSubstrateErrorCode,
  message: (field: string) => string,
): void {
  for (const key of Object.keys(input)) {
    if (denyList.includes(normalizeFieldName(key))) {
      throw new ModelSubstrateError(code, { message: message(key), details: { field: key } });
    }
  }
}

/**
 * Reject any field of a compatibility test/result input that would assert a
 * substrate/model ≡ body identity alias (spec AB1.0 hard rule, mirrored from
 * @arena/agent-body's compatibility tripwire).
 */
export function assertNoSubstrateAliasFields(input: Record<string, unknown>): void {
  screenFieldNames(input, SUBSTRATE_ALIAS_FIELD_NAMES, MODEL_SUBSTRATE_ERROR_CODES.SUBSTRATE_ALIAS_FORBIDDEN, (field) =>
    `compatibility field ${JSON.stringify(field)} would assert a substrate/model ≡ body identity alias; compatibility is a per-profile capability predicate, never an identity claim (spec AB1.0) — declare required capabilities instead`,
  );
}

/**
 * Reject any field of an upgrade input that would reference or rebind a
 * Possession (requirement R45: upgrades never silently rebind possessions; a
 * new possession version is required).
 */
export function assertNoPossessionRebindFields(input: Record<string, unknown>): void {
  screenFieldNames(input, POSSESSION_REBIND_FIELD_NAMES, MODEL_SUBSTRATE_ERROR_CODES.POSSESSION_REBIND_FORBIDDEN, (field) =>
    `upgrade field ${JSON.stringify(field)} is rejected: a substrate upgrade never rebinds a Possession (requirement R45); a new Possession version must be created explicitly through the agent-body protocol instead`,
  );
}

// ---------------------------------------------------------------------------
// Deep freeze
// ---------------------------------------------------------------------------

/** Recursively freeze a plain-JSON domain object; frozen inputs stay frozen. */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
