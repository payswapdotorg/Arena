/**
 * BenchmarkDescriptor -- the versioned, content-addressed, CITABLE
 * declaration of a public research benchmark (Work Order A030;
 * requirements R23, R32, R43; architecture-lock rules 12, 18, 22).
 *
 * The descriptor is the stable, published definition -- it pins the
 * IDENTITY of every protocol object a run must use, never the digests
 * of run-bound objects (those live in BenchmarkResultRecord):
 *
 *   - `benchmarkId` + `version` -- the benchmark's own versioned,
 *     citable identity. Content-addressed: ANY change to ANY field
 *     changes the digest, so every historical benchmark revision stays
 *     addressable forever;
 *   - `domain` -- the professional domain (a neutral id, e.g.
 *     'software-engineering' -- the A028 body's domain);
 *   - `status` -- the publication lifecycle: draft | published |
 *     retired (closed enum; transitions are the publisher's discipline,
 *     the descriptor records the state);
 *   - `criteriaPins` -- the A012 EvaluationCriteria identities
 *     (criteriaId@version, ≥ 1) a compliant run MUST judge against;
 *   - `evaluatorPins` -- the A012 evaluator identities (evaluatorId@version
 *     + the CLOSED A012 evaluator-kind enum, reused by import), ≥ 1;
 *   - `verifierPins` -- the A013 VerifierDescriptor identities
 *     (verifierId@version, ≥ 1) -- VERIFICATION-CHECKED scoring is
 *     mandatory: a benchmark without a verifier pin is rejected;
 *   - `methodologyRef` -- the content-addressed ScoringMethodology this
 *     benchmark scores under (an A002 artifact ref);
 *   - `datasetRef` -- the A014 public DatasetManifest ref (null only in
 *     draft status: a PUBLISHED benchmark must cite its public dataset);
 *   - `subjectScope` -- the pinned population: the A003 BodyVersion
 *     artifact refs (≥ 1 -- e.g. the A028 reference body versions), an
 *     optional A009 environment ref, and a runtime note;
 *   - `taskPopulation` -- scenarioCount (positive integer), seedPolicy
 *     (closed enum: fixed-seed | declared-per-scenario) and notes;
 *   - `provenance` -- who authored the benchmark, when, notes.
 *
 * R43 discipline: the descriptor scopes a benchmark over AGENT BODY
 * compositions (body + substrate + environment + runtime), never over
 * a model in isolation; R44 discipline: result records (not the
 * descriptor) carry the concrete version pins of a run.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { SchemaRef } from '@arena/protocol-core';
import { isEvaluatorKind } from '@arena/evaluation';
import type { EvaluatorKind } from '@arena/evaluation';
import { isArtifactRef, toArtifactRef as toArenaArtifactRef } from '@arena/artifact-protocol';
import type { ArtifactRef } from '@arena/artifact-protocol';
import { RESEARCH_ERROR_CODES, ResearchError } from './errors.js';
import { researchSchemaRef } from './schemas.js';
import {
  deepFreeze,
  expectFields,
  expectPositiveInteger,
  isContentDigest,
  isNeutralId,
  isNeutralText,
  isResearchId,
  isResearchTimestamp,
  isResearchVersion,
  toContentDigest,
  toNeutralText,
  toResearchId,
  toResearchVersion,
} from './shared.js';
import type {
  ResearchContentDigest,
  ResearchId,
  ResearchNeutralText,
  ResearchTimestamp,
  ResearchVersion,
} from './shared.js';

/** Wire version of the benchmark-descriptor shape. */
export const BENCHMARK_DESCRIPTOR_VERSION = 1 as const;

/** The closed publication lifecycle. */
export const BENCHMARK_STATUSES = Object.freeze(['draft', 'published', 'retired'] as const);
export type BenchmarkStatus = (typeof BENCHMARK_STATUSES)[number];

/** The closed seed policy for the task population. */
export const SEED_POLICIES = Object.freeze(['fixed-seed', 'declared-per-scenario'] as const);
export type SeedPolicy = (typeof SEED_POLICIES)[number];

/** Stable field lists (tests mirror them). */
export const CRITERIA_PIN_FIELDS = Object.freeze(['criteriaId', 'version'] as const) as readonly string[];
export const EVALUATOR_PIN_FIELDS = Object.freeze([
  'evaluatorId',
  'version',
  'kind',
] as const) as readonly string[];
export const VERIFIER_PIN_FIELDS = Object.freeze(['verifierId', 'version'] as const) as readonly string[];
export const SUBJECT_SCOPE_FIELDS = Object.freeze([
  'bodyRefs',
  'environmentRef',
  'runtimeNote',
] as const) as readonly string[];
export const TASK_POPULATION_FIELDS = Object.freeze([
  'scenarioCount',
  'seedPolicy',
  'notes',
] as const) as readonly string[];

export interface CriteriaPin {
  readonly criteriaId: ResearchId;
  readonly version: ResearchVersion;
}

export interface EvaluatorPin {
  readonly evaluatorId: ResearchId;
  readonly version: ResearchVersion;
  readonly kind: EvaluatorKind;
}

export interface VerifierPin {
  readonly verifierId: ResearchId;
  readonly version: ResearchVersion;
}

export interface BenchmarkSubjectScope {
  /** The pinned body population (A003 BodyVersion artifact refs, ≥ 1). */
  readonly bodyRefs: readonly ArtifactRef[];
  readonly environmentRef: ArtifactRef | null;
  readonly runtimeNote: ResearchNeutralText;
}

export interface BenchmarkTaskPopulation {
  readonly scenarioCount: number;
  readonly seedPolicy: SeedPolicy;
  readonly notes: ResearchNeutralText;
}

export interface BenchmarkProvenance {
  readonly authoredBy: ResearchId;
  readonly submittedAt: ResearchTimestamp;
  readonly notes: ResearchNeutralText | null;
}

/** The digest-free view -- exactly what the descriptor digest commits to. */
export interface BenchmarkDescriptorView {
  readonly recordVersion: typeof BENCHMARK_DESCRIPTOR_VERSION;
  readonly benchmarkId: ResearchId;
  readonly version: ResearchVersion;
  readonly domain: ResearchId;
  readonly title: ResearchNeutralText;
  readonly description: ResearchNeutralText;
  readonly status: BenchmarkStatus;
  readonly criteriaPins: readonly CriteriaPin[];
  readonly evaluatorPins: readonly EvaluatorPin[];
  readonly verifierPins: readonly VerifierPin[];
  readonly methodologyRef: ArtifactRef;
  readonly datasetRef: ArtifactRef | null;
  readonly subjectScope: BenchmarkSubjectScope;
  readonly taskPopulation: BenchmarkTaskPopulation;
  readonly outputSchema: SchemaRef;
  readonly provenance: BenchmarkProvenance;
}

/** A frozen, content-addressed benchmark descriptor: the view plus its digest. */
export interface BenchmarkDescriptor extends BenchmarkDescriptorView {
  readonly digest: ResearchContentDigest;
}

/** Stable field list for the descriptor view. */
export const BENCHMARK_DESCRIPTOR_FIELDS = Object.freeze([
  'recordVersion',
  'benchmarkId',
  'version',
  'domain',
  'title',
  'description',
  'status',
  'criteriaPins',
  'evaluatorPins',
  'verifierPins',
  'methodologyRef',
  'datasetRef',
  'subjectScope',
  'taskPopulation',
  'outputSchema',
  'provenance',
] as const) as readonly string[];

export interface CreateBenchmarkDescriptorInput {
  readonly benchmarkId: string;
  readonly version: string;
  readonly domain: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly criteriaPins: readonly { criteriaId: string; version: string }[];
  readonly evaluatorPins: readonly { evaluatorId: string; version: string; kind: string }[];
  readonly verifierPins: readonly { verifierId: string; version: string }[];
  readonly methodologyRef: { namespace: string; name: string; version: string; digest: string };
  readonly datasetRef: { namespace: string; name: string; version: string; digest: string } | null;
  readonly subjectScope: {
    readonly bodyRefs: readonly {
      namespace: string;
      name: string;
      version: string;
      digest: string;
    }[];
    readonly environmentRef: {
      namespace: string;
      name: string;
      version: string;
      digest: string;
    } | null;
    readonly runtimeNote: string;
  };
  readonly taskPopulation: {
    readonly scenarioCount: number;
    readonly seedPolicy: string;
    readonly notes: string;
  };
  readonly provenance: {
    readonly authoredBy: string;
    readonly submittedAt: string;
    readonly notes: string | null;
  };
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

function toArtifactRef(value: unknown, field: string): ArtifactRef {
  if (typeof value !== 'object' || value === null) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_PINS, {
      message: `${field}: expected an artifact ref object`,
    });
  }
  try {
    // REUSE the A002 artifact-protocol guard (never reimplement identity
    // validation): namespace/name/version charset + sha256 digest.
    return toArenaArtifactRef(value as {
      namespace: string;
      name: string;
      version: string;
      digest: string;
    });
  } catch (error) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_PINS, {
      message: `${field}: invalid artifact ref (${error instanceof Error ? error.message : String(error)})`,
    });
  }
}

function toCriteriaPin(value: unknown): CriteriaPin {
  const record = expectFields(
    value,
    ['criteriaId', 'version'],
    [],
    RESEARCH_ERROR_CODES.INVALID_PINS,
    'benchmark criteria pin',
  );
  return Object.freeze({
    criteriaId: toResearchId(
      typeof record['criteriaId'] === 'string' ? record['criteriaId'] : '',
      'criteria pin criteriaId',
    ),
    version: toResearchVersion(
      typeof record['version'] === 'string' ? record['version'] : '',
      'criteria pin version',
    ),
  });
}

function toEvaluatorPin(value: unknown): EvaluatorPin {
  const record = expectFields(
    value,
    ['evaluatorId', 'version', 'kind'],
    [],
    RESEARCH_ERROR_CODES.INVALID_PINS,
    'benchmark evaluator pin',
  );
  const kind = record['kind'];
  if (!isEvaluatorKind(kind)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_PINS, {
      message: `benchmark evaluator pin: unknown evaluator kind ${JSON.stringify(kind)} (the A012 closed enum is reused)`,
    });
  }
  return Object.freeze({
    evaluatorId: toResearchId(
      typeof record['evaluatorId'] === 'string' ? record['evaluatorId'] : '',
      'evaluator pin evaluatorId',
    ),
    version: toResearchVersion(
      typeof record['version'] === 'string' ? record['version'] : '',
      'evaluator pin version',
    ),
    kind,
  });
}

function toVerifierPin(value: unknown): VerifierPin {
  const record = expectFields(
    value,
    ['verifierId', 'version'],
    [],
    RESEARCH_ERROR_CODES.INVALID_PINS,
    'benchmark verifier pin',
  );
  return Object.freeze({
    verifierId: toResearchId(
      typeof record['verifierId'] === 'string' ? record['verifierId'] : '',
      'verifier pin verifierId',
    ),
    version: toResearchVersion(
      typeof record['version'] === 'string' ? record['version'] : '',
      'verifier pin version',
    ),
  });
}

function toSubjectScope(value: unknown): BenchmarkSubjectScope {
  const record = expectFields(
    value,
    ['bodyRefs', 'environmentRef', 'runtimeNote'],
    [],
    RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR,
    'benchmark subject scope',
  );
  const bodyRefs = record['bodyRefs'];
  if (!Array.isArray(bodyRefs) || bodyRefs.length === 0) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: 'benchmark subject scope: at least one body ref is required (a benchmark judges Agent Body compositions, never a model in isolation -- R43)',
    });
  }
  const environmentRef = record['environmentRef'];
  return deepFreeze({
    bodyRefs: bodyRefs.map((ref, index) => toArtifactRef(ref, `subject scope bodyRefs[${index}]`)),
    environmentRef: environmentRef === null || environmentRef === undefined ? null : toArtifactRef(environmentRef, 'subject scope environmentRef'),
    runtimeNote: toNeutralText(
      typeof record['runtimeNote'] === 'string' ? record['runtimeNote'] : '',
      'subject scope runtimeNote',
    ),
  });
}

function toTaskPopulation(value: unknown): BenchmarkTaskPopulation {
  const record = expectFields(
    value,
    ['scenarioCount', 'seedPolicy', 'notes'],
    [],
    RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR,
    'benchmark task population',
  );
  const seedPolicy = record['seedPolicy'];
  if (
    typeof seedPolicy !== 'string' ||
    !(SEED_POLICIES as readonly string[]).includes(seedPolicy)
  ) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: `benchmark task population: unknown seed policy ${JSON.stringify(seedPolicy)}`,
      details: { allowed: [...SEED_POLICIES] },
    });
  }
  return deepFreeze({
    scenarioCount: expectPositiveInteger(
      record['scenarioCount'],
      'scenarioCount',
      RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR,
      'benchmark task population',
    ),
    seedPolicy: seedPolicy as SeedPolicy,
    notes: toNeutralText(
      typeof record['notes'] === 'string' ? record['notes'] : '',
      'task population notes',
    ),
  });
}

function toBenchmarkProvenance(value: unknown): BenchmarkProvenance {
  const record = expectFields(
    value,
    ['authoredBy', 'submittedAt', 'notes'],
    [],
    RESEARCH_ERROR_CODES.INVALID_PROVENANCE,
    'benchmark provenance',
  );
  const submittedAt = record['submittedAt'];
  if (typeof submittedAt !== 'string' || !isResearchTimestamp(submittedAt)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'benchmark provenance: submittedAt must be a ms-precision UTC timestamp',
    });
  }
  const notes = record['notes'];
  return deepFreeze({
    authoredBy: toResearchId(
      typeof record['authoredBy'] === 'string' ? record['authoredBy'] : '',
      'benchmark provenance authoredBy',
    ),
    submittedAt,
    notes: typeof notes === 'string' ? toNeutralText(notes, 'benchmark provenance notes') : null,
  });
}

// ---------------------------------------------------------------------------
// Structural guards
// ---------------------------------------------------------------------------

export function isBenchmarkDescriptorView(value: unknown): value is BenchmarkDescriptorView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === BENCHMARK_DESCRIPTOR_VERSION &&
    isResearchId(candidate['benchmarkId']) &&
    isResearchVersion(candidate['version']) &&
    isResearchId(candidate['domain']) &&
    isNeutralText(candidate['title']) &&
    isNeutralText(candidate['description']) &&
    (BENCHMARK_STATUSES as readonly string[]).includes(String(candidate['status'])) &&
    Array.isArray(candidate['criteriaPins']) &&
    (candidate['criteriaPins'] as unknown[]).length > 0 &&
    Array.isArray(candidate['evaluatorPins']) &&
    (candidate['evaluatorPins'] as unknown[]).length > 0 &&
    Array.isArray(candidate['verifierPins']) &&
    (candidate['verifierPins'] as unknown[]).length > 0 &&
    isArtifactRef(candidate['methodologyRef']) &&
    (candidate['datasetRef'] === null || isArtifactRef(candidate['datasetRef'])) &&
    typeof candidate['subjectScope'] === 'object' &&
    candidate['subjectScope'] !== null &&
    typeof candidate['taskPopulation'] === 'object' &&
    candidate['taskPopulation'] !== null &&
    typeof candidate['provenance'] === 'object' &&
    candidate['provenance'] !== null
  );
}

export function isBenchmarkDescriptor(value: unknown): value is BenchmarkDescriptor {
  if (!isBenchmarkDescriptorView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

/**
 * Create a validated, deep-frozen, content-addressed benchmark
 * descriptor. Rejects: unknown statuses/seed policies, empty criteria/
 * evaluator/verifier pin sets (verification-checked scoring is
 * mandatory), missing body population, a published benchmark without a
 * public dataset ref, unknown fields.
 */
export async function createBenchmarkDescriptor(
  input: CreateBenchmarkDescriptorInput,
): Promise<BenchmarkDescriptor> {
  const record = expectFields(
    input,
    [
      'benchmarkId',
      'version',
      'domain',
      'title',
      'description',
      'status',
      'criteriaPins',
      'evaluatorPins',
      'verifierPins',
      'methodologyRef',
      'datasetRef',
      'subjectScope',
      'taskPopulation',
      'provenance',
    ],
    [],
    RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR,
    'benchmark descriptor',
  );

  const status = record['status'];
  if (typeof status !== 'string' || !(BENCHMARK_STATUSES as readonly string[]).includes(status)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: `benchmark descriptor: unknown status ${JSON.stringify(status)}`,
      details: { allowed: [...BENCHMARK_STATUSES] },
    });
  }
  const datasetRef = record['datasetRef'];
  if (status === 'published' && (datasetRef === null || datasetRef === undefined)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: 'benchmark descriptor: a PUBLISHED benchmark must cite its public dataset (A014 DatasetManifest ref) -- draft is the only dataset-less status',
      details: { status },
    });
  }

  const criteriaPins = record['criteriaPins'];
  const evaluatorPins = record['evaluatorPins'];
  const verifierPins = record['verifierPins'];
  if (!Array.isArray(criteriaPins) || criteriaPins.length === 0) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: 'benchmark descriptor: at least one A012 criteria pin is required',
    });
  }
  if (!Array.isArray(evaluatorPins) || evaluatorPins.length === 0) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: 'benchmark descriptor: at least one A012 evaluator pin is required',
    });
  }
  if (!Array.isArray(verifierPins) || verifierPins.length === 0) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: 'benchmark descriptor: at least one A013 verifier pin is required (verification-checked scoring is mandatory -- an unverifiable benchmark is not publishable)',
    });
  }

  const view: BenchmarkDescriptorView = {
    recordVersion: BENCHMARK_DESCRIPTOR_VERSION,
    benchmarkId: toResearchId(
      typeof record['benchmarkId'] === 'string' ? record['benchmarkId'] : '',
      'benchmark descriptor benchmarkId',
    ),
    version: toResearchVersion(
      typeof record['version'] === 'string' ? record['version'] : '',
      'benchmark descriptor version',
    ),
    domain: toResearchId(
      typeof record['domain'] === 'string' ? record['domain'] : '',
      'benchmark descriptor domain',
    ),
    title: toNeutralText(typeof record['title'] === 'string' ? record['title'] : '', 'benchmark descriptor title'),
    description: toNeutralText(
      typeof record['description'] === 'string' ? record['description'] : '',
      'benchmark descriptor description',
    ),
    status: status as BenchmarkStatus,
    criteriaPins: criteriaPins.map(toCriteriaPin),
    evaluatorPins: evaluatorPins.map(toEvaluatorPin),
    verifierPins: verifierPins.map(toVerifierPin),
    methodologyRef: toArtifactRef(record['methodologyRef'], 'benchmark methodologyRef'),
    datasetRef: datasetRef === null || datasetRef === undefined ? null : toArtifactRef(datasetRef, 'benchmark datasetRef'),
    subjectScope: toSubjectScope(record['subjectScope']),
    taskPopulation: toTaskPopulation(record['taskPopulation']),
    outputSchema: researchSchemaRef('research/benchmark-descriptor'),
    provenance: toBenchmarkProvenance(record['provenance']),
  };
  const digest = toContentDigest(await digestCanonical(view), 'benchmark descriptor digest');
  return deepFreeze({ ...view, digest }) as BenchmarkDescriptor;
}

/** The digest-free view of a descriptor. */
export function benchmarkDescriptorView(
  descriptor: BenchmarkDescriptor,
): BenchmarkDescriptorView {
  const { digest: _digest, ...view } = descriptor;
  return deepFreeze({ ...view }) as BenchmarkDescriptorView;
}

/**
 * Recompute the descriptor digest over the digest-free view and
 * compare. Throws RESEARCH_TAMPERED on any mismatch.
 */
export async function recomputeBenchmarkDescriptorDigest(
  descriptor: BenchmarkDescriptor,
  expectedDigest?: string,
): Promise<ResearchContentDigest> {
  if (!isBenchmarkDescriptor(descriptor)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: 'descriptor digest recomputation requires a structurally valid benchmark descriptor',
    });
  }
  const actual = await digestCanonical(benchmarkDescriptorView(descriptor));
  if (actual !== descriptor.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.TAMPERED, {
      message: `benchmark descriptor digest mismatch: expected ${expectedDigest ?? descriptor.digest}, got ${actual}`,
      details: {
        benchmarkId: descriptor.benchmarkId,
        version: descriptor.version,
        expected: expectedDigest ?? descriptor.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed descriptor digest');
}

/** The benchmark identity key -- "benchmarkId@version". */
export function benchmarkIdentityKey(descriptor: BenchmarkDescriptor): string {
  return `${descriptor.benchmarkId}@${descriptor.version}`;
}

/** True iff every neutral-id field is well-formed (used by structural tests). */
export function hasNeutralDescriptorIds(descriptor: BenchmarkDescriptor): boolean {
  return (
    isNeutralId(descriptor.benchmarkId) &&
    isNeutralId(descriptor.domain) &&
    isNeutralId(descriptor.provenance.authoredBy)
  );
}
