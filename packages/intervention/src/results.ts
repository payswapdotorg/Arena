/**
 * Per-mode typed result contracts (Work Order C007; issue #114) — the
 * machine-readable results each intervention mode must produce, in the
 * house verdict style (strict fail-closed constructors, closed
 * vocabularies, deep-frozen plain JSON, machine-readable verdicts —
 * never bare booleans).
 *
 * Derived from spec/expert-escalation-api.md ES1.0 "Result types" +
 * spec/expert-environment-session.md EES1.0 (completion/replay) +
 * spec/escalation-reference-flow.md ERF1.0:
 *
 *   CORRECT  → correction patch + BEFORE/AFTER evidence refs;
 *   UNBLOCK  → exactly the missing information/decision + provenance;
 *   SOLVE    → completed-subproblem result + evidence bundle;
 *   REVIEW   → critique/verdict against DECLARED criteria (A012
 *              evaluator discipline — every criterion is evaluated);
 *   TEACH    → observable demonstration record shaped
 *              state → human action → observable consequence → evidence
 *              (the EES1.0 replay law; capture is MANDATORY and the
 *              A011 trajectory binding is REQUIRED);
 *   TOOL_GAP → missing-tool signal with evidence of use;
 *   KNOWLEDGE→ scoped knowledge patch (never silently universal);
 *   EVALUATE → evaluation verdict (pass/fail/inconclusive) over a subject.
 *
 * Every contract maps onto exactly one C001 EscalationResultKind via
 * toEscalationResultInput — the intervention layer never invents a
 * second result taxonomy.
 */

import { ESCALATION_MODES } from '@arena/escalation';
import type { CreateEscalationResultInput, EscalationMode } from '@arena/escalation';
import { INTERVENTION_ERROR_CODES, InterventionError } from './errors.js';
import type { InterventionTimestamp, PlainJsonValue } from './shared.js';
import { deepFreeze, isInterventionTimestamp, isPlainJsonValue, toInterventionTimestamp } from './shared.js';
import { profileForMode } from './modes.js';

/** Wire version of every intervention result contract. */
export const INTERVENTION_RESULT_CONTRACT_VERSION = 1 as const;

/** The closed per-mode contract kind vocabulary (mirrors the mode table). */
export const INTERVENTION_RESULT_CONTRACT_KINDS = Object.freeze([
  'correction',
  'unblock',
  'solution',
  'review',
  'teach-demonstration',
  'tool-gap-signal',
  'knowledge-patch',
  'evaluation-verdict',
] as const);
export type InterventionResultContractKind = (typeof INTERVENTION_RESULT_CONTRACT_KINDS)[number];

export function isInterventionResultContractKind(
  value: unknown,
): value is InterventionResultContractKind {
  return (
    typeof value === 'string' &&
    (INTERVENTION_RESULT_CONTRACT_KINDS as readonly string[]).includes(value)
  );
}

/** Reference to the A011 trajectory backing the observable work. */
export interface TrajectoryBindingRef {
  readonly trajectoryId: string;
  /** The trajectory's chain head (its content-addressed digest). */
  readonly chainHead: string;
}

// ---------------------------------------------------------------------------
// Common fields
// ---------------------------------------------------------------------------

export interface InterventionResultCommon {
  readonly contractVersion: typeof INTERVENTION_RESULT_CONTRACT_VERSION;
  /** The escalation mode this result was produced under. */
  readonly mode: EscalationMode;
  readonly kind: InterventionResultContractKind;
  readonly requestId: string;
  readonly sessionId: string;
  readonly producedAt: InterventionTimestamp;
  readonly summary: string;
  /** The A011 trajectory binding (required for TEACH; optional elsewhere). */
  readonly trajectoryRef?: TrajectoryBindingRef;
}

// ---------------------------------------------------------------------------
// CORRECT — correction patch + before/after evidence refs
// ---------------------------------------------------------------------------

export interface CorrectionContract extends InterventionResultCommon {
  readonly mode: 'correct';
  readonly kind: 'correction';
  /** The artifact/step being corrected. */
  readonly correctedRef: string;
  /** The correction patch (the corrected payload). */
  readonly replacement: PlainJsonValue;
  /** Evidence backing the FLAWED BEFORE state (>= 1). */
  readonly beforeEvidenceRefs: readonly string[];
  /** Evidence backing the CORRECTED AFTER state (>= 1). */
  readonly afterEvidenceRefs: readonly string[];
}

// ---------------------------------------------------------------------------
// UNBLOCK — exactly the missing information/decision + provenance
// ---------------------------------------------------------------------------

export const UNBLOCK_INFORMATION_KINDS = Object.freeze(['information', 'decision'] as const);
export type UnblockInformationKind = (typeof UNBLOCK_INFORMATION_KINDS)[number];

export interface UnblockProvenance {
  /** Where the missing information/decision came from (>= 1 source ref). */
  readonly sourceRefs: readonly string[];
  /** How the expert obtained it (method statement). */
  readonly method: string;
}

export interface UnblockContract extends InterventionResultCommon {
  readonly mode: 'unblock';
  readonly kind: 'unblock';
  /** What was blocking. */
  readonly blockageRef: string;
  /** EXACTLY the missing information (or decision) — nothing more. */
  readonly missingInformation: PlainJsonValue;
  readonly informationKind: UnblockInformationKind;
  readonly provenance: UnblockProvenance;
}

// ---------------------------------------------------------------------------
// SOLVE — completed-subproblem result + evidence bundle
// ---------------------------------------------------------------------------

export interface SolveEvidenceBundle {
  /** Evidence backing the completed subproblem (>= 1). */
  readonly evidenceRefs: readonly string[];
  /** Optional A011 trajectory binding for the solved work. */
  readonly trajectoryRef?: TrajectoryBindingRef;
}

export interface SolveContract extends InterventionResultCommon {
  readonly mode: 'solve';
  readonly kind: 'solution';
  /** The completed-subproblem result (satisfies the request's desired output schema). */
  readonly payload: PlainJsonValue;
  /** The observable steps taken (>= 1). */
  readonly steps: readonly string[];
  readonly evidenceBundle: SolveEvidenceBundle;
}

// ---------------------------------------------------------------------------
// REVIEW — critique/verdict against declared criteria (A012 discipline)
// ---------------------------------------------------------------------------

export const REVIEW_CONTRACT_VERDICTS = Object.freeze([
  'approved',
  'changes-requested',
  'rejected',
] as const);
export type ReviewContractVerdict = (typeof REVIEW_CONTRACT_VERDICTS)[number];

export const CRITERION_EVALUATION_VERDICTS = Object.freeze([
  'met',
  'not-met',
  'inconclusive',
] as const);
export type CriterionEvaluationVerdict = (typeof CRITERION_EVALUATION_VERDICTS)[number];

export interface DeclaredCriterion {
  readonly criteriaRef: string;
  readonly description: string;
}

export interface CriterionEvaluation {
  readonly criteriaRef: string;
  readonly verdict: CriterionEvaluationVerdict;
  readonly note: string;
}

export interface ReviewContract extends InterventionResultCommon {
  readonly mode: 'review';
  readonly kind: 'review';
  readonly verdict: ReviewContractVerdict;
  /** The criteria the critique runs against (>= 1, DECLARED up front). */
  readonly declaredCriteria: readonly DeclaredCriterion[];
  /** One evaluation per declared criterion (closed set, no orphans). */
  readonly criteriaEvaluations: readonly CriterionEvaluation[];
  readonly findings: readonly string[];
}

// ---------------------------------------------------------------------------
// TEACH — observable demonstration record (the EES1.0 replay law)
// ---------------------------------------------------------------------------

/**
 * One demonstration step: state → human action → observable
 * consequence → evidence. The EES1.0 replay shape; never private
 * chain-of-thought (lock rule 30 — the trajectory-binding module
 * screens payloads).
 */
export interface DemonstrationStep {
  /** The capsule state the step started from. */
  readonly stateRef: string;
  /** The observable human action performed. */
  readonly humanAction: string;
  /** The observable consequence the action produced. */
  readonly consequenceRef: string;
  /** Evidence of the consequence (>= 1). */
  readonly evidenceRefs: readonly string[];
}

export interface TeachContract extends InterventionResultCommon {
  readonly mode: 'teach';
  readonly kind: 'teach-demonstration';
  /** The observable demonstration record (>= 1 step; capture MANDATORY). */
  readonly demonstration: readonly DemonstrationStep[];
}

// ---------------------------------------------------------------------------
// TOOL_GAP — missing-tool signal with evidence of use
// ---------------------------------------------------------------------------

export interface ToolGapContract extends InterventionResultCommon {
  readonly mode: 'tool_gap';
  readonly kind: 'tool-gap-signal';
  readonly missingToolId: string;
  readonly rationale: string;
  /** Evidence the tool was needed/used (>= 1). */
  readonly evidenceOfUseRefs: readonly string[];
}

// ---------------------------------------------------------------------------
// KNOWLEDGE — scoped knowledge patch (never silently universal)
// ---------------------------------------------------------------------------

export interface KnowledgeContract extends InterventionResultCommon {
  readonly mode: 'knowledge';
  readonly kind: 'knowledge-patch';
  readonly statement: string;
  /** The scope the statement holds within (a universal scope is EXPLICIT). */
  readonly scope: string;
}

// ---------------------------------------------------------------------------
// EVALUATE — evaluation verdict over a subject
// ---------------------------------------------------------------------------

export const EVALUATE_CONTRACT_VERDICTS = Object.freeze([
  'pass',
  'fail',
  'inconclusive',
] as const);
export type EvaluateContractVerdict = (typeof EVALUATE_CONTRACT_VERDICTS)[number];

export interface EvaluateContract extends InterventionResultCommon {
  readonly mode: 'evaluate';
  readonly kind: 'evaluation-verdict';
  readonly verdict: EvaluateContractVerdict;
  readonly subjectRef: string;
}

// ---------------------------------------------------------------------------
// Union + creation input
// ---------------------------------------------------------------------------

export type InterventionResultContract =
  | CorrectionContract
  | UnblockContract
  | SolveContract
  | ReviewContract
  | TeachContract
  | ToolGapContract
  | KnowledgeContract
  | EvaluateContract;

/** The modes a result contract may be produced under (authorization source). */
export type PermittedModesView = readonly string[];

export interface CreateInterventionResultInput {
  /** The escalation mode the result is produced under. */
  readonly mode: string;
  /** The modes the EscalationRequest authorizes (fail-closed guard). */
  readonly permittedModes: PermittedModesView;
  readonly requestId: string;
  readonly sessionId: string;
  readonly producedAt: number | string | Date;
  readonly summary: string;
  readonly trajectoryRef?: TrajectoryBindingRef;
  // CORRECT
  readonly correctedRef?: string;
  readonly replacement?: unknown;
  readonly beforeEvidenceRefs?: readonly string[];
  readonly afterEvidenceRefs?: readonly string[];
  // UNBLOCK
  readonly blockageRef?: string;
  readonly missingInformation?: unknown;
  readonly informationKind?: string;
  readonly provenance?: { sourceRefs: readonly string[]; method: string };
  // SOLVE
  readonly payload?: unknown;
  readonly steps?: readonly string[];
  readonly evidenceRefs?: readonly string[];
  // REVIEW
  readonly verdict?: string;
  readonly declaredCriteria?: readonly { criteriaRef: string; description: string }[];
  readonly criteriaEvaluations?: readonly { criteriaRef: string; verdict: string; note: string }[];
  readonly findings?: readonly string[];
  // TEACH
  readonly demonstration?: readonly {
    stateRef: string;
    humanAction: string;
    consequenceRef: string;
    evidenceRefs: readonly string[];
  }[];
  // TOOL_GAP
  readonly missingToolId?: string;
  readonly rationale?: string;
  readonly evidenceOfUseRefs?: readonly string[];
  // KNOWLEDGE
  readonly statement?: string;
  readonly scope?: string;
  // EVALUATE
  readonly subjectRef?: string;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
      message: `${field} must be a non-empty string (<= 4096 chars)`,
    });
  }
  return value;
}

function requireRef(value: unknown, field: string): string {
  requireString(value, field);
  const ref = value as string;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/.test(ref)) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
      message: `${field} must be a valid reference: ${JSON.stringify(value)}`,
    });
  }
  return ref;
}

function requireStringArray(values: unknown, field: string): readonly string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
      message: `${field} must be a non-empty string array`,
    });
  }
  for (const value of values) requireString(value, `${field} entry`);
  return Object.freeze([...values]);
}

function requireRefArray(values: unknown, field: string): readonly string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
      message: `${field} must be a non-empty reference array (>= 1)`,
    });
  }
  const refs = values.map((value) => requireRef(value, `${field} entry`));
  return Object.freeze(refs);
}

function requirePlainJson(value: unknown, field: string): PlainJsonValue {
  if (!isPlainJsonValue(value)) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
      message: `${field} must be a plain-JSON value`,
    });
  }
  return deepFreeze(value);
}

function requireTrajectoryRef(value: unknown, field: string): TrajectoryBindingRef {
  if (typeof value !== 'object' || value === null) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
      message: `${field} must be { trajectoryId, chainHead }`,
    });
  }
  const candidate = value as Record<string, unknown>;
  return Object.freeze({
    trajectoryId: requireString(candidate['trajectoryId'], `${field}.trajectoryId`),
    chainHead: requireRefDigest(candidate['chainHead'], `${field}.chainHead`),
  });
}

function requireRefDigest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
      message: `${field} must be a 64-hex content digest`,
    });
  }
  return value;
}

function requireEnum<T extends string>(
  value: unknown,
  vocabulary: readonly T[],
  field: string,
): T {
  if (typeof value !== 'string' || !(vocabulary as readonly string[]).includes(value)) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
      message: `${field} must be one of ${JSON.stringify([...vocabulary])}: ${JSON.stringify(value)}`,
    });
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// The fail-closed constructor (mode-authorization guarded)
// ---------------------------------------------------------------------------

/**
 * Create and freeze a per-mode intervention result contract. STRICT:
 *   - the mode must be in the approved closed vocabulary;
 *   - the mode must be AUTHORIZED (within permittedModes — an unlisted
 *     mode is a typed UNPERMITTED_MODE rejection, never a coercion);
 *   - the mode-specific REQUIRED fields must be present and valid
 *     (a Correction without before/after evidence refs, an UNBLOCK
 *     without provenance, a TEACH without a trajectory binding can
 *     never be constructed).
 */
export function createInterventionResult(
  input: CreateInterventionResultInput,
): InterventionResultContract {
  if (typeof input !== 'object' || input === null) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
      message: 'intervention result input must be an object',
    });
  }
  if (!(ESCALATION_MODES as readonly string[]).includes(input.mode)) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_MODE, {
      message: `escalation mode is not in the approved closed vocabulary: ${JSON.stringify(input.mode)}`,
      details: { approved: ESCALATION_MODES },
    });
  }
  if (!Array.isArray(input.permittedModes) || !input.permittedModes.includes(input.mode)) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.UNPERMITTED_MODE, {
      message: `escalation mode '${input.mode}' is not permitted for this request (permitted: ${JSON.stringify([...(input.permittedModes ?? [])])})`,
      details: { mode: input.mode, permitted: [...(input.permittedModes ?? [])] },
    });
  }
  const mode = input.mode as EscalationMode;
  const profile = profileForMode(mode);
  const producedAt = toInterventionTimestamp(input.producedAt);
  if (!isInterventionTimestamp(producedAt)) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
      message: 'producedAt is not a canonical ms-UTC timestamp',
    });
  }
  const summary = requireString(input.summary, 'summary');
  const common = {
    contractVersion: INTERVENTION_RESULT_CONTRACT_VERSION,
    mode,
    requestId: requireRef(input.requestId, 'requestId'),
    sessionId: requireRef(input.sessionId, 'sessionId'),
    producedAt,
    summary,
    ...(input.trajectoryRef !== undefined
      ? { trajectoryRef: requireTrajectoryRef(input.trajectoryRef, 'trajectoryRef') }
      : {}),
  };

  switch (mode) {
    case 'correct':
      return Object.freeze({
        ...common,
        mode: 'correct',
        kind: 'correction',
        correctedRef: requireRef(input.correctedRef, 'correction.correctedRef'),
        replacement: requirePlainJson(input.replacement, 'correction.replacement'),
        beforeEvidenceRefs: requireRefArray(
          input.beforeEvidenceRefs,
          'correction.beforeEvidenceRefs',
        ),
        afterEvidenceRefs: requireRefArray(input.afterEvidenceRefs, 'correction.afterEvidenceRefs'),
      });
    case 'unblock':
      return Object.freeze({
        ...common,
        mode: 'unblock',
        kind: 'unblock',
        blockageRef: requireRef(input.blockageRef, 'unblock.blockageRef'),
        missingInformation: requirePlainJson(
          input.missingInformation,
          'unblock.missingInformation',
        ),
        informationKind: requireEnum(
          input.informationKind,
          UNBLOCK_INFORMATION_KINDS,
          'unblock.informationKind',
        ),
        provenance: freezeProvenance(input.provenance),
      });
    case 'solve':
      return Object.freeze({
        ...common,
        mode: 'solve',
        kind: 'solution',
        payload: requirePlainJson(input.payload, 'solution.payload'),
        steps: requireStringArray(input.steps, 'solution.steps'),
        evidenceBundle: freezeEvidenceBundle(input.evidenceRefs, input.trajectoryRef),
      });
    case 'review': {
      const declaredCriteria = freezeDeclaredCriteria(input.declaredCriteria);
      const criteriaEvaluations = freezeCriteriaEvaluations(
        input.criteriaEvaluations,
        declaredCriteria,
      );
      const findings =
        input.findings === undefined ? [] : requireStringArray(input.findings, 'review.findings');
      return Object.freeze({
        ...common,
        mode: 'review',
        kind: 'review',
        verdict: requireEnum(
          input.verdict,
          REVIEW_CONTRACT_VERDICTS,
          'review.verdict',
        ),
        declaredCriteria,
        criteriaEvaluations,
        findings,
      });
    }
    case 'teach': {
      const demonstration = freezeDemonstration(input.demonstration);
      if (profile.captureMandatory && input.trajectoryRef === undefined) {
        throw new InterventionError(INTERVENTION_ERROR_CODES.CAPTURE_REQUIRED, {
          message:
            'teach results REQUIRE an A011 trajectory binding (capture is mandatory for TEACH — EES1.0 replay law)',
          details: { mode: 'teach', requestId: common.requestId },
        });
      }
      return Object.freeze({
        ...common,
        mode: 'teach',
        kind: 'teach-demonstration',
        demonstration,
      });
    }
    case 'tool_gap':
      return Object.freeze({
        ...common,
        mode: 'tool_gap',
        kind: 'tool-gap-signal',
        missingToolId: requireRef(input.missingToolId, 'toolGap.missingToolId'),
        rationale: requireString(input.rationale, 'toolGap.rationale'),
        evidenceOfUseRefs: requireRefArray(
          input.evidenceOfUseRefs,
          'toolGap.evidenceOfUseRefs',
        ),
      });
    case 'knowledge':
      return Object.freeze({
        ...common,
        mode: 'knowledge',
        kind: 'knowledge-patch',
        statement: requireString(input.statement, 'knowledge.statement'),
        scope: requireString(input.scope, 'knowledge.scope'),
      });
    case 'evaluate':
      return Object.freeze({
        ...common,
        mode: 'evaluate',
        kind: 'evaluation-verdict',
        verdict: requireEnum(input.verdict, EVALUATE_CONTRACT_VERDICTS, 'evaluate.verdict'),
        subjectRef: requireRef(input.subjectRef, 'evaluate.subjectRef'),
      });
  }
}

function freezeProvenance(value: unknown): UnblockProvenance {
  if (typeof value !== 'object' || value === null) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
      message: 'unblock.provenance { sourceRefs, method } is REQUIRED',
    });
  }
  return Object.freeze({
    sourceRefs: requireRefArray(
      (value as Record<string, unknown>)['sourceRefs'],
      'unblock.provenance.sourceRefs',
    ),
    method: requireString((value as Record<string, unknown>)['method'], 'unblock.provenance.method'),
  });
}

function freezeEvidenceBundle(
  evidenceRefs: unknown,
  trajectoryRef: TrajectoryBindingRef | undefined,
): SolveEvidenceBundle {
  const refs = requireRefArray(evidenceRefs, 'solution.evidenceBundle.evidenceRefs');
  return Object.freeze({
    evidenceRefs: refs,
    ...(trajectoryRef !== undefined
      ? { trajectoryRef: requireTrajectoryRef(trajectoryRef, 'solution.evidenceBundle.trajectoryRef') }
      : {}),
  });
}

function freezeDeclaredCriteria(value: unknown): readonly DeclaredCriterion[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
      message: 'review.declaredCriteria must be a non-empty array (>= 1 declared criterion)',
    });
  }
  const seen = new Set<string>();
  const criteria = value.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
        message: `declared criterion is invalid: ${JSON.stringify(entry)}`,
      });
    }
    const criteriaRef = requireRef((entry as Record<string, unknown>)['criteriaRef'], 'declaredCriteria.criteriaRef');
    if (seen.has(criteriaRef)) {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
        message: `declared criterion is duplicated: ${JSON.stringify(criteriaRef)}`,
      });
    }
    seen.add(criteriaRef);
    return Object.freeze({
      criteriaRef,
      description: requireString(
        (entry as Record<string, unknown>)['description'],
        'declaredCriteria.description',
      ),
    });
  });
  return Object.freeze(criteria);
}

function freezeCriteriaEvaluations(
  value: unknown,
  declaredCriteria: readonly DeclaredCriterion[],
): readonly CriterionEvaluation[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
      message: 'review.criteriaEvaluations must be a non-empty array (every declared criterion is evaluated)',
    });
  }
  const declaredRefs = new Set(declaredCriteria.map((criterion) => criterion.criteriaRef));
  const evaluated = new Set<string>();
  const evaluations = value.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
        message: `criterion evaluation is invalid: ${JSON.stringify(entry)}`,
      });
    }
    const criteriaRef = requireRef(
      (entry as Record<string, unknown>)['criteriaRef'],
      'criteriaEvaluations.criteriaRef',
    );
    if (!declaredRefs.has(criteriaRef)) {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
        message: `criterion evaluation references an UNDECLARED criterion: ${JSON.stringify(criteriaRef)}`,
        details: { declared: [...declaredRefs] },
      });
    }
    if (evaluated.has(criteriaRef)) {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
        message: `criterion is evaluated twice: ${JSON.stringify(criteriaRef)}`,
      });
    }
    evaluated.add(criteriaRef);
    return Object.freeze({
      criteriaRef,
      verdict: requireEnum(
        (entry as Record<string, unknown>)['verdict'],
        CRITERION_EVALUATION_VERDICTS,
        'criteriaEvaluations.verdict',
      ),
      note: requireString((entry as Record<string, unknown>)['note'], 'criteriaEvaluations.note'),
    });
  });
  if (evaluated.size !== declaredRefs.size) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
      message: 'every declared criterion must be evaluated exactly once (A012 evaluator discipline)',
      details: { declared: declaredRefs.size, evaluated: evaluated.size },
    });
  }
  return Object.freeze(evaluations);
}

function freezeDemonstration(value: unknown): readonly DemonstrationStep[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.CAPTURE_REQUIRED, {
      message: 'teach.demonstration must be a non-empty array of observable steps (capture is mandatory)',
    });
  }
  const steps = value.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_RESULT, {
        message: `demonstration step is invalid: ${JSON.stringify(entry)}`,
      });
    }
    return Object.freeze({
      stateRef: requireRef((entry as Record<string, unknown>)['stateRef'], 'demonstration.stateRef'),
      humanAction: requireString(
        (entry as Record<string, unknown>)['humanAction'],
        'demonstration.humanAction',
      ),
      consequenceRef: requireRef(
        (entry as Record<string, unknown>)['consequenceRef'],
        'demonstration.consequenceRef',
      ),
      evidenceRefs: requireRefArray(
        (entry as Record<string, unknown>)['evidenceRefs'],
        'demonstration.evidenceRefs',
      ),
    });
  });
  return Object.freeze(steps);
}

// ---------------------------------------------------------------------------
// Structural guards + C001 mapping
// ---------------------------------------------------------------------------

/** Structural guard for wire values claiming to be intervention result contracts. */
export function isInterventionResult(value: unknown): value is InterventionResultContract {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['contractVersion'] === INTERVENTION_RESULT_CONTRACT_VERSION &&
    (ESCALATION_MODES as readonly string[]).includes(candidate['mode'] as string) &&
    isInterventionResultContractKind(candidate['kind']) &&
    typeof candidate['requestId'] === 'string' &&
    typeof candidate['sessionId'] === 'string' &&
    typeof candidate['summary'] === 'string' &&
    candidate['summary'].length > 0 &&
    isInterventionTimestamp(candidate['producedAt'])
  );
}

/** The escalation mode a contract was produced under. */
export function modeOfContract(contract: InterventionResultContract): EscalationMode {
  return contract.mode;
}

/**
 * Map a contract onto its C001 EscalationResult input — the SINGLE
 * result taxonomy. The intervention layer never invents a second one.
 */
export function toEscalationResultInput(
  contract: InterventionResultContract,
): CreateEscalationResultInput {
  const base = {
    producedAt: contract.producedAt,
    summary: contract.summary,
  };
  switch (contract.mode) {
    case 'correct':
      return {
        ...base,
        kind: 'correction',
        correctedRef: contract.correctedRef,
        replacement: contract.replacement,
      };
    case 'unblock':
      return {
        ...base,
        kind: 'unblock',
        blockageRef: contract.blockageRef,
        resolution: {
          missingInformation: contract.missingInformation,
          informationKind: contract.informationKind,
          provenance: contract.provenance,
        },
      };
    case 'solve':
      return {
        ...base,
        kind: 'solution',
        payload: contract.payload,
        steps: contract.steps,
      };
    case 'review':
      return {
        ...base,
        kind: 'review',
        verdict: contract.verdict,
        findings: [
          ...contract.findings,
          ...contract.criteriaEvaluations.map(
            (evaluation) =>
              `${evaluation.criteriaRef}: ${evaluation.verdict} — ${evaluation.note}`,
          ),
        ],
      };
    case 'teach':
      return {
        ...base,
        kind: 'evidence-bundle',
        evidenceRefs: [
          ...contract.demonstration.flatMap((step) => step.evidenceRefs),
          ...(contract.trajectoryRef !== undefined
            ? [`trajectory/${contract.trajectoryRef.trajectoryId}@${contract.trajectoryRef.chainHead}`]
            : []),
        ],
      };
    case 'tool_gap':
      return {
        ...base,
        kind: 'tool-gap-signal',
        missingToolId: contract.missingToolId,
        rationale: contract.rationale,
      };
    case 'knowledge':
      return {
        ...base,
        kind: 'knowledge-patch',
        statement: contract.statement,
        scope: contract.scope,
      };
    case 'evaluate':
      return {
        ...base,
        kind: 'evaluation-verdict',
        verdict: contract.verdict,
        subjectRef: contract.subjectRef,
      };
  }
}

/** Evidence references carried by a contract (submission evidence for C006). */
export function evidenceRefsOfContract(contract: InterventionResultContract): readonly string[] {
  switch (contract.mode) {
    case 'correct':
      return [...contract.beforeEvidenceRefs, ...contract.afterEvidenceRefs];
    case 'unblock':
      return [...contract.provenance.sourceRefs];
    case 'solve':
      return [...contract.evidenceBundle.evidenceRefs];
    case 'review':
      return contract.declaredCriteria.map((criterion) => criterion.criteriaRef);
    case 'teach':
      return contract.demonstration.flatMap((step) => step.evidenceRefs);
    case 'tool_gap':
      return [...contract.evidenceOfUseRefs];
    case 'knowledge':
      return [];
    case 'evaluate':
      return [];
  }
}
