/**
 * Assigned-work discovery view models (Work Order B009; issue #81;
 * apps/web/src/expert). SERVER-ONLY.
 *
 * The expert landing (UXM1.0 `/` expert lens: "assigned work") and the
 * assigned-cases list (`/cases` expert lens): every row comes from a
 * CANONICAL READ through the B005 boundary (the injected read port) and
 * carries:
 *   - its canonical product-truth classification (B003 taxonomy; the demo
 *     posture uses the B006 corpus's own per-record labels);
 *   - the structural lifecycle states VERBATIM as the record carries them
 *     (A005 case lifecycle; task states), with honest recognition flags —
 *     unknown stays unknown, never guessed;
 *   - the source record's version + revision (reload drift is
 *     detectable, never cached).
 *
 * Assignment identity: the capability-case record carries the task list.
 * Where a task entry names an `assignedExpertId`, only that expert sees it
 * in their queue; where the record carries no assignee, the task is
 * surfaced for the expert lens with the honest note that the case record
 * does not name an assigning expert. Nothing here is authorization: the
 * qualification panel renders scoped judgment domains (A007 semantics —
 * qualification is an INPUT to matching, never an access decision).
 */

import { describeDemoRecord, DemoError } from '@arena/demo';
import type { DemoRecordSummary } from '@arena/demo';
import type { CanonicalRead, KindInventory } from '../../../../packages/read-model/src/index.js';
import {
  REFERENCE_ROLE_REGISTRY,
  getRoleDefinition,
} from '../../../../packages/role-context/src/index.js';
import {
  classifyDatum,
  DEMO_LABEL_TO_CANONICAL_KIND,
  caseLifecycle,
  taskStateClass,
  isOpenTaskClass,
} from './state-mark.js';
import type {
  ExpertTruthTreatment,
  StructuralState,
  ExpertTaskStateClass,
} from './state-mark.js';
import type { ExpertReadPort, ExpertSessionFacts } from './runtime.js';

/** The expert reference role (name + goal from the B003 registry — never re-transcribed). */
export const EXPERT_ROLE = Object.freeze({ ...getRoleDefinition(REFERENCE_ROLE_REGISTRY, 'expert') });

/** The persistent "qualification is not authorization" note rendered on the expert landing. */
export const QUALIFICATION_NOT_AUTHORIZATION_NOTE =
  'A qualification scopes the judgment domains an expert may speak to; it is an input to matching and audit, never an authorization, and never a verification.';

/** The honest assignment-identity note (case records carry the task list). */
export const ASSIGNMENT_IDENTITY_NOTE =
  'Assignment identity is carried by the canonical case record: tasks that name an assigned expert go to that expert\u2019s queue; where the record names no assignee, the open task is surfaced for this lens. Nothing is fabricated to fill the queue.';

// ---------------------------------------------------------------------------
// Shared projection helpers (honest, structure-only)
// ---------------------------------------------------------------------------

function asRecord(data: unknown): Readonly<Record<string, unknown>> {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Readonly<Record<string, unknown>>)
    : {};
}

/** One classified product truth for rendering. */
export interface TruthClassification {
  readonly kind: string;
  readonly treatment: ExpertTruthTreatment;
  readonly label: string;
}

/**
 * Classify one canonical read for rendering. Classification order
 * (truthful, never invented):
 *   1. demo mode: the B006 demo projector (`describeDemoRecord`) carries
 *      the corpus's own per-record product-truth labels;
 *   2. otherwise / unclassifiable: the B003 total classifier over the
 *      focus datum (`stateKind` field when present; `unknown`
 *      otherwise — rendered as unknown, never guessed).
 */
function classifyForRender(
  read: CanonicalRead,
  isDemo: boolean,
  focus?: Readonly<Record<string, unknown>>,
): TruthClassification {
  let kind = classifyDatum(focus ?? asRecord(read.data)).kind;
  if (isDemo) {
    try {
      const demoSummary: DemoRecordSummary = describeDemoRecord(read);
      kind = DEMO_LABEL_TO_CANONICAL_KIND[demoSummary.truth];
    } catch (error) {
      // Outside the demo corpus vocabulary: keep the honest generic
      // classification (unknown stays unknown — never guessed).
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

/** An honest generic title from a canonical record payload (no fabricated claims). */
function genericTitle(data: Readonly<Record<string, unknown>>, recordId: string): string {
  for (const key of ['title', 'displayName', 'name', 'qualificationId', 'caseId']) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return recordId;
}

// ---------------------------------------------------------------------------
// Qualification panel (A007 semantics: qualification is data, never authorization)
// ---------------------------------------------------------------------------

/** One expert qualification as carried by a canonical `expert-qualification` record. */
export interface ExpertQualificationCard {
  readonly recordId: string;
  readonly kind: 'expert-qualification';
  readonly title: string;
  readonly domain: string;
  readonly scope: readonly string[];
  readonly judgmentSummary: string;
  readonly basis: string;
  readonly truth: TruthClassification;
  readonly demo: boolean;
  readonly sourceVersion: number;
  readonly sourceRevision: number;
}

function toQualificationCard(read: CanonicalRead, isDemo: boolean): ExpertQualificationCard {
  const data = asRecord(read.data);
  const judgment = asRecord(data['judgment']);
  const domain = typeof data['domain'] === 'string' ? data['domain'] : '';
  const title = isDemo
    ? `Expert qualification — ${domain}`
    : genericTitle(data, read.recordId);
  // The qualification's product-truth classification: in session mode the
  // judgment object is the classifiable datum (its `stateKind` when the
  // writer carried one); in demo mode the corpus's own label wins.
  const truth =
    !isDemo && judgment['stateKind'] !== undefined
      ? classifyForRender(read, isDemo, judgment)
      : classifyForRender(read, isDemo);
  return Object.freeze({
    recordId: read.recordId,
    kind: 'expert-qualification',
    title,
    domain,
    scope: Object.freeze(
      Array.isArray(data['scope'])
        ? data['scope'].filter((entry): entry is string => typeof entry === 'string')
        : [],
    ),
    judgmentSummary: typeof judgment['summary'] === 'string' ? judgment['summary'] : '',
    basis: typeof judgment['basis'] === 'string' ? judgment['basis'] : '',
    truth,
    demo: isDemo,
    sourceVersion: read.sourceVersion,
    sourceRevision: read.sourceRevision,
  });
}

// ---------------------------------------------------------------------------
// Assignment rows (task-level: what work am I being asked to perform?)
// ---------------------------------------------------------------------------

/** One task entry as carried by a canonical capability-case record. */
interface CarriedTask {
  readonly taskId: string;
  readonly title: string;
  readonly state: unknown;
  readonly assignedExpertId: string | undefined;
}

/** Extract the task list a case record carries (malformed entries are counted, never guessed into rows). */
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
      title: typeof task['title'] === 'string' && task['title'].length > 0 ? task['title'] : taskId,
      state: task['state'],
      assignedExpertId: typeof assigned === 'string' && assigned.length > 0 ? assigned : undefined,
    });
  }
  return { tasks: Object.freeze(tasks), unrecognized };
}

/** One assignment row: a task of a case, truthfully classified. */
export interface ExpertAssignmentRow {
  readonly caseRecordId: string;
  readonly caseTitle: string;
  readonly caseId: string;
  readonly lifecycle: StructuralState;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly taskState: StructuralState;
  readonly taskStateClass: ExpertTaskStateClass;
  /** The assigned expert the record names (undefined when the record names none). */
  readonly assignedExpertId: string | undefined;
  readonly truth: TruthClassification;
  readonly demo: boolean;
  readonly sourceVersion: number;
  readonly sourceRevision: number;
  readonly href: string;
}

/** One assigned-case row (case-level rollup for `/cases` expert lens). */
export interface AssignedCaseRow {
  readonly caseRecordId: string;
  readonly caseTitle: string;
  readonly caseId: string;
  readonly lifecycle: StructuralState;
  readonly taskTotal: number;
  readonly taskOpen: number;
  readonly taskUnknown: number;
  readonly truth: TruthClassification;
  readonly demo: boolean;
  readonly sourceVersion: number;
  readonly sourceRevision: number;
  readonly href: string;
}

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

/** The complete assigned-work (expert landing) view model. */
export interface AssignedWorkViewModel {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly principalLabel: string;
  readonly grantedRoleIds: readonly string[];
  readonly roleName: string;
  readonly roleGoal: string;
  readonly qualifications: readonly ExpertQualificationCard[];
  readonly qualificationNote: string;
  readonly assignments: readonly ExpertAssignmentRow[];
  readonly openAssignments: readonly ExpertAssignmentRow[];
  readonly doneAssignments: readonly ExpertAssignmentRow[];
  /** Rows whose task state the closed vocabulary does not recognize — rendered as carried, never guessed. */
  readonly unknownAssignments: readonly ExpertAssignmentRow[];
  readonly unrecognizedTaskEntries: number;
  readonly assignmentNote: string;
  readonly emptyKinds: readonly string[];
  readonly inventory: KindInventory;
  readonly readAt: number;
  readonly demo: {
    readonly isDemo: boolean;
    readonly corpusHash?: string;
  };
  readonly hrefBase: string;
  readonly casesHref: string;
}

/** The assigned-cases view model (`/cases` expert lens). */
export interface AssignedCasesViewModel {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalLabel: string;
  readonly cases: readonly AssignedCaseRow[];
  readonly unrecognizedTaskEntries: number;
  readonly emptyKinds: readonly string[];
  readonly inventory: KindInventory;
  readonly readAt: number;
  readonly demo: {
    readonly isDemo: boolean;
    readonly corpusHash?: string;
  };
  readonly hrefBase: string;
}

export interface BuildExpertViewOptions {
  readonly mode: 'session' | 'demo';
  readonly facts: ExpertSessionFacts;
  readonly port: ExpertReadPort;
  /** Demo corpus hash (demo mode determinism stamp). */
  readonly corpusHash?: string;
}

/** Base href of the expert workbench routes for this mode ('/expert' session, '/demo/expert' demo). */
export function expertHrefBase(mode: 'session' | 'demo'): string {
  return mode === 'demo' ? '/demo/expert' : '/expert';
}

/** The href of one task's execute/review surface (explicit query state carries the case). */
export function taskHref(mode: 'session' | 'demo', taskId: string, caseRecordId: string): string {
  return `${expertHrefBase(mode)}/tasks/${encodeURIComponent(taskId)}?case=${encodeURIComponent(caseRecordId)}`;
}

/** The href of one case's work lens. */
export function caseHref(mode: 'session' | 'demo', caseRecordId: string): string {
  return `${expertHrefBase(mode)}/cases/${encodeURIComponent(caseRecordId)}`;
}

interface CaseProjection {
  readonly read: CanonicalRead;
  readonly data: Readonly<Record<string, unknown>>;
  readonly title: string;
  readonly caseId: string;
  readonly lifecycle: StructuralState;
  readonly truth: TruthClassification;
  readonly tasks: readonly CarriedTask[];
  readonly unrecognized: number;
}

async function projectCases(
  port: ExpertReadPort,
  isDemo: boolean,
): Promise<{ readonly cases: readonly CaseProjection[]; readonly readAt: number }> {
  const page = await port.scroll('capability-case');
  const cases: CaseProjection[] = [];
  let readAt = page.readAt;
  for (const record of page.records) {
    readAt = Math.max(readAt, record.readAt);
    const data = asRecord(record.data);
    const carried = carriedTasks(data);
    cases.push({
      read: record,
      data,
      title: genericTitle(data, record.recordId),
      caseId: typeof data['caseId'] === 'string' ? data['caseId'] : record.recordId,
      lifecycle: caseLifecycle(data['lifecycle'] ?? data['status']),
      truth: classifyForRender(record, isDemo),
      tasks: carried.tasks,
      unrecognized: carried.unrecognized,
    });
  }
  return { cases: Object.freeze(cases), readAt };
}

export async function projectQualificationCards(
  port: ExpertReadPort,
  isDemo: boolean,
): Promise<{ readonly cards: readonly ExpertQualificationCard[]; readonly readAt: number }> {
  const page = await port.scroll('expert-qualification');
  let readAt = page.readAt;
  const cards: ExpertQualificationCard[] = [];
  for (const record of page.records) {
    readAt = Math.max(readAt, record.readAt);
    cards.push(toQualificationCard(record, isDemo));
  }
  return { cards: Object.freeze(cards), readAt };
}

/**
 * Build the assigned-work (expert landing) view: qualifications (scoped
 * judgment domains) + task-level assignment rows from canonical case
 * reads, each with truthful state classification. Rows for tasks the
 * record assigns to ANOTHER expert are excluded; rows with no named
 * assignee are surfaced with the honest assignment-identity note.
 */
export async function buildAssignedWorkView(
  options: BuildExpertViewOptions,
): Promise<AssignedWorkViewModel> {
  const isDemo = options.mode === 'demo';
  const [qualifications, caseProjection, inventory] = await Promise.all([
    projectQualificationCards(options.port, isDemo),
    projectCases(options.port, isDemo),
    options.port.inventory(),
  ]);
  const assignments: ExpertAssignmentRow[] = [];
  let unrecognizedTaskEntries = 0;
  for (const projection of caseProjection.cases) {
    unrecognizedTaskEntries += projection.unrecognized;
    for (const task of projection.tasks) {
      if (task.assignedExpertId !== undefined && task.assignedExpertId !== options.facts.principalId) {
        continue; // the record assigns this task to another expert
      }
      const classified = taskStateClass(task.state);
      assignments.push(
        Object.freeze({
          caseRecordId: projection.read.recordId,
          caseTitle: projection.title,
          caseId: projection.caseId,
          lifecycle: projection.lifecycle,
          taskId: task.taskId,
          taskTitle: task.title,
          taskState: classified.state,
          taskStateClass: classified.class,
          assignedExpertId: task.assignedExpertId,
          truth: projection.truth,
          demo: isDemo,
          sourceVersion: projection.read.sourceVersion,
          sourceRevision: projection.read.sourceRevision,
          href: taskHref(options.mode, task.taskId, projection.read.recordId),
        }),
      );
    }
  }
  const openAssignments = Object.freeze(assignments.filter((row) => isOpenTaskClass(row.taskStateClass)));
  const doneAssignments = Object.freeze(assignments.filter((row) => row.taskStateClass === 'done'));
  const unknownAssignments = Object.freeze(assignments.filter((row) => row.taskStateClass === 'unknown'));
  const emptyKinds: string[] = [];
  if (qualifications.cards.length === 0) emptyKinds.push('expert-qualification');
  if (caseProjection.cases.length === 0) emptyKinds.push('capability-case');
  return Object.freeze({
    mode: options.mode,
    tenantId: options.facts.tenantId,
    workspaceId: options.facts.workspaceId,
    principalId: options.facts.principalId,
    principalLabel: options.facts.principalLabel,
    grantedRoleIds: Object.freeze([...options.facts.grantedRoleIds]),
    roleName: EXPERT_ROLE.name,
    roleGoal: EXPERT_ROLE.goal,
    qualifications: qualifications.cards,
    qualificationNote: QUALIFICATION_NOT_AUTHORIZATION_NOTE,
    assignments: Object.freeze(assignments),
    openAssignments,
    doneAssignments,
    unknownAssignments,
    unrecognizedTaskEntries,
    assignmentNote: ASSIGNMENT_IDENTITY_NOTE,
    emptyKinds: Object.freeze(emptyKinds),
    inventory,
    readAt: Math.max(qualifications.readAt, caseProjection.readAt),
    demo: Object.freeze({
      isDemo,
      ...(isDemo && options.corpusHash !== undefined ? { corpusHash: options.corpusHash } : {}),
    }),
    hrefBase: expertHrefBase(options.mode),
    casesHref: `${expertHrefBase(options.mode)}/cases`,
  } satisfies AssignedWorkViewModel);
}

/** Build the assigned-cases view (case-level rollup, `/cases` expert lens). */
export async function buildAssignedCasesView(
  options: BuildExpertViewOptions,
): Promise<AssignedCasesViewModel> {
  const isDemo = options.mode === 'demo';
  const [caseProjection, inventory] = await Promise.all([
    projectCases(options.port, isDemo),
    options.port.inventory(),
  ]);
  let unrecognizedTaskEntries = 0;
  const cases: AssignedCaseRow[] = caseProjection.cases.map((projection) => {
    unrecognizedTaskEntries += projection.unrecognized;
    let taskOpen = 0;
    let taskUnknown = 0;
    for (const task of projection.tasks) {
      const classified = taskStateClass(task.state);
      if (isOpenTaskClass(classified.class)) taskOpen += 1;
      else if (classified.class === 'unknown') taskUnknown += 1;
    }
    return Object.freeze({
      caseRecordId: projection.read.recordId,
      caseTitle: projection.title,
      caseId: projection.caseId,
      lifecycle: projection.lifecycle,
      taskTotal: projection.tasks.length,
      taskOpen,
      taskUnknown,
      truth: projection.truth,
      demo: isDemo,
      sourceVersion: projection.read.sourceVersion,
      sourceRevision: projection.read.sourceRevision,
      href: caseHref(options.mode, projection.read.recordId),
    });
  });
  const emptyKinds: string[] = caseProjection.cases.length === 0 ? ['capability-case'] : [];
  return Object.freeze({
    mode: options.mode,
    tenantId: options.facts.tenantId,
    workspaceId: options.facts.workspaceId,
    principalLabel: options.facts.principalLabel,
    cases: Object.freeze(cases),
    unrecognizedTaskEntries,
    emptyKinds: Object.freeze(emptyKinds),
    inventory,
    readAt: caseProjection.readAt,
    demo: Object.freeze({
      isDemo,
      ...(isDemo && options.corpusHash !== undefined ? { corpusHash: options.corpusHash } : {}),
    }),
    hrefBase: expertHrefBase(options.mode),
  } satisfies AssignedCasesViewModel);
}
