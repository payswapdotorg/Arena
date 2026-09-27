/**
 * Typed console view-models + pure projection functions (Work Order A018,
 * gates 1-2). Every view-model is DERIVED from the domain packages' public
 * types via digest refs — domain types are REFERENCED (type-only imports),
 * never redefined — and every projection is a pure function over its frozen
 * input that returns a DEEP-FROZEN view. Projections never mutate their
 * inputs (gate 7): they only read.
 *
 * View-model families (one per console section, gate 2):
 *   - CaseSummaryView     ← @arena/capability-case CapabilityCase
 *   - BodyView            ← @arena/agent-body BodyVersion
 *   - SubstrateView       ← @arena/model-substrate SubstrateRegistration
 *   - JobView             ← @arena/job-protocol JobRecord
 *   - EnvironmentRunView  ← @arena/environment-protocol
 *                             EnvironmentDefinition + RunAddress
 *   - TrajectoryView      ← RunAddress + console trajectory steps
 *                           (A011 trajectory package is not merged at this
 *                           base; steps are console reference data pinned
 *                           to the run by its trajectoryDigest)
 *   - DashboardView       ← aggregate counts over a whole corpus
 *
 * Section-list views wrap the per-item views; error views (404/405) carry
 * only route metadata.
 */

import type { BodyVersion } from '@arena/agent-body';
import type { CapabilityCase } from '@arena/capability-case';
import type { EnvironmentDefinition, RunAddress } from '@arena/environment-protocol';
import type { JobRecord } from '@arena/job-protocol';
import type { SubstrateRegistration } from '@arena/model-substrate';

import { deepFreeze } from './freeze.js';

// ---------------------------------------------------------------------------
// View-model primitives
// ---------------------------------------------------------------------------

/** A digest ref as shown in the console: full sha256 hex, traceability unit. */
export type ViewDigest = string;

/** One entry of a status/section breakdown (dashboard aggregates). */
export interface StatusCount {
  readonly status: string;
  readonly count: number;
}

// ---------------------------------------------------------------------------
// CaseSummaryView (gate 2)
// ---------------------------------------------------------------------------

/** Summary projection of a CapabilityCase (the versioned root-of-record). */
export interface CaseSummaryView {
  readonly kind: 'case-summary';
  readonly tenant: string;
  readonly caseId: string;
  readonly version: string;
  readonly status: string;
  readonly priority: string;
  readonly risk: string;
  readonly problemStatement: string;
  readonly targetCapability: string;
  readonly domain: string;
  readonly evidenceCount: number;
  readonly unknownsCount: number;
  readonly lifecycleEventCount: number;
  readonly raisedBy: string;
  readonly createdAt: string;
  readonly currentBodyRef?: string;
  readonly currentSubstrateRef?: string;
  /** Content digest of the exact case state this view was derived from. */
  readonly digest: ViewDigest;
}

/** Project a CapabilityCase into a deep-frozen CaseSummaryView. */
export function toCaseSummaryView(caseRecord: CapabilityCase): CaseSummaryView {
  const view: CaseSummaryView = {
    kind: 'case-summary',
    tenant: caseRecord.identity.tenant,
    caseId: caseRecord.identity.caseId,
    version: caseRecord.version,
    status: caseRecord.status,
    priority: caseRecord.priority,
    risk: caseRecord.risk,
    problemStatement: caseRecord.problemStatement,
    targetCapability: `${caseRecord.targetCapability.id}@${caseRecord.targetCapability.version}`,
    domain: `${caseRecord.domain.id}@${caseRecord.domain.version}`,
    evidenceCount: caseRecord.evidence.length,
    unknownsCount: caseRecord.unknowns.length,
    lifecycleEventCount: caseRecord.lifecycle.length,
    raisedBy: `${caseRecord.source.tenant}/${caseRecord.source.principalId}`,
    createdAt: caseRecord.lifecycle[0]?.occurredAt ?? '',
    ...(caseRecord.currentBody !== undefined
      ? {
          currentBodyRef: `${caseRecord.currentBody.tenant}/${caseRecord.currentBody.name}@${caseRecord.currentBody.version}`,
        }
      : {}),
    ...(caseRecord.currentSubstrate !== undefined
      ? {
          currentSubstrateRef: `${caseRecord.currentSubstrate.adapterId}:${caseRecord.currentSubstrate.modelId}@${caseRecord.currentSubstrate.modelRevision}`,
        }
      : {}),
    digest: caseRecord.digest,
  };
  return deepFreeze(view);
}

// ---------------------------------------------------------------------------
// BodyView (gate 2)
// ---------------------------------------------------------------------------

/** Projection of an agent-body BodyVersion (the immutable capability body). */
export interface BodyView {
  readonly kind: 'body';
  readonly tenant: string;
  readonly name: string;
  readonly version: string;
  readonly mission: string;
  readonly role: string;
  readonly domainScope: readonly string[];
  readonly capabilities: readonly string[];
  readonly skillsCount: number;
  readonly knowledgeCount: number;
  readonly toolsCount: number;
  readonly proceduresCount: number;
  readonly authorityBoundaries: readonly string[];
  readonly escalationRuleCount: number;
  readonly evaluationSuiteCount: number;
  readonly verificationSuiteCount: number;
  readonly environmentRequirementCount: number;
  readonly requiredToolCalling: string;
  readonly minContextUnits: number;
  readonly parentsCount: number;
  readonly forgedBy: string;
  readonly createdAt: string;
  /** Content digest of the exact body version this view was derived from. */
  readonly digest: ViewDigest;
}

/** Project a BodyVersion into a deep-frozen BodyView. */
export function toBodyView(body: BodyVersion): BodyView {
  const view: BodyView = {
    kind: 'body',
    tenant: body.body.tenant,
    name: body.body.name,
    version: body.version,
    mission: body.mission,
    role: body.role,
    domainScope: deepFreeze([...body.domainScope]),
    capabilities: deepFreeze([...body.capabilities]),
    skillsCount: body.skills.length,
    knowledgeCount: body.knowledge.length,
    toolsCount: body.tools.length,
    proceduresCount: body.procedures.length,
    authorityBoundaries: deepFreeze([...body.authorityBoundaries]),
    escalationRuleCount: body.escalation.rules.length,
    evaluationSuiteCount: body.evaluationSuites.length,
    verificationSuiteCount: body.verificationSuites.length,
    environmentRequirementCount: body.environmentRequirements.length,
    requiredToolCalling: body.substrateCompatibility.requiredToolCalling,
    minContextUnits: body.substrateCompatibility.contextRequirements.minContextUnits,
    parentsCount: body.lineage.parents.length,
    forgedBy: `${body.provenance.creator.tenant}/${body.provenance.creator.principalId}`,
    createdAt: body.provenance.createdAt,
    digest: body.digest,
  };
  return deepFreeze(view);
}

// ---------------------------------------------------------------------------
// SubstrateView (gate 2)
// ---------------------------------------------------------------------------

/** Projection of a registered Cognitive Substrate (provider-neutral). */
export interface SubstrateView {
  readonly kind: 'substrate';
  readonly substrateId: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly adapterDigest: ViewDigest;
  readonly modelFamily: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly modalityProfile: readonly string[];
  readonly toolCallingProfile: string;
  readonly maxContextUnits: number;
  readonly maxOutputUnits: number;
  readonly conditions: readonly string[];
  readonly registeredAt: string;
  /** Content digest of the substrate record (agent-body CognitiveSubstrate shape). */
  readonly contentDigest: ViewDigest;
  /** Content digest of the registration record. */
  readonly registrationDigest: ViewDigest;
}

/** Project a SubstrateRegistration into a deep-frozen SubstrateView. */
export function toSubstrateView(registration: SubstrateRegistration): SubstrateView {
  const view: SubstrateView = {
    kind: 'substrate',
    substrateId: registration.substrateId,
    adapterId: registration.adapterDescriptor.adapterId,
    adapterVersion: registration.adapterDescriptor.adapterVersion,
    adapterDigest: registration.adapterDescriptor.digest,
    modelFamily: registration.substrate.modelFamily,
    modelId: registration.substrate.modelId,
    modelRevision: registration.substrate.modelRevision,
    modalityProfile: deepFreeze([...registration.substrate.modalityProfile]),
    toolCallingProfile: registration.substrate.toolCallingProfile,
    maxContextUnits: registration.substrate.contextLimits.maxContextUnits,
    maxOutputUnits: registration.substrate.contextLimits.maxOutputUnits,
    conditions: deepFreeze([...registration.substrate.conditions]),
    registeredAt: registration.registeredAt,
    contentDigest: registration.substrate.integrity.contentDigest,
    registrationDigest: registration.registrationDigest,
  };
  return deepFreeze(view);
}

// ---------------------------------------------------------------------------
// JobView (gate 2)
// ---------------------------------------------------------------------------

/** Projection of a durable-job record (job-protocol JobRecord). */
export interface JobView {
  readonly kind: 'job';
  readonly jobId: string;
  readonly jobKind: string;
  readonly definitionDigest: ViewDigest;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly idempotencyScope: string;
  readonly status: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly submittedAt: string;
  readonly updatedAt: string;
  readonly eventCount: number;
  readonly lastEventKind: string;
  readonly progressPercent?: number;
  readonly progressNote?: string;
  readonly failureKind?: string;
  readonly failureClass?: string;
  readonly failureMessage?: string;
}

/** Project a JobRecord into a deep-frozen JobView. */
export function toJobView(job: JobRecord): JobView {
  const lastEvent = job.events[job.events.length - 1];
  const view: JobView = {
    kind: 'job',
    jobId: job.jobId,
    jobKind: `${job.kind.namespace}/${job.kind.name}@${job.kind.version}`,
    definitionDigest: job.definitionDigest,
    correlationId: job.correlationId,
    idempotencyKey: job.idempotencyKey,
    idempotencyScope: job.idempotencyScope,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.policy.retry.maxAttempts,
    timeoutMs: job.policy.timeoutMs,
    submittedAt: job.submittedAt,
    updatedAt: job.updatedAt,
    eventCount: job.events.length,
    lastEventKind: lastEvent?.kind ?? 'none',
    ...(job.progress?.percent !== undefined
      ? { progressPercent: job.progress.percent }
      : {}),
    ...(job.progress?.note !== undefined ? { progressNote: job.progress.note } : {}),
    ...(job.failure !== undefined
      ? {
          failureKind: job.failure.kind,
          failureClass: job.failure.errorClass,
          failureMessage: job.failure.message,
        }
      : {}),
  };
  return deepFreeze(view);
}

// ---------------------------------------------------------------------------
// EnvironmentRunView (gate 2)
// ---------------------------------------------------------------------------

/**
 * A console environment run: a domain EnvironmentDefinition paired with the
 * RunAddress of one executed run (both are domain public types; this is a
 * COMPOSITION, not a redefinition).
 */
export interface ConsoleEnvironmentRun {
  readonly definition: EnvironmentDefinition;
  readonly address: RunAddress;
}

/** Projection of an environment run (definition + run address). */
export interface EnvironmentRunView {
  readonly kind: 'environment-run';
  readonly environment: string;
  readonly environmentVersion: string;
  readonly environmentDigest: ViewDigest;
  readonly runId: string;
  readonly taskId: string;
  readonly taskVersion: string;
  readonly initialSnapshotDigest: ViewDigest;
  readonly trajectoryDigest: ViewDigest;
  readonly evidenceDigests: readonly string[];
  readonly imageDigest: ViewDigest;
  readonly networkEgress: string;
  readonly filesystemWriteMode: string;
  readonly deadlineBehavior: string;
  readonly evidenceOutputKinds: readonly string[];
}

/** Project a ConsoleEnvironmentRun into a deep-frozen EnvironmentRunView. */
export function toEnvironmentRunView(run: ConsoleEnvironmentRun): EnvironmentRunView {
  const view: EnvironmentRunView = {
    kind: 'environment-run',
    environment: `${run.definition.identity.namespace}/${run.definition.identity.name}`,
    environmentVersion: run.definition.version,
    environmentDigest: run.definition.digest,
    runId: run.address.runId,
    taskId: run.address.taskVersion.taskId,
    taskVersion: run.address.taskVersion.version,
    initialSnapshotDigest: run.address.initialSnapshotDigest,
    trajectoryDigest: run.address.trajectoryDigest,
    evidenceDigests: deepFreeze([...run.address.evidenceDigests]),
    imageDigest: run.definition.image.digest,
    networkEgress: run.definition.networkPolicy.egress,
    filesystemWriteMode: run.definition.filesystemPolicy.writeMode,
    deadlineBehavior: run.definition.timeLimits.deadlineBehavior,
    evidenceOutputKinds: deepFreeze(
      run.definition.evidenceOutputs.outputs.map((output) => output.kind),
    ),
  };
  return deepFreeze(view);
}

// ---------------------------------------------------------------------------
// TrajectoryView (gate 2)
// ---------------------------------------------------------------------------

/**
 * One recorded trajectory step of an environment run. The trajectory
 * package (A011) is not merged at this base, so steps are console
 * reference data: neutral, secret-free, and pinned to their run by the
 * RunAddress trajectoryDigest carried on the view.
 */
export interface TrajectoryStep {
  readonly sequence: number;
  readonly at: string;
  readonly actor: string;
  readonly action: string;
  readonly observation: string;
  readonly evidenceDigest?: ViewDigest;
}

/** Projection of a run trajectory (address + steps). */
export interface TrajectoryView {
  readonly kind: 'trajectory';
  readonly runId: string;
  readonly taskId: string;
  readonly taskVersion: string;
  readonly environment: string;
  readonly trajectoryDigest: ViewDigest;
  readonly stepCount: number;
  readonly steps: readonly TrajectoryStep[];
}

/** Project a run address + its steps into a deep-frozen TrajectoryView. */
export function toTrajectoryView(
  address: RunAddress,
  steps: readonly TrajectoryStep[],
): TrajectoryView {
  const view: TrajectoryView = {
    kind: 'trajectory',
    runId: address.runId,
    taskId: address.taskVersion.taskId,
    taskVersion: address.taskVersion.version,
    environment: `${address.environmentVersion.namespace}/${address.environmentVersion.name}@${address.environmentVersion.version}`,
    trajectoryDigest: address.trajectoryDigest,
    stepCount: steps.length,
    steps: deepFreeze(steps.map((step) => ({ ...step }))),
  };
  return deepFreeze(view);
}

// ---------------------------------------------------------------------------
// Section list views + dashboard aggregate
// ---------------------------------------------------------------------------

/** Cases section (/cases). */
export interface CaseListView {
  readonly kind: 'case-list';
  readonly cases: readonly CaseSummaryView[];
}

/** Bodies section (/bodies). */
export interface BodyListView {
  readonly kind: 'body-list';
  readonly bodies: readonly BodyView[];
}

/** Substrates section (/substrates). */
export interface SubstrateListView {
  readonly kind: 'substrate-list';
  readonly substrates: readonly SubstrateView[];
}

/** Jobs section (/jobs). */
export interface JobListView {
  readonly kind: 'job-list';
  readonly jobs: readonly JobView[];
}

/** Environment runs section (/runs). */
export interface RunListView {
  readonly kind: 'run-list';
  readonly runs: readonly EnvironmentRunView[];
}

/** Index/dashboard aggregate (gate 3: aggregates every section). */
export interface DashboardView {
  readonly kind: 'dashboard';
  readonly caseCount: number;
  readonly bodyCount: number;
  readonly substrateCount: number;
  readonly jobCount: number;
  readonly runCount: number;
  readonly trajectoryStepCount: number;
  readonly caseStatusBreakdown: readonly StatusCount[];
  readonly jobStatusBreakdown: readonly StatusCount[];
  readonly latestCaseDigests: readonly ViewDigest[];
  readonly latestJobIds: readonly string[];
}

/** Unknown route (negative view — router 404). */
export interface NotFoundView {
  readonly kind: 'not-found';
  readonly path: string;
}

/** Mutation attempt against a read-only console (negative view — router 405). */
export interface MethodNotAllowedView {
  readonly kind: 'method-not-allowed';
  readonly method: string;
  readonly path: string;
  readonly allowedMethods: readonly string[];
}
