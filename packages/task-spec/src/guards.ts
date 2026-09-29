/**
 * TaskSpec guards (Work Order A008) — the PURE validation layer.
 *
 * `guardTaskSpecView` validates one claimed TaskSpec view end-to-end and
 * returns the normalized (deep-frozen) view, or throws a TYPED
 * TaskSpecError naming the violated rule. It is the single validation
 * authority for the TaskSpec shape; `createTaskSpec` (spec.ts) runs it
 * before digesting, and any consumer can re-run it on untrusted input.
 *
 * Guard families (the work-order acceptance list):
 *   1. field completeness per TS1.0 — every structure field present,
 *      no unknown fields (closed shape);
 *   2. closed vocabularies — task class (11), difficulty scale + class,
 *      quality dimensions (7) + provenance sources, data-rights
 *      classifications, node kinds, ref patterns;
 *   3. cross-field consistency —
 *        - long-horizon-execution class ⇒ long-horizon evidence
 *          (intermediate state + recoveries) REQUIRED; other classes
 *          (except recovery-failure, where it is permitted) MUST NOT
 *          carry it;
 *        - every evaluator/verifier binding digest well-formed (A012/
 *          A013 descriptor-digest triples);
 *        - difficulty in a declared scale (closed scale vocabulary);
 *        - the pinned initial-state environment is one of the required
 *          ENV1.0 declarations;
 *        - data rights: private-tenant forbids cross-tenant reuse, and
 *          the tenant scope must equal the task identity's tenant (lock
 *          rule 11);
 *        - supersession: same logical task, strictly higher semver
 *          precedence (append-only versioning, never a rewrite);
 *        - capability labels unique and non-empty;
 *        - derivation provenance (case ref + policy ref) well-formed.
 */

import { TASK_SPEC_ERROR_CODES, TaskSpecError } from './errors.js';
import {
  toEvaluatorBindings,
  toVerifierBindings,
} from './bindings.js';
import type { EvaluatorBinding, VerifierBinding } from './bindings.js';
import { toTaskClass, permitsLongHorizonEvidence, requiresLongHorizonEvidence } from './task-class.js';
import { toTaskDifficultyDeclaration } from './difficulty.js';
import { toQualityDeclarationSet } from './quality.js';
import type { QualityDeclaration } from './quality.js';
import {
  toTaskEnvironmentRequirements,
  toTaskInitialStateRef,
} from './environment.js';
import { toTaskExpertQualificationRequirements } from './expert-qualification.js';
import { toDataRightsMetadata } from './data-rights.js';
import { toTaskIdentity } from './identity.js';
import type { TaskVersionRef } from './identity.js';
import {
  compareTaskVersions,
  deepFreeze,
  expectFields,
  expectNonEmptyString,
  isCapabilityLabel,
  isTaskVersion,
  toArtifactRefView,
  toCaseRefView,
  toCompilationPolicyRefView,
  toNodeRefView,
  toStatementList,
  toTaskVersion,
} from './shared.js';
import type {
  ArtifactRefView,
  CaseRefView,
  CapabilityLabel,
  CompilationPolicyRefView,
  NodeRefView,
} from './shared.js';
import type { LongHorizonEvidence, TaskSpecView } from './spec.js';
import { TASK_SPEC_RECORD_VERSION } from './spec.js';

function crossField(message: string, details: Readonly<Record<string, unknown>>): never {
  throw new TaskSpecError(TASK_SPEC_ERROR_CODES.CROSS_FIELD_CONSISTENCY, {
    message,
    details,
  });
}

/** Validate + freeze long-horizon evidence (both lists >= 1). */
function toLongHorizonEvidence(value: {
  intermediateStateEvidence: readonly string[];
  recoveryCriteria: readonly string[];
}): LongHorizonEvidence {
  const intermediateStateEvidence = toStatementList(
    value.intermediateStateEvidence,
    'intermediateStateEvidence',
    1,
    TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    'long-horizon evidence',
  );
  const recoveryCriteria = toStatementList(
    value.recoveryCriteria,
    'recoveryCriteria',
    1,
    TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    'long-horizon evidence',
  );
  return Object.freeze({ intermediateStateEvidence, recoveryCriteria });
}

/** Tuple equality for ENV1.0 declaration refs. */
function sameArtifactRef(
  a: { namespace: string; name: string; version: string; digest: string },
  b: { namespace: string; name: string; version: string; digest: string },
): boolean {
  return (
    a.namespace === b.namespace &&
    a.name === b.name &&
    a.version === b.version &&
    a.digest === b.digest
  );
}

/**
 * THE guard: validate a claimed TaskSpec view. Throws typed TaskSpecError
 * on the first violated rule; returns the deep-frozen normalized view
 * otherwise. Pure — no I/O, no clock, no store.
 */
export function guardTaskSpecView(value: unknown): TaskSpecView {
  const record = expectFields(
    value,
    [
      'identity',
      'version',
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
    ],
    ['supersedes', 'recordVersion'],
    TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    'task spec',
  );

  if (
    record['recordVersion'] !== undefined &&
    record['recordVersion'] !== TASK_SPEC_RECORD_VERSION
  ) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `unsupported task-spec record version: ${String(record['recordVersion'])} (expected ${TASK_SPEC_RECORD_VERSION})`,
      details: { expected: TASK_SPEC_RECORD_VERSION },
    });
  }

  const identity = toTaskIdentity(
    record['identity'] as { tenant: string; taskId: string },
  );
  const version = toTaskVersion(
    typeof record['version'] === 'string' ? record['version'] : '',
  );
  const taskClass = toTaskClass(
    typeof record['taskClass'] === 'string' ? record['taskClass'] : '',
  );

  // -- capability labels: >= 1, pattern-valid, unique --------------------
  const rawLabels = record['capabilityLabels'];
  if (!Array.isArray(rawLabels) || rawLabels.length === 0) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_SPEC, {
      message: 'capability labels: at least one label is required (TS1.0 "capability labels")',
      details: { field: 'capabilityLabels' },
    });
  }
  const seenLabels = new Set<string>();
  for (const label of rawLabels) {
    if (!isCapabilityLabel(label)) {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_SPEC, {
        message: `invalid capability label: ${JSON.stringify(label)} (lowercase kebab, 1-64 chars)`,
        details: { field: 'capabilityLabels' },
      });
    }
    if (seenLabels.has(label)) {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_SPEC, {
        message: `duplicate capability label: ${JSON.stringify(label)}`,
        details: { field: 'capabilityLabels', label },
      });
    }
    seenLabels.add(label);
  }
  const capabilityLabels = Object.freeze([...rawLabels]) as readonly CapabilityLabel[];

  // -- difficulty: declared scale -----------------------------------------
  const difficulty = toTaskDifficultyDeclaration(
    record['difficulty'] as { scale: string; class: string },
  );

  // -- domain: capability-graph domain node --------------------------------
  const domain = toNodeRefView(
    record['domain'] as NodeRefView,
    ['domain'],
  );

  // -- initial state -------------------------------------------------------
  const initialState = toTaskInitialStateRef(
    record['initialState'] as {
      environment: { namespace: string; name: string; version: string; digest: string };
      seed?: string | null;
      note?: string | null;
    },
  );

  // -- instructions --------------------------------------------------------
  const instructions = expectNonEmptyString(
    record['instructions'],
    'instructions',
    TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    'task spec',
  );

  // -- statement lists -----------------------------------------------------
  const objectives = toStatementList(
    record['objectives'],
    'objectives',
    1,
    TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    'task spec',
  );
  const constraints = toStatementList(
    record['constraints'] ?? [],
    'constraints',
    0,
    TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    'task spec',
  );
  const prohibitedShortcuts = toStatementList(
    record['prohibitedShortcuts'] ?? [],
    'prohibitedShortcuts',
    0,
    TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    'task spec',
  );
  const expectedOutputs = toStatementList(
    record['expectedOutputs'],
    'expectedOutputs',
    1,
    TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    'task spec',
  );
  const completionCriteria = toStatementList(
    record['completionCriteria'],
    'completionCriteria',
    1,
    TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    'task spec',
  );
  const evidenceCriteria = toStatementList(
    record['evidenceCriteria'],
    'evidenceCriteria',
    1,
    TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    'task spec',
  );

  // -- permitted tools -----------------------------------------------------
  const rawTools = record['permittedTools'] ?? [];
  if (!Array.isArray(rawTools)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_SPEC, {
      message: 'permittedTools must be an array of content-addressed tool refs',
      details: { field: 'permittedTools' },
    });
  }
  const permittedTools = Object.freeze(
    rawTools.map((ref) => toArtifactRefView(ref as ArtifactRefView)),
  ) as readonly ArtifactRefView[];

  // -- long-horizon evidence: cross-field consistency ----------------------
  const rawLongHorizon = record['longHorizonEvidence'];
  if (rawLongHorizon !== null && rawLongHorizon !== undefined) {
    if (typeof rawLongHorizon !== 'object' || Array.isArray(rawLongHorizon)) {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_SPEC, {
        message: 'longHorizonEvidence must be {intermediateStateEvidence, recoveryCriteria} or null',
        details: { field: 'longHorizonEvidence' },
      });
    }
  }
  const longHorizonEvidence =
    rawLongHorizon === null || rawLongHorizon === undefined
      ? null
      : toLongHorizonEvidence(
          rawLongHorizon as {
            intermediateStateEvidence: readonly string[];
            recoveryCriteria: readonly string[];
          },
        );
  if (requiresLongHorizonEvidence(taskClass) && longHorizonEvidence === null) {
    crossField(
      `task class ${JSON.stringify(taskClass)} REQUIRES long-horizon evidence (intermediate state + recovery criteria) — "final output alone is insufficient where process behavior is part of the target capability" (TS1.0 Long-horizon work)`,
      { taskClass, required: ['intermediateStateEvidence', 'recoveryCriteria'] },
    );
  }
  if (longHorizonEvidence !== null && !permitsLongHorizonEvidence(taskClass)) {
    crossField(
      `task class ${JSON.stringify(taskClass)} must NOT carry long-horizon evidence (it is required only for long-horizon-execution and permitted for recovery-failure)`,
      { taskClass },
    );
  }

  // -- environment requirements + initial-state consistency ----------------
  const environmentRequirements = toTaskEnvironmentRequirements(
    record['environmentRequirements'] as {
      environments: readonly {
        namespace: string;
        name: string;
        version: string;
        digest: string;
      }[];
      constraints?: readonly string[];
    },
  );
  const pinned = initialState.environment;
  if (
    !environmentRequirements.environments.some((env) => sameArtifactRef(env, pinned))
  ) {
    crossField(
      `the pinned initial-state environment (${pinned.namespace}/${pinned.name}@${pinned.version}) is not among the required environment declarations — a task cannot start in a world it does not require`,
      {
        pinned: { ...pinned },
        required: environmentRequirements.environments.map((env) => ({ ...env })),
      },
    );
  }

  // -- bindings (rule 7: distinct, separately required) --------------------
  const evaluatorBindings = toEvaluatorBindings(
    record['evaluatorBindings'] as {
      evaluatorId: string;
      version: string;
      descriptorDigest: string;
    }[],
  ) as readonly EvaluatorBinding[];
  const verifierBindings = toVerifierBindings(
    record['verifierBindings'] as {
      verifierId: string;
      version: string;
      descriptorDigest: string;
    }[],
  ) as readonly VerifierBinding[];

  // -- expert qualification requirements ------------------------------------
  const expertQualificationRequirements = toTaskExpertQualificationRequirements(
    record['expertQualificationRequirements'] as {
      competencies: readonly {
        kind: string;
        id: string;
        version: string;
        digest: string;
      }[];
      qualificationPolicy?: { policyId: string; version: string; digest: string } | null;
      expectations: readonly string[];
    },
  );

  // -- quality declarations --------------------------------------------------
  const quality = toQualityDeclarationSet(
    record['quality'] as {
      dimension: string;
      satisfied: boolean;
      justification: string;
      provenance: { source: string; ref: string };
    }[],
  ) as readonly QualityDeclaration[];

  // -- data rights ------------------------------------------------------------
  const dataRights = toDataRightsMetadata(
    record['dataRights'] as {
      classification: string;
      tenantScope: string;
      crossTenantReuse: boolean;
      licensing?: string | null;
      privacyNotes?: string | null;
    },
  );
  if (dataRights.tenantScope !== identity.tenant) {
    crossField(
      `data-rights tenant scope (${JSON.stringify(dataRights.tenantScope)}) must equal the task identity's tenant (${JSON.stringify(identity.tenant)}) — task data is tenant-scoped (lock rule 11)`,
      { dataRightsTenant: dataRights.tenantScope, identityTenant: identity.tenant },
    );
  }

  // -- derivation provenance ---------------------------------------------------
  const rawDerived = record['derivedFrom'];
  const derivedRecord = expectFields(
    rawDerived,
    ['caseRef', 'policyRef'],
    [],
    TASK_SPEC_ERROR_CODES.INVALID_PROVENANCE,
    'task derivation',
  );
  const derivedFrom = Object.freeze({
    caseRef: toCaseRefView(
      derivedRecord['caseRef'] as CaseRefView,
    ),
    policyRef: toCompilationPolicyRefView(
      derivedRecord['policyRef'] as CompilationPolicyRefView,
    ),
  });

  // -- supersession (append-only versioning) -----------------------------------
  let supersedes: TaskVersionRef | undefined;
  if (record['supersedes'] !== undefined) {
    const rawSupersedes = record['supersedes'] as {
      tenant: string;
      taskId: string;
      version: string;
      digest: string;
    };
    supersedes = Object.freeze({
      tenant: ((): string => {
        if (typeof rawSupersedes.tenant !== 'string') {
          throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_SUPERSESSION, {
            message: 'supersedes ref requires a tenant scope',
          });
        }
        return rawSupersedes.tenant;
      })(),
      taskId: ((): string => {
        if (typeof rawSupersedes.taskId !== 'string') {
          throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_SUPERSESSION, {
            message: 'supersedes ref requires a task id',
          });
        }
        return rawSupersedes.taskId;
      })(),
      version: toTaskVersion(rawSupersedes.version ?? ''),
      digest: ((): string => {
        if (typeof rawSupersedes.digest !== 'string' || !/^[0-9a-f]{64}$/.test(rawSupersedes.digest)) {
          throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_SUPERSESSION, {
            message: `invalid supersedes ref digest: ${JSON.stringify(rawSupersedes.digest)}`,
          });
        }
        return rawSupersedes.digest;
      })(),
    });
    if (
      supersedes.tenant !== identity.tenant ||
      supersedes.taskId !== identity.taskId
    ) {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_SUPERSESSION, {
        message: `supersession must target the same logical task: ${JSON.stringify(supersedes.tenant)}/${JSON.stringify(supersedes.taskId)} does not match ${JSON.stringify(identity.tenant)}/${JSON.stringify(identity.taskId)}`,
        details: {
          supersedes: `${supersedes.tenant}/${supersedes.taskId}@${supersedes.version}`,
          task: `${identity.tenant}/${identity.taskId}`,
        },
      });
    }
    if (!isTaskVersion(supersedes.version) || compareTaskVersions(version, supersedes.version) <= 0) {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_SUPERSESSION, {
        message: `a superseding task version must have STRICTLY higher semver precedence than the version it supersedes: ${JSON.stringify(version)} does not supersede ${JSON.stringify(supersedes.version)}`,
        details: { supersedes: supersedes.version, version },
      });
    }
  }

  const view: TaskSpecView = {
    recordVersion: TASK_SPEC_RECORD_VERSION,
    identity,
    version,
    ...(supersedes !== undefined ? { supersedes } : {}),
    taskClass,
    capabilityLabels,
    difficulty,
    domain,
    initialState,
    instructions,
    objectives,
    constraints,
    permittedTools,
    prohibitedShortcuts,
    expectedOutputs,
    completionCriteria,
    evidenceCriteria,
    longHorizonEvidence,
    environmentRequirements,
    evaluatorBindings,
    verifierBindings,
    expertQualificationRequirements,
    quality,
    dataRights,
    derivedFrom,
  };
  return deepFreeze(view);
}
