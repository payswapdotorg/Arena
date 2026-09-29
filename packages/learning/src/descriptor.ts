/**
 * ExperimentDescriptor - the content-addressed, versioned, deep-frozen
 * DECLARATION of a learning experiment (Work Order A020; spec LE1.0
 * "Experiment"; requirement R15 - "Run learning experiments with
 * baseline/intervention/comparison").
 *
 * The descriptor carries EVERY LE1.0 minimum field:
 *
 *   - experiment id/version (`experimentId`, `version`);
 *   - target capability (`targetCapability` - a REAL A004
 *     CapabilityNodeRef validated by @arena/capability-graph's own
 *     guard, never redefined here);
 *   - baseline Body/Model/Runtime (`baseline` - digest-addressed pins,
 *     nullable when unbound: `bodyRef` (A003 BodyVersion), `substrateRef`
 *     (A016 model substrate), `runtimeRef` (runtime profile pin));
 *   - intervention artifact(s) (`interventions` - each a typed A002-shaped
 *     artifact ref plus an EXPLICIT `changedSurface` from the LE1.0
 *     nine; an intervention with an undeclared/ambiguous changed
 *     surface is REJECTED);
 *   - task population (`taskPopulation` - pinned A009-shaped task/version
 *     refs, validated by @arena/trajectory's REAL TaskVersionRef guard);
 *   - evaluation suite (`evaluationSuiteRefs` - A012
 *     EvaluationCriteria/EvaluatorDescriptor digests);
 *   - verification suite (`verificationSuiteRefs` - A013
 *     VerifierDescriptor digests);
 *   - environment versions (`environmentVersions` - content-addressed
 *     environment refs);
 *   - outcome metrics (`outcomeMetrics` - closed-direction declarations);
 *   - uncertainty/statistical method (`uncertainty`);
 *   - protected capabilities (Q1.0 condition 4 - the capabilities whose
 *     regression the experiment MUST measure);
 *   - provenance (`provenance`).
 *
 * Content addressing: the sha256 digest is computed over the canonical
 * JSON of the digest-free view with @arena/protocol-core's
 * digestCanonical - NEVER reimplemented here. Same descriptor ⇒ same
 * digest; deep-frozen at creation - there is NO mutation API.
 */

import { digestCanonical } from '@arena/protocol-core';
import { isCapabilityNodeRef } from '@arena/capability-graph';
import type { CapabilityNodeRef } from '@arena/capability-graph';
import { isTaskVersionRef } from '@arena/trajectory';
import type { TaskVersionRef } from '@arena/environment-protocol';
import { LEARNING_ERROR_CODES, LearningError } from './errors.js';
import {
  INTERVENTION_SURFACES,
  toInterventionSurface,
} from './intervention-surface.js';
import type { InterventionSurface } from './intervention-surface.js';
import {
  deepFreeze,
  expectFields,
  isContentDigest,
  isLearningVersion,
  isNeutralId,
  isNeutralText,
  isLearningTimestamp,
  toContentDigest,
  toLearningId,
  toLearningTimestamp,
  toLearningVersion,
  toNeutralId,
  toNeutralText,
  ARTIFACT_NAMESPACE_PATTERN_SOURCE,
  ARTIFACT_NAME_PATTERN_SOURCE,
} from './shared.js';
import type {
  ContentDigest,
  LearningId,
  LearningTimestamp,
  LearningVersion,
  NeutralId,
  NeutralText,
} from './shared.js';

/** Wire version of the experiment-descriptor shape. */
export const EXPERIMENT_DESCRIPTOR_VERSION = 1 as const;

/** The closed metric-direction vocabulary. */
export const METRIC_DIRECTIONS = Object.freeze([
  'higher-is-better',
  'lower-is-better',
] as const);

export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

export function isMetricDirection(value: unknown): value is MetricDirection {
  return (
    typeof value === 'string' && (METRIC_DIRECTIONS as readonly string[]).includes(value)
  );
}

/** The closed uncertainty-method vocabulary (LE1.0 "uncertainty/statistical method"). */
export const UNCERTAINTY_METHODS = Object.freeze([
  'none',
  'analytic-variance',
  'bootstrap',
  'paired-permutation',
] as const);

export type UncertaintyMethod = (typeof UNCERTAINTY_METHODS)[number];

export function isUncertaintyMethod(value: unknown): value is UncertaintyMethod {
  return (
    typeof value === 'string' && (UNCERTAINTY_METHODS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Intervention artifact (typed ref + EXPLICIT changed surface)
// ---------------------------------------------------------------------------

/**
 * The A002-shaped artifact reference: a typed, digest-addressed pointer
 * to the intervention artifact (namespace/name/version + content
 * digest). The referenced object is bound BY DIGEST, never redefined
 * here.
 */
export interface ArtifactRef {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}

/** Stable field list for artifact refs (tests + contracts mirror it). */
export const ARTIFACT_REF_FIELDS = Object.freeze([
  'namespace',
  'name',
  'version',
  'digest',
] as const);

const ARTIFACT_NAMESPACE_PATTERN = new RegExp(ARTIFACT_NAMESPACE_PATTERN_SOURCE);
const ARTIFACT_NAME_PATTERN = new RegExp(ARTIFACT_NAME_PATTERN_SOURCE);

export function isArtifactRef(value: unknown): value is ArtifactRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['namespace'] === 'string' &&
    ARTIFACT_NAMESPACE_PATTERN.test(candidate['namespace']) &&
    typeof candidate['name'] === 'string' &&
    ARTIFACT_NAME_PATTERN.test(candidate['name']) &&
    isLearningVersion(candidate['version']) &&
    isContentDigest(candidate['digest'])
  );
}

function toArtifactRef(value: unknown, context: string): ArtifactRef {
  const record = expectFields(
    value,
    ['namespace', 'name', 'version', 'digest'],
    [],
    LEARNING_ERROR_CODES.INVALID_INTERVENTION,
    context,
  );
  const namespace = record['namespace'];
  if (typeof namespace !== 'string' || !ARTIFACT_NAMESPACE_PATTERN.test(namespace)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_INTERVENTION, {
      message: `${context}: artifact namespace must match ${ARTIFACT_NAMESPACE_PATTERN_SOURCE}, got: ${JSON.stringify(namespace)}`,
    });
  }
  const name = record['name'];
  if (typeof name !== 'string' || !ARTIFACT_NAME_PATTERN.test(name)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_INTERVENTION, {
      message: `${context}: artifact name must match ${ARTIFACT_NAME_PATTERN_SOURCE}, got: ${JSON.stringify(name)}`,
    });
  }
  const version = record['version'];
  if (typeof version !== 'string' || !isLearningVersion(version)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_INTERVENTION, {
      message: `${context}: artifact version must be semver without build metadata, got: ${JSON.stringify(version)}`,
    });
  }
  return deepFreeze({
    namespace,
    name,
    version,
    digest: toContentDigest(
      typeof record['digest'] === 'string' ? record['digest'] : '',
      `${context} artifact digest`,
    ),
  });
}

/**
 * One intervention artifact: a typed A002-shaped ref PLUS the EXPLICIT
 * changed surface from the LE1.0 nine. An intervention with an
 * undeclared (missing) or ambiguous (outside the closed vocabulary)
 * changed surface is REJECTED - "the changed surface must be explicit"
 * is a construction-time guarantee, not a convention.
 */
export interface InterventionArtifact {
  /** The typed, digest-addressed artifact being introduced. */
  readonly artifact: ArtifactRef;
  /** The EXPLICIT LE1.0 surface this artifact changes (closed vocabulary of nine). */
  readonly changedSurface: InterventionSurface;
}

/** Stable field list for interventions (tests + contracts mirror it). */
export const INTERVENTION_ARTIFACT_FIELDS = Object.freeze([
  'artifact',
  'changedSurface',
] as const);

export function isInterventionArtifact(value: unknown): value is InterventionArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isArtifactRef(candidate['artifact']) &&
    typeof candidate['changedSurface'] === 'string' &&
    (INTERVENTION_SURFACES as readonly string[]).includes(candidate['changedSurface'])
  );
}

function toInterventionArtifact(
  value: unknown,
  context: string,
): InterventionArtifact {
  const record = expectFields(
    value,
    ['artifact', 'changedSurface'],
    [],
    LEARNING_ERROR_CODES.INVALID_INTERVENTION,
    context,
  );
  const changedSurfaceRaw = record['changedSurface'];
  if (typeof changedSurfaceRaw !== 'string' || changedSurfaceRaw.length === 0) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_INTERVENTION, {
      message: `${context}: the changed surface must be EXPLICIT - an intervention with a missing/empty changedSurface is rejected (spec LE1.0: "the changed surface must be explicit")`,
      details: { known: [...INTERVENTION_SURFACES] },
    });
  }
  return deepFreeze({
    artifact: toArtifactRef(record['artifact'], context),
    changedSurface: toInterventionSurface(changedSurfaceRaw, context),
  });
}

// ---------------------------------------------------------------------------
// Baseline composition (Body/Model/Runtime - digest-addressed pins)
// ---------------------------------------------------------------------------

/**
 * The baseline composition (LE1.0 "baseline Body/Model/Runtime"): three
 * digest-addressed pins, each nullable when the experiment does not pin
 * it. `bodyRef` addresses the A003 BodyVersion, `substrateRef` the A016
 * cognitive substrate (the "Model"), `runtimeRef` the runtime profile.
 * Referenced objects are bound BY DIGEST, never redefined here.
 */
export interface BaselineComposition {
  readonly bodyRef: ContentDigest | null;
  readonly substrateRef: ContentDigest | null;
  readonly runtimeRef: ContentDigest | null;
}

/** Stable field list for the baseline composition. */
export const BASELINE_COMPOSITION_FIELDS = Object.freeze([
  'bodyRef',
  'substrateRef',
  'runtimeRef',
] as const);

export function isBaselineComposition(value: unknown): value is BaselineComposition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate['bodyRef'] === null || isContentDigest(candidate['bodyRef'])) &&
    (candidate['substrateRef'] === null || isContentDigest(candidate['substrateRef'])) &&
    (candidate['runtimeRef'] === null || isContentDigest(candidate['runtimeRef']))
  );
}

function toBaselineComposition(value: unknown): BaselineComposition {
  const record = expectFields(
    value,
    ['bodyRef', 'substrateRef', 'runtimeRef'],
    [],
    LEARNING_ERROR_CODES.INVALID_DESCRIPTOR,
    'experiment descriptor baseline',
  );
  const bodyRef = record['bodyRef'];
  const substrateRef = record['substrateRef'];
  const runtimeRef = record['runtimeRef'];
  if (bodyRef !== null && typeof bodyRef !== 'string') {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: 'experiment descriptor baseline: bodyRef must be a content digest or null',
    });
  }
  if (substrateRef !== null && typeof substrateRef !== 'string') {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: 'experiment descriptor baseline: substrateRef must be a content digest or null',
    });
  }
  if (runtimeRef !== null && typeof runtimeRef !== 'string') {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: 'experiment descriptor baseline: runtimeRef must be a content digest or null',
    });
  }
  return deepFreeze({
    bodyRef: bodyRef === null ? null : toContentDigest(bodyRef, 'baseline bodyRef'),
    substrateRef:
      substrateRef === null
        ? null
        : toContentDigest(substrateRef, 'baseline substrateRef'),
    runtimeRef:
      runtimeRef === null ? null : toContentDigest(runtimeRef, 'baseline runtimeRef'),
  });
}

// ---------------------------------------------------------------------------
// Environment version refs
// ---------------------------------------------------------------------------

/**
 * A content-addressed environment version ref (A009 shape - the same
 * four-field form A011 trajectory headers bind). The environment is
 * pinned by DIGEST, not by name.
 */
export interface EnvironmentVersionRef {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}

/** Stable field list for environment version refs. */
export const ENVIRONMENT_VERSION_REF_FIELDS = Object.freeze([
  'namespace',
  'name',
  'version',
  'digest',
] as const);

export function isEnvironmentVersionRef(value: unknown): value is EnvironmentVersionRef {
  return isArtifactRef(value);
}

function toEnvironmentVersionRef(value: unknown): EnvironmentVersionRef {
  return toArtifactRef(value, 'experiment descriptor environmentVersions entry');
}

// ---------------------------------------------------------------------------
// Outcome metric declaration
// ---------------------------------------------------------------------------

/**
 * One declared outcome metric: id, human-readable description and a
 * CLOSED direction (higher-is-better | lower-is-better). The
 * direction defines what "improves" means for Q1.0 condition 1 -
 * without it, improvement is ambiguous and therefore undeclarable.
 */
export interface OutcomeMetricDeclaration {
  readonly metricId: NeutralId;
  readonly description: NeutralText;
  readonly direction: MetricDirection;
}

/** Stable field list for metric declarations. */
export const OUTCOME_METRIC_DECLARATION_FIELDS = Object.freeze([
  'metricId',
  'description',
  'direction',
] as const);

export function isOutcomeMetricDeclaration(
  value: unknown,
): value is OutcomeMetricDeclaration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['metricId']) &&
    isNeutralText(candidate['description']) &&
    isMetricDirection(candidate['direction'])
  );
}

function toOutcomeMetricDeclaration(
  value: unknown,
  context: string,
): OutcomeMetricDeclaration {
  const record = expectFields(
    value,
    ['metricId', 'description', 'direction'],
    [],
    LEARNING_ERROR_CODES.INVALID_METRIC,
    context,
  );
  return deepFreeze({
    metricId: toNeutralId(
      typeof record['metricId'] === 'string' ? record['metricId'] : '',
      `${context} metricId`,
    ),
    description: toNeutralText(
      typeof record['description'] === 'string' ? record['description'] : '',
      `${context} description`,
    ),
    direction:
      record['direction'] === 'higher-is-better' ||
      record['direction'] === 'lower-is-better'
        ? record['direction']
        : (() => {
            throw new LearningError(LEARNING_ERROR_CODES.INVALID_METRIC, {
              message: `${context}: direction must be one of [higher-is-better, lower-is-better], got: ${String(record['direction'])}`,
              details: { known: [...METRIC_DIRECTIONS] },
            });
          })(),
  });
}

// ---------------------------------------------------------------------------
// Protected capability declaration (Q1.0 condition 4)
// ---------------------------------------------------------------------------

/**
 * One protected capability: the REAL A004 CapabilityNodeRef of the
 * capability that must not regress, plus the metric id and direction
 * with which regression is measured in both arms. Q1.0 condition 4
 * ("regression on protected capabilities is measured") requires ≥1
 * declared protected capability with paired measurements - an
 * experiment declaring NONE cannot reach `lift-demonstrated` (the
 * conservative, failing-closed reading; disclosed design decision).
 */
export interface ProtectedCapabilityDeclaration {
  readonly ref: CapabilityNodeRef;
  readonly metricId: NeutralId;
  readonly direction: MetricDirection;
}

/** Stable field list for protected capability declarations. */
export const PROTECTED_CAPABILITY_DECLARATION_FIELDS = Object.freeze([
  'ref',
  'metricId',
  'direction',
] as const);

export function isProtectedCapabilityDeclaration(
  value: unknown,
): value is ProtectedCapabilityDeclaration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isCapabilityNodeRef(candidate['ref']) &&
    isNeutralId(candidate['metricId']) &&
    isMetricDirection(candidate['direction'])
  );
}

function toProtectedCapabilityDeclaration(
  value: unknown,
  context: string,
): ProtectedCapabilityDeclaration {
  const record = expectFields(
    value,
    ['ref', 'metricId', 'direction'],
    [],
    LEARNING_ERROR_CODES.INVALID_DESCRIPTOR,
    context,
  );
  const ref = record['ref'];
  if (!isCapabilityNodeRef(ref)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: `${context}: ref must be a structurally valid A004 CapabilityNodeRef (REAL @arena/capability-graph guard): ${JSON.stringify(ref)}`,
    });
  }
  return deepFreeze({
    ref: deepFreeze({ ...ref }) as CapabilityNodeRef,
    metricId: toNeutralId(
      typeof record['metricId'] === 'string' ? record['metricId'] : '',
      `${context} metricId`,
    ),
    direction:
      record['direction'] === 'higher-is-better' ||
      record['direction'] === 'lower-is-better'
        ? record['direction']
        : (() => {
            throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
              message: `${context}: direction must be one of [higher-is-better, lower-is-better], got: ${String(record['direction'])}`,
              details: { known: [...METRIC_DIRECTIONS] },
            });
          })(),
  });
}

// ---------------------------------------------------------------------------
// Uncertainty declaration
// ---------------------------------------------------------------------------

/**
 * The declared uncertainty/statistical method (LE1.0): a CLOSED method
 * vocabulary plus optional free-form notes. The method declaration
 * commits the experiment to HOW variance is computed; the reported
 * values live in the run record's UncertaintyReport.
 */
export interface UncertaintyDeclaration {
  readonly method: UncertaintyMethod;
  readonly notes: NeutralText | null;
}

/** Stable field list for uncertainty declarations. */
export const UNCERTAINTY_DECLARATION_FIELDS = Object.freeze([
  'method',
  'notes',
] as const);

export function isUncertaintyDeclaration(value: unknown): value is UncertaintyDeclaration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isUncertaintyMethod(candidate['method']) &&
    (candidate['notes'] === null || isNeutralText(candidate['notes']))
  );
}

function toUncertaintyDeclaration(value: unknown): UncertaintyDeclaration {
  const record = expectFields(
    value,
    ['method', 'notes'],
    [],
    LEARNING_ERROR_CODES.INVALID_DESCRIPTOR,
    'experiment descriptor uncertainty',
  );
  const method = record['method'];
  if (typeof method !== 'string' || !isUncertaintyMethod(method)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: `experiment descriptor uncertainty: method must be one of [${UNCERTAINTY_METHODS.join(', ')}], got: ${String(method)}`,
      details: { known: [...UNCERTAINTY_METHODS] },
    });
  }
  const notes = record['notes'];
  if (notes !== null && typeof notes !== 'string') {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: 'experiment descriptor uncertainty: notes must be neutral text or null',
    });
  }
  return deepFreeze({
    method,
    notes: notes === null ? null : toNeutralText(notes, 'uncertainty notes'),
  });
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** Provenance of the experiment declaration (LE1.0 "provenance"; R14). */
export interface ExperimentProvenance {
  readonly authoredBy: NeutralId;
  readonly submittedAt: LearningTimestamp;
  readonly notes: NeutralText | null;
}

/** Stable field list for provenance. */
export const EXPERIMENT_PROVENANCE_FIELDS = Object.freeze([
  'authoredBy',
  'submittedAt',
  'notes',
] as const);

export function isExperimentProvenance(value: unknown): value is ExperimentProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['authoredBy']) &&
    isLearningTimestamp(candidate['submittedAt']) &&
    (candidate['notes'] === null || isNeutralText(candidate['notes']))
  );
}

function toExperimentProvenance(value: unknown): ExperimentProvenance {
  const record = expectFields(
    value,
    ['authoredBy', 'submittedAt', 'notes'],
    [],
    LEARNING_ERROR_CODES.INVALID_PROVENANCE,
    'experiment descriptor provenance',
  );
  const notes = record['notes'];
  if (notes !== null && typeof notes !== 'string') {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'experiment descriptor provenance: notes must be neutral text or null',
    });
  }
  return deepFreeze({
    authoredBy: toNeutralId(
      typeof record['authoredBy'] === 'string' ? record['authoredBy'] : '',
      'experiment descriptor provenance authoredBy',
    ),
    submittedAt: toLearningTimestamp(
      typeof record['submittedAt'] === 'string' ? record['submittedAt'] : '',
      'experiment descriptor provenance submittedAt',
    ),
    notes: notes === null ? null : toNeutralText(notes, 'provenance notes'),
  });
}

// ---------------------------------------------------------------------------
// ExperimentDescriptor
// ---------------------------------------------------------------------------

/** The digest-free view - exactly what the descriptor digest commits to. */
export interface ExperimentDescriptorView {
  readonly recordVersion: typeof EXPERIMENT_DESCRIPTOR_VERSION;
  readonly experimentId: LearningId;
  readonly version: LearningVersion;
  readonly targetCapability: CapabilityNodeRef;
  readonly baseline: BaselineComposition;
  readonly interventions: readonly InterventionArtifact[];
  readonly taskPopulation: readonly TaskVersionRef[];
  readonly evaluationSuiteRefs: readonly ContentDigest[];
  readonly verificationSuiteRefs: readonly ContentDigest[];
  readonly environmentVersions: readonly EnvironmentVersionRef[];
  readonly outcomeMetrics: readonly OutcomeMetricDeclaration[];
  readonly uncertainty: UncertaintyDeclaration;
  readonly protectedCapabilities: readonly ProtectedCapabilityDeclaration[];
  readonly provenance: ExperimentProvenance;
}

/** A frozen, content-addressed experiment descriptor: the view plus its sha256 digest. */
export interface ExperimentDescriptor extends ExperimentDescriptorView {
  readonly digest: ContentDigest;
}

/** Stable field list for the descriptor view (tests + contracts mirror it). */
export const EXPERIMENT_DESCRIPTOR_FIELDS = Object.freeze([
  'recordVersion',
  'experimentId',
  'version',
  'targetCapability',
  'baseline',
  'interventions',
  'taskPopulation',
  'evaluationSuiteRefs',
  'verificationSuiteRefs',
  'environmentVersions',
  'outcomeMetrics',
  'uncertainty',
  'protectedCapabilities',
  'provenance',
] as const);

export interface CreateExperimentDescriptorInput {
  readonly experimentId: string;
  readonly version: string;
  readonly targetCapability: {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly baseline: {
    readonly bodyRef: string | null;
    readonly substrateRef: string | null;
    readonly runtimeRef: string | null;
  };
  readonly interventions: readonly {
    readonly artifact: {
      readonly namespace: string;
      readonly name: string;
      readonly version: string;
      readonly digest: string;
    };
    readonly changedSurface: string;
  }[];
  readonly taskPopulation: readonly { readonly taskId: string; readonly version: string }[];
  readonly evaluationSuiteRefs: readonly string[];
  readonly verificationSuiteRefs: readonly string[];
  readonly environmentVersions: readonly {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  }[];
  readonly outcomeMetrics: readonly {
    readonly metricId: string;
    readonly description: string;
    readonly direction: string;
  }[];
  readonly uncertainty: {
    readonly method: string;
    readonly notes: string | null;
  };
  readonly protectedCapabilities: readonly {
    readonly ref: {
      readonly kind: string;
      readonly id: string;
      readonly version: string;
      readonly digest: string;
    };
    readonly metricId: string;
    readonly direction: string;
  }[];
  readonly provenance: {
    readonly authoredBy: string;
    readonly submittedAt: string;
    readonly notes: string | null;
  };
}

/** Structural (non-throwing) check for the digest-free view. */
export function isExperimentDescriptorView(
  value: unknown,
): value is ExperimentDescriptorView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === EXPERIMENT_DESCRIPTOR_VERSION &&
    isNeutralId(candidate['experimentId']) &&
    isLearningVersion(candidate['version']) &&
    isCapabilityNodeRef(candidate['targetCapability']) &&
    isBaselineComposition(candidate['baseline']) &&
    Array.isArray(candidate['interventions']) &&
    (candidate['interventions'] as unknown[]).length > 0 &&
    (candidate['interventions'] as unknown[]).every((entry) =>
      isInterventionArtifact(entry),
    ) &&
    Array.isArray(candidate['taskPopulation']) &&
    (candidate['taskPopulation'] as unknown[]).length > 0 &&
    (candidate['taskPopulation'] as unknown[]).every((entry) => isTaskVersionRef(entry)) &&
    Array.isArray(candidate['evaluationSuiteRefs']) &&
    (candidate['evaluationSuiteRefs'] as unknown[]).length > 0 &&
    (candidate['evaluationSuiteRefs'] as unknown[]).every((entry) =>
      isContentDigest(entry),
    ) &&
    Array.isArray(candidate['verificationSuiteRefs']) &&
    (candidate['verificationSuiteRefs'] as unknown[]).length > 0 &&
    (candidate['verificationSuiteRefs'] as unknown[]).every((entry) =>
      isContentDigest(entry),
    ) &&
    Array.isArray(candidate['environmentVersions']) &&
    (candidate['environmentVersions'] as unknown[]).length > 0 &&
    (candidate['environmentVersions'] as unknown[]).every((entry) =>
      isEnvironmentVersionRef(entry),
    ) &&
    Array.isArray(candidate['outcomeMetrics']) &&
    (candidate['outcomeMetrics'] as unknown[]).length > 0 &&
    (candidate['outcomeMetrics'] as unknown[]).every((entry) =>
      isOutcomeMetricDeclaration(entry),
    ) &&
    isUncertaintyDeclaration(candidate['uncertainty']) &&
    Array.isArray(candidate['protectedCapabilities']) &&
    (candidate['protectedCapabilities'] as unknown[]).every((entry) =>
      isProtectedCapabilityDeclaration(entry),
    ) &&
    isExperimentProvenance(candidate['provenance'])
  );
}

/** Structural (non-throwing) check for the full descriptor (view + digest). */
export function isExperimentDescriptor(value: unknown): value is ExperimentDescriptor {
  if (!isExperimentDescriptorView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

function uniqueDigests(values: readonly ContentDigest[]): readonly ContentDigest[] {
  return Object.freeze([...new Set(values.map((entry) => entry as string))] as ContentDigest[]);
}

/**
 * Create a validated, deep-frozen, content-addressed experiment
 * descriptor. Rejects with typed LearningErrors on every failure mode:
 * malformed ids/versions, a target capability that is not a REAL A004
 * CapabilityNodeRef, ambiguous/undeclared intervention surfaces,
 * duplicate intervention artifact digests, empty task populations,
 * empty evaluation/verification suites, empty environment versions,
 * duplicate metric ids, empty outcome metrics, unknown uncertainty
 * methods, malformed protected-capability refs, malformed provenance
 * and unknown fields.
 */
export async function createExperimentDescriptor(
  input: CreateExperimentDescriptorInput,
): Promise<ExperimentDescriptor> {
  const record = expectFields(
    input,
    [
      'experimentId',
      'version',
      'targetCapability',
      'baseline',
      'interventions',
      'taskPopulation',
      'evaluationSuiteRefs',
      'verificationSuiteRefs',
      'environmentVersions',
      'outcomeMetrics',
      'uncertainty',
      'protectedCapabilities',
      'provenance',
    ],
    [],
    LEARNING_ERROR_CODES.INVALID_DESCRIPTOR,
    'experiment descriptor',
  );

  const targetCapability = record['targetCapability'];
  if (!isCapabilityNodeRef(targetCapability)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: `experiment descriptor: targetCapability must be a structurally valid A004 CapabilityNodeRef (REAL @arena/capability-graph guard): ${JSON.stringify(targetCapability)}`,
    });
  }

  const rawInterventions = record['interventions'];
  if (!Array.isArray(rawInterventions) || rawInterventions.length === 0) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_INTERVENTION, {
      message:
        'experiment descriptor: an experiment requires at least one intervention artifact (LE1.0: an Experiment compares a baseline against an intervention)',
    });
  }
  const interventions: InterventionArtifact[] = [];
  const seenArtifactDigests = new Set<string>();
  for (const entry of rawInterventions) {
    const intervention = toInterventionArtifact(entry, 'experiment descriptor intervention');
    const artifactDigest = intervention.artifact.digest as string;
    if (seenArtifactDigests.has(artifactDigest)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_INTERVENTION, {
        message: `experiment descriptor: duplicate intervention artifact digest ${artifactDigest} (the same artifact declared twice is ambiguous - declare it once with its explicit surface)`,
        details: { artifactDigest },
      });
    }
    seenArtifactDigests.add(artifactDigest);
    interventions.push(intervention);
  }

  const rawTaskPopulation = record['taskPopulation'];
  if (!Array.isArray(rawTaskPopulation) || rawTaskPopulation.length === 0) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_POPULATION, {
      message:
        'experiment descriptor: taskPopulation must be a non-empty pinned set of task/version refs (Q1.0 condition 1: improvement is measured on a PINNED evaluation population)',
    });
  }
  const taskPopulation: TaskVersionRef[] = [];
  const seenTaskKeys = new Set<string>();
  for (const entry of rawTaskPopulation) {
    if (!isTaskVersionRef(entry)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_POPULATION, {
        message: `experiment descriptor: taskPopulation entry must be a structurally valid A009 TaskVersionRef (REAL @arena/trajectory guard): ${JSON.stringify(entry)}`,
      });
    }
    const key = `${entry.taskId}@${entry.version}`;
    if (seenTaskKeys.has(key)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_POPULATION, {
        message: `experiment descriptor: duplicate pinned task version ${key} in taskPopulation`,
        details: { task: key },
      });
    }
    seenTaskKeys.add(key);
    taskPopulation.push(deepFreeze({ ...entry }) as TaskVersionRef);
  }

  const rawEvaluationSuites = record['evaluationSuiteRefs'];
  if (!Array.isArray(rawEvaluationSuites) || rawEvaluationSuites.length === 0) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
      message:
        'experiment descriptor: evaluationSuiteRefs must be a non-empty set of A012 EvaluationCriteria/EvaluatorDescriptor digests',
    });
  }
  const evaluationSuiteRefs: ContentDigest[] = [];
  for (const entry of rawEvaluationSuites) {
    if (typeof entry !== 'string') {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_DIGEST, {
        message: `experiment descriptor: evaluationSuiteRefs entries must be sha256 hex digests, got: ${String(entry)}`,
      });
    }
    evaluationSuiteRefs.push(
      toContentDigest(entry, 'experiment descriptor evaluationSuiteRefs entry'),
    );
  }

  const rawVerificationSuites = record['verificationSuiteRefs'];
  if (!Array.isArray(rawVerificationSuites) || rawVerificationSuites.length === 0) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
      message:
        'experiment descriptor: verificationSuiteRefs must be a non-empty set of A013 VerifierDescriptor digests',
    });
  }
  const verificationSuiteRefs: ContentDigest[] = [];
  for (const entry of rawVerificationSuites) {
    if (typeof entry !== 'string') {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_DIGEST, {
        message: `experiment descriptor: verificationSuiteRefs entries must be sha256 hex digests, got: ${String(entry)}`,
      });
    }
    verificationSuiteRefs.push(
      toContentDigest(entry, 'experiment descriptor verificationSuiteRefs entry'),
    );
  }

  const rawEnvironmentVersions = record['environmentVersions'];
  if (!Array.isArray(rawEnvironmentVersions) || rawEnvironmentVersions.length === 0) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
      message:
        'experiment descriptor: environmentVersions must be a non-empty pinned set of content-addressed environment refs',
    });
  }
  const environmentVersions: EnvironmentVersionRef[] = [];
  const seenEnvironmentKeys = new Set<string>();
  for (const entry of rawEnvironmentVersions) {
    const environmentRef = toEnvironmentVersionRef(entry);
    const key = `${environmentRef.namespace}/${environmentRef.name}@${environmentRef.version}#${environmentRef.digest}`;
    if (seenEnvironmentKeys.has(key)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
        message: `experiment descriptor: duplicate environment version ${key} in environmentVersions`,
      });
    }
    seenEnvironmentKeys.add(key);
    environmentVersions.push(environmentRef);
  }

  const rawOutcomeMetrics = record['outcomeMetrics'];
  if (!Array.isArray(rawOutcomeMetrics) || rawOutcomeMetrics.length === 0) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_METRIC, {
      message:
        'experiment descriptor: outcomeMetrics must be a non-empty set of declared outcome metrics (R16: measure whether interventions change target capability)',
    });
  }
  const outcomeMetrics: OutcomeMetricDeclaration[] = [];
  const seenMetricIds = new Set<string>();
  for (const entry of rawOutcomeMetrics) {
    const declaration = toOutcomeMetricDeclaration(
      entry,
      'experiment descriptor outcomeMetrics entry',
    );
    const metricId = declaration.metricId as string;
    if (seenMetricIds.has(metricId)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_METRIC, {
        message: `experiment descriptor: duplicate outcome metric id ${metricId} (metric ids are unique within the experiment)`,
        details: { metricId },
      });
    }
    seenMetricIds.add(metricId);
    outcomeMetrics.push(declaration);
  }

  const rawProtectedCapabilities = record['protectedCapabilities'];
  if (!Array.isArray(rawProtectedCapabilities)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: 'experiment descriptor: protectedCapabilities must be an array (possibly empty)',
    });
  }
  const protectedCapabilities: ProtectedCapabilityDeclaration[] = [];
  const seenProtectedDigests = new Set<string>();
  for (const entry of rawProtectedCapabilities) {
    const declaration = toProtectedCapabilityDeclaration(
      entry,
      'experiment descriptor protectedCapabilities entry',
    );
    const refDigest = declaration.ref.digest;
    if (seenProtectedDigests.has(refDigest)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
        message: `experiment descriptor: duplicate protected capability ref digest ${refDigest} (protected capabilities are unique by ref digest)`,
        details: { refDigest },
      });
    }
    seenProtectedDigests.add(refDigest);
    protectedCapabilities.push(declaration);
  }

  const view: ExperimentDescriptorView = {
    recordVersion: EXPERIMENT_DESCRIPTOR_VERSION,
    experimentId: toLearningId(
      typeof record['experimentId'] === 'string' ? record['experimentId'] : '',
      'experiment descriptor experimentId',
    ),
    version: toLearningVersion(
      typeof record['version'] === 'string' ? record['version'] : '',
      'experiment descriptor version',
    ),
    targetCapability: deepFreeze({ ...targetCapability }) as CapabilityNodeRef,
    baseline: toBaselineComposition(record['baseline']),
    interventions: Object.freeze([...interventions]),
    taskPopulation: Object.freeze([...taskPopulation]),
    evaluationSuiteRefs: uniqueDigests(evaluationSuiteRefs),
    verificationSuiteRefs: uniqueDigests(verificationSuiteRefs),
    environmentVersions: Object.freeze([...environmentVersions]),
    outcomeMetrics: Object.freeze([...outcomeMetrics]),
    uncertainty: toUncertaintyDeclaration(record['uncertainty']),
    protectedCapabilities: Object.freeze([...protectedCapabilities]),
    provenance: toExperimentProvenance(record['provenance']),
  };
  const digest = toContentDigest(
    await digestCanonical(view),
    'experiment descriptor digest',
  );
  return deepFreeze({ ...view, digest }) as ExperimentDescriptor;
}

/** The digest-free view of a descriptor (what the digest commits to). */
export function experimentDescriptorView(
  descriptor: ExperimentDescriptor,
): ExperimentDescriptorView {
  const { digest: _digest, ...view } = descriptor;
  return deepFreeze({ ...view }) as ExperimentDescriptorView;
}

/**
 * Recompute the descriptor digest over the digest-free view and compare
 * (optionally against an expected digest). Throws LEARNING_TAMPERED on
 * any mismatch.
 */
export async function recomputeExperimentDescriptorDigest(
  descriptor: ExperimentDescriptor,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isExperimentDescriptor(descriptor)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
      message:
        'descriptor digest recomputation requires a structurally valid experiment descriptor',
    });
  }
  const actual = await digestCanonical(experimentDescriptorView(descriptor));
  if (
    actual !== descriptor.digest ||
    (expectedDigest !== undefined && actual !== expectedDigest)
  ) {
    throw new LearningError(LEARNING_ERROR_CODES.TAMPERED, {
      message: `experiment descriptor digest mismatch: expected ${expectedDigest ?? descriptor.digest}, got ${actual}`,
      details: {
        experimentId: descriptor.experimentId,
        version: descriptor.version,
        expected: expectedDigest ?? descriptor.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed experiment descriptor digest');
}

/**
 * The experiment identity key - "experimentId@version". The reference
 * registry keys duplicate detection on this pair: registering a
 * DIFFERENT descriptor digest under the same identity is a version
 * conflict (changing an experiment requires a new version).
 */
export function experimentIdentityKey(descriptor: ExperimentDescriptor): string {
  return `${descriptor.experimentId}@${descriptor.version}`;
}
