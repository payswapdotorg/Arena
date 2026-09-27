/**
 * Capability node payloads (Work Order A004; docs/architecture.md §3).
 *
 * Capabilities decompose into (architecture.md §3, verbatim): declarative
 * knowledge; procedural skills; tool skills; reasoning/decision patterns;
 * verification skills; communication/escalation behavior; domain methods.
 * The closed CAPABILITY_DECOMPOSITION_CATEGORIES enum encodes exactly those
 * seven decomposition categories, carried by sub-capability and skill nodes.
 *
 * A Skill is a versioned artifact with inputs, outputs, prerequisites,
 * evidence, tests and provenance (§3, verbatim) — the SkillNodePayload
 * below carries the six payload-side fields; provenance is a first-class
 * node-level field (see nodes.ts, REQUIRED for skill nodes).
 *
 * Safety/privacy/licensing and professional limitations are explicit
 * metadata (architecture-lock rule 23): every skill payload carries
 * `professionalLimitations` (possibly empty — the point is explicitness) and
 * `customerData` (none | derived | contains, the A002 rights vocabulary).
 *
 * Payload kinds:
 *   - SkillNodePayload (kind 'skill') — the rich §3 skill shape;
 *   - ObservedFailureNodePayload (kind 'observed-failure') — summary,
 *     observedAt (UTC ms) and severity;
 *   - TitledNodePayload (all other kinds) — title, optional description and
 *     optional decomposition category.
 */

import { CAPABILITY_GRAPH_ERROR_CODES, CapabilityGraphError } from './errors.js';
import type { ArtifactRefView } from './shared.js';
import { isArtifactRefView } from './shared.js';
import { isCapabilityTimestamp } from './timestamp.js';

// ---------------------------------------------------------------------------
// Decomposition categories (architecture.md §3, the seven, verbatim)
// ---------------------------------------------------------------------------

/** The seven decomposition categories of a capability (architecture.md §3). */
export const CAPABILITY_DECOMPOSITION_CATEGORIES = [
  'declarative-knowledge',
  'procedural-skill',
  'tool-skill',
  'reasoning-decision-pattern',
  'verification-skill',
  'communication-escalation-behavior',
  'domain-method',
] as const;

export type CapabilityDecompositionCategory =
  (typeof CAPABILITY_DECOMPOSITION_CATEGORIES)[number];

export function isCapabilityDecompositionCategory(
  value: unknown,
): value is CapabilityDecompositionCategory {
  return (
    typeof value === 'string' &&
    (CAPABILITY_DECOMPOSITION_CATEGORIES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Skill payloads (architecture.md §3: "A Skill is a versioned artifact with
// inputs, outputs, prerequisites, evidence, tests and provenance.")
// ---------------------------------------------------------------------------

/** One named input or output port of a skill. */
export interface SkillIOPort {
  readonly name: string;
  readonly description?: string;
}

/** Exact pattern source; kept in sync with the generated contracts. */
export const SKILL_IO_PORT_NAME_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';

const PORT_NAME_PATTERN = new RegExp(SKILL_IO_PORT_NAME_PATTERN_SOURCE);

/** Customer-data exposure vocabulary (mirrors A002 RightsMetadata). */
export const CUSTOMER_DATA_POLICIES = ['none', 'derived', 'contains'] as const;

export type CustomerDataPolicy = (typeof CUSTOMER_DATA_POLICIES)[number];

export function isCustomerDataPolicy(value: unknown): value is CustomerDataPolicy {
  return (
    typeof value === 'string' &&
    (CUSTOMER_DATA_POLICIES as readonly string[]).includes(value)
  );
}

/**
 * The payload of a skill node. Field mapping of architecture.md §3:
 *   inputs / outputs — named input and output ports;
 *   prerequisites    — descriptive prerequisite statements (the RELATIONAL
 *                      prerequisites are `requires` edges in the graph);
 *   evidence         — content-addressed evidence artifact references;
 *   tests            — content-addressed test artifact references;
 *   provenance       — node-level ProvenanceRefView (required for skills).
 * Lock rule 23: professionalLimitations + customerData are explicit
 * (professionalLimitations may be an empty list — explicitly none).
 */
export interface SkillNodePayload {
  readonly title: string;
  readonly summary: string;
  readonly category?: CapabilityDecompositionCategory;
  readonly inputs: readonly SkillIOPort[];
  readonly outputs: readonly SkillIOPort[];
  readonly prerequisites: readonly string[];
  readonly evidence: readonly ArtifactRefView[];
  readonly tests: readonly ArtifactRefView[];
  readonly professionalLimitations: readonly string[];
  readonly customerData: CustomerDataPolicy;
}

// ---------------------------------------------------------------------------
// Observed-failure payloads
// ---------------------------------------------------------------------------

/** Severity levels of an observed failure (explicit metadata, lock rule 23). */
export const OBSERVED_FAILURE_SEVERITIES = [
  'minor',
  'moderate',
  'major',
  'critical',
] as const;

export type ObservedFailureSeverity = (typeof OBSERVED_FAILURE_SEVERITIES)[number];

export function isObservedFailureSeverity(
  value: unknown,
): value is ObservedFailureSeverity {
  return (
    typeof value === 'string' &&
    (OBSERVED_FAILURE_SEVERITIES as readonly string[]).includes(value)
  );
}

export interface ObservedFailureNodePayload {
  readonly title: string;
  readonly summary: string;
  /** When the failure was observed (UTC, millisecond precision). */
  readonly observedAt: string;
  readonly severity: ObservedFailureSeverity;
}

// ---------------------------------------------------------------------------
// Titled payloads (domain, capability, sub-capability, tool, task-family,
// evaluator, verifier, expert-competency, body-version)
// ---------------------------------------------------------------------------

export interface TitledNodePayload {
  readonly title: string;
  readonly description?: string;
  /** The §3 decomposition category (sub-capabilities and skills). */
  readonly category?: CapabilityDecompositionCategory;
}

/** The union of all per-kind node payloads. */
export type CapabilityNodePayload =
  | TitledNodePayload
  | SkillNodePayload
  | ObservedFailureNodePayload;

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const TITLE_MAX = 256;
const SUMMARY_MAX = 2048;
const DESCRIPTION_MAX = 4096;
const LIST_MAX = 256;

function fail(
  reason: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_PAYLOAD, {
    message: reason,
    details,
  });
}

function isNonEmptyString(value: unknown, maxLength: number): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isStringList(value: unknown, maxLength: number): boolean {
  return (
    Array.isArray(value) &&
    value.length <= LIST_MAX &&
    value.every((item) => isNonEmptyString(item, maxLength))
  );
}

function isPortList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= LIST_MAX &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        hasOnlyKeys(item, ['name', 'description']) &&
        typeof (item as Record<string, unknown>)['name'] === 'string' &&
        PORT_NAME_PATTERN.test(String((item as Record<string, unknown>)['name'])) &&
        ((item as Record<string, unknown>)['description'] === undefined ||
          isNonEmptyString((item as Record<string, unknown>)['description'], DESCRIPTION_MAX)),
    )
  );
}

function isArtifactRefList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= LIST_MAX &&
    value.every((item) => isArtifactRefView(item))
  );
}

const TITLED_PAYLOAD_KEYS = ['title', 'description', 'category'];
const SKILL_PAYLOAD_KEYS = [
  'title',
  'summary',
  'category',
  'inputs',
  'outputs',
  'prerequisites',
  'evidence',
  'tests',
  'professionalLimitations',
  'customerData',
];
const OBSERVED_FAILURE_PAYLOAD_KEYS = ['title', 'summary', 'observedAt', 'severity'];

/** additionalProperties:false parity with the generated contracts. */
function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return false;
  }
  return true;
}

export function isTitledNodePayload(value: unknown): value is TitledNodePayload {
  if (typeof value !== 'object' || value === null) return false;
  if (!hasOnlyKeys(value, TITLED_PAYLOAD_KEYS)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate['title'], TITLE_MAX) &&
    (candidate['description'] === undefined ||
      isNonEmptyString(candidate['description'], DESCRIPTION_MAX)) &&
    (candidate['category'] === undefined ||
      isCapabilityDecompositionCategory(candidate['category']))
  );
}

export function isSkillNodePayload(value: unknown): value is SkillNodePayload {
  if (typeof value !== 'object' || value === null) return false;
  if (!hasOnlyKeys(value, SKILL_PAYLOAD_KEYS)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate['title'], TITLE_MAX) &&
    isNonEmptyString(candidate['summary'], SUMMARY_MAX) &&
    (candidate['category'] === undefined ||
      isCapabilityDecompositionCategory(candidate['category'])) &&
    isPortList(candidate['inputs']) &&
    isPortList(candidate['outputs']) &&
    isStringList(candidate['prerequisites'], SUMMARY_MAX) &&
    isArtifactRefList(candidate['evidence']) &&
    isArtifactRefList(candidate['tests']) &&
    isStringList(candidate['professionalLimitations'], SUMMARY_MAX) &&
    isCustomerDataPolicy(candidate['customerData'])
  );
}

export function isObservedFailureNodePayload(
  value: unknown,
): value is ObservedFailureNodePayload {
  if (typeof value !== 'object' || value === null) return false;
  if (!hasOnlyKeys(value, OBSERVED_FAILURE_PAYLOAD_KEYS)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate['title'], TITLE_MAX) &&
    isNonEmptyString(candidate['summary'], SUMMARY_MAX) &&
    isCapabilityTimestamp(candidate['observedAt']) &&
    isObservedFailureSeverity(candidate['severity'])
  );
}

/** Structural check for any node payload (union of the three payload kinds). */
export function isCapabilityNodePayload(value: unknown): value is CapabilityNodePayload {
  return (
    isSkillNodePayload(value) ||
    isObservedFailureNodePayload(value) ||
    isTitledNodePayload(value)
  );
}

/** Validate a payload for a node kind; throws INVALID_PAYLOAD otherwise. */
export function validateNodePayload(
  kind: string,
  payload: unknown,
): CapabilityNodePayload {
  switch (kind) {
    case 'skill': {
      if (!isSkillNodePayload(payload)) {
        fail(
          `skill nodes require a skill payload (title, summary, inputs, outputs, prerequisites, evidence, tests, professionalLimitations, customerData)`,
          { kind, expectedPayload: 'capability/skill-payload' },
        );
      }
      return payload;
    }
    case 'observed-failure': {
      if (!isObservedFailureNodePayload(payload)) {
        fail(
          'observed-failure nodes require an observed-failure payload (title, summary, observedAt, severity)',
          { kind, expectedPayload: 'capability/observed-failure-payload' },
        );
      }
      return payload;
    }
    case 'domain':
    case 'capability':
    case 'sub-capability':
    case 'tool':
    case 'task-family':
    case 'evaluator':
    case 'verifier':
    case 'expert-competency':
    case 'body-version': {
      if (!isTitledNodePayload(payload)) {
        fail('titled node kinds require a titled payload (title, optional description and category)', {
          kind,
          expectedPayload: 'capability/node-payload',
        });
      }
      return payload;
    }
    default:
      fail(`unknown node kind: ${JSON.stringify(kind)}`, {
        known: ['skill', 'observed-failure', 'titled kinds'],
      });
  }
}

/**
 * Normalize a payload input into its frozen canonical form (drops nothing —
 * validation already guarantees shape; freezes nested lists and objects).
 */
export function freezeNodePayload<TPayload extends CapabilityNodePayload>(
  payload: TPayload,
): TPayload {
  return deepFreeze(payload);
}

/** Deep-freeze a plain-JSON value graph (used by all domain objects here). */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
