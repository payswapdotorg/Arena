/**
 * EvaluatorDescriptor — the content-addressed, versioned DECLARATION of
 * an evaluator (Work Order A012 gate 2; spec EV1.0: "Every evaluator has
 * id/version, inputs, criteria, output schema, reproducibility
 * characteristics, confidence/limitations and provenance";
 * architecture-lock rule 12 — public artifacts are explicitly published
 * and versioned; spec/quality-model.md — "Changing an evaluator requires
 * a new version and cannot be treated as a pure model improvement").
 *
 * A descriptor binds:
 *   - `evaluatorId` + `version` — the evaluator's own versioned
 *     identity. Because the descriptor is content-addressed, ANY change
 *     to ANY field changes the digest; registering a different
 *     descriptor under the same (evaluatorId, version) is an identity
 *     conflict in the reference registry (services/evaluation) — the
 *     enforcement point of "any change ⇒ a new version";
 *   - `kind` — the CLOSED evaluator-type vocabulary of EV1.0
 *     (evaluator-kind.ts; unknown kinds are rejected);
 *   - `inputs` — the input contract: MANDATORY digest refs to the
 *     A005 CapabilityCase judged and the A011 TrajectoryRecord judged,
 *     plus OPTIONAL body/substrate digest refs (A003 BodyVersion /
 *     A016 substrate — a model is a cognitive substrate, NOT the durable
 *     identity of a professional Agent Body). The referenced types are
 *     bound by DIGEST, never redefined here;
 *   - `criteriaRef` — the digest of the EvaluationCriteria this
 *     evaluator judges against (gate 3 objects);
 *   - `outputSchema` — a versioned SchemaRef naming the evaluator's
 *     output schema (the reference evaluators pin
 *     arena:schema/evaluation/evaluation-record@1.0.0);
 *   - `reproducibility` — deterministic? seeded? requires-human?
 *     (a deterministic evaluator cannot require human judgment —
 *     rejected at construction, a quality-model consistency rule);
 *   - `confidence` — calibrated confidence in this evaluator's
 *     judgments, a finite number in [0, 1];
 *   - `limitations` — the known blind spots (quality model: known blind
 *     spots, contamination caveats — always stated, never implied);
 *   - `provenance` — who authored the evaluator, when, and with what
 *     notes.
 *
 * Content addressing: the sha256 digest is computed over the canonical
 * JSON of the digest-free view with @arena/protocol-core's
 * digestCanonical — NEVER reimplemented here. Same descriptor ⇒ same
 * digest (gate 2 test); deep-frozen at creation — there is NO mutation
 * API (gate 2 negative test).
 */

import { digestCanonical } from '@arena/protocol-core';
import type { SchemaRef } from '@arena/protocol-core';
import { EVALUATION_ERROR_CODES, EvaluationError } from './errors.js';
import type { EvaluatorKind } from './evaluator-kind.js';
import { isEvaluatorKind, toEvaluatorKind } from './evaluator-kind.js';
import {
  deepFreeze,
  expectFields,
  expectNumberInRange,
  isContentDigest,
  isNeutralId,
  isNeutralText,
  isEvaluationTimestamp,
  isEvaluationVersion,
  toContentDigest,
  toNeutralId,
  toNeutralText,
  toEvaluationTimestamp,
  toEvaluationVersion,
  toOutputSchemaRef,
} from './shared.js';
import type { ContentDigest, EvaluationVersion, NeutralId, NeutralText, EvaluationTimestamp } from './shared.js';
import { isSchemaRef } from '@arena/protocol-core';

/** Wire version of the evaluator-descriptor shape. */
export const EVALUATOR_DESCRIPTOR_VERSION = 1 as const;

/** Identity charset for evaluator ids (closed, neutral). */
export const EVALUATOR_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';

const EVALUATOR_ID_PATTERN = new RegExp(EVALUATOR_ID_PATTERN_SOURCE);

function toEvaluatorId(value: string): NeutralId {
  if (typeof value !== 'string' || !EVALUATOR_ID_PATTERN.test(value)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `evaluator descriptor: invalid evaluator id: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { pattern: EVALUATOR_ID_PATTERN_SOURCE },
    });
  }
  return value as NeutralId;
}

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

/**
 * The evaluator's input contract: digest refs to the objects an
 * evaluation run must resolve. The A005 CapabilityCase digest and the
 * A011 TrajectoryRecord digest (its chain head) are MANDATORY; body and
 * substrate refs are OPTIONAL pins (null when the evaluator does not
 * bind them).
 */
export interface EvaluatorInputContract {
  /** Digest of the A005 CapabilityCase being judged (never redefined here). */
  readonly caseRef: ContentDigest;
  /** Digest of the A011 TrajectoryRecord being judged (its chain head). */
  readonly trajectoryRef: ContentDigest;
  /** Optional A003 BodyVersion digest pin (null when unbound). */
  readonly bodyRef: ContentDigest | null;
  /** Optional A016 substrate digest pin (null when unbound). */
  readonly substrateRef: ContentDigest | null;
}

/** Stable field list for the input contract (tests + contracts mirror it). */
export const EVALUATOR_INPUT_FIELDS = Object.freeze([
  'caseRef',
  'trajectoryRef',
  'bodyRef',
  'substrateRef',
] as const) as readonly string[];

export interface EvaluatorInputContractInput {
  readonly caseRef: string;
  readonly trajectoryRef: string;
  readonly bodyRef: string | null;
  readonly substrateRef: string | null;
}

/** Structural (non-throwing) check for the input contract. */
export function isEvaluatorInputContract(value: unknown): value is EvaluatorInputContract {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isContentDigest(candidate['caseRef']) &&
    isContentDigest(candidate['trajectoryRef']) &&
    (candidate['bodyRef'] === null || isContentDigest(candidate['bodyRef'])) &&
    (candidate['substrateRef'] === null || isContentDigest(candidate['substrateRef']))
  );
}

function toEvaluatorInputContract(value: unknown): EvaluatorInputContract {
  const record = expectFields(
    value,
    ['caseRef', 'trajectoryRef', 'bodyRef', 'substrateRef'],
    [],
    EVALUATION_ERROR_CODES.INVALID_INPUT_CONTRACT,
    'evaluator input contract',
  );
  const bodyRef = record['bodyRef'];
  const substrateRef = record['substrateRef'];
  if (bodyRef !== null && typeof bodyRef !== 'string') {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_INPUT_CONTRACT, {
      message: 'evaluator input contract: bodyRef must be a content digest or null',
    });
  }
  if (substrateRef !== null && typeof substrateRef !== 'string') {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_INPUT_CONTRACT, {
      message: 'evaluator input contract: substrateRef must be a content digest or null',
    });
  }
  return deepFreeze({
    caseRef: toContentDigest(
      typeof record['caseRef'] === 'string' ? record['caseRef'] : '',
      'evaluator input contract caseRef',
    ),
    trajectoryRef: toContentDigest(
      typeof record['trajectoryRef'] === 'string' ? record['trajectoryRef'] : '',
      'evaluator input contract trajectoryRef',
    ),
    bodyRef: bodyRef === null ? null : toContentDigest(bodyRef, 'evaluator input contract bodyRef'),
    substrateRef:
      substrateRef === null
        ? null
        : toContentDigest(substrateRef, 'evaluator input contract substrateRef'),
  });
}

// ---------------------------------------------------------------------------
// Reproducibility characteristics
// ---------------------------------------------------------------------------

/**
 * Reproducibility characteristics (EV1.0): deterministic? seeded?
 * requires-human? A deterministic evaluator CANNOT require human
 * judgment — that combination is rejected at construction (human
 * judgment is not reproducible by re-run; spec/quality-model.md score
 * stability under rerun).
 */
export interface EvaluatorReproducibility {
  readonly deterministic: boolean;
  readonly seeded: boolean;
  readonly requiresHuman: boolean;
}

/** Stable field list for reproducibility (tests + contracts mirror it). */
export const EVALUATOR_REPRODUCIBILITY_FIELDS = Object.freeze([
  'deterministic',
  'seeded',
  'requiresHuman',
] as const) as readonly string[];

/** Structural (non-throwing) check for reproducibility characteristics. */
export function isEvaluatorReproducibility(
  value: unknown,
): value is EvaluatorReproducibility {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['deterministic'] === 'boolean' &&
    typeof candidate['seeded'] === 'boolean' &&
    typeof candidate['requiresHuman'] === 'boolean'
  );
}

function toEvaluatorReproducibility(value: unknown): EvaluatorReproducibility {
  const record = expectFields(
    value,
    ['deterministic', 'seeded', 'requiresHuman'],
    [],
    EVALUATION_ERROR_CODES.INVALID_REPRODUCIBILITY,
    'evaluator reproducibility',
  );
  const deterministic = record['deterministic'];
  const seeded = record['seeded'];
  const requiresHuman = record['requiresHuman'];
  if (typeof deterministic !== 'boolean' || typeof seeded !== 'boolean' || typeof requiresHuman !== 'boolean') {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_REPRODUCIBILITY, {
      message: 'evaluator reproducibility: deterministic, seeded and requiresHuman must all be booleans',
      details: {
        deterministic: typeof deterministic,
        seeded: typeof seeded,
        requiresHuman: typeof requiresHuman,
      },
    });
  }
  if (deterministic && requiresHuman) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_REPRODUCIBILITY, {
      message:
        'evaluator reproducibility: a deterministic evaluator cannot require human judgment (human judgment is not reproducible under rerun — spec/quality-model.md score stability)',
      details: { deterministic, requiresHuman },
    });
  }
  return Object.freeze({ deterministic, seeded, requiresHuman });
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** Provenance of the evaluator declaration (EV1.0 "provenance"). */
export interface EvaluatorProvenance {
  /** Neutral identity of the authoring principal (expert, org, pipeline). */
  readonly authoredBy: NeutralId;
  /** When the descriptor was authored (ms-precision UTC). */
  readonly submittedAt: EvaluationTimestamp;
  /** Optional free-form notes (method, data sources, review state). */
  readonly notes: NeutralText | null;
}

/** Stable field list for provenance (tests + contracts mirror it). */
export const EVALUATOR_PROVENANCE_FIELDS = Object.freeze([
  'authoredBy',
  'submittedAt',
  'notes',
] as const) as readonly string[];

/** Structural (non-throwing) check for provenance. */
export function isEvaluatorProvenance(value: unknown): value is EvaluatorProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['authoredBy']) &&
    isEvaluationTimestamp(candidate['submittedAt']) &&
    (candidate['notes'] === null || isNeutralText(candidate['notes']))
  );
}

function toEvaluatorProvenance(value: unknown): EvaluatorProvenance {
  const record = expectFields(
    value,
    ['authoredBy', 'submittedAt', 'notes'],
    [],
    EVALUATION_ERROR_CODES.INVALID_PROVENANCE,
    'evaluator provenance',
  );
  const notes = record['notes'];
  if (notes !== null && typeof notes !== 'string') {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'evaluator provenance: notes must be neutral text or null',
    });
  }
  return deepFreeze({
    authoredBy: toNeutralId(
      typeof record['authoredBy'] === 'string' ? record['authoredBy'] : '',
      'evaluator provenance authoredBy',
    ),
    submittedAt: toEvaluationTimestamp(
      typeof record['submittedAt'] === 'string' ? record['submittedAt'] : '',
      'evaluator provenance submittedAt',
    ),
    notes: notes === null ? null : toNeutralText(notes, 'evaluator provenance notes'),
  });
}

// ---------------------------------------------------------------------------
// EvaluatorDescriptor
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the descriptor digest commits to. */
export interface EvaluatorDescriptorView {
  readonly recordVersion: typeof EVALUATOR_DESCRIPTOR_VERSION;
  readonly evaluatorId: NeutralId;
  readonly version: EvaluationVersion;
  readonly kind: EvaluatorKind;
  readonly inputs: EvaluatorInputContract;
  readonly criteriaRef: ContentDigest;
  readonly outputSchema: SchemaRef;
  readonly reproducibility: EvaluatorReproducibility;
  readonly confidence: number;
  readonly limitations: NeutralText;
  readonly provenance: EvaluatorProvenance;
}

/** A frozen, content-addressed evaluator descriptor: the view plus its sha256 digest. */
export interface EvaluatorDescriptor extends EvaluatorDescriptorView {
  readonly digest: ContentDigest;
}

/** Stable field list for the descriptor view (tests + contracts mirror it). */
export const EVALUATOR_DESCRIPTOR_FIELDS = Object.freeze([
  'recordVersion',
  'evaluatorId',
  'version',
  'kind',
  'inputs',
  'criteriaRef',
  'outputSchema',
  'reproducibility',
  'confidence',
  'limitations',
  'provenance',
] as const) as readonly string[];

export interface CreateEvaluatorDescriptorInput {
  readonly evaluatorId: string;
  readonly version: string;
  readonly kind: string;
  readonly inputs: EvaluatorInputContractInput;
  readonly criteriaRef: string;
  readonly outputSchema: SchemaRef;
  readonly reproducibility: {
    readonly deterministic: boolean;
    readonly seeded: boolean;
    readonly requiresHuman: boolean;
  };
  readonly confidence: number;
  readonly limitations: string;
  readonly provenance: {
    readonly authoredBy: string;
    readonly submittedAt: string;
    readonly notes: string | null;
  };
}

/** Structural (non-throwing) check for the digest-free view. */
export function isEvaluatorDescriptorView(value: unknown): value is EvaluatorDescriptorView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === EVALUATOR_DESCRIPTOR_VERSION &&
    isNeutralId(candidate['evaluatorId']) &&
    isEvaluationVersion(candidate['version']) &&
    isEvaluatorKind(candidate['kind']) &&
    isEvaluatorInputContract(candidate['inputs']) &&
    isContentDigest(candidate['criteriaRef']) &&
    isSchemaRef(candidate['outputSchema']) &&
    isEvaluatorReproducibility(candidate['reproducibility']) &&
    typeof candidate['confidence'] === 'number' &&
    Number.isFinite(candidate['confidence']) &&
    candidate['confidence'] >= 0 &&
    candidate['confidence'] <= 1 &&
    isNeutralText(candidate['limitations']) &&
    isEvaluatorProvenance(candidate['provenance'])
  );
}

/** Structural (non-throwing) check for the full descriptor (view + digest). */
export function isEvaluatorDescriptor(value: unknown): value is EvaluatorDescriptor {
  if (!isEvaluatorDescriptorView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed evaluator
 * descriptor. Rejects unknown kinds (closed enum), malformed input
 * contracts, contradictory reproducibility characteristics, out-of-range
 * confidence, malformed provenance and unknown fields — all with typed
 * EvaluationErrors.
 */
export async function createEvaluatorDescriptor(
  input: CreateEvaluatorDescriptorInput,
): Promise<EvaluatorDescriptor> {
  const record = expectFields(
    input,
    [
      'evaluatorId',
      'version',
      'kind',
      'inputs',
      'criteriaRef',
      'outputSchema',
      'reproducibility',
      'confidence',
      'limitations',
      'provenance',
    ],
    [],
    EVALUATION_ERROR_CODES.INVALID_DESCRIPTOR,
    'evaluator descriptor',
  );

  const kind = toEvaluatorKind(
    typeof record['kind'] === 'string' ? record['kind'] : '',
    'evaluator descriptor',
  );
  const confidence = expectNumberInRange(
    record['confidence'],
    'confidence',
    0,
    1,
    EVALUATION_ERROR_CODES.INVALID_DESCRIPTOR,
    'evaluator descriptor',
  );

  const view: EvaluatorDescriptorView = {
    recordVersion: EVALUATOR_DESCRIPTOR_VERSION,
    evaluatorId: toEvaluatorId(
      typeof record['evaluatorId'] === 'string' ? record['evaluatorId'] : '',
    ),
    version: toEvaluationVersion(
      typeof record['version'] === 'string' ? record['version'] : '',
      'evaluator descriptor version',
    ),
    kind,
    inputs: toEvaluatorInputContract(record['inputs']),
    criteriaRef: toContentDigest(
      typeof record['criteriaRef'] === 'string' ? record['criteriaRef'] : '',
      'evaluator descriptor criteriaRef',
    ),
    outputSchema: toOutputSchemaRef(
      (isSchemaRef(record['outputSchema']) ? record['outputSchema'] : { namespace: '', name: '', version: '' }) as SchemaRef,
    ),
    reproducibility: toEvaluatorReproducibility(record['reproducibility']),
    confidence,
    limitations: toNeutralText(
      typeof record['limitations'] === 'string' ? record['limitations'] : '',
      'evaluator descriptor limitations',
    ),
    provenance: toEvaluatorProvenance(record['provenance']),
  };
  const digest = toContentDigest(await digestCanonical(view), 'evaluator descriptor digest');
  return deepFreeze({ ...view, digest }) as EvaluatorDescriptor;
}

/** The digest-free view of a descriptor (what the digest commits to). */
export function evaluatorDescriptorView(
  descriptor: EvaluatorDescriptor,
): EvaluatorDescriptorView {
  const { digest: _digest, ...view } = descriptor;
  return deepFreeze({ ...view }) as EvaluatorDescriptorView;
}

/**
 * Recompute the descriptor digest over the digest-free view and compare
 * (optionally against an expected digest). Throws EVALUATION_TAMPERED on
 * any mismatch.
 */
export async function recomputeEvaluatorDescriptorDigest(
  descriptor: EvaluatorDescriptor,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isEvaluatorDescriptor(descriptor)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: 'descriptor digest recomputation requires a structurally valid evaluator descriptor',
    });
  }
  const actual = await digestCanonical(evaluatorDescriptorView(descriptor));
  if (actual !== descriptor.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.TAMPERED, {
      message: `evaluator descriptor digest mismatch: expected ${expectedDigest ?? descriptor.digest}, got ${actual}`,
      details: {
        evaluatorId: descriptor.evaluatorId,
        version: descriptor.version,
        expected: expectedDigest ?? descriptor.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed descriptor digest');
}

/**
 * The evaluator identity key — "evaluatorId@version". The reference
 * registry keys duplicate detection on this pair: registering a
 * DIFFERENT descriptor digest under the same identity is a version
 * conflict (spec/quality-model.md: changing an evaluator requires a new
 * version — same version, different bytes is a conflict, never a silent
 * improvement).
 */
export function evaluatorIdentityKey(descriptor: EvaluatorDescriptor): string {
  return `${descriptor.evaluatorId}@${descriptor.version}`;
}
