/**
 * The CalibrationProgram (Work Order C004) — a versioned, content-
 * addressed composition of calibration probes per capability.
 *
 * A program is the EV1.0 Certification-Suite discipline applied to
 * EXPERT calibration: each probe is PINNED to evaluator/verifier
 * criteria (id + version + criteria digest) with a DECLARED minimum
 * evidence requirement in the A007 evidence-kind vocabulary — so a
 * program run over identical inputs is reproducible by construction:
 *
 *   - probes are deterministically ordered (seeded ordering —
 *     capability key, then probe id) regardless of input order;
 *   - the program commits to its drift policy (minimum sample,
 *     tolerance, freshness window) and its requalification policy
 *     (freshness/validity windows + armed triggers) BY VALUE;
 *   - the program is content-addressed: same composition ⇒ same digest.
 *
 * The capability vocabulary is the A004 graph via the C003/C002 seams
 * (CapabilityNodeRefView, consumed from @arena/expert-qualification —
 * never redefined here).
 *
 * A PROGRAM IS MEASUREMENT DESIGN, NEVER AN ACCESS GRANT (lock rules
 * 9/35): authority-shaped field names are rejected at construction.
 */

import { digestCanonical } from '@arena/protocol-core';
import {
  isQualificationEvidenceKind,
  toCapabilityNodeRefView,
  capabilityNodeRefViewKey,
} from '@arena/expert-qualification';
import type { CapabilityNodeRefView, QualificationEvidenceKind } from '@arena/expert-qualification';
import { EXPERT_CALIBRATION_ERROR_CODES, ExpertCalibrationError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  expectNonEmptyString,
  screenFieldNames,
  toCalibrationContentDigest,
  toCalibrationNeutralText,
  toCalibrationProgramId,
  toCalibrationSeed,
  toCalibrationTimestamp,
} from './shared.js';
import type {
  CalibrationProgramId,
  CalibrationSeed,
  CalibrationTimestamp,
} from './shared.js';
import { createDriftPolicy } from './verdict.js';
import type { CreateDriftPolicyInput, DriftPolicyView } from './verdict.js';
import { createRequalificationPolicy } from './requalification.js';
import type { RequalificationPolicyView } from './requalification.js';

/** Wire version of the calibration-program shape. */
export const CALIBRATION_PROGRAM_VERSION = 1 as const;

/**
 * The evaluator types of spec/evaluation.md EV1.0 — the closed set a
 * probe's pinned evaluator may be drawn from.
 */
export const EVALUATOR_TYPES = Object.freeze([
  'deterministic-test',
  'model-based-evaluator',
  'expert-evaluator',
  'rubric-evaluator',
  'simulation-evaluator',
  'comparative-evaluator',
  'adversarial-evaluator',
] as const);

export type EvaluatorType = (typeof EVALUATOR_TYPES)[number];

export function isEvaluatorType(value: unknown): value is EvaluatorType {
  return typeof value === 'string' && (EVALUATOR_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

/** Wire version of the calibration-probe shape. */
export const CALIBRATION_PROBE_VERSION = 1 as const;

/**
 * One calibration probe: the capability it probes, the PINNED evaluator
 * criteria that elicits the expert's predicted confidence, and the
 * PINNED verifier criteria with the DECLARED minimum evidence the
 * later-observed outcome must rest on (EV1.0 Certification Suite
 * discipline: pass criteria + minimum evidence, per probe).
 */
export interface CalibrationProbe {
  readonly probeVersion: typeof CALIBRATION_PROBE_VERSION;
  readonly probeId: string;
  /** The capability the probe calibrates FOR (A004 graph vocabulary). */
  readonly capability: CapabilityNodeRefView;
  readonly evaluator: {
    readonly evaluatorType: EvaluatorType;
    readonly evaluatorVersion: string;
    /** Digest of the pinned evaluation criteria. */
    readonly criteriaDigest: string;
  };
  readonly verifier: {
    readonly verifierId: string;
    readonly verifierVersion: string;
    /** Digest of the pinned verification criteria. */
    readonly criteriaDigest: string;
    /** The DECLARED minimum evidence the observed outcome must rest on. */
    readonly minimumEvidence: {
      readonly evidenceKind: QualificationEvidenceKind;
      readonly minimumCount: number;
    };
  };
}

function toProbe(input: unknown): CalibrationProbe {
  const record = expectFields(
    input,
    ['probeId', 'capability', 'evaluator', 'verifier'],
    [],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROBE,
    'calibration probe',
  );
  const probeId = expectNonEmptyString(record['probeId'], 'probeId', EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROBE, 'calibration probe');
  const capability = toCapabilityNodeRefView(
    record['capability'] as { kind: string; id: string; version: string; digest: string },
  );

  const evaluator = expectFields(
    record['evaluator'],
    ['evaluatorType', 'evaluatorVersion', 'criteriaDigest'],
    [],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROBE,
    'calibration probe evaluator',
  );
  const evaluatorType = evaluator['evaluatorType'];
  if (!isEvaluatorType(evaluatorType)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROBE, {
      message: `calibration probe: evaluator.evaluatorType must be one of [${EVALUATOR_TYPES.join(', ')}], got: ${String(evaluatorType)}`,
      details: { known: [...EVALUATOR_TYPES] },
    });
  }

  const verifier = expectFields(
    record['verifier'],
    ['verifierId', 'verifierVersion', 'criteriaDigest', 'minimumEvidence'],
    [],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROBE,
    'calibration probe verifier',
  );
  const minimumEvidence = expectFields(
    verifier['minimumEvidence'],
    ['evidenceKind', 'minimumCount'],
    [],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROBE,
    'calibration probe verifier minimumEvidence',
  );
  const evidenceKind = minimumEvidence['evidenceKind'];
  if (!isQualificationEvidenceKind(evidenceKind)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROBE, {
      message: `calibration probe: minimumEvidence.evidenceKind must be an A007 qualification evidence kind, got: ${String(evidenceKind)}`,
    });
  }
  const minimumCount = minimumEvidence['minimumCount'];
  if (typeof minimumCount !== 'number' || !Number.isInteger(minimumCount) || minimumCount < 1) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROBE, {
      message: `calibration probe: minimumEvidence.minimumCount must be an integer >= 1, got ${String(minimumCount)}`,
    });
  }

  return deepFreeze({
    probeVersion: CALIBRATION_PROBE_VERSION,
    probeId,
    capability,
    evaluator: deepFreeze({
      evaluatorType,
      evaluatorVersion: expectNonEmptyString(evaluator['evaluatorVersion'], 'evaluatorVersion', EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROBE, 'calibration probe evaluator'),
      criteriaDigest: toCalibrationContentDigest(
        typeof evaluator['criteriaDigest'] === 'string' ? evaluator['criteriaDigest'] : '',
        'calibration probe evaluator criteriaDigest',
      ),
    }),
    verifier: deepFreeze({
      verifierId: expectNonEmptyString(verifier['verifierId'], 'verifierId', EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROBE, 'calibration probe verifier'),
      verifierVersion: expectNonEmptyString(verifier['verifierVersion'], 'verifierVersion', EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROBE, 'calibration probe verifier'),
      criteriaDigest: toCalibrationContentDigest(
        typeof verifier['criteriaDigest'] === 'string' ? verifier['criteriaDigest'] : '',
        'calibration probe verifier criteriaDigest',
      ),
      minimumEvidence: deepFreeze({
        evidenceKind,
        minimumCount,
      }),
    }),
  });
}

/** Stable ordering key for a probe: capability key, then probe id. */
export function calibrationProbeKey(probe: CalibrationProbe): string {
  return `${capabilityNodeRefViewKey(probe.capability)}|${probe.probeId}`;
}

// ---------------------------------------------------------------------------
// The program
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the program digest commits to. */
export interface CalibrationProgramView {
  readonly programVersion: typeof CALIBRATION_PROGRAM_VERSION;
  readonly programId: CalibrationProgramId;
  readonly tenant: string;
  /** The capability the program calibrates (the program's target). */
  readonly capability: CapabilityNodeRefView;
  /** The ordered probe composition (deterministic — seeded ordering). */
  readonly probes: readonly CalibrationProbe[];
  /** The drift policy verdicts are derived under. */
  readonly driftPolicy: DriftPolicyView;
  /** The requalification policy the program arms. */
  readonly requalificationPolicy: RequalificationPolicyView;
  /** The deterministic seed anchoring probe ordering + run reproducibility. */
  readonly seed: CalibrationSeed;
  readonly createdBy: string;
  readonly createdAt: CalibrationTimestamp;
  readonly note: string | null;
}

/** A frozen, content-addressed calibration program: the view plus its sha256 digest. */
export interface CalibrationProgram extends CalibrationProgramView {
  readonly digest: string;
}

export interface CreateCalibrationProgramInput {
  readonly programId: string;
  readonly tenant: string;
  readonly capability: { readonly kind: string; readonly id: string; readonly version: string; readonly digest: string };
  readonly probes: readonly {
    readonly probeId: string;
    readonly capability: { readonly kind: string; readonly id: string; readonly version: string; readonly digest: string };
    readonly evaluator: {
      readonly evaluatorType: string;
      readonly evaluatorVersion: string;
      readonly criteriaDigest: string;
    };
    readonly verifier: {
      readonly verifierId: string;
      readonly verifierVersion: string;
      readonly criteriaDigest: string;
      readonly minimumEvidence: { readonly evidenceKind: string; readonly minimumCount: number };
    };
  }[];
  readonly driftPolicy: {
    readonly minimumSample: number;
    readonly tolerance: number;
    readonly freshnessWindowDays: number;
  };
  readonly requalificationPolicy: {
    readonly freshnessWindowDays: number;
    readonly validityWindowDays: number;
    readonly triggers: readonly string[];
  };
  readonly seed: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly note?: string | null;
}

/**
 * Create a validated, deep-frozen, content-addressed calibration program.
 * Deterministic: probes are sorted by (capability key, probe id) — the
 * seeded ordering that makes a program run reproducible given identical
 * inputs. Rejects empty probe sets, duplicate probe ids, malformed
 * policies and authority-shaped fields with typed errors.
 */
export async function createCalibrationProgram(
  input: CreateCalibrationProgramInput,
): Promise<CalibrationProgram> {
  const record = expectFields(
    input,
    [
      'programId',
      'tenant',
      'capability',
      'probes',
      'driftPolicy',
      'requalificationPolicy',
      'seed',
      'createdBy',
      'createdAt',
    ],
    ['note'],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROGRAM,
    'calibration program',
  );

  const capability = toCapabilityNodeRefView(
    record['capability'] as { kind: string; id: string; version: string; digest: string },
  );
  const rawProbes = record['probes'];
  if (!Array.isArray(rawProbes) || rawProbes.length === 0) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROGRAM, {
      message: 'calibration program: probes must be a non-empty composition (an evidence-free program is structurally not a calibration)',
    });
  }
  const probes = rawProbes.map((entry) => toProbe(entry));
  const seen = new Set<string>();
  for (const probe of probes) {
    const key = calibrationProbeKey(probe);
    if (seen.has(key)) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROGRAM, {
        message: `calibration program: duplicate probe ${JSON.stringify(key)} — a composition pins each (capability, probe) pair exactly once`,
        details: { probe: key },
      });
    }
    seen.add(key);
  }
  // SEEDED ORDERING — deterministic regardless of input order.
  probes.sort((a, b) => (calibrationProbeKey(a) < calibrationProbeKey(b) ? -1 : 1));

  const driftPolicy = createDriftPolicy(record['driftPolicy'] as CreateDriftPolicyInput);
  const requalificationPolicy = createRequalificationPolicy(
    record['requalificationPolicy'] as {
      freshnessWindowDays: number;
      validityWindowDays: number;
      triggers: readonly string[];
    },
  );

  const noteRaw = record['note'];
  const note =
    noteRaw === undefined || noteRaw === null
      ? null
      : toCalibrationNeutralText(noteRaw as string, 'calibration program note');

  const view: CalibrationProgramView = {
    programVersion: CALIBRATION_PROGRAM_VERSION,
    programId: toCalibrationProgramId(
      typeof record['programId'] === 'string' ? record['programId'] : '',
      'calibration program programId',
    ),
    tenant: expectNonEmptyString(record['tenant'], 'tenant', EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROGRAM, 'calibration program'),
    capability,
    probes: Object.freeze([...probes]),
    driftPolicy,
    requalificationPolicy,
    seed: toCalibrationSeed(
      typeof record['seed'] === 'string' ? record['seed'] : '',
      'calibration program seed',
    ),
    createdBy: expectNonEmptyString(record['createdBy'], 'createdBy', EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROGRAM, 'calibration program'),
    createdAt: toCalibrationTimestamp(
      typeof record['createdAt'] === 'string' ? record['createdAt'] : '',
      'calibration program createdAt',
    ),
    note,
  };
  screenFieldNames(view, 'calibrationProgram');
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as CalibrationProgram;
}

/** The digest-free view of a program (what the digest commits to). */
export function calibrationProgramView(program: CalibrationProgram): CalibrationProgramView {
  const { digest: _digest, ...view } = program;
  return deepFreeze({ ...view }) as CalibrationProgramView;
}

/**
 * Recompute the program digest over the digest-free view and compare.
 * Throws EXPERT_CALIBRATION_TAMPERED on any mismatch.
 */
export async function recomputeCalibrationProgramDigest(
  program: CalibrationProgram,
): Promise<string> {
  if (!isCalibrationProgram(program)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROGRAM, {
      message: 'program digest recomputation requires a structurally valid calibration program',
    });
  }
  const actual = await digestCanonical(calibrationProgramView(program));
  if (actual !== program.digest) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.TAMPERED, {
      message: `calibration program digest mismatch for ${program.programId}`,
      details: { programId: program.programId, expected: program.digest, actual },
    });
  }
  return actual;
}

// ---------------------------------------------------------------------------
// Structural (non-throwing) guards
// ---------------------------------------------------------------------------

/** Structural (non-throwing) check for the digest-free program view. */
export function isCalibrationProgramView(value: unknown): value is CalibrationProgramView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['programVersion'] === CALIBRATION_PROGRAM_VERSION &&
    typeof candidate['programId'] === 'string' &&
    /^calprog-[a-z0-9][a-z0-9-]{0,62}$/.test(candidate['programId']) &&
    typeof candidate['tenant'] === 'string' &&
    candidate['tenant'].length > 0 &&
    typeof candidate['probes'] === 'object' &&
    Array.isArray(candidate['probes']) &&
    (candidate['probes'] as unknown[]).length > 0 &&
    typeof candidate['seed'] === 'string' &&
    typeof candidate['createdAt'] === 'string'
  );
}

/** Structural (non-throwing) check for the full program (view + digest). */
export function isCalibrationProgram(value: unknown): value is CalibrationProgram {
  if (!isCalibrationProgramView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return typeof candidate['digest'] === 'string' && /^[0-9a-f]{64}$/.test(candidate['digest']);
}
