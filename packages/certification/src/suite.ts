/**
 * CertificationSuite — the content-addressed, versioned DECLARATION of a
 * certification suite (Work Order A023; requirements R21, R22, R43;
 * architecture-lock rules 4, 12; spec/quality-model.md "Certification
 * levels"; docs/architecture.md §10: "Both [evaluation and
 * verification] are versioned and can be combined into Certification
 * Suites").
 *
 * A suite binds:
 *   - `suiteId` + `version` — the suite's own versioned identity.
 *     Because the suite is content-addressed, ANY change to ANY field
 *     changes the digest; registering a different suite under the same
 *     (suiteId, version) identity is a conflict in the reference
 *     registry (services/certification) — the enforcement point of the
 *     assessor-versioning rule (spec/quality-model.md);
 *   - `stages` — the ORDERED composition of requirement stages, one per
 *     consumed protocol (the closed stage-kind vocabulary):
 *       - evaluation: pins the EXACT evaluator descriptor digest +
 *         criteria digest (A012) — satisfied iff the pinned evaluation
 *         record's aggregate outcome is meets-criteria;
 *       - verification: pins the EXACT verifier descriptor digest
 *         (A013) — satisfied iff the pinned verification record's
 *         outcome is pass;
 *       - compatibility: pins optional required test-suite artifact
 *         refs (A022) — satisfied iff a compatibility record for the
 *         subject's body×substrate pair is `compatible`;
 *       - dataset: pins the EXACT dataset manifest ref (A014) —
 *         satisfied iff the pinned dataset manifest resolves by digest;
 *       - composition: pins optional environment/runtime requirements —
 *         satisfied iff the subject's E and R match the pins;
 *     Stage ids are unique within the suite (duplicates rejected); at
 *     least one stage is required;
 *   - `levelGrant` — what a SATISFIED run grants (DEVELOPMENT |
 *     CANDIDATE | CERTIFIED); a suite declaring `constraints` grants
 *     CONDITIONAL instead (derived, never declared);
 *   - `constraints` — the declared constraints of a conditional
 *     certification (empty ⇒ unconditional);
 *   - `limitations` — the professional-limitations notice carried by
 *     every statement the suite issues (lock rule 23; R46); when null,
 *     the mandated default notice from spec/quality-model.md
 *     "Professional limitations" applies;
 *   - `supersedes` — the digest of the PRIOR suite version this suite
 *     supersedes (append-only lineage, mirroring the A021 forge
 *     manifest lineage); null for a first suite;
 *   - `provenance` — who authored the suite, when, with what notes.
 *
 * Content addressing: the sha256 digest is computed over the canonical
 * JSON of the digest-free view with @arena/protocol-core's
 * digestCanonical — NEVER reimplemented here. Same suite ⇒ same digest;
 * the suite digest IS the "revision X" of the certification statement.
 * Deep-frozen at creation — there is NO mutation API.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { SchemaRef } from '@arena/protocol-core';
import { isSchemaRef } from '@arena/protocol-core';
import { CERTIFICATION_ERROR_CODES, CertificationError } from './errors.js';
import type { CertificationGrantLevel } from './level.js';
import { isCertificationGrantLevel, toCertificationGrantLevel } from './level.js';
import {
  deepFreeze,
  expectFields,
  isCertificationId,
  isCertificationVersion,
  isContentDigest,
  isNeutralId,
  isNeutralText,
  isCertificationTimestamp,
  toCertificationVersion,
  toContentDigest,
  toNeutralId,
  toNeutralText,
  toCertificationTimestamp,
  toOptionalContentDigest,
  toSchemaRefValue,
} from './shared.js';
import type {
  CertificationTimestamp,
  CertificationVersion,
  ContentDigest,
  NeutralId,
  NeutralText,
} from './shared.js';

/** Wire version of the certification-suite shape. */
export const CERTIFICATION_SUITE_VERSION = 1 as const;

/** Identity charset for suite ids (closed, neutral). */
export const SUITE_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';

/** The CLOSED stage-kind vocabulary — one member per consumed protocol. */
export const CERTIFICATION_STAGE_KINDS = Object.freeze([
  'evaluation',
  'verification',
  'compatibility',
  'dataset',
  'composition',
] as const);

export type CertificationStageKind = (typeof CERTIFICATION_STAGE_KINDS)[number];

/** Structural (non-throwing) check for the stage-kind vocabulary. */
export function isCertificationStageKind(value: unknown): value is CertificationStageKind {
  return (
    typeof value === 'string' &&
    (CERTIFICATION_STAGE_KINDS as readonly string[]).includes(value)
  );
}

/** An A002-style artifact reference pin (namespace/name/version + digest). */
export interface ArtifactPin {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}

/** Stable field list for artifact pins (tests + contracts mirror it). */
export const ARTIFACT_PIN_FIELDS = Object.freeze([
  'namespace',
  'name',
  'version',
  'digest',
] as const) as readonly string[];

const ARTIFACT_NAMESPACE_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const ARTIFACT_NAME_PATTERN = '^[a-z][a-z0-9-]{1,127}$';

/** Structural (non-throwing) check for an artifact pin. */
export function isArtifactPin(value: unknown): value is ArtifactPin {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['namespace'] === 'string' &&
    new RegExp(ARTIFACT_NAMESPACE_PATTERN).test(candidate['namespace']) &&
    typeof candidate['name'] === 'string' &&
    new RegExp(ARTIFACT_NAME_PATTERN).test(candidate['name']) &&
    isCertificationVersion(candidate['version']) &&
    isContentDigest(candidate['digest'])
  );
}

function toArtifactPin(value: unknown, context: string): ArtifactPin {
  const record = expectFields(
    value,
    ['namespace', 'name', 'version', 'digest'],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_STAGE,
    context,
  );
  const pin = {
    namespace: typeof record['namespace'] === 'string' ? record['namespace'] : '',
    name: typeof record['name'] === 'string' ? record['name'] : '',
    version: typeof record['version'] === 'string' ? record['version'] : '',
    digest: typeof record['digest'] === 'string' ? record['digest'] : '',
  };
  if (!isArtifactPin(pin)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STAGE, {
      message: `${context}: invalid artifact pin: ${JSON.stringify(value)} (namespace/name neutral ids, semver version and sha256 digest required)`,
    });
  }
  return deepFreeze({
    ...pin,
    version: toCertificationVersion(pin.version, `${context} version`),
    digest: toContentDigest(pin.digest, `${context} digest`),
  });
}

/**
 * One suite stage: the closed kind plus the pin fields that kind
 * requires (strict shape — a stage carrying a foreign kind's field is
 * rejected, and so is a stage missing its own kind's pins).
 */
export interface CertificationStage {
  readonly stageId: string;
  readonly kind: CertificationStageKind;
  /** evaluation: the pinned A012 evaluator descriptor digest. */
  readonly evaluatorRef: ContentDigest | null;
  /** evaluation: the pinned A012 criteria digest. */
  readonly criteriaRef: ContentDigest | null;
  /** verification: the pinned A013 verifier descriptor digest. */
  readonly verifierRef: ContentDigest | null;
  /** compatibility: the pinned required test-suite artifact refs (may be empty). */
  readonly requiredTestSuites: readonly ArtifactPin[];
  /** dataset: the pinned A014 dataset manifest artifact ref. */
  readonly datasetRef: ArtifactPin | null;
  /** composition: the pinned environment requirement (id + version), when declared. */
  readonly environmentRequirement: { readonly environmentId: string; readonly environmentVersion: string } | null;
  /** composition: the pinned runtime requirement (id + version), when declared. */
  readonly runtimeRequirement: { readonly runtimeId: string; readonly runtimeVersion: string } | null;
}

/** Stable field list for a suite stage (tests + contracts mirror it). */
export const CERTIFICATION_STAGE_FIELDS = Object.freeze([
  'stageId',
  'kind',
  'evaluatorRef',
  'criteriaRef',
  'verifierRef',
  'requiredTestSuites',
  'datasetRef',
  'environmentRequirement',
  'runtimeRequirement',
] as const) as readonly string[];

function isIdVersionPin(
  value: unknown,
  idField: string,
): value is { environmentId: string; environmentVersion: string } | { runtimeId: string; runtimeVersion: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate[idField] === 'string' &&
    isNeutralId(candidate[idField]) &&
    isCertificationVersion(candidate['environmentVersion'] ?? candidate['runtimeVersion'] ?? '')
  );
}

function toStage(value: unknown, index: number): CertificationStage {
  const context = `certification suite stage ${index + 1}`;
  const record = expectFields(
    value,
    [
      'stageId',
      'kind',
      'evaluatorRef',
      'criteriaRef',
      'verifierRef',
      'requiredTestSuites',
      'datasetRef',
      'environmentRequirement',
      'runtimeRequirement',
    ],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_STAGE,
    context,
  );
  const stageId = typeof record['stageId'] === 'string' ? record['stageId'] : '';
  if (!isCertificationId(stageId)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STAGE, {
      message: `${context}: invalid stage id: ${JSON.stringify(record['stageId'])}`,
      details: { pattern: SUITE_ID_PATTERN_SOURCE },
    });
  }
  const kind = record['kind'];
  if (!isCertificationStageKind(kind)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STAGE, {
      message: `${context}: unknown stage kind: ${JSON.stringify(kind)} (closed vocabulary: ${CERTIFICATION_STAGE_KINDS.join(' | ')})`,
      details: { known: [...CERTIFICATION_STAGE_KINDS] },
    });
  }

  const refOrEmpty = (value: unknown): string => {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value !== 'string') return '';
    return value;
  };
  const evaluatorRef = refOrEmpty(record['evaluatorRef']);
  const criteriaRef = refOrEmpty(record['criteriaRef']);
  const verifierRef = refOrEmpty(record['verifierRef']);

  const testSuiteList = Array.isArray(record['requiredTestSuites'])
    ? (record['requiredTestSuites'] as unknown[])
    : [];
  if (testSuiteList.length === 0 && !Array.isArray(record['requiredTestSuites'])) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STAGE, {
      message: `${context}: requiredTestSuites must be an array`,
    });
  }
  const requiredTestSuites = testSuiteList.map((entry) =>
    toArtifactPin(entry, `${context} requiredTestSuites`),
  );
  const seenSuites = new Set<string>();
  for (const pin of requiredTestSuites) {
    const key = `${pin.namespace}/${pin.name}@${pin.version}#${pin.digest}`;
    if (seenSuites.has(key)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STAGE, {
        message: `${context}: duplicate required test suite ${key}`,
      });
    }
    seenSuites.add(key);
  }

  const datasetRef =
    record['datasetRef'] === null || record['datasetRef'] === undefined
      ? null
      : toArtifactPin(record['datasetRef'], `${context} datasetRef`);

  const environmentRequirement =
    record['environmentRequirement'] === null || record['environmentRequirement'] === undefined
      ? null
      : toEnvironmentRequirement(record['environmentRequirement'], context);
  const runtimeRequirement =
    record['runtimeRequirement'] === null || record['runtimeRequirement'] === undefined
      ? null
      : toRuntimeRequirement(record['runtimeRequirement'], context);

  // Per-kind pin requirements (strict: foreign pins rejected, own pins required).
  if (kind === 'evaluation') {
    if (evaluatorRef === '' || criteriaRef === '') {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STAGE, {
        message: `${context}: an evaluation stage requires BOTH evaluatorRef and criteriaRef pins`,
      });
    }
  } else if (evaluatorRef !== '' || criteriaRef !== '') {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STAGE, {
      message: `${context}: only evaluation stages carry evaluatorRef/criteriaRef pins`,
    });
  }
  if (kind === 'verification') {
    if (verifierRef === '') {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STAGE, {
        message: `${context}: a verification stage requires a verifierRef pin`,
      });
    }
  } else if (verifierRef !== '') {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STAGE, {
      message: `${context}: only verification stages carry a verifierRef pin`,
    });
  }
  if (kind === 'dataset') {
    if (datasetRef === null) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STAGE, {
        message: `${context}: a dataset stage requires a datasetRef pin`,
      });
    }
  } else if (datasetRef !== null) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STAGE, {
      message: `${context}: only dataset stages carry a datasetRef pin`,
    });
  }
  if (
    kind !== 'composition' &&
    (environmentRequirement !== null || runtimeRequirement !== null)
  ) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STAGE, {
      message: `${context}: only composition stages carry environment/runtime requirements`,
    });
  }
  if (kind === 'composition' && environmentRequirement === null && runtimeRequirement === null) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STAGE, {
      message: `${context}: a composition stage requires at least one of environmentRequirement / runtimeRequirement`,
    });
  }

  return deepFreeze({
    stageId,
    kind,
    evaluatorRef: evaluatorRef === '' ? null : toContentDigest(evaluatorRef, `${context} evaluatorRef`),
    criteriaRef: criteriaRef === '' ? null : toContentDigest(criteriaRef, `${context} criteriaRef`),
    verifierRef: verifierRef === '' ? null : toContentDigest(verifierRef, `${context} verifierRef`),
    requiredTestSuites: Object.freeze([...requiredTestSuites]),
    datasetRef,
    environmentRequirement,
    runtimeRequirement,
  });
}

function toEnvironmentRequirement(
  value: unknown,
  context: string,
): { readonly environmentId: string; readonly environmentVersion: string } {
  const record = expectFields(
    value,
    ['environmentId', 'environmentVersion'],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_STAGE,
    `${context} environmentRequirement`,
  );
  const requirement = {
    environmentId: typeof record['environmentId'] === 'string' ? record['environmentId'] : '',
    environmentVersion:
      typeof record['environmentVersion'] === 'string' ? record['environmentVersion'] : '',
  };
  if (!isIdVersionPin(requirement, 'environmentId') || !isCertificationVersion(requirement.environmentVersion)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STAGE, {
      message: `${context} environmentRequirement: environmentId must be a neutral id and environmentVersion a semver string`,
    });
  }
  return deepFreeze({
    environmentId: toNeutralId(requirement.environmentId, `${context} environmentRequirement environmentId`),
    environmentVersion: toCertificationVersion(
      requirement.environmentVersion,
      `${context} environmentRequirement environmentVersion`,
    ),
  });
}

function toRuntimeRequirement(
  value: unknown,
  context: string,
): { readonly runtimeId: string; readonly runtimeVersion: string } {
  const record = expectFields(
    value,
    ['runtimeId', 'runtimeVersion'],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_STAGE,
    `${context} runtimeRequirement`,
  );
  const requirement = {
    runtimeId: typeof record['runtimeId'] === 'string' ? record['runtimeId'] : '',
    runtimeVersion: typeof record['runtimeVersion'] === 'string' ? record['runtimeVersion'] : '',
  };
  if (!isIdVersionPin(requirement, 'runtimeId') || !isCertificationVersion(requirement.runtimeVersion)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STAGE, {
      message: `${context} runtimeRequirement: runtimeId must be a neutral id and runtimeVersion a semver string`,
    });
  }
  return deepFreeze({
    runtimeId: toNeutralId(requirement.runtimeId, `${context} runtimeRequirement runtimeId`),
    runtimeVersion: toCertificationVersion(
      requirement.runtimeVersion,
      `${context} runtimeRequirement runtimeVersion`,
    ),
  });
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** Provenance of the suite declaration. */
export interface SuiteProvenance {
  readonly authoredBy: NeutralId;
  readonly submittedAt: CertificationTimestamp;
  readonly notes: NeutralText | null;
}

/** Stable field list for suite provenance (tests + contracts mirror it). */
export const SUITE_PROVENANCE_FIELDS = Object.freeze([
  'authoredBy',
  'submittedAt',
  'notes',
] as const) as readonly string[];

/** Structural (non-throwing) check for suite provenance. */
export function isSuiteProvenance(value: unknown): value is SuiteProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['authoredBy']) &&
    isCertificationTimestamp(candidate['submittedAt']) &&
    (candidate['notes'] === null || isNeutralText(candidate['notes']))
  );
}

function toSuiteProvenance(value: unknown): SuiteProvenance {
  const record = expectFields(
    value,
    ['authoredBy', 'submittedAt', 'notes'],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_PROVENANCE,
    'certification suite provenance',
  );
  const notes = record['notes'];
  if (notes !== null && typeof notes !== 'string') {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'certification suite provenance: notes must be neutral text or null',
    });
  }
  return deepFreeze({
    authoredBy: toNeutralId(
      typeof record['authoredBy'] === 'string' ? record['authoredBy'] : '',
      'certification suite provenance authoredBy',
    ),
    submittedAt: toCertificationTimestamp(
      typeof record['submittedAt'] === 'string' ? record['submittedAt'] : '',
      'certification suite provenance submittedAt',
    ),
    notes: notes === null ? null : toNeutralText(notes, 'certification suite provenance notes'),
  });
}

// ---------------------------------------------------------------------------
// CertificationSuite
// ---------------------------------------------------------------------------

/** The mandated default professional-limitations notice (quality-model, R46). */
export const DEFAULT_CERTIFICATION_LIMITATIONS =
  'Certification does not grant a legal license, professional registration, sign-off authority or authority to practice where external law or regulation requires it.';

/** The digest-free view — exactly what the suite digest commits to. */
export interface CertificationSuiteView {
  readonly recordVersion: typeof CERTIFICATION_SUITE_VERSION;
  readonly suiteId: string;
  readonly version: CertificationVersion;
  readonly levelGrant: CertificationGrantLevel;
  readonly stages: readonly CertificationStage[];
  readonly constraints: readonly string[];
  readonly limitations: NeutralText | null;
  readonly supersedes: ContentDigest | null;
  readonly inputSchema: SchemaRef;
  readonly outputSchema: SchemaRef;
  readonly provenance: SuiteProvenance;
}

/** A frozen, content-addressed certification suite: the view plus its sha256 digest. */
export interface CertificationSuite extends CertificationSuiteView {
  readonly digest: ContentDigest;
}

/** Stable field list for the suite view (tests + contracts mirror it). */
export const CERTIFICATION_SUITE_FIELDS = Object.freeze([
  'recordVersion',
  'suiteId',
  'version',
  'levelGrant',
  'stages',
  'constraints',
  'limitations',
  'supersedes',
  'inputSchema',
  'outputSchema',
  'provenance',
] as const) as readonly string[];

export interface CreateCertificationSuiteInput {
  readonly suiteId: string;
  readonly version: string;
  readonly levelGrant: string;
  readonly stages: readonly {
    readonly stageId: string;
    readonly kind: string;
    readonly evaluatorRef?: string | null;
    readonly criteriaRef?: string | null;
    readonly verifierRef?: string | null;
    readonly requiredTestSuites?: readonly ArtifactPin[];
    readonly datasetRef?: ArtifactPin | null;
    readonly environmentRequirement?: { readonly environmentId: string; readonly environmentVersion: string } | null;
    readonly runtimeRequirement?: { readonly runtimeId: string; readonly runtimeVersion: string } | null;
  }[];
  readonly constraints: readonly string[];
  readonly limitations: string | null;
  readonly supersedes: string | null;
  readonly inputSchema: SchemaRef;
  readonly outputSchema: SchemaRef;
  readonly provenance: {
    readonly authoredBy: string;
    readonly submittedAt: string;
    readonly notes: string | null;
  };
}

/** Structural (non-throwing) check for the digest-free view. */
export function isCertificationSuiteView(value: unknown): value is CertificationSuiteView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === CERTIFICATION_SUITE_VERSION &&
    isCertificationId(candidate['suiteId']) &&
    isCertificationVersion(candidate['version']) &&
    isCertificationGrantLevel(candidate['levelGrant']) &&
    Array.isArray(candidate['stages']) &&
    (candidate['stages'] as unknown[]).length > 0 &&
    (candidate['stages'] as unknown[]).every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        isCertificationStageKind((entry as Record<string, unknown>)['kind']),
    ) &&
    Array.isArray(candidate['constraints']) &&
    (candidate['constraints'] as unknown[]).every(
      (entry) => typeof entry === 'string' && entry.length > 0,
    ) &&
    (candidate['limitations'] === null || isNeutralText(candidate['limitations'])) &&
    (candidate['supersedes'] === null || isContentDigest(candidate['supersedes'])) &&
    isSchemaRef(candidate['inputSchema']) &&
    isSchemaRef(candidate['outputSchema']) &&
    isSuiteProvenance(candidate['provenance'])
  );
}

/** Structural (non-throwing) check for the full suite (view + digest). */
export function isCertificationSuite(value: unknown): value is CertificationSuite {
  if (!isCertificationSuiteView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed certification
 * suite. Rejects unknown stage kinds, duplicate stage ids, per-kind pin
 * violations (missing own pins / foreign pins), duplicate test-suite
 * pins, unknown grant levels, malformed provenance and unknown fields —
 * all with typed CertificationErrors.
 */
export async function createCertificationSuite(
  input: CreateCertificationSuiteInput,
): Promise<CertificationSuite> {
  const record = expectFields(
    input,
    [
      'suiteId',
      'version',
      'levelGrant',
      'stages',
      'constraints',
      'limitations',
      'supersedes',
      'inputSchema',
      'outputSchema',
      'provenance',
    ],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_SUITE,
    'certification suite',
  );

  if (!isCertificationId(record['suiteId'])) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUITE, {
      message: `certification suite: invalid suite id: ${JSON.stringify(record['suiteId'])}`,
      details: { pattern: SUITE_ID_PATTERN_SOURCE },
    });
  }

  const stagesInput = record['stages'];
  if (!Array.isArray(stagesInput) || stagesInput.length === 0) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUITE, {
      message: 'certification suite: at least one stage is required (an empty suite certifies nothing)',
    });
  }
  const stages = stagesInput.map((entry, index) => toStage(entry, index));
  const seen = new Set<string>();
  for (const stage of stages) {
    if (seen.has(stage.stageId)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.DUPLICATE_STAGE, {
        message: `certification suite: duplicate stage id ${JSON.stringify(stage.stageId)} (stage ids are unique within a suite)`,
        details: { stageId: stage.stageId },
      });
    }
    seen.add(stage.stageId);
  }

  const constraints = Array.isArray(record['constraints'])
    ? (record['constraints'] as unknown[]).map((entry, index) =>
        typeof entry === 'string' && entry.length > 0
          ? toNeutralText(entry, `certification suite constraint ${index + 1}`)
          : (() => {
              throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUITE, {
                message: `certification suite constraint ${index + 1}: constraints must be non-empty neutral text`,
              });
            })(),
      )
    : [];
  const seenConstraints = new Set<string>();
  for (const constraint of constraints) {
    if (seenConstraints.has(constraint)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUITE, {
        message: `certification suite: duplicate constraint ${JSON.stringify(constraint)}`,
      });
    }
    seenConstraints.add(constraint);
  }

  const limitationsRaw = record['limitations'];
  const limitations =
    limitationsRaw === null || limitationsRaw === undefined
      ? null
      : toNeutralText(
          typeof limitationsRaw === 'string' ? limitationsRaw : '',
          'certification suite limitations',
        );

  const view: CertificationSuiteView = {
    recordVersion: CERTIFICATION_SUITE_VERSION,
    suiteId: record['suiteId'] as string,
    version: toCertificationVersion(
      typeof record['version'] === 'string' ? record['version'] : '',
      'certification suite version',
    ),
    levelGrant: toCertificationGrantLevel(
      typeof record['levelGrant'] === 'string' ? record['levelGrant'] : '',
      'certification suite levelGrant',
    ),
    stages: Object.freeze([...stages]),
    constraints: Object.freeze([...constraints]),
    limitations,
    supersedes: toOptionalContentDigest(
      record['supersedes'],
      'certification suite supersedes',
    ),
    inputSchema: toSchemaRefValue(
      (isSchemaRef(record['inputSchema'])
        ? record['inputSchema']
        : { namespace: '', name: '', version: '' }) as SchemaRef,
    ),
    outputSchema: toSchemaRefValue(
      (isSchemaRef(record['outputSchema'])
        ? record['outputSchema']
        : { namespace: '', name: '', version: '' }) as SchemaRef,
    ),
    provenance: toSuiteProvenance(record['provenance']),
  };
  const digest = toContentDigest(await digestCanonical(view), 'certification suite digest');
  return deepFreeze({ ...view, digest }) as CertificationSuite;
}

/** The digest-free view of a suite (what the digest commits to). */
export function certificationSuiteView(suite: CertificationSuite): CertificationSuiteView {
  const { digest: _digest, ...view } = suite;
  return deepFreeze({ ...view }) as CertificationSuiteView;
}

/**
 * Recompute the suite digest over the digest-free view and compare.
 * Throws CERTIFICATION_TAMPERED on any mismatch.
 */
export async function recomputeCertificationSuiteDigest(
  suite: CertificationSuite,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isCertificationSuite(suite)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUITE, {
      message: 'suite digest recomputation requires a structurally valid certification suite',
    });
  }
  const actual = await digestCanonical(certificationSuiteView(suite));
  if (actual !== suite.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.TAMPERED, {
      message: `certification suite digest mismatch: expected ${expectedDigest ?? suite.digest}, got ${actual}`,
      details: {
        suiteId: suite.suiteId,
        version: suite.version,
        expected: expectedDigest ?? suite.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed suite digest');
}

/**
 * The suite identity key — "suiteId@version". The reference registry
 * keys duplicate detection on this pair: registering a DIFFERENT suite
 * digest under the same identity is a version conflict (changing a
 * suite requires a new version — the assessor-versioning rule).
 */
export function certificationSuiteIdentityKey(suite: CertificationSuite): string {
  return `${suite.suiteId}@${suite.version}`;
}
