/**
 * The guided flow RUNTIME (Work Order B008; issue #80).
 *
 * Applies canonical A005 lifecycle transitions THROUGH the B002
 * ControlPlaneRepository port. Every write is a repository insert (start)
 * or an optimistic-concurrency update (continue: expectedRevision = the
 * revision the runtime read); concurrent writers get the typed B002
 * PERSISTENCE_REVISION_CONFLICT, never a lost update. There is NO
 * parallel lifecycle and NO parallel store: the transition functions are
 * @arena/capability-case's own pure functions, and their typed lifecycle
 * rejections (CAPABILITY_CASE_*) propagate VERBATIM.
 *
 * Determinism: the runtime reads no clock and no randomness — `at`
 * (timestamps), actor principals, case ids and notes are ALL injected by
 * the caller. Same inputs over the same repository state ⇒ byte-identical
 * case states and history.
 *
 * compose-task: after the canonical triage succeeds, the compilation
 * target is derived from the exact resulting case state (A005
 * deriveCompilationTarget — pure). When a task composer port is injected
 * (the app layer adapts the A008 pure compiler), the derived target is
 * compiled into TaskSpec PROPOSALS and each is stored as a canonical
 * control-plane record (kind `task-spec`) so task surfaces read them
 * through the canonical read path. Specs are proposals until pinned —
 * nothing here claims otherwise.
 */

import {
  CAPABILITY_CASE_ERROR_CODES,
  CapabilityCaseError,
  activateCase,
  attachEvidence,
  createCapabilityCase,
  deriveCompilationTarget,
  isCaseStatus,
  resolveCase,
  submitCase,
  triageCase,
} from '@arena/capability-case';
import type {
  CapabilityCase,
  CaseLifecycleEvent,
  CaseTransitionContext,
  CreateCapabilityCaseInput,
  TaskCompilationTarget,
} from '@arena/capability-case';
import type { TaskSpec } from '@arena/task-spec';
import type {
  ControlPlaneRepository,
  ControlPlaneRecord,
  JsonSafeValue,
} from '@arena/persistence';
import { PRODUCT_FLOW_ERROR_CODES, ProductFlowError } from './errors.js';
import {
  caseRecordId,
  fromCaseRecord,
  toCaseInsertInput,
  toTaskInsertInput,
} from './case-codec.js';
import { getFlowStep } from './definitions.js';
import type { FlowStepDefinition } from './definitions.js';

/**
 * The optional task-composition port (adapted at the app boundary over
 * the A008 pure compiler). Domain-pure: takes the derived target, returns
 * TaskSpec proposals.
 */
export type TaskComposerPort = (
  target: TaskCompilationTarget,
) => Promise<readonly TaskSpec[]>;

export interface ProductFlowRuntimeDeps {
  /** The B002 control-plane repository port (fake = local/demo posture). */
  readonly repository: ControlPlaneRepository;
  /** Optional task composer (A008 adaptation); absent = no spec storage. */
  readonly composeTask?: TaskComposerPort;
}

/** The canonical actor shape (tenant-scoped principal). */
export interface FlowActor {
  readonly type: string;
  readonly tenant: string;
  readonly principalId: string;
}

/** The result of one runtime operation. */
export interface FlowStepResult {
  readonly step: FlowStepDefinition;
  /** The resulting canonical case state (frozen, content-addressed). */
  readonly caseRecord: CapabilityCase;
  /** The lifecycle event the operation appended (canonical, append-only). */
  readonly event: CaseLifecycleEvent;
  /** The repository revision AFTER the write (optimistic-concurrency stamp). */
  readonly revision: number;
  /** The compilation target derived on compose-task (else undefined). */
  readonly compilationTarget?: TaskCompilationTarget;
  /** TaskSpec proposals stored on compose-task (composer present). */
  readonly taskSpecs?: readonly TaskSpec[];
  /** True when startCase replayed an identical existing insert. */
  readonly alreadyExisted?: boolean;
}

/** startCase input: the full canonical case framing (validated by A005). */
export type StartCaseInput = CreateCapabilityCaseInput;

/** continueCase input: one guided step applied to one logical case. */
export interface ContinueCaseInput {
  readonly stepId: string;
  readonly identity: { readonly tenant: string; readonly caseId: string };
  readonly actor: FlowActor;
  /** When the transition occurred (INJECTED — the runtime reads no clock). */
  readonly at: string;
  /** Optional event note (REQUIRED by the triage step's rationale rule). */
  readonly note?: string;
  /** decide only: the REQUIRED non-empty resolution statement. */
  readonly resolution?: string;
  /** observe/evaluate only: the evidence refs to append (>= 1). */
  readonly evidence?: readonly { readonly digest: string; readonly description: string }[];
}

function requireActor(actor: FlowActor, tenant: string): void {
  if (
    typeof actor?.type !== 'string' ||
    actor.type.length === 0 ||
    typeof actor?.tenant !== 'string' ||
    actor.tenant.length === 0 ||
    typeof actor?.principalId !== 'string' ||
    actor.principalId.length === 0
  ) {
    throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.MALFORMED_INPUT, {
      message: 'a flow operation requires a valid actor (type, tenant, principalId)',
      details: { actor },
    });
  }
  if (actor.tenant !== tenant) {
    throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.MALFORMED_INPUT, {
      message: `the actor's tenant ${JSON.stringify(actor.tenant)} must match the case tenant ${JSON.stringify(tenant)} (tenant-scoped transitions only)`,
      details: { actorTenant: actor.tenant, caseTenant: tenant },
    });
  }
}

function requireAt(at: string): void {
  if (typeof at !== 'string' || at.length === 0) {
    throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.MALFORMED_INPUT, {
      message: 'a flow operation requires an explicit `at` timestamp (the runtime reads no clock)',
      details: { at },
    });
  }
}

/** Load + verify the canonical case behind one logical identity. */
async function loadCase(
  repository: ControlPlaneRepository,
  identity: { readonly tenant: string; readonly caseId: string },
): Promise<{ readonly record: ControlPlaneRecord; readonly caseRecord: CapabilityCase }> {
  const recordId = caseRecordId(identity);
  const record = await repository.get(recordId);
  if (record === null) {
    throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.CASE_NOT_FOUND, {
      message: `no capability case ${JSON.stringify(identity.caseId)} exists in tenant ${JSON.stringify(identity.tenant)} (record ${JSON.stringify(recordId)})`,
      details: { recordId, ...identity },
    });
  }
  const caseRecord = await fromCaseRecord(record);
  return { record, caseRecord };
}

/**
 * Guard: the guided step must be valid FROM the case's current canonical
 * status. The rejection is the CANONICAL typed error
 * (CAPABILITY_CASE_INVALID_TRANSITION) — the guided flow never invents a
 * parallel rejection vocabulary.
 */
function assertStepValidFrom(step: FlowStepDefinition, caseRecord: CapabilityCase): void {
  if (step.validFrom !== caseRecord.status) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_TRANSITION, {
      message: `guided step ${JSON.stringify(step.stepId)} is valid from ${JSON.stringify(step.validFrom)} but case ${caseRecord.identity.caseId} is ${caseRecord.status}`,
      details: {
        stepId: step.stepId,
        from: caseRecord.status,
        expected: step.validFrom,
      },
    });
  }
}

/**
 * Construct the guided flow runtime over the B002 repository port.
 * Pure functions + injected repository; no clock, no randomness, no state.
 */
export function createProductFlowRuntime(deps: ProductFlowRuntimeDeps): {
  startCase(input: StartCaseInput): Promise<FlowStepResult>;
  continueCase(input: ContinueCaseInput): Promise<FlowStepResult>;
  getCase(identity: { readonly tenant: string; readonly caseId: string }): Promise<{
    readonly caseRecord: CapabilityCase;
    readonly revision: number;
  }>;
} {
  if (typeof deps.repository?.insert !== 'function' || typeof deps.repository?.update !== 'function') {
    throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.MALFORMED_INPUT, {
      message: 'createProductFlowRuntime requires an injected ControlPlaneRepository (insert + update)',
    });
  }
  const repository = deps.repository;
  const composer = deps.composeTask;

  async function startCase(input: StartCaseInput): Promise<FlowStepResult> {
    const step = getFlowStep('start-case');
    requireAt(input.createdAt);
    if (input.identity?.tenant === undefined || input.source?.tenant === undefined) {
      throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.MALFORMED_INPUT, {
        message: 'startCase requires identity.tenant and source.tenant',
      });
    }
    // Canonical creation (typed validation failures propagate verbatim).
    const caseRecord = await createCapabilityCase(input);
    const insert = toCaseInsertInput(caseRecord);
    const result = await repository.insert(insert);
    return Object.freeze({
      step,
      caseRecord,
      event: caseRecord.lifecycle[caseRecord.lifecycle.length - 1] as CaseLifecycleEvent,
      revision: result.record.revision,
      ...(result.created ? {} : { alreadyExisted: true }),
    } satisfies FlowStepResult);
  }

  async function continueCase(input: ContinueCaseInput): Promise<FlowStepResult> {
    const step = getFlowStep(input.stepId);
    if (step.stepId === 'start-case') {
      throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.MALFORMED_INPUT, {
        message: 'start-case is a creation step — use startCase (a case must be started, not continued, into existence)',
        details: { stepId: input.stepId },
      });
    }
    requireAt(input.at);
    requireActor(input.actor, input.identity.tenant);
    const { record, caseRecord } = await loadCase(repository, input.identity);
    assertStepValidFrom(step, caseRecord);

    const context: CaseTransitionContext = {
      at: input.at,
      actor: input.actor,
      ...(input.note !== undefined && input.note.length > 0 ? { note: input.note } : {}),
    };

    let next: CapabilityCase;
    switch (step.transition) {
      case 'submit':
        next = await submitCase(caseRecord, context);
        break;
      case 'triage':
        if (typeof input.note !== 'string' || input.note.length === 0) {
          throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_TRANSITION, {
            message:
              'triage requires a non-empty rationale note (the selection rationale remains inspectable)',
            details: { caseId: caseRecord.identity.caseId },
          });
        }
        next = await triageCase(caseRecord, { ...context, note: input.note });
        break;
      case 'activate':
        next = await activateCase(caseRecord, context);
        break;
      case 'attach-evidence': {
        if (!Array.isArray(input.evidence) || input.evidence.length === 0) {
          throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_EVIDENCE, {
            message: `${JSON.stringify(step.stepId)} requires at least one evidence reference (digest + description)`,
            details: { caseId: caseRecord.identity.caseId, stepId: step.stepId },
          });
        }
        next = await attachEvidence(caseRecord, { ...context, evidence: input.evidence });
        break;
      }
      case 'resolve':
        if (typeof input.resolution !== 'string' || input.resolution.length === 0) {
          throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_TRANSITION, {
            message: 'resolution requires a non-empty outcome statement',
            details: { caseId: caseRecord.identity.caseId },
          });
        }
        next = await resolveCase(caseRecord, { ...context, resolution: input.resolution });
        break;
      default:
        throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.UNKNOWN_STEP, {
          message: `the guided step ${JSON.stringify(step.stepId)} has no runtime transition`,
          details: { stepId: step.stepId },
        });
    }

    // Optimistic-concurrency write: expectedRevision = what we read.
    const updated = await repository.update(record.recordId, {
      expectedRevision: record.revision,
      // The canonical case payload IS JSON-safe (A005 builds it that way);
      // the cast carries it through the B002 record type without cloning.
      data: next as unknown as JsonSafeValue,
    });

    // compose-task: derive the compilation target from the EXACT triaged
    // state; with a composer, compile + store TaskSpec proposals.
    let compilationTarget: TaskCompilationTarget | undefined;
    let taskSpecs: readonly TaskSpec[] | undefined;
    if (step.stepId === 'compose-task') {
      compilationTarget = await deriveCompilationTarget(next, { derivedAt: input.at });
      if (composer !== undefined) {
        const specs = await composer(compilationTarget);
        for (const spec of specs) {
          await repository.insert(toTaskInsertInput(spec));
        }
        taskSpecs = Object.freeze([...specs]);
      }
    }

    return Object.freeze({
      step,
      caseRecord: next,
      event: next.lifecycle[next.lifecycle.length - 1] as CaseLifecycleEvent,
      revision: updated.revision,
      ...(compilationTarget !== undefined ? { compilationTarget } : {}),
      ...(taskSpecs !== undefined ? { taskSpecs } : {}),
    } satisfies FlowStepResult);
  }

  async function getCase(identity: {
    readonly tenant: string;
    readonly caseId: string;
  }): Promise<{ readonly caseRecord: CapabilityCase; readonly revision: number }> {
    const { record, caseRecord } = await loadCase(repository, identity);
    return Object.freeze({ caseRecord, revision: record.revision });
  }

  return Object.freeze({ startCase, continueCase, getCase });
}

/** Re-exported canonical status guard for surface-side projections. */
export { isCaseStatus };
