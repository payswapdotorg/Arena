/**
 * Workbench view models — the case work lens and the task execute/review
 * surfaces (Work Order B009; issue #81; apps/web/src/expert). SERVER-ONLY.
 *
 * Composition rules (the same posture as assignment.ts):
 *   - EVERY datum comes from a CANONICAL READ through the injected B005
 *     read port; nothing is fabricated to fill a section;
 *   - lifecycle states render VERBATIM with honest recognition flags: the
 *     A005 case lifecycle, the task states, the A010 run-state vocabulary
 *     and the A011 trajectory step kinds — unknown stays unknown, never
 *     guessed into a neighbor;
 *   - the run timeline distinguishes OBSERVATION vs ACTION vs TOOL vs
 *     RESULT vs MODEL-OUTPUT steps (and the A011 checkpoint/error/
 *     completion kinds): a model-output step is raw model output (badged
 *     as such — unverified by any authority); every other recorded step
 *     is run data classified as the replay itself;
 *   - evaluation, verification, certification and expert judgment are
 *     rendered as the DISTINCT concepts they are — an evaluation verdict
 *     is not a verification verdict, and an expert's judgment (evidence)
 *     is neither;
 *   - evidence ledgers are read THROUGH the canonical read path (the
 *     deterministic sequence addressing of evidence.ts) — the work the
 *     expert submitted stays visible next to the work's canonical state;
 *   - a case or task the canonical record does not carry renders an
 *     honest not-found state (fail closed — never a guessed surface).
 */

import { describeDemoRecord, DemoError } from '@arena/demo';
import type { CanonicalRead } from '../../../../packages/read-model/src/index.js';
import {
  caseLifecycle,
  classifyDatum,
  DEMO_LABEL_TO_CANONICAL_KIND,
  isOpenTaskClass,
  runState,
  taskStateClass,
  trajectoryOutcome,
  trajectoryStepKind,
  isTruthAssertingStepKind,
} from './state-mark.js';
import type {
  ExpertTaskStateClass,
  StructuralState,
} from './state-mark.js';
import type { TruthClassification } from './assignment.js';
import type { ExpertReadPort, ExpertSessionFacts } from './runtime.js';
import { isExpertReadNotFound } from './runtime.js';
import { readExpertEvidenceLedger } from './evidence.js';
import type { ExpertEvidenceCard } from './evidence.js';

export type { ExpertEvidenceCard } from './evidence.js';
import { projectQualificationCards, taskHref } from './assignment.js';
import { QUALIFICATION_NOT_AUTHORIZATION_NOTE as QUALIFICATION_NOTE } from './assignment.js';
import type { ExpertQualificationCard } from './assignment.js';

// ---------------------------------------------------------------------------
// Shared honest projection helpers
// ---------------------------------------------------------------------------

function asRecord(data: unknown): Readonly<Record<string, unknown>> {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Readonly<Record<string, unknown>>)
    : {};
}

function stringField(data: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Classify one canonical read for rendering (demo corpus labels win in demo mode). */
function classifyForRender(
  read: CanonicalRead,
  isDemo: boolean,
  focus?: Readonly<Record<string, unknown>>,
): TruthClassification {
  let kind = classifyDatum(focus ?? asRecord(read.data)).kind;
  if (isDemo) {
    try {
      const demoSummary = describeDemoRecord(read);
      kind = DEMO_LABEL_TO_CANONICAL_KIND[demoSummary.truth];
    } catch (error) {
      if (!(error instanceof DemoError)) throw error;
    }
  }
  const classification = classifyDatum({ stateKind: kind });
  return Object.freeze({
    kind: classification.kind,
    treatment: classification.treatment,
    label: classification.label,
  });
}

function genericTitle(data: Readonly<Record<string, unknown>>, recordId: string): string {
  for (const key of ['title', 'displayName', 'name', 'caseId']) {
    const value = stringField(data, key);
    if (value !== undefined) return value;
  }
  return recordId;
}

// ---------------------------------------------------------------------------
// The case projection (work lens + task surface share it)
// ---------------------------------------------------------------------------

/** One carried task entry, verbatim. */
interface CarriedTask {
  readonly taskId: string;
  readonly title: string;
  readonly state: unknown;
  readonly assignedExpertId: string | undefined;
}

function carriedTasks(data: Readonly<Record<string, unknown>>): {
  readonly tasks: readonly CarriedTask[];
  readonly unrecognized: number;
} {
  const raw = data['tasks'];
  if (!Array.isArray(raw)) return { tasks: [], unrecognized: 0 };
  const tasks: CarriedTask[] = [];
  let unrecognized = 0;
  for (const entry of raw) {
    const task = asRecord(entry);
    const taskId = task['taskId'];
    if (typeof taskId !== 'string' || taskId.length === 0) {
      unrecognized += 1;
      continue;
    }
    const assigned = task['assignedExpertId'];
    tasks.push({
      taskId,
      title:
        typeof task['title'] === 'string' && task['title'].length > 0 ? task['title'] : taskId,
      state: task['state'],
      assignedExpertId: typeof assigned === 'string' && assigned.length > 0 ? assigned : undefined,
    });
  }
  return { tasks: Object.freeze(tasks), unrecognized };
}

/** One trajectory step of the recorded run, verbatim + classified. */
export interface TrajectoryStep {
  /** The step number as carried (verbatim; 0 when the record carries none). */
  readonly step: number;
  /** The step kind as carried, classified against the closed vocabulary (unknown stays unknown). */
  readonly kind: StructuralState;
  /** The step's own summary text as carried. */
  readonly summary: string;
  /** The tool name the step names (tool steps carry one; otherwise undefined). */
  readonly tool: string | undefined;
  /** True iff this step kind asserts its own product-truth kind (model-output). */
  readonly truthAsserting: boolean;
}

function toTrajectorySteps(data: Readonly<Record<string, unknown>>): readonly TrajectoryStep[] {
  const raw = data['trajectory'];
  if (!Array.isArray(raw)) return [];
  const steps: TrajectoryStep[] = [];
  for (const entry of raw) {
    const step = asRecord(entry);
    const kind = trajectoryStepKind(step['type']);
    const summary = stringField(step, 'summary') ?? '';
    steps.push(
      Object.freeze({
        step: typeof step['step'] === 'number' && Number.isFinite(step['step']) ? step['step'] : 0,
        kind,
        summary,
        tool: stringField(step, 'tool'),
        truthAsserting: isTruthAssertingStepKind(kind),
      }),
    );
  }
  return Object.freeze(steps);
}

/** The run context of the work: the run state + trajectory outcome, honestly carried. */
export interface RunContext {
  /** The run state as the record carries it (absent renders as not-carried, never guessed). */
  readonly state: StructuralState;
  /** The trajectory outcome as the record carries it (absent renders as not-carried). */
  readonly outcome: StructuralState;
  /** True iff the record carries a run state at all. */
  readonly carriedState: boolean;
  /** True iff the record carries a trajectory outcome at all. */
  readonly carriedOutcome: boolean;
}

function toRunContext(data: Readonly<Record<string, unknown>>): RunContext {
  const run = asRecord(data['run']);
  const rawState = run['state'] !== undefined ? run['state'] : data['runState'];
  const carriedState = typeof rawState === 'string' && rawState.length > 0;
  // The trajectory outcome: a completion step's outcome wins; otherwise a
  // top-level carried outcome field. Absent stays absent.
  let rawOutcome: unknown;
  const steps = Array.isArray(data['trajectory']) ? data['trajectory'] : [];
  for (const entry of steps) {
    const step = asRecord(entry);
    if (step['type'] === 'completion') {
      rawOutcome = asRecord(step['payload'])['outcome'] ?? step['outcome'];
    }
  }
  if (rawOutcome === undefined) rawOutcome = data['trajectoryOutcome'];
  const carriedOutcome = typeof rawOutcome === 'string' && rawOutcome.length > 0;
  return Object.freeze({
    state: runState(rawState),
    outcome: trajectoryOutcome(rawOutcome),
    carriedState,
    carriedOutcome,
  });
}

/** An evaluation the work received (an EVALUATION — never a verification). */
export interface EvaluationBlock {
  readonly suiteId: string | undefined;
  readonly verdict: string | undefined;
  readonly summary: string | undefined;
  readonly evaluatedAt: string | undefined;
  readonly carried: boolean;
}

function toEvaluationBlock(data: Readonly<Record<string, unknown>>): EvaluationBlock {
  const evaluation = asRecord(data['evaluation']);
  return Object.freeze({
    suiteId: stringField(evaluation, 'suiteId'),
    verdict: stringField(evaluation, 'verdict'),
    summary: stringField(evaluation, 'summary'),
    evaluatedAt: stringField(evaluation, 'evaluatedAt'),
    carried: Object.keys(evaluation).length > 0,
  });
}

/** A verification the work received (a VERIFICATION — never an evaluation). */
export interface VerificationBlock {
  readonly verifierKind: string | undefined;
  readonly verdict: string | undefined;
  readonly checks: readonly string[];
  readonly verifiedAt: string | undefined;
  readonly carried: boolean;
}

function toVerificationBlock(data: Readonly<Record<string, unknown>>): VerificationBlock {
  const verification = asRecord(data['verification']);
  const rawChecks = verification['checks'];
  return Object.freeze({
    verifierKind: stringField(verification, 'verifierKind'),
    verdict: stringField(verification, 'verdict'),
    checks: Object.freeze(
      Array.isArray(rawChecks)
        ? rawChecks.filter((entry): entry is string => typeof entry === 'string')
        : [],
    ),
    verifiedAt: stringField(verification, 'verifiedAt'),
    carried: Object.keys(verification).length > 0,
  });
}

/** A suggestion the work produced (a SUGGESTION/HYPOTHESIS — not a learned fact). */
export interface SuggestionBlock {
  readonly suggestionId: string | undefined;
  readonly kind: string | undefined;
  readonly text: string | undefined;
  readonly status: string | undefined;
  readonly carried: boolean;
}

function toSuggestionBlock(data: Readonly<Record<string, unknown>>): SuggestionBlock {
  const epoch = asRecord(data['epoch']);
  const suggestion = asRecord(epoch['suggestion']);
  return Object.freeze({
    suggestionId: stringField(suggestion, 'suggestionId'),
    kind: stringField(suggestion, 'kind'),
    text: stringField(suggestion, 'text'),
    status: stringField(suggestion, 'status'),
    carried: Object.keys(suggestion).length > 0,
  });
}

/** The body the case record assigns (body ≠ model: possession is composition). */
export interface AssignedBodyRef {
  readonly bodyId: string | undefined;
  readonly bodyVersion: string | undefined;
  readonly carried: boolean;
}

function toAssignedBody(data: Readonly<Record<string, unknown>>): AssignedBodyRef {
  const body = asRecord(data['assignedBody']);
  return Object.freeze({
    bodyId: stringField(body, 'bodyId'),
    bodyVersion: stringField(body, 'bodyVersion'),
    carried: stringField(body, 'bodyId') !== undefined,
  });
}

/** One task row of the case work lens. */
export interface CaseTaskRow {
  readonly taskId: string;
  readonly title: string;
  readonly state: StructuralState;
  readonly stateClass: ExpertTaskStateClass;
  readonly assignedExpertId: string | undefined;
  readonly href: string;
}

/** The shared shape of every workbench view model (mode + honest metadata). */
interface WorkbenchBase {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly principalLabel: string;
  readonly hrefBase: string;
  readonly demo: { readonly isDemo: boolean; readonly corpusHash?: string };
}

export interface BuildWorkbenchOptions {
  readonly mode: 'session' | 'demo';
  readonly facts: ExpertSessionFacts;
  readonly port: ExpertReadPort;
  /** Demo corpus hash (demo mode determinism stamp). */
  readonly corpusHash?: string;
}

// ---------------------------------------------------------------------------
// The case work lens (UXM1.0 `/cases/:id` expert row)
// ---------------------------------------------------------------------------

/** The found case work lens view model. */
export interface CaseWorkViewModel extends WorkbenchBase {
  readonly status: 'found';
  readonly surface: 'case-work';
  readonly caseRecordId: string;
  readonly caseId: string;
  readonly caseTitle: string;
  readonly summary: string | undefined;
  readonly lifecycle: StructuralState;
  readonly truth: TruthClassification;
  readonly assignedBody: AssignedBodyRef;
  readonly run: RunContext;
  readonly tasks: readonly CaseTaskRow[];
  readonly unrecognizedTaskEntries: number;
  readonly trajectory: readonly TrajectoryStep[];
  readonly evaluation: EvaluationBlock;
  readonly verification: VerificationBlock;
  readonly suggestion: SuggestionBlock;
  /** Evidence ledgers per task id — the judgment the workbench has appended. */
  readonly evidence: Readonly<Record<string, readonly ExpertEvidenceCard[]>>;
  readonly evidenceTotal: number;
  readonly qualifications: readonly ExpertQualificationCard[];
  readonly qualificationNote: string;
  readonly sourceVersion: number;
  readonly sourceRevision: number;
  readonly readAt: number;
}

/** The honest not-found outcome of the case work lens. */
export interface CaseNotFoundViewModel extends WorkbenchBase {
  readonly status: 'not-found';
  readonly surface: 'case-work';
  readonly caseRecordId: string;
}

export type CaseWorkModel = CaseWorkViewModel | CaseNotFoundViewModel;

/**
 * Build the case work lens view: one canonical case read + the carried
 * task list, trajectory, run state, evaluation/verification blocks and
 * the evidence ledgers of every task (probed through the canonical read
 * path). A case the record does not carry renders not-found — fail
 * closed, never a guessed surface.
 */
export async function buildCaseWorkView(
  options: BuildWorkbenchOptions & { readonly caseRecordId: string },
): Promise<CaseWorkModel> {
  const isDemo = options.mode === 'demo';
  const base = Object.freeze({
    mode: options.mode,
    tenantId: options.facts.tenantId,
    workspaceId: options.facts.workspaceId,
    principalId: options.facts.principalId,
    principalLabel: options.facts.principalLabel,
    hrefBase: options.mode === 'demo' ? '/demo/expert' : '/expert',
    demo: Object.freeze({
      isDemo,
      ...(isDemo && options.corpusHash !== undefined ? { corpusHash: options.corpusHash } : {}),
    }),
  });
  let read: CanonicalRead;
  try {
    read = await options.port.read(options.caseRecordId);
  } catch (error) {
    if (isExpertReadNotFound(error)) {
      return Object.freeze({
        ...base,
        status: 'not-found',
        surface: 'case-work',
        caseRecordId: options.caseRecordId,
      } satisfies CaseNotFoundViewModel);
    }
    throw error;
  }
  const data = asRecord(read.data);
  const carried = carriedTasks(data);
  const tasks: CaseTaskRow[] = carried.tasks.map((task) => {
    const classified = taskStateClass(task.state);
    return Object.freeze({
      taskId: task.taskId,
      title: task.title,
      state: classified.state,
      stateClass: classified.class,
      assignedExpertId: task.assignedExpertId,
      href: taskHref(options.mode, task.taskId, read.recordId),
    });
  });
  const evidence: Record<string, readonly ExpertEvidenceCard[]> = {};
  let evidenceTotal = 0;
  for (const task of carried.tasks) {
    const ledger = await readExpertEvidenceLedger(options.port, read.recordId, task.taskId, {
      isDemo,
    });
    evidence[task.taskId] = ledger;
    evidenceTotal += ledger.length;
  }
  const qualifications = await projectQualificationCards(options.port, isDemo);
  return Object.freeze({
    ...base,
    status: 'found',
    surface: 'case-work',
    caseRecordId: read.recordId,
    caseId: stringField(data, 'caseId') ?? read.recordId,
    caseTitle: genericTitle(data, read.recordId),
    summary: stringField(data, 'summary'),
    lifecycle: caseLifecycle(data['lifecycle'] ?? data['status']),
    truth: classifyForRender(read, isDemo),
    assignedBody: toAssignedBody(data),
    run: toRunContext(data),
    tasks: Object.freeze(tasks),
    unrecognizedTaskEntries: carried.unrecognized,
    trajectory: toTrajectorySteps(data),
    evaluation: toEvaluationBlock(data),
    verification: toVerificationBlock(data),
    suggestion: toSuggestionBlock(data),
    evidence: Object.freeze(evidence),
    evidenceTotal,
    qualifications: qualifications.cards,
    qualificationNote: QUALIFICATION_NOTE,
    sourceVersion: read.sourceVersion,
    sourceRevision: read.sourceRevision,
    readAt: read.readAt,
  } satisfies CaseWorkViewModel);
}

// ---------------------------------------------------------------------------
// The task execute/review surface (UXM1.0 `/tasks/:id` expert row)
// ---------------------------------------------------------------------------

/** The posture of the task surface: what the expert is being asked to do. */
export type TaskPosture = 'execute' | 'review' | 'closed';

/** The found task execute/review view model. */
export interface TaskWorkViewModel extends WorkbenchBase {
  readonly status: 'found';
  readonly surface: 'task-work';
  readonly posture: TaskPosture;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly taskState: StructuralState;
  readonly taskStateClass: ExpertTaskStateClass;
  readonly assignedExpertId: string | undefined;
  readonly caseRecordId: string;
  readonly caseId: string;
  readonly caseTitle: string;
  readonly caseLifecycle: StructuralState;
  readonly caseHref: string;
  readonly run: RunContext;
  readonly trajectory: readonly TrajectoryStep[];
  readonly evaluation: EvaluationBlock;
  readonly verification: VerificationBlock;
  readonly suggestion: SuggestionBlock;
  readonly evidence: readonly ExpertEvidenceCard[];
  readonly qualifications: readonly ExpertQualificationCard[];
  readonly qualificationNote: string;
  readonly sourceVersion: number;
  readonly sourceRevision: number;
  readonly readAt: number;
}

/** The honest not-found/unassigned outcomes of the task surface. */
export interface TaskNotFoundViewModel extends WorkbenchBase {
  readonly status: 'case-not-found' | 'task-not-found' | 'not-assigned';
  readonly surface: 'task-work';
  readonly taskId: string;
  readonly caseRecordId: string;
  /** The expert the record assigns the task to (present on the not-assigned outcome). */
  readonly assignedExpertId?: string;
}

export type TaskWorkModel = TaskWorkViewModel | TaskNotFoundViewModel;

/**
 * Build the task execute/review view: the task as the canonical case
 * record carries it (verbatim state + honest class), the recorded run
 * context (trajectory + run state + trajectory outcome — observation vs
 * action vs tool vs result vs model-output kept distinct), the evaluation
 * and verification the work has received (distinct concepts, never
 * collapsed), the evidence the workbench has appended so far, and the
 * expert's qualifications (scoped judgment domains — an input to the
 * judgment, never an authorization).
 */
export async function buildTaskWorkView(
  options: BuildWorkbenchOptions & {
    readonly taskId: string;
    readonly caseRecordId: string;
  },
): Promise<TaskWorkModel> {
  const isDemo = options.mode === 'demo';
  const base = Object.freeze({
    mode: options.mode,
    tenantId: options.facts.tenantId,
    workspaceId: options.facts.workspaceId,
    principalId: options.facts.principalId,
    principalLabel: options.facts.principalLabel,
    hrefBase: options.mode === 'demo' ? '/demo/expert' : '/expert',
    demo: Object.freeze({
      isDemo,
      ...(isDemo && options.corpusHash !== undefined ? { corpusHash: options.corpusHash } : {}),
    }),
  });
  let read: CanonicalRead;
  try {
    read = await options.port.read(options.caseRecordId);
  } catch (error) {
    if (isExpertReadNotFound(error)) {
      return Object.freeze({
        ...base,
        status: 'case-not-found',
        surface: 'task-work',
        taskId: options.taskId,
        caseRecordId: options.caseRecordId,
      } satisfies TaskNotFoundViewModel);
    }
    throw error;
  }
  const data = asRecord(read.data);
  const carried = carriedTasks(data);
  const task = carried.tasks.find((entry) => entry.taskId === options.taskId);
  if (task === undefined) {
    return Object.freeze({
      ...base,
      status: 'task-not-found',
      surface: 'task-work',
      taskId: options.taskId,
      caseRecordId: read.recordId,
    } satisfies TaskNotFoundViewModel);
  }
  if (task.assignedExpertId !== undefined && task.assignedExpertId !== options.facts.principalId) {
    return Object.freeze({
      ...base,
      status: 'not-assigned',
      surface: 'task-work',
      taskId: options.taskId,
      caseRecordId: read.recordId,
      assignedExpertId: task.assignedExpertId,
    } satisfies TaskNotFoundViewModel);
  }
  const classified = taskStateClass(task.state);
  const posture: TaskPosture =
    classified.class === 'awaiting-expert' && task.state === 'in-review'
      ? 'review'
      : isOpenTaskClass(classified.class)
        ? 'execute'
        : 'closed';
  const [evidence, qualifications] = await Promise.all([
    readExpertEvidenceLedger(options.port, read.recordId, task.taskId, { isDemo }),
    projectQualificationCards(options.port, isDemo),
  ]);
  return Object.freeze({
    ...base,
    status: 'found',
    surface: 'task-work',
    posture,
    taskId: task.taskId,
    taskTitle: task.title,
    taskState: classified.state,
    taskStateClass: classified.class,
    assignedExpertId: task.assignedExpertId,
    caseRecordId: read.recordId,
    caseId: stringField(data, 'caseId') ?? read.recordId,
    caseTitle: genericTitle(data, read.recordId),
    caseLifecycle: caseLifecycle(data['lifecycle'] ?? data['status']),
    caseHref:
      options.mode === 'demo'
        ? `/demo/expert/cases/${encodeURIComponent(read.recordId)}`
        : `/expert/cases/${encodeURIComponent(read.recordId)}`,
    run: toRunContext(data),
    trajectory: toTrajectorySteps(data),
    evaluation: toEvaluationBlock(data),
    verification: toVerificationBlock(data),
    suggestion: toSuggestionBlock(data),
    evidence,
    qualifications: qualifications.cards,
    qualificationNote: QUALIFICATION_NOTE,
    sourceVersion: read.sourceVersion,
    sourceRevision: read.sourceRevision,
    readAt: read.readAt,
  } satisfies TaskWorkViewModel);
}

// ---------------------------------------------------------------------------
// Notes (persistent product-truth statements of this surface)
// ---------------------------------------------------------------------------

/** The persistent body-truth note for assigned-body surfaces. */
export const BODY_NOT_MODEL_NOTE =
  'A body is a composition of skills, knowledge, tools and procedures — the body reference names what was composed, never which model ran it; possession of a substrate is composition-scoped.';

/** The persistent evidence note for the submission surface. */
export const EVIDENCE_APPEND_ONLY_NOTE =
  'Submitting evidence appends an expert-judgment record to the task\u2019s ledger through the control-plane repository. It never changes the task state, the run state, an evaluation verdict or a verification verdict — expert judgment is expert judgment, not verification.';

/** The persistent run-state honesty note. */
export const RUN_STATE_HONESTY_NOTE =
  'Run and trajectory state render exactly as the canonical record carries them. Where the record carries none, the state is unknown — never guessed from the timeline\u2019s shape.';
