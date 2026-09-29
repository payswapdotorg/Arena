/**
 * Shared structural components (Work Order A008).
 *
 * @arena/task-spec is a DOMAIN package: its only runtime dependency is
 * @arena/protocol-core, so it cannot import the value surface of sibling
 * domain packages (@arena/capability-case, @arena/evaluation,
 * @arena/verification, @arena/environment-protocol,
 * @arena/expert-qualification). Every cross-protocol object a TaskSpec
 * references is therefore defined HERE as a validated plain-string VIEW
 * type — the same pattern @arena/capability-case and
 * @arena/expert-qualification use (see their shared.ts headers).
 *
 * The views are STRUCTURALLY COMPATIBLE with the owning packages' types
 * (plain strings accept branded strings), so a capability-graph node ref,
 * a capability-case version ref, an A009 environment declaration ref or an
 * A007 qualification-policy ref can be passed through these validators
 * unchanged. Pattern sources are duplicated from the owning packages'
 * surfaces and mirrored in the generated contracts, so the duplication
 * cannot drift silently (see contracts.parity.test.ts).
 */

import type { Brand } from '@arena/protocol-core';
import { TASK_SPEC_ERROR_CODES, TaskSpecError } from './errors.js';

// ---------------------------------------------------------------------------
// Deep freeze (convention of every Arena domain package)
// ---------------------------------------------------------------------------

/** Recursively freeze a value (arrays, plain objects). */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return value;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Tenant scope (architecture-lock rule 11)
// ---------------------------------------------------------------------------

export type TenantScope = Brand<string, 'TenantScope'>;

/**
 * The reserved GLOBAL namespace: explicitly published, tenant-independent
 * tasks (the artifact-protocol `public` namespace convention — lock rule
 * 12: public artifacts are explicitly published and versioned).
 */
export const PUBLIC_TENANT = 'public' as const;

/** Exact pattern source; MUST equal @arena/artifact-protocol's namespace pattern. */
export const TENANT_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';

const TENANT_PATTERN = new RegExp(TENANT_PATTERN_SOURCE);

export function isTenantScope(value: unknown): value is TenantScope {
  return typeof value === 'string' && TENANT_PATTERN.test(value);
}

/** Validate and brand a tenant scope; throws INVALID_IDENTITY otherwise. */
export function toTenantScope(value: string): TenantScope {
  if (!isTenantScope(value)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid tenant scope: ${JSON.stringify(value)} (lowercase kebab, 2-63 chars; the reserved global namespace is "public")`,
      details: { pattern: TENANT_PATTERN_SOURCE },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Content digests (sha256, lowercase hex — computed by @arena/protocol-core)
// ---------------------------------------------------------------------------

export type ContentDigest = Brand<string, 'ContentDigest'>;

/** Exact pattern source; kept in sync with the generated contracts. */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';

const DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

/** Validate and brand a sha256 content digest; throws INVALID_DIGEST otherwise. */
export function toContentDigest(value: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_DIGEST, {
      message: `invalid content digest: ${JSON.stringify(value)} (expected a lowercase 64-char sha256 hex digest)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Semver (pattern + precedence, duplicated from the sibling convention)
// ---------------------------------------------------------------------------

export type TaskVersion = Brand<string, 'TaskVersion'>;

/**
 * Exact pattern source (kept in sync with the generated contracts):
 * semver 2.0.0 core with optional prerelease, WITHOUT build metadata
 * (content addressing requires exact versions — same rule as
 * @arena/capability-case and @arena/capability-graph).
 */
export const TASK_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';

const VERSION_PATTERN = new RegExp(TASK_VERSION_PATTERN_SOURCE);

export function isTaskVersion(value: unknown): value is TaskVersion {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

/** Validate and brand a task version; throws INVALID_VERSION otherwise. */
export function toTaskVersion(value: string): TaskVersion {
  if (!isTaskVersion(value)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_VERSION, {
      message: `invalid task version: ${JSON.stringify(value)} (semver major.minor.patch with optional prerelease; build metadata is not allowed)`,
      details: { pattern: TASK_VERSION_PATTERN_SOURCE },
    });
  }
  return value;
}

function prereleaseParts(version: string): string[] {
  const index = version.indexOf('-');
  return index === -1 ? [] : version.slice(index + 1).split('.');
}

/**
 * Semver 2.0.0 precedence comparison (build metadata is excluded by the
 * pattern, so only core + prerelease participate). Returns a negative
 * number when `a` has LOWER precedence than `b`, 0 when equal, positive
 * when higher.
 */
export function compareTaskVersions(a: string, b: string): number {
  const coreA = a.split('-')[0] ?? '';
  const coreB = b.split('-')[0] ?? '';
  const [maA, miA, paA] = coreA.split('.').map((part) => Number.parseInt(part, 10));
  const [maB, miB, paB] = coreB.split('.').map((part) => Number.parseInt(part, 10));
  for (const [x, y] of [
    [maA ?? 0, maB ?? 0],
    [miA ?? 0, miB ?? 0],
    [paA ?? 0, paB ?? 0],
  ] as const) {
    if (x !== y) return x - y;
  }
  const preA = prereleaseParts(a);
  const preB = prereleaseParts(b);
  if (preA.length === 0 && preB.length === 0) return 0;
  if (preA.length === 0) return 1; // no prerelease > prerelease
  if (preB.length === 0) return -1;
  const shared = Math.min(preA.length, preB.length);
  for (let i = 0; i < shared; i += 1) {
    const partA = preA[i] ?? '';
    const partB = preB[i] ?? '';
    const numA = /^\d+$/.test(partA) ? Number.parseInt(partA, 10) : null;
    const numB = /^\d+$/.test(partB) ? Number.parseInt(partB, 10) : null;
    if (numA !== null && numB !== null) {
      if (numA !== numB) return numA - numB;
      continue;
    }
    if (numA !== null) return -1; // numeric < alphanumeric
    if (numB !== null) return 1;
    if (partA !== partB) return partA < partB ? -1 : 1;
  }
  return preA.length - preB.length;
}

// ---------------------------------------------------------------------------
// Neutral identifiers + labels + prose
// ---------------------------------------------------------------------------

export type NeutralId = Brand<string, 'NeutralId'>;

/** Exact pattern source (matches the sibling neutral-id convention). */
export const NEUTRAL_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';

const NEUTRAL_ID_PATTERN = new RegExp(NEUTRAL_ID_PATTERN_SOURCE);

export function isNeutralId(value: unknown): value is NeutralId {
  return typeof value === 'string' && NEUTRAL_ID_PATTERN.test(value);
}

/** Validate and brand a neutral identifier; throws INVALID_IDENTITY otherwise. */
export function toNeutralId(value: string, field: string): NeutralId {
  if (!isNeutralId(value)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_IDENTITY, {
      message: `task-spec: invalid neutral identifier for ${JSON.stringify(field)}: ${JSON.stringify(value)} (lowercase kebab, 1-64 chars)`,
      details: { field, pattern: NEUTRAL_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Task ids: neutral kebab ids with a longer bound (mirrors case ids). */
export const TASK_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,127}$';

const TASK_ID_PATTERN = new RegExp(TASK_ID_PATTERN_SOURCE);

export type TaskSpecId = Brand<string, 'TaskSpecId'>;

export function isTaskSpecId(value: unknown): value is TaskSpecId {
  return typeof value === 'string' && TASK_ID_PATTERN.test(value);
}

/** Validate and brand a task id; throws INVALID_IDENTITY otherwise. */
export function toTaskSpecId(value: string): TaskSpecId {
  if (!isTaskSpecId(value)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid task id: ${JSON.stringify(value)} (lowercase kebab, 1-128 chars)`,
      details: { pattern: TASK_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Capability labels: neutral kebab labels (TS1.0 "capability labels"). */
export const CAPABILITY_LABEL_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';

const CAPABILITY_LABEL_PATTERN = new RegExp(CAPABILITY_LABEL_PATTERN_SOURCE);

export type CapabilityLabel = Brand<string, 'CapabilityLabel'>;

export function isCapabilityLabel(value: unknown): value is CapabilityLabel {
  return typeof value === 'string' && CAPABILITY_LABEL_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Timestamps (ms-precision UTC, ISO 8601)
// ---------------------------------------------------------------------------

export type TaskSpecTimestamp = Brand<string, 'TaskSpecTimestamp'>;

/** Exact pattern source; kept in sync with the generated contracts. */
export const TASK_SPEC_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';

const TIMESTAMP_PATTERN = new RegExp(TASK_SPEC_TIMESTAMP_PATTERN_SOURCE);

export function isTaskSpecTimestamp(value: unknown): value is TaskSpecTimestamp {
  return typeof value === 'string' && TIMESTAMP_PATTERN.test(value);
}

/** Validate and brand an ms-precision UTC timestamp; throws INVALID_TIMESTAMP otherwise. */
export function toTaskSpecTimestamp(value: string): TaskSpecTimestamp {
  if (!isTaskSpecTimestamp(value)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `invalid task-spec timestamp: ${JSON.stringify(value)} (expected ms-precision UTC ISO 8601, e.g. 2026-02-01T09:30:00.000Z)`,
      details: { pattern: TASK_SPEC_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Cross-protocol VIEW types (validated plain-string shapes — see header)
// ---------------------------------------------------------------------------

/**
 * A capability-graph node ref VIEW (A004 shape: kind/id/version/digest).
 * Structurally compatible with @arena/capability-graph node refs and
 * @arena/capability-case's CapabilityNodeRefView — plain strings accept
 * branded strings.
 */
export interface NodeRefView {
  readonly kind: string;
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

/** Exact pattern source for node kinds (MUST equal A004's vocabulary). */
export const NODE_KINDS = Object.freeze([
  'domain',
  'capability',
  'sub-capability',
  'skill',
  'tool',
  'task-family',
  'evaluator',
  'verifier',
  'expert-competency',
  'observed-failure',
  'body-version',
] as const) as readonly string[];

export const NODE_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,127}$';

const NODE_ID_PATTERN = new RegExp(NODE_ID_PATTERN_SOURCE);

export function isNodeRefView(value: unknown): value is NodeRefView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['kind'] === 'string' &&
    (NODE_KINDS as readonly string[]).includes(candidate['kind']) &&
    typeof candidate['id'] === 'string' &&
    NODE_ID_PATTERN.test(candidate['id']) &&
    isTaskVersion(candidate['version']) &&
    isContentDigest(candidate['digest'])
  );
}

/** Validate a node ref view against a permitted kind set; typed error otherwise. */
export function toNodeRefView(
  value: NodeRefView,
  permittedKinds: readonly string[],
): NodeRefView {
  if (!isNodeRefView(value)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_REF, {
      message: `invalid capability-graph node ref: ${JSON.stringify(value)}`,
      details: {
        nodeKinds: [...NODE_KINDS],
        idPattern: NODE_ID_PATTERN_SOURCE,
      },
    });
  }
  if (!permittedKinds.includes(value.kind)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_REF, {
      message: `node ref kind ${JSON.stringify(value.kind)} is not permitted here (permitted: ${permittedKinds.join(', ')})`,
      details: { permitted: [...permittedKinds], kind: value.kind },
    });
  }
  return value;
}

/**
 * A versioned-artifact ref VIEW (A002 shape: namespace/name/version/digest)
 * — also the A009 ENV1.0 environment-declaration ref shape and
 * @arena/capability-case's VersionedArtifactRefView.
 */
export interface ArtifactRefView {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}

export const ARTIFACT_NAMESPACE_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const ARTIFACT_NAME_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,127}$';

const ARTIFACT_NAMESPACE_PATTERN = new RegExp(ARTIFACT_NAMESPACE_PATTERN_SOURCE);
const ARTIFACT_NAME_PATTERN = new RegExp(ARTIFACT_NAME_PATTERN_SOURCE);

export function isArtifactRefView(value: unknown): value is ArtifactRefView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['namespace'] === 'string' &&
    ARTIFACT_NAMESPACE_PATTERN.test(candidate['namespace']) &&
    typeof candidate['name'] === 'string' &&
    ARTIFACT_NAME_PATTERN.test(candidate['name']) &&
    isTaskVersion(candidate['version']) &&
    isContentDigest(candidate['digest'])
  );
}

/** Validate and freeze an artifact ref view; typed error otherwise. */
export function toArtifactRefView(value: ArtifactRefView): ArtifactRefView {
  if (!isArtifactRefView(value)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_REF, {
      message: `invalid versioned-artifact ref: ${JSON.stringify(value)} (expected namespace/name/version/digest with an ENV1.0-shaped declaration address)`,
      details: {
        namespacePattern: ARTIFACT_NAMESPACE_PATTERN_SOURCE,
        namePattern: ARTIFACT_NAME_PATTERN_SOURCE,
      },
    });
  }
  return deepFreeze({ ...value });
}

/**
 * A capability-case version ref VIEW (A005 shape:
 * tenant/caseId/version/digest). The TaskSpec's derivation provenance
 * carries this so every task traces to the exact case state that
 * motivated it.
 */
export interface CaseRefView {
  readonly tenant: string;
  readonly caseId: string;
  readonly version: string;
  readonly digest: string;
}

export const CASE_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,127}$';

const CASE_ID_PATTERN = new RegExp(CASE_ID_PATTERN_SOURCE);

export function isCaseRefView(value: unknown): value is CaseRefView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isTenantScope(candidate['tenant']) &&
    typeof candidate['caseId'] === 'string' &&
    CASE_ID_PATTERN.test(candidate['caseId']) &&
    isTaskVersion(candidate['version']) &&
    isContentDigest(candidate['digest'])
  );
}

/** Validate and freeze a case ref view; typed error otherwise. */
export function toCaseRefView(value: CaseRefView): CaseRefView {
  if (!isCaseRefView(value)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_REF, {
      message: `invalid capability-case version ref: ${JSON.stringify(value)}`,
      details: { caseIdPattern: CASE_ID_PATTERN_SOURCE },
    });
  }
  return deepFreeze({ ...value });
}

/**
 * A qualification-policy ref VIEW (A007 shape: policyId/version/digest —
 * the QualificationPolicy identity triple). Referenced by TaskSpec expert
 * qualification requirements.
 */
export interface QualificationPolicyRefView {
  readonly policyId: string;
  readonly version: string;
  readonly digest: string;
}

export function isQualificationPolicyRefView(
  value: unknown,
): value is QualificationPolicyRefView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['policyId']) &&
    isTaskVersion(candidate['version']) &&
    isContentDigest(candidate['digest'])
  );
}

/** Validate and freeze a qualification-policy ref view; typed error otherwise. */
export function toQualificationPolicyRefView(value: QualificationPolicyRefView): QualificationPolicyRefView {
  if (!isQualificationPolicyRefView(value)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_REF, {
      message: `invalid qualification-policy ref: ${JSON.stringify(value)} (A007 QualificationPolicy identity triple: policyId/version/digest)`,
    });
  }
  return deepFreeze({ ...value });
}

/**
 * A compilation-policy ref VIEW (A008 shape: policyId/version/digest —
 * the CompilationPolicy identity triple; see compilation-policy.ts).
 * Referenced by TaskSpec derivation provenance.
 */
export interface CompilationPolicyRefView {
  readonly policyId: string;
  readonly version: string;
  readonly digest: string;
}

export function isCompilationPolicyRefView(
  value: unknown,
): value is CompilationPolicyRefView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['policyId']) &&
    isTaskVersion(candidate['version']) &&
    isContentDigest(candidate['digest'])
  );
}

/** Validate and freeze a compilation-policy ref view; typed error otherwise. */
export function toCompilationPolicyRefView(
  value: CompilationPolicyRefView,
): CompilationPolicyRefView {
  if (!isCompilationPolicyRefView(value)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_REF, {
      message: `invalid compilation-policy ref: ${JSON.stringify(value)} (identity triple: policyId/version/digest)`,
    });
  }
  return deepFreeze({ ...value });
}

// ---------------------------------------------------------------------------
// Field-expectation helpers (the sibling validation convention)
// ---------------------------------------------------------------------------

/**
 * Assert `value` is a plain object carrying exactly the expected fields
 * (required + optional) and no unknown ones; returns it as a record.
 * Throws the given typed error code otherwise.
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: (typeof TASK_SPEC_ERROR_CODES)[keyof typeof TASK_SPEC_ERROR_CODES],
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TaskSpecError(code, {
      message: `${context}: expected a plain object, got ${typeof value}`,
    });
  }
  const record = value as Record<string, unknown>;
  for (const field of required) {
    if (!(field in record)) {
      throw new TaskSpecError(code, {
        message: `${context}: missing required field ${JSON.stringify(field)}`,
        details: { field, required: [...required] },
      });
    }
  }
  for (const field of Object.keys(record)) {
    if (!required.includes(field) && !optional.includes(field)) {
      throw new TaskSpecError(code, {
        message: `${context}: unknown field ${JSON.stringify(field)} (closed shape — no silent surface growth)`,
        details: { field, known: [...required, ...optional] },
      });
    }
  }
  return record;
}

/** Assert a finite number in [min, max]; typed error otherwise. */
export function expectNumberInRange(
  value: unknown,
  field: string,
  min: number,
  max: number,
  code: (typeof TASK_SPEC_ERROR_CODES)[keyof typeof TASK_SPEC_ERROR_CODES],
  context: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new TaskSpecError(code, {
      message: `${context}: ${JSON.stringify(field)} must be a finite number in [${min}, ${max}]`,
      details: { field, min, max },
    });
  }
  return value;
}

/** Assert a non-empty string; typed error otherwise. */
export function expectNonEmptyString(
  value: unknown,
  field: string,
  code: (typeof TASK_SPEC_ERROR_CODES)[keyof typeof TASK_SPEC_ERROR_CODES],
  context: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TaskSpecError(code, {
      message: `${context}: ${JSON.stringify(field)} must be a non-empty string`,
      details: { field },
    });
  }
  return value;
}

/** Validate a list of non-empty statements; typed error otherwise. */
export function toStatementList(
  value: unknown,
  field: string,
  minCount: 0 | 1,
  code: (typeof TASK_SPEC_ERROR_CODES)[keyof typeof TASK_SPEC_ERROR_CODES],
  context: string,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TaskSpecError(code, {
      message: `${context}: ${JSON.stringify(field)} must be an array of statements`,
      details: { field },
    });
  }
  if (value.length < minCount) {
    throw new TaskSpecError(code, {
      message: `${context}: ${JSON.stringify(field)} requires at least ${minCount} statement(s)`,
      details: { field, minCount },
    });
  }
  return Object.freeze(
    value.map((entry) => {
      if (typeof entry !== 'string' || entry.length === 0) {
        throw new TaskSpecError(code, {
          message: `${context}: ${JSON.stringify(field)} must contain non-empty statements: ${JSON.stringify(entry)}`,
          details: { field },
        });
      }
      return entry;
    }),
  );
}
