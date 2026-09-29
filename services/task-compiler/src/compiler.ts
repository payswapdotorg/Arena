/**
 * TaskCompiler — the PURE compilation engine (Work Order A008;
 * requirement R6 "Compile Capability Cases into reproducible TaskSpecs";
 * architecture-lock rules 5, 6, 17).
 *
 * `compileTarget` compiles ONE A005 TaskCompilationTarget (the typed data
 * contract @arena/capability-case derives from an exact case state) under
 * ONE @arena/task-spec CompilationPolicy into TaskSpec PROPOSALS:
 *
 *   - DETERMINISTIC + PURE: same case state + same policy ⇒ byte-identical
 *     specs (the spec view carries no timestamps and no randomness — the
 *     derivation provenance is (case ref, policy ref), both
 *     content-addressed). The target's own transport digest (which covers
 *     its derivation timestamp) deliberately does NOT enter the spec
 *     content: re-deriving the same case at a different time yields the
 *     SAME specs.
 *   - A PROPOSAL, never a mutation: the case is never touched (lock rule
 *     6 — append-only lifecycle respected); pinning is a separate,
 *     consumer-side act.
 *   - FAIL-CLOSED inputs: both the target digest and the policy digest are
 *     recomputed and compared before anything is emitted.
 *
 * Eligibility split (documented honestly): the A005 target derivation
 * already enforces TRIAGED/ACTIVE (non-terminal, post-triage states only);
 * the POLICY narrows further (its compilableStatuses subset) and the
 * minimum-evidence floor is enforced HERE against the target's evidence
 * set. The fabric (fabric.ts) additionally checks the LIVE case status
 * against the policy at command time.
 */

import {
  recomputeCompilationPolicyDigest,
  createTaskSpec,
  TASK_SPEC_ERROR_CODES,
  TaskSpecError,
} from '@arena/task-spec';
import type {
  CompilationPolicy,
  TaskSpec,
} from '@arena/task-spec';
import {
  verifyTaskCompilationTarget,
} from '@arena/capability-case';
import type { TaskCompilationTarget } from '@arena/capability-case';

/** The result of one pure compilation: ordered spec proposals. */
export interface CompileResult {
  readonly specs: readonly TaskSpec[];
}

/** Deduplicate a list of statements preserving first-occurrence order. */
function dedupe(entries: readonly string[]): string[] {
  return [...new Set(entries)];
}

/** Render the policy's instruction template over the target (closed placeholders). */
export function renderInstructions(
  template: string,
  target: TaskCompilationTarget,
  difficultyClass: string,
  objectives: readonly string[],
): string {
  return template
    .replaceAll('{caseId}', target.caseRef.caseId)
    .replaceAll('{domain}', target.domain.id)
    .replaceAll('{capability}', target.targetCapability.id)
    .replaceAll('{objectives}', objectives.join('; '))
    .replaceAll('{difficulty}', difficultyClass)
    .replaceAll('{evidenceCount}', String(target.evidence.length));
}

/** Select the task class by the policy's ordered first-match-wins rules. */
export function selectTaskClass(
  target: TaskCompilationTarget,
  policy: CompilationPolicy,
): string {
  for (const rule of policy.classSelection.rules) {
    const matches = (() => {
      switch (rule.matcher) {
        case 'always':
          return true;
        case 'difficulty-is':
          return target.taskRequirements.difficulty === rule.difficulty;
        case 'tools-present':
          return target.taskRequirements.allowedTools.length > 0;
        case 'shortcuts-present':
          return target.taskRequirements.forbiddenShortcuts.length > 0;
        case 'evidence-at-least':
          return target.evidence.length >= (rule.count ?? 1);
        default:
          return false;
      }
    })();
    if (matches) return rule.class;
  }
  // Unreachable: policy construction enforces a trailing 'always' rule.
  throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_CLASS_SELECTION, {
    message: 'class selection is not total (no rule matched — the policy guard was bypassed)',
  });
}

/**
 * Compile one target under one policy into TaskSpec PROPOSALS. Pure and
 * deterministic; throws typed TaskSpecErrors on tampered inputs or
 * policy-eligibility violations.
 */
export async function compileTarget(
  target: TaskCompilationTarget,
  policy: CompilationPolicy,
): Promise<readonly TaskSpec[]> {
  // Fail-closed inputs: verify BOTH digests before emitting anything.
  await verifyTaskCompilationTarget(target);
  await recomputeCompilationPolicyDigest(policy);

  // Eligibility: sufficient evidence (the status gate is A005's derive +
  // the fabric's live-case check; the policy narrows both).
  if (target.evidence.length < policy.eligibility.minimumEvidenceCount) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_POLICY, {
      message: `case ${target.caseRef.caseId} carries ${target.evidence.length} evidence ref(s) but policy ${policy.policyId}@${policy.version} requires at least ${policy.eligibility.minimumEvidenceCount} (only sufficiently-evidenced cases are compilable)`,
      details: {
        caseId: target.caseRef.caseId,
        evidenceCount: target.evidence.length,
        minimumEvidenceCount: policy.eligibility.minimumEvidenceCount,
      },
    });
  }

  // Environment selection: first candidate, or one spec per candidate.
  const environments = target.environmentRequirements.environments;
  const selected =
    policy.environment.selection === 'first'
      ? [environments[0] as (typeof environments)[number]]
      : [...environments];

  const specs: TaskSpec[] = [];
  for (const [index, environment] of selected.entries()) {
    const multi = selected.length > 1;
    const taskId = `${policy.identity.taskIdPrefix}${target.caseRef.caseId}${multi ? `-e${index}` : ''}`;

    const taskClass = selectTaskClass(target, policy);
    const difficultyClass =
      policy.difficulty.mode === 'from-case'
        ? target.taskRequirements.difficulty
        : (policy.difficulty.declaredClass as string);

    const objectives =
      policy.fieldMapping.objectives.mode === 'first'
        ? target.taskRequirements.objectives.slice(
            0,
            policy.fieldMapping.objectives.count,
          )
        : [...target.taskRequirements.objectives];

    const constraints =
      policy.fieldMapping.constraints.mode === 'union'
        ? dedupe([
            ...target.taskRequirements.constraints,
            ...policy.fieldMapping.constraints.additional,
          ])
        : [...target.taskRequirements.constraints];

    const prohibitedShortcuts =
      policy.fieldMapping.prohibitedShortcuts.mode === 'union'
        ? dedupe([
            ...target.taskRequirements.forbiddenShortcuts,
            ...policy.fieldMapping.prohibitedShortcuts.additional,
          ])
        : [...target.taskRequirements.forbiddenShortcuts];

    const permittedTools =
      policy.fieldMapping.permittedTools.mode === 'none'
        ? []
        : target.taskRequirements.allowedTools.map((tool) => ({ ...tool }));

    const expectedOutputs =
      policy.fieldMapping.expectedOutputs.mode === 'declared'
        ? [...policy.fieldMapping.expectedOutputs.outputs]
        : [...target.taskRequirements.successConditions];

    const longHorizonEvidence =
      taskClass === 'long-horizon-execution' || taskClass === 'recovery-failure'
        ? policy.longHorizon
        : null;

    const expertQualificationRequirements =
      policy.expertQualification.mode === 'declare'
        ? // 'declare' mode guarantees a non-null declaration (policy guard).
          (policy.expertQualification.declared as NonNullable<
            typeof policy.expertQualification.declared
          >)
        : {
            competencies: [{ ...target.targetCapability }],
            qualificationPolicy: policy.expertQualification.qualificationPolicy,
            expectations: policy.expertQualification.expectations ?? [],
          };

    const spec = await createTaskSpec({
      identity: { tenant: target.caseRef.tenant, taskId },
      version: policy.identity.initialVersion,
      taskClass,
      capabilityLabels: dedupe([target.targetCapability.id, target.domain.id]),
      difficulty: { scale: policy.difficulty.scale, class: difficultyClass },
      domain: { ...target.domain },
      initialState: {
        environment: { ...environment },
        seed: policy.environment.seed,
        note: policy.environment.note,
      },
      instructions: renderInstructions(
        policy.fieldMapping.instructions.template,
        target,
        difficultyClass,
        objectives,
      ),
      objectives,
      constraints,
      permittedTools,
      prohibitedShortcuts,
      expectedOutputs,
      completionCriteria: [...target.taskRequirements.successConditions],
      evidenceCriteria: [...target.taskRequirements.evidenceCriteria],
      longHorizonEvidence: longHorizonEvidence
        ? {
            intermediateStateEvidence: [
              ...longHorizonEvidence.intermediateStateEvidence,
            ],
            recoveryCriteria: [...longHorizonEvidence.recoveryCriteria],
          }
        : null,
      environmentRequirements: {
        environments: environments.map((env) => ({ ...env })),
        constraints: [...target.environmentRequirements.constraints],
      },
      evaluatorBindings: target.evaluationRequirements.evaluators.map((ref) => ({
        evaluatorId: ref.id,
        version: ref.version,
        descriptorDigest: ref.digest,
      })),
      verifierBindings: target.verificationRequirements.verifiers.map((ref) => ({
        verifierId: ref.id,
        version: ref.version,
        descriptorDigest: ref.digest,
      })),
      expertQualificationRequirements,
      quality: policy.quality.map((declaration) => ({ ...declaration })),
      dataRights: {
        classification: policy.dataRights.classification,
        tenantScope: target.caseRef.tenant,
        // R24 posture: compilation NEVER turns on cross-tenant reuse —
        // reuse is a later, explicit, tenant-side act.
        crossTenantReuse: false,
        licensing: policy.dataRights.licensing,
        privacyNotes: policy.dataRights.privacyNotes,
      },
      derivedFrom: {
        caseRef: { ...target.caseRef },
        policyRef: {
          policyId: policy.policyId,
          version: policy.version,
          digest: policy.digest,
        },
      },
    });
    specs.push(spec);
  }
  return Object.freeze(specs);
}
