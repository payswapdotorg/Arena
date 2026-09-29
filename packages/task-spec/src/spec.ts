/**
 * TaskSpec — the versioned, content-addressed, immutable reproducible unit
 * of capability-development work (Work Order A008; docs/architecture.md
 * §6 "Task"; spec/task-spec.md TS1.0; requirement R6; architecture-lock
 * rules 5, 6, 11, 17, 18, 22, 24).
 *
 * "TaskSpec is the reproducible unit of work." (architecture.md §6). The
 * view carries EVERY TS1.0 structure field:
 *
 *   task identity/version; capability labels; difficulty (declared
 *   scale); domain; initial state reference; instructions; objectives;
 *   constraints; permitted tools; prohibited shortcuts (FIRST-CLASS —
 *   shortcut resistance is a TS1.0 quality dimension); expected outputs;
 *   completion criteria; evidence criteria; environment requirements
 *   (A009 ENV1.0-shaped declarations); evaluator bindings (A012
 *   descriptor digests); verifier bindings (A013 descriptor digests);
 *   expert qualification requirements (A007 shapes); data-rights metadata
 *   (R24 posture: private-tenant by default);
 *
 * plus the TS1.0 long-horizon section (intermediate state and recoveries
 * as FIRST-CLASS evidence — REQUIRED for the long-horizon-execution
 * class), the TS1.0 Quality section (seven declared quality dimensions
 * with provenance) and the derivation provenance (the exact case state +
 * compilation policy that produced this spec).
 *
 * Immutability + content addressing: `createTaskSpec` validates through
 * the pure guards (guards.ts), computes the sha256 digest over the
 * canonical JSON of the digest-free view (@arena/protocol-core
 * digestCanonical — never reimplemented here) and DEEP-FREEZES the
 * result. There is NO mutation API: a new version is a NEW
 * content-addressed object; supersession is by append (`supersedes` —
 * the superseded version stays immutable and addressable forever).
 *
 * DETERMINISM NOTE: the view contains no timestamps and no randomness —
 * a spec's digest is a pure function of its content, so the same case
 * state + the same compilation policy always compile to byte-identical
 * specs (the R6 reproducibility bridge; see services/task-compiler).
 */

import { digestCanonical } from '@arena/protocol-core';
import { TASK_SPEC_ERROR_CODES, TaskSpecError } from './errors.js';
import { guardTaskSpecView } from './guards.js';
import type { TaskIdentity, TaskVersionRef } from './identity.js';
import { taskVersionRefOf } from './identity.js';
import type {
  EvaluatorBinding,
  VerifierBinding,
} from './bindings.js';
import type { TaskClass } from './task-class.js';
import type { TaskDifficultyDeclaration } from './difficulty.js';
import type { QualityDeclaration } from './quality.js';
import type {
  TaskEnvironmentRequirements,
  TaskInitialStateRef,
} from './environment.js';
import type { TaskExpertQualificationRequirements } from './expert-qualification.js';
import type { DataRightsMetadata } from './data-rights.js';
import type {
  ArtifactRefView,
  CaseRefView,
  CapabilityLabel,
  CompilationPolicyRefView,
  ContentDigest,
  NodeRefView,
  TaskVersion,
} from './shared.js';

/** Wire version of the task-spec record shape. */
export const TASK_SPEC_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Long-horizon evidence (TS1.0 "Long-horizon work")
// ---------------------------------------------------------------------------

/**
 * Intermediate state and recoveries as FIRST-CLASS evidence: what
 * intermediate state an attempt must record, and what recovery behavior
 * counts. REQUIRED for the `long-horizon-execution` class (guards), where
 * "final output alone is insufficient where process behavior is part of
 * the target capability".
 */
export interface LongHorizonEvidence {
  /** Intermediate-state evidence criteria (>= 1). */
  readonly intermediateStateEvidence: readonly string[];
  /** Recovery criteria — what counts as a recovery (>= 1). */
  readonly recoveryCriteria: readonly string[];
}

/** Stable field list (tests + contracts mirror it). */
export const LONG_HORIZON_EVIDENCE_FIELDS = Object.freeze([
  'intermediateStateEvidence',
  'recoveryCriteria',
] as const) as readonly string[];

// ---------------------------------------------------------------------------
// Derivation provenance (clear provenance — TS1.0 Quality)
// ---------------------------------------------------------------------------

/**
 * Where this spec came from: the EXACT capability-case state (A005 case
 * version ref — the case digest pins its full state incl. lifecycle) and
 * the compilation policy (identity + digest). Deliberately carries NO
 * timestamps: the derivation is content-addressed so the same case state +
 * policy always yield the same spec bytes.
 */
export interface TaskDerivation {
  readonly caseRef: CaseRefView;
  readonly policyRef: CompilationPolicyRefView;
}

/** Stable field list (tests + contracts mirror it). */
export const TASK_DERIVATION_FIELDS = Object.freeze([
  'caseRef',
  'policyRef',
] as const) as readonly string[];

// ---------------------------------------------------------------------------
// The TaskSpec shape
// ---------------------------------------------------------------------------

/** The digest-free view of a TaskSpec — exactly what the digest covers. */
export interface TaskSpecView {
  readonly recordVersion: typeof TASK_SPEC_RECORD_VERSION;
  /** Task identity: owning tenant scope + task id. */
  readonly identity: TaskIdentity;
  /** Semver version of this task version (no build metadata). */
  readonly version: TaskVersion;
  /** Supersession: the previous version of THIS task this version replaces (append-only). */
  readonly supersedes?: TaskVersionRef;
  /** The task class (closed eleven-class TS1.0 vocabulary). */
  readonly taskClass: TaskClass;
  /** Capability labels (>= 1, unique, neutral kebab). */
  readonly capabilityLabels: readonly CapabilityLabel[];
  /** Difficulty declared in a scale (closed scale + class vocabularies). */
  readonly difficulty: TaskDifficultyDeclaration;
  /** Domain (capability-graph domain node ref). */
  readonly domain: NodeRefView;
  /** The pinned initial state (environment version + seed). */
  readonly initialState: TaskInitialStateRef;
  /** The task statement (non-empty prose). */
  readonly instructions: string;
  /** What the task must achieve (>= 1). */
  readonly objectives: readonly string[];
  /** Hard constraints on the attempt (may be empty). */
  readonly constraints: readonly string[];
  /** Tools the attempt may use (content-addressed refs; may be empty). */
  readonly permittedTools: readonly ArtifactRefView[];
  /** Shortcuts the task forbids (FIRST-CLASS; may be empty). */
  readonly prohibitedShortcuts: readonly string[];
  /** What the attempt is expected to produce (>= 1). */
  readonly expectedOutputs: readonly string[];
  /** Conditions under which an attempt counts as successful (>= 1). */
  readonly completionCriteria: readonly string[];
  /** What counts as task evidence (>= 1). */
  readonly evidenceCriteria: readonly string[];
  /** Long-horizon evidence (REQUIRED for long-horizon-execution; see guards). */
  readonly longHorizonEvidence: LongHorizonEvidence | null;
  /** Environment requirements (ENV1.0-shaped declarations + constraints). */
  readonly environmentRequirements: TaskEnvironmentRequirements;
  /** Evaluator bindings (A012 descriptor digests; >= 1; rule 7). */
  readonly evaluatorBindings: readonly EvaluatorBinding[];
  /** Verifier bindings (A013 descriptor digests; >= 1; rule 7). */
  readonly verifierBindings: readonly VerifierBinding[];
  /** Expert qualification requirements (A007 shapes). */
  readonly expertQualificationRequirements: TaskExpertQualificationRequirements;
  /** The seven declared quality dimensions with provenance. */
  readonly quality: readonly QualityDeclaration[];
  /** Data-rights metadata (R24 posture; mandatory). */
  readonly dataRights: DataRightsMetadata;
  /** Derivation provenance (case state + policy). */
  readonly derivedFrom: TaskDerivation;
}

/** A frozen, content-addressed TaskSpec: the view plus its sha256 digest. */
export interface TaskSpec extends TaskSpecView {
  readonly digest: ContentDigest;
}

/** The stable top-level field list of the view (tests + contracts mirror it). */
export const TASK_SPEC_FIELDS = Object.freeze([
  'recordVersion',
  'identity',
  'version',
  'supersedes',
  'taskClass',
  'capabilityLabels',
  'difficulty',
  'domain',
  'initialState',
  'instructions',
  'objectives',
  'constraints',
  'permittedTools',
  'prohibitedShortcuts',
  'expectedOutputs',
  'completionCriteria',
  'evidenceCriteria',
  'longHorizonEvidence',
  'environmentRequirements',
  'evaluatorBindings',
  'verifierBindings',
  'expertQualificationRequirements',
  'quality',
  'dataRights',
  'derivedFrom',
] as const) as readonly string[];

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** The (unvalidated) construction input — mirrors the view with plain strings. */
export interface CreateTaskSpecInput {
  readonly identity: { tenant: string; taskId: string };
  readonly version: string;
  readonly supersedes?: {
    tenant: string;
    taskId: string;
    version: string;
    digest: string;
  };
  readonly taskClass: string;
  readonly capabilityLabels: readonly string[];
  readonly difficulty: { scale: string; class: string };
  readonly domain: { kind: string; id: string; version: string; digest: string };
  readonly initialState: {
    environment: { namespace: string; name: string; version: string; digest: string };
    seed?: string | null;
    note?: string | null;
  };
  readonly instructions: string;
  readonly objectives: readonly string[];
  readonly constraints?: readonly string[];
  readonly permittedTools?: readonly {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }[];
  readonly prohibitedShortcuts?: readonly string[];
  readonly expectedOutputs: readonly string[];
  readonly completionCriteria: readonly string[];
  readonly evidenceCriteria: readonly string[];
  readonly longHorizonEvidence?: {
    intermediateStateEvidence: readonly string[];
    recoveryCriteria: readonly string[];
  } | null;
  readonly environmentRequirements: {
    environments: readonly {
      namespace: string;
      name: string;
      version: string;
      digest: string;
    }[];
    constraints?: readonly string[];
  };
  readonly evaluatorBindings: readonly {
    evaluatorId: string;
    version: string;
    descriptorDigest: string;
  }[];
  readonly verifierBindings: readonly {
    verifierId: string;
    version: string;
    descriptorDigest: string;
  }[];
  readonly expertQualificationRequirements: {
    competencies: readonly {
      kind: string;
      id: string;
      version: string;
      digest: string;
    }[];
    qualificationPolicy?: { policyId: string; version: string; digest: string } | null;
    expectations: readonly string[];
  };
  readonly quality: readonly {
    dimension: string;
    satisfied: boolean;
    justification: string;
    provenance: { source: string; ref: string };
  }[];
  readonly dataRights: {
    classification: string;
    tenantScope: string;
    crossTenantReuse: boolean;
    licensing?: string | null;
    privacyNotes?: string | null;
  };
  readonly derivedFrom: {
    caseRef: { tenant: string; caseId: string; version: string; digest: string };
    policyRef: { policyId: string; version: string; digest: string };
  };
}

/**
 * Create a validated, deep-frozen, content-addressed TaskSpec. ALL
 * validation (field completeness per TS1.0, closed vocabularies, cross-
 * field consistency) runs through the pure guards (guards.ts) — this
 * constructor adds the digest and the freeze. A failing guard throws a
 * typed TaskSpecError naming the violated rule.
 */
export async function createTaskSpec(
  input: CreateTaskSpecInput,
): Promise<TaskSpec> {
  const view = guardTaskSpecView(input);
  const digest = await digestCanonical(view);
  const spec: TaskSpec = Object.freeze({ ...view, digest: digest as ContentDigest });
  return spec;
}

// ---------------------------------------------------------------------------
// Digest / verification
// ---------------------------------------------------------------------------

/** The digest-free view of a spec (what the digest commits to). */
export function taskSpecContentView(spec: TaskSpec): TaskSpecView {
  const { digest: _digest, ...view } = spec;
  return view as TaskSpecView;
}

/**
 * Recompute a spec's digest over the digest-free view and compare it with
 * the claimed digest (or an explicitly expected one). FAILS CLOSED with
 * TASK_SPEC_TAMPERED on any mismatch — a mutation of any field is always
 * detected.
 */
export async function verifyTaskSpec(
  spec: TaskSpec,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isTaskSpec(spec)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_SPEC, {
      message: 'digest verification requires a structurally valid TaskSpec',
    });
  }
  const actual = await digestCanonical(taskSpecContentView(spec));
  const claimed = expectedDigest ?? spec.digest;
  if (actual !== claimed) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.TAMPERED, {
      message: `task spec digest mismatch: expected ${claimed}, recomputed ${actual}`,
      details: { expected: claimed, actual },
    });
  }
  return actual as ContentDigest;
}

// ---------------------------------------------------------------------------
// Structural checks (non-throwing)
// ---------------------------------------------------------------------------

export function isTaskSpecView(value: unknown): value is TaskSpecView {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)['recordVersion'] === TASK_SPEC_RECORD_VERSION &&
    typeof (value as Record<string, unknown>)['identity'] === 'object' &&
    typeof (value as Record<string, unknown>)['instructions'] === 'string'
  );
}

export function isTaskSpec(value: unknown): value is TaskSpec {
  if (!isTaskSpecView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return (
    typeof candidate['digest'] === 'string' && /^[0-9a-f]{64}$/.test(candidate['digest'])
  );
}

/** A content-addressed ref to this exact task version. */
export function taskSpecVersionRef(spec: TaskSpec): TaskVersionRef {
  return taskVersionRefOf(spec);
}
