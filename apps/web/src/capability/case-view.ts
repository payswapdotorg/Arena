/**
 * Case + task view-model composition (Work Order B008; issue #80;
 * apps/web/src/capability). SERVER-ONLY.
 *
 * Every datum is read through the canonical read port (the B005 boundary
 * in session mode; the B006 demo read session in demo mode) and carries
 * its canonical product-truth classification through the B007 state-mark
 * pattern (injective; distinct pending/unknown marks; unknown never
 * guessed). Two honest record shapes are supported:
 *
 *   - CANONICAL case records (created through the product-flows runtime):
 *     parsed + digest-verified, lifecycle status projected through the
 *     guided definitions (next-step cues, honest dead-ends);
 *   - NARRATIVE-shaped case records (the B006 demo corpus): NOT canonical
 *     protocol objects — rendered with their demo corpus truth labels and
 *     an explicit note that the guided flow cannot transition them (a
 *     new canonical case is started instead). Never guessed into shape.
 *
 * Tasks: canonical TaskSpec records (kind `task-spec`, read by id) render
 * as PROPOSALS (suggestion/hypothesis — specs are proposals until
 * pinned); demo narrative tasks embedded in the corpus case record
 * render as labelled narrative state.
 */

import { isCapabilityCase } from '../../../../packages/capability-case/src/index.js';
import type { CapabilityCase, CaseStatus } from '../../../../packages/capability-case/src/index.js';
import type { TaskSpec } from '../../../../packages/task-spec/src/index.js';
import { isTaskSpec } from '../../../../packages/task-spec/src/index.js';
import {
  FLOW_SUPPLEMENT,
  GUIDED_FLOW_STEPS,
  nextGuidedStep,
} from '../../../../packages/product-flows/src/index.js';
import type { FlowStepDefinition } from '../../../../packages/product-flows/src/index.js';
import { isDemoTenant } from '@arena/demo';
import { describeDemoRecord, DemoError, DEMO_LABELLING } from '@arena/demo';
import type { DemoRecordSummary } from '@arena/demo';
import type { CanonicalRead, ReadPage } from '../../../../packages/read-model/src/index.js';
import type { RoleId } from '../../../../packages/role-context/src/index.js';
import type { CanonicalStateKind } from '../../../../packages/role-context/src/index.js';
import { classifyDatum, DEMO_LABEL_TO_CANONICAL_KIND, truthTreatment } from '../cockpit/state-mark.js';
import type { CockpitTruthTreatment } from '../cockpit/state-mark.js';
import { resolveActiveRole } from '../cockpit/role-lens.js';
import type { CockpitReadPort, CockpitSessionFacts } from '../cockpit/runtime.js';
import { CASE_DETAIL_LENSES, CASE_LIST_LENSES, TASK_LENSES } from './role-lens.js';
import type { CaseDetailLens, CaseListLens, TaskLens } from './role-lens.js';

// ---------------------------------------------------------------------------
// Product-truth classification of the surfaced data (honest, injective)
// ---------------------------------------------------------------------------

/**
 * The canonical classification of a case LIFECYCLE STATUS datum:
 * non-terminal statuses are processes IN FLIGHT ('pending' — never
 * badgeable as a result); terminal statuses are digest-verified facts
 * about the authoritative control-plane record ('verified-fact' — every
 * render re-verifies the case content digest through the product-flows
 * codec). This is RECORD-INTEGRITY verification, not capability
 * verification (A013) — evaluation/verification results carry their own
 * distinct kinds, and the surfaces say so explicitly.
 */
export function classifyCaseStatus(status: CaseStatus): CanonicalStateKind {
  return status === 'resolved' || status === 'superseded' ? 'verified-fact' : 'pending';
}

/** The canonical classification of a TaskSpec record: a PROPOSAL awaiting validation. */
export const TASK_SPEC_STATE_KIND: CanonicalStateKind = 'suggestion-hypothesis';

/** One truth-classified datum line rendered by the capability surfaces. */
export interface CapabilityDatum {
  readonly label: string;
  readonly text: string;
  readonly stateKind: CanonicalStateKind;
  readonly treatment: CockpitTruthTreatment;
  readonly stateLabel: string;
}

/** Classify one datum line through the B007 state-mark pattern. */
function datum(label: string, text: string, stateKind: CanonicalStateKind): CapabilityDatum {
  const classification = classifyDatum({ stateKind });
  return Object.freeze({
    label,
    text,
    stateKind,
    treatment: truthTreatment(classification.kind),
    stateLabel: classification.label,
  });
}

// ---------------------------------------------------------------------------
// Case projections
// ---------------------------------------------------------------------------

/** One case card on the list surface. */
export interface CaseCard {
  readonly recordId: string;
  /** 'canonical' (product-flows case) | 'narrative' (demo corpus record). */
  readonly shape: 'canonical' | 'narrative';
  readonly title: string;
  readonly summary: string;
  readonly caseId: string;
  readonly version?: string;
  readonly status?: CaseStatus;
  readonly facts: readonly CapabilityDatum[];
  readonly nextStep?: FlowStepDefinition;
  readonly demo: boolean;
  readonly demoCorpus: boolean;
}

/** The case list view model. */
export interface CaseListViewModel {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly principalLabel: string;
  readonly roleSwitch: {
    readonly grantedRoleIds: readonly RoleId[];
    readonly activeRoleId: RoleId;
    readonly denied: boolean;
    readonly deniedRequested?: string;
  };
  readonly lens: CaseListLens;
  readonly cards: readonly CaseCard[];
  readonly empty: boolean;
  readonly readAt: number;
  readonly demo: { readonly isDemo: boolean; readonly corpusHash?: string };
  readonly roleHrefBase: string;
}

/** Generic title/summary extraction for narrative-shaped records (no fabrication). */
function narrativeTitle(data: Readonly<Record<string, unknown>>, recordId: string): string {
  for (const key of ['title', 'displayName', 'name']) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return recordId;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

/** Project one canonical read into a case card (canonical or narrative shape). */
function toCaseCard(read: CanonicalRead, isDemo: boolean): CaseCard {
  const data = asRecord(read.data);
  const demoCorpus = isDemo;
  if (isCapabilityCase(read.data)) {
    const caseRecord = read.data as CapabilityCase;
    const status = caseRecord.status;
    const nextStep = nextGuidedStep(status);
    // Demo tenant canonical cases are demo state — visibly labelled.
    const stateKind: CanonicalStateKind = demoCorpus && isDemoTenant(read.tenantId)
      ? 'demo-state'
      : classifyCaseStatus(status);
    return Object.freeze({
      recordId: read.recordId,
      shape: 'canonical',
      title: caseRecord.problemStatement,
      summary: caseRecord.desiredOutcome,
      caseId: caseRecord.identity.caseId,
      version: caseRecord.version,
      status,
      facts: Object.freeze([
        datum('Case id', caseRecord.identity.caseId, 'verified-fact'),
        datum('Version', caseRecord.version, 'verified-fact'),
        datum('Status', status, stateKind),
        datum('Evidence refs', String(caseRecord.evidence.length), 'evidence'),
        datum('Lifecycle events', String(caseRecord.lifecycle.length), 'verified-fact'),
      ]),
      ...(nextStep !== null ? { nextStep } : {}),
      demo: isDemo,
      demoCorpus,
    } satisfies CaseCard);
  }
  // Narrative-shaped record (the B006 demo corpus case): honest fallback.
  let title = narrativeTitle(data, read.recordId);
  let truth: CanonicalStateKind = classifyDatum(data).kind;
  if (isDemo) {
    try {
      const summary: DemoRecordSummary = describeDemoRecord(read);
      title = summary.title;
      truth = DEMO_LABEL_TO_CANONICAL_KIND[summary.truth];
    } catch (error) {
      if (!(error instanceof DemoError)) throw error;
    }
  }
  return Object.freeze({
    recordId: read.recordId,
    shape: 'narrative',
    title,
    summary: 'Narrative-shaped demo record — not a canonical A005 case protocol object; the guided flow starts a NEW canonical case rather than transitioning this one.',
    caseId: typeof data['caseId'] === 'string' ? data['caseId'] : read.recordId,
    facts: Object.freeze([
      datum('Record', read.recordId, truth),
      datum('Kind', read.kind, 'verified-fact'),
    ]),
    demo: isDemo,
    demoCorpus,
  } satisfies CaseCard);
}

/** Build the case list view model (reads THROUGH the canonical read port). */
export async function buildCaseListView(options: {
  readonly mode: 'session' | 'demo';
  readonly facts: CockpitSessionFacts;
  readonly port: CockpitReadPort;
  readonly requestedRoleId?: string;
  readonly corpusHash?: string;
}): Promise<CaseListViewModel> {
  const isDemo = options.mode === 'demo';
  const roleHrefBase = isDemo ? '/demo/cases' : '/cases';
  const resolution = resolveActiveRole({
    grantedRoleIds: options.facts.grantedRoleIds,
    ...(options.requestedRoleId !== undefined ? { requested: options.requestedRoleId } : {}),
    ...(isDemo ? { defaultRoleId: 'owner' as RoleId } : {}),
  });
  const activeRoleId =
    resolution.status === 'granted' ? resolution.roleId : resolution.fallbackRoleId;
  const lens = CASE_LIST_LENSES[activeRoleId];
  const page: ReadPage = await options.port.scroll('capability-case');
  const cards = page.records.map((record) => toCaseCard(record, isDemo));
  let readAt = page.readAt;
  for (const record of page.records) {
    readAt = Math.max(readAt, record.readAt);
  }
  return Object.freeze({
    mode: options.mode,
    tenantId: options.facts.tenantId,
    principalLabel: options.facts.principalLabel,
    roleSwitch: Object.freeze({
      grantedRoleIds: Object.freeze([...options.facts.grantedRoleIds]),
      activeRoleId,
      denied: resolution.status === 'not-granted',
      ...(resolution.status === 'not-granted' ? { deniedRequested: resolution.requested } : {}),
    }),
    lens,
    cards: Object.freeze(cards),
    empty: cards.length === 0,
    readAt,
    demo: Object.freeze({
      isDemo,
      ...(isDemo && options.corpusHash !== undefined ? { corpusHash: options.corpusHash } : {}),
    }),
    roleHrefBase,
  } satisfies CaseListViewModel);
}

// ---------------------------------------------------------------------------
// Case detail
// ---------------------------------------------------------------------------

/** One guided step row on the detail surface (done / current / upcoming / dead-end). */
export interface GuidedStepRow {
  readonly step: FlowStepDefinition;
  readonly phase: 'done' | 'current' | 'upcoming';
}

/** The case detail view model. */
export interface CaseDetailViewModel {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly recordId: string;
  readonly shape: 'canonical' | 'narrative';
  readonly title: string;
  readonly summary: string;
  readonly caseId: string;
  readonly version?: string;
  readonly status?: CaseStatus;
  readonly terminal: boolean;
  readonly lens: CaseDetailLens;
  readonly roleSwitch: {
    readonly grantedRoleIds: readonly RoleId[];
    readonly activeRoleId: RoleId;
    readonly denied: boolean;
    readonly deniedRequested?: string;
  };
  readonly facts: readonly CapabilityDatum[];
  /** Canonical case: the §5 requirement groups, truthfully classified. */
  readonly requirements: readonly { readonly group: string; readonly entries: readonly CapabilityDatum[] }[];
  /** Canonical case: the append-only lifecycle event history. */
  readonly history: readonly {
    readonly sequence: number;
    readonly kind: string;
    readonly occurredAt: string;
    readonly actor: string;
    readonly fromStatus: string;
    readonly toStatus: string;
    readonly note?: string;
    readonly treatment: CockpitTruthTreatment;
  }[];
  /** The guided path rendered as done/current/upcoming rows. */
  readonly guided: readonly GuidedStepRow[];
  /** The honest next step (null at terminal — dead-end + follow-up guidance). */
  readonly nextStep: FlowStepDefinition | null;
  readonly demo: { readonly isDemo: boolean; readonly corpusHash?: string };
  readonly roleHrefBase: string;
  readonly supplement: typeof FLOW_SUPPLEMENT;
  readonly flowActionsBase: string;
}

const REQUIREMENT_GROUPS: ReadonlyArray<{
  readonly group: string;
  readonly pick: (caseRecord: CapabilityCase) => readonly CapabilityDatum[];
}> = Object.freeze([
  {
    group: 'Observed failure',
    pick: (c) => [
      datum('Summary', c.observedFailure.summary, 'evidence'),
      ...(c.observedFailure.reproduction !== undefined
        ? [datum('Reproduction', c.observedFailure.reproduction as string, 'evidence')]
        : []),
      datum('Observed at', c.observedFailure.observedAt, 'verified-fact'),
    ],
  },
  {
    group: 'Capability gap',
    pick: (c) => [
      datum('Target capability', `${c.targetCapability.id}@${c.targetCapability.version}`, 'suggestion-hypothesis'),
      datum('Domain', `${c.domain.id}@${c.domain.version}`, 'verified-fact'),
      datum('Unknowns', c.unknowns.join(' · '), 'unknown'),
      datum('Desired outcome', c.desiredOutcome, 'suggestion-hypothesis'),
    ],
  },
  {
    group: 'Evidence (append-only)',
    pick: (c) =>
      c.evidence.map((ref) => datum(ref.digest.slice(0, 16), ref.description, 'evidence')),
  },
  {
    group: 'Expert requirements',
    pick: (c) => [
      ...c.expertRequirements.competencies.map((ref) =>
        datum('Competency', `${ref.id}@${ref.version}`, 'verified-fact'),
      ),
      ...c.expertRequirements.qualifications.map((q) =>
        datum('Qualification', q, 'verified-fact'),
      ),
    ],
  },
  {
    group: 'Environment requirements',
    pick: (c) => [
      ...c.environmentRequirements.environments.map((ref) =>
        datum('Environment', `${ref.namespace}/${ref.name}@${ref.version}`, 'verified-fact'),
      ),
      ...c.environmentRequirements.constraints.map((entry) =>
        datum('Constraint', entry, 'verified-fact'),
      ),
    ],
  },
  {
    group: 'Task requirements',
    pick: (c) => [
      ...c.taskRequirements.objectives.map((o) => datum('Objective', o, 'suggestion-hypothesis')),
      ...c.taskRequirements.constraints.map((entry) => datum('Constraint', entry, 'verified-fact')),
      ...c.taskRequirements.allowedTools.map((tool) =>
        datum('Allowed tool', `${tool.namespace}/${tool.name}@${tool.version}`, 'verified-fact'),
      ),
      ...c.taskRequirements.forbiddenShortcuts.map((entry) =>
        datum('Forbidden shortcut', entry, 'verified-fact'),
      ),
      ...c.taskRequirements.successConditions.map((entry) =>
        datum('Success condition', entry, 'suggestion-hypothesis'),
      ),
      ...c.taskRequirements.evidenceCriteria.map((entry) =>
        datum('Evidence criterion', entry, 'evidence'),
      ),
      datum('Difficulty', c.taskRequirements.difficulty, 'verified-fact'),
    ],
  },
  {
    group: 'Evaluation requirements (≠ verification)',
    pick: (c) => [
      ...c.evaluationRequirements.evaluators.map((ref) =>
        datum('Evaluator', `${ref.id}@${ref.version}`, 'verified-fact'),
      ),
      ...c.evaluationRequirements.criteria.map((entry) =>
        datum('Criterion', entry, 'suggestion-hypothesis'),
      ),
    ],
  },
  {
    group: 'Verification requirements (≠ evaluation)',
    pick: (c) => [
      ...c.verificationRequirements.verifiers.map((ref) =>
        datum('Verifier', `${ref.id}@${ref.version}`, 'verified-fact'),
      ),
      ...c.verificationRequirements.evidenceStandards.map((entry) =>
        datum('Evidence standard', entry, 'verified-fact'),
      ),
    ],
  },
]);

/** The guided path rows for a canonical case (done/current/upcoming). */
function guidedRows(status: CaseStatus): readonly GuidedStepRow[] {
  const orderOf: Record<string, number> = { new: 0, draft: 1, submitted: 2, triaged: 3, active: 4 };
  const currentOrder = orderOf[status] ?? 0;
  return GUIDED_FLOW_STEPS.map((step) => {
    const stepOrder = step.transition === 'create' ? 0 : orderOf[step.validFrom] ?? 0;
    const phase: GuidedStepRow['phase'] =
      stepOrder < currentOrder ? 'done' : stepOrder === currentOrder ? 'current' : 'upcoming';
    return { step, phase };
  });
}

/** Build the case detail view model for one record id (read through the port). */
export async function buildCaseDetailView(options: {
  readonly mode: 'session' | 'demo';
  readonly facts: CockpitSessionFacts;
  readonly port: CockpitReadPort;
  readonly recordId: string;
  readonly requestedRoleId?: string;
  readonly corpusHash?: string;
}): Promise<CaseDetailViewModel> {
  const isDemo = options.mode === 'demo';
  const roleHrefBase = isDemo ? '/demo/cases' : '/cases';
  const flowActionsBase = isDemo ? '/demo/cases' : '/cases';
  const resolution = resolveActiveRole({
    grantedRoleIds: options.facts.grantedRoleIds,
    ...(options.requestedRoleId !== undefined ? { requested: options.requestedRoleId } : {}),
    ...(isDemo ? { defaultRoleId: 'owner' as RoleId } : {}),
  });
  const activeRoleId =
    resolution.status === 'granted' ? resolution.roleId : resolution.fallbackRoleId;
  const lens = CASE_DETAIL_LENSES[activeRoleId];
  const read: CanonicalRead = await options.port.read(options.recordId);
  const roleSwitch = Object.freeze({
    grantedRoleIds: Object.freeze([...options.facts.grantedRoleIds]),
    activeRoleId,
    denied: resolution.status === 'not-granted',
    ...(resolution.status === 'not-granted' ? { deniedRequested: resolution.requested } : {}),
  });
  const demoMeta = Object.freeze({
    isDemo,
    ...(isDemo && options.corpusHash !== undefined ? { corpusHash: options.corpusHash } : {}),
  });

  if (isCapabilityCase(read.data)) {
    const caseRecord = read.data as CapabilityCase;
    const status = caseRecord.status;
    const stateKind: CanonicalStateKind = isDemo && isDemoTenant(read.tenantId)
      ? 'demo-state'
      : classifyCaseStatus(status);
    const history = caseRecord.lifecycle.map((event) => ({
      sequence: event.sequence,
      kind: event.kind,
      occurredAt: event.occurredAt,
      actor: `${event.actor.type}:${event.actor.principalId}`,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      ...(event.note !== undefined ? { note: event.note } : {}),
      treatment: truthTreatment('verified-fact'),
    }));
    const requirements = REQUIREMENT_GROUPS.map(({ group, pick }) => ({
      group,
      entries: pick(caseRecord),
    })).filter((group) => group.entries.length > 0);
    return Object.freeze({
      mode: options.mode,
      tenantId: options.facts.tenantId,
      recordId: read.recordId,
      shape: 'canonical',
      title: caseRecord.problemStatement,
      summary: caseRecord.desiredOutcome,
      caseId: caseRecord.identity.caseId,
      version: caseRecord.version,
      status,
      terminal: status === 'resolved' || status === 'superseded',
      lens,
      roleSwitch,
      facts: Object.freeze([
        datum('Case id', caseRecord.identity.caseId, 'verified-fact'),
        datum('Version', caseRecord.version, 'verified-fact'),
        datum('Status', status, stateKind),
        datum('Priority', caseRecord.priority, 'verified-fact'),
        datum('Risk', caseRecord.risk, 'verified-fact'),
        datum('Content digest', caseRecord.digest.slice(0, 32), 'verified-fact'),
        ...(caseRecord.currentBody !== undefined
          ? [datum('Current body', `${caseRecord.currentBody.name}@${caseRecord.currentBody.version}`, 'verified-fact')]
          : []),
      ]),
      requirements: Object.freeze(requirements),
      history: Object.freeze(history),
      guided: Object.freeze(guidedRows(status)),
      nextStep: nextGuidedStep(status),
      demo: demoMeta,
      roleHrefBase,
      supplement: FLOW_SUPPLEMENT,
      flowActionsBase,
    } satisfies CaseDetailViewModel);
  }

  // Narrative-shaped record (the demo corpus case): honest rendering.
  const data = asRecord(read.data);
  let title = narrativeTitle(data, read.recordId);
  let truth: CanonicalStateKind = classifyDatum(data).kind;
  let summary = 'Narrative-shaped demo record — not a canonical A005 case protocol object.';
  if (isDemo) {
    try {
      const demoSummary = describeDemoRecord(read);
      title = demoSummary.title;
      summary = demoSummary.summary;
      truth = DEMO_LABEL_TO_CANONICAL_KIND[demoSummary.truth];
    } catch (error) {
      if (!(error instanceof DemoError)) throw error;
    }
  }
  return Object.freeze({
    mode: options.mode,
    tenantId: options.facts.tenantId,
    recordId: read.recordId,
    shape: 'narrative',
    title,
    summary,
    caseId: typeof data['caseId'] === 'string' ? data['caseId'] : read.recordId,
    terminal: false,
    lens,
    roleSwitch,
    facts: Object.freeze([
      datum('Record', read.recordId, truth),
      datum('Kind', read.kind, 'verified-fact'),
      ...(isDemo ? [datum('Demo labelling', DEMO_LABELLING.bannerTitle, 'demo-state')] : []),
    ]),
    requirements: Object.freeze([]),
    history: Object.freeze([]),
    guided: Object.freeze([]),
    nextStep: null,
    demo: demoMeta,
    roleHrefBase,
    supplement: FLOW_SUPPLEMENT,
    flowActionsBase,
  } satisfies CaseDetailViewModel);
}

// ---------------------------------------------------------------------------
// Task view
// ---------------------------------------------------------------------------

/** One narrative task embedded in a demo corpus case record. */
export interface NarrativeTask {
  readonly taskId: string;
  readonly title: string;
  readonly state: string;
  readonly caseRecordId: string;
}

/** The task detail view model (canonical TaskSpec OR narrative demo task). */
export interface TaskDetailViewModel {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly recordId: string;
  readonly shape: 'task-spec' | 'narrative';
  readonly title: string;
  readonly summary: string;
  readonly taskId: string;
  readonly lens: TaskLens;
  readonly roleSwitch: {
    readonly grantedRoleIds: readonly RoleId[];
    readonly activeRoleId: RoleId;
    readonly denied: boolean;
    readonly deniedRequested?: string;
  };
  readonly facts: readonly CapabilityDatum[];
  readonly objectives: readonly CapabilityDatum[];
  readonly constraints: readonly CapabilityDatum[];
  readonly tools: readonly CapabilityDatum[];
  readonly outputs: readonly CapabilityDatum[];
  readonly demo: { readonly isDemo: boolean; readonly corpusHash?: string };
  readonly roleHrefBase: string;
  readonly caseRecordId?: string;
  readonly narrative?: NarrativeTask;
}

function taskRoleSwitch(options: {
  readonly facts: CockpitSessionFacts;
  readonly requestedRoleId?: string;
  readonly isDemo: boolean;
}) {
  const resolution = resolveActiveRole({
    grantedRoleIds: options.facts.grantedRoleIds,
    ...(options.requestedRoleId !== undefined ? { requested: options.requestedRoleId } : {}),
    ...(options.isDemo ? { defaultRoleId: 'owner' as RoleId } : {}),
  });
  const activeRoleId =
    resolution.status === 'granted' ? resolution.roleId : resolution.fallbackRoleId;
  return Object.freeze({
    grantedRoleIds: Object.freeze([...options.facts.grantedRoleIds]),
    activeRoleId,
    denied: resolution.status === 'not-granted',
    ...(resolution.status === 'not-granted' ? { deniedRequested: resolution.requested } : {}),
  });
}

/**
 * Build the task view model. Resolution order (honest):
 *   1. a canonical `task-spec` control-plane record read by id (the
 *      compose-task step's stored proposal) — rendered as a PROPOSAL;
 *   2. in demo mode, a narrative task embedded in a demo corpus case
 *      record — rendered as labelled narrative state.
 */
export async function buildTaskDetailView(options: {
  readonly mode: 'session' | 'demo';
  readonly facts: CockpitSessionFacts;
  readonly port: CockpitReadPort;
  readonly taskId: string;
  readonly requestedRoleId?: string;
  readonly corpusHash?: string;
}): Promise<TaskDetailViewModel> {
  const isDemo = options.mode === 'demo';
  const roleHrefBase = isDemo ? '/demo/tasks' : '/tasks';
  const roleSwitch = taskRoleSwitch({ ...options, isDemo });
  const lens = TASK_LENSES[roleSwitch.activeRoleId];
  const demoMeta = Object.freeze({
    isDemo,
    ...(isDemo && options.corpusHash !== undefined ? { corpusHash: options.corpusHash } : {}),
  });

  // 1) Canonical task-spec record by id (read-canonical works for ANY kind).
  let specRead: CanonicalRead | undefined;
  try {
    specRead = await options.port.read(options.taskId);
  } catch {
    specRead = undefined;
  }
  if (specRead !== undefined && isTaskSpec(specRead.data)) {
    const spec = specRead.data as TaskSpec;
    const stateKind = isDemo && isDemoTenant(specRead.tenantId) ? 'demo-state' : TASK_SPEC_STATE_KIND;
    return Object.freeze({
      mode: options.mode,
      tenantId: options.facts.tenantId,
      recordId: specRead.recordId,
      shape: 'task-spec',
      title: `Task ${spec.identity.taskId}`,
      summary:
        'A TaskSpec PROPOSAL compiled from the case’s triaged state — proposals await pinning; nothing here claims execution or results.',
      taskId: spec.identity.taskId,
      lens,
      roleSwitch,
      facts: Object.freeze([
        datum('Task id', spec.identity.taskId, stateKind),
        datum('Version', spec.version, 'verified-fact'),
        datum('Class', spec.taskClass, 'verified-fact'),
        datum('Difficulty', `${spec.difficulty.scale} · ${spec.difficulty.class}`, 'verified-fact'),
        datum('Environment', `${spec.initialState.environment.namespace}/${spec.initialState.environment.name}@${spec.initialState.environment.version}`, 'verified-fact'),
        datum('Data rights', `${spec.dataRights.classification} · cross-tenant reuse: ${String(spec.dataRights.crossTenantReuse)}`, 'verified-fact'),
        ...(spec.derivedFrom?.caseRef !== undefined
          ? [datum('Derived from case', `${spec.derivedFrom.caseRef.caseId}@${spec.derivedFrom.caseRef.version}`, 'verified-fact')]
          : []),
      ]),
      objectives: Object.freeze(spec.objectives.map((o) => datum('Objective', o, 'suggestion-hypothesis'))),
      constraints: Object.freeze(spec.constraints.map((c) => datum('Constraint', c, 'verified-fact'))),
      tools: Object.freeze(spec.permittedTools.map((tool) => datum('Tool', `${tool.namespace}/${tool.name}@${tool.version}`, 'verified-fact'))),
      outputs: Object.freeze(spec.expectedOutputs.map((o) => datum('Expected output', o, 'suggestion-hypothesis'))),
      demo: demoMeta,
      roleHrefBase,
    } satisfies TaskDetailViewModel);
  }

  // 2) Demo narrative task embedded in a corpus case record.
  if (isDemo) {
    const page: ReadPage = await options.port.scroll('capability-case');
    for (const record of page.records) {
      const data = asRecord(record.data);
      const tasks = Array.isArray(data['tasks']) ? data['tasks'] : [];
      for (const entry of tasks) {
        const task = asRecord(entry);
        if (task['taskId'] === options.taskId || record.recordId === options.taskId) {
          const narrative: NarrativeTask = Object.freeze({
            taskId: String(task['taskId'] ?? options.taskId),
            title: String(task['title'] ?? options.taskId),
            state: String(task['state'] ?? 'unknown'),
            caseRecordId: record.recordId,
          });
          const stateKind: CanonicalStateKind =
            narrative.state === 'completed' ? 'simulation-replay' : 'pending';
          return Object.freeze({
            mode: options.mode,
            tenantId: options.facts.tenantId,
            recordId: options.taskId,
            shape: 'narrative',
            title: narrative.title,
            summary: `Narrative demo task embedded in the demo case record — labelled demo state, never customer state.`,
            taskId: narrative.taskId,
            lens,
            roleSwitch,
            facts: Object.freeze([
              datum('Task id', narrative.taskId, 'demo-state'),
              datum('State', narrative.state, stateKind),
              datum('Demo labelling', DEMO_LABELLING.bannerTitle, 'demo-state'),
            ]),
            objectives: Object.freeze([]),
            constraints: Object.freeze([]),
            tools: Object.freeze([]),
            outputs: Object.freeze([]),
            demo: demoMeta,
            roleHrefBase,
            caseRecordId: record.recordId,
            narrative,
          } satisfies TaskDetailViewModel);
        }
      }
    }
  }

  // 3) Honest not-found: the task view with a truthful empty outcome.
  return Object.freeze({
    mode: options.mode,
    tenantId: options.facts.tenantId,
    recordId: options.taskId,
    shape: 'narrative',
    title: 'Task not found',
    summary:
      'No canonical task-spec record and no embedded narrative task matches this id. Nothing is fabricated to fill the space.',
    taskId: options.taskId,
    lens,
    roleSwitch,
    facts: Object.freeze([datum('Requested id', options.taskId, 'unknown')]),
    objectives: Object.freeze([]),
    constraints: Object.freeze([]),
    tools: Object.freeze([]),
    outputs: Object.freeze([]),
    demo: demoMeta,
    roleHrefBase,
  } satisfies TaskDetailViewModel);
}
