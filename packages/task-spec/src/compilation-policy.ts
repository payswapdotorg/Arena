/**
 * CompilationPolicy — the versioned, content-addressed RULE SET the A008
 * TaskCompiler compiles Capability Cases under (Work Order A008;
 * requirement R6 "Compile Capability Cases into reproducible TaskSpecs").
 *
 * A policy is the task-design authority's declared, immutable rule set:
 *
 *   - `eligibility` — which case lifecycle statuses are compilable under
 *     this policy (a NON-EMPTY SUBSET of A005's compilable statuses
 *     {triaged, active} — the policy may NARROW the A005 gate but never
 *     widen it past non-terminal, sufficiently-evidenced states) and the
 *     minimum evidence count a case must carry;
 *   - `classSelection` — the ordered, first-match-wins rules that select
 *     the TS1.0 task class from case data (closed matcher vocabulary; the
 *     LAST rule must be `always`, so class selection is a TOTAL function);
 *   - `difficulty` — how task difficulty is derived (from the case's
 *     declared difficulty, or declared by the policy) — always in the
 *     declared scale;
 *   - `fieldMapping` — how case objectives/constraints/shortcuts/tools/
 *     expected-outputs map into task fields, plus the instruction
 *     template (closed placeholder vocabulary);
 *   - `environment` — environment selection (first candidate vs one spec
 *     per candidate) and the pinned seed;
 *   - `identity` — the task-id prefix and the initial task version;
 *   - `expertQualification` — the A007-shaped expert-qualification
 *     requirements compiled tasks carry (derived from the case's target
 *     capability, or declared by the policy);
 *   - `quality` — the declared posture for all seven TS1.0 quality
 *     dimensions (exactly one declaration per dimension, REQUIRED);
 *   - `longHorizon` — the intermediate-state + recovery evidence
 *     injected into long-horizon tasks (REQUIRED when the class-selection
 *     rules can select `long-horizon-execution` — cross-field guard);
 *   - `dataRights` — the data-rights classification compiled tasks carry
 *     (R24 posture; the compiler always emits crossTenantReuse: false).
 *
 * Content-addressed + deep-frozen: same rules ⇒ same digest; there is NO
 * mutation API. Changing a rule is a NEW policy version (the identity is
 * policyId + version; a different digest under the same identity is a
 * conflict in the compiler registry).
 */

import { digestCanonical } from '@arena/protocol-core';
import { TASK_SPEC_ERROR_CODES, TaskSpecError } from './errors.js';
import { toTaskClass } from './task-class.js';
import type { TaskClass } from './task-class.js';
import { isTaskDifficultyClass, isTaskDifficultyScale, TASK_DIFFICULTY_SCALES } from './difficulty.js';
import type { TaskDifficultyClass } from './difficulty.js';
import { toQualityDeclarationSet } from './quality.js';
import type { QualityDeclaration } from './quality.js';
import { toTaskExpertQualificationRequirements } from './expert-qualification.js';
import type { TaskExpertQualificationRequirements } from './expert-qualification.js';
import {
  deepFreeze,
  expectFields,
  expectNonEmptyString,
  expectNumberInRange,
  isNeutralId,
  toNeutralId,
  toQualificationPolicyRefView,
  toStatementList,
  toTaskVersion,
} from './shared.js';
import type {
  NeutralId,
  QualificationPolicyRefView,
  TaskVersion,
} from './shared.js';
import {
  isDataRightsClassification,
  DATA_RIGHTS_CLASSIFICATIONS,
} from './data-rights.js';
import type { DataRightsClassification } from './data-rights.js';
import type { LongHorizonEvidence } from './spec.js';

/** Wire version of the compilation-policy shape. */
export const COMPILATION_POLICY_VERSION = 1 as const;

/** The case statuses a compilation policy may declare compilable (A005 gate). */
export const POLICY_COMPILABLE_CASE_STATUSES = Object.freeze([
  'triaged',
  'active',
] as const);

export type PolicyCompilableCaseStatus = (typeof POLICY_COMPILABLE_CASE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/** Stable field list for eligibility. */
export const POLICY_ELIGIBILITY_FIELDS = Object.freeze([
  'compilableStatuses',
  'minimumEvidenceCount',
] as const) as readonly string[];

export interface PolicyEligibility {
  readonly compilableStatuses: readonly PolicyCompilableCaseStatus[];
  readonly minimumEvidenceCount: number;
}

// ---------------------------------------------------------------------------
// Class selection
// ---------------------------------------------------------------------------

/** The CLOSED class-selection matcher vocabulary. */
export const CLASS_SELECTION_MATCHER_KINDS = Object.freeze([
  'always',
  'difficulty-is',
  'tools-present',
  'shortcuts-present',
  'evidence-at-least',
] as const);

export type ClassSelectionMatcherKind = (typeof CLASS_SELECTION_MATCHER_KINDS)[number];

/** Stable field list for one class-selection rule. */
export const CLASS_SELECTION_RULE_FIELDS = Object.freeze([
  'matcher',
  'class',
  'difficulty',
  'count',
] as const) as readonly string[];

/** One ordered class-selection rule (first-match-wins). */
export interface ClassSelectionRule {
  readonly matcher: ClassSelectionMatcherKind;
  readonly class: TaskClass;
  /** Required iff matcher is 'difficulty-is'. */
  readonly difficulty?: TaskDifficultyClass;
  /** Required iff matcher is 'evidence-at-least'. */
  readonly count?: number;
}

// ---------------------------------------------------------------------------
// Difficulty derivation
// ---------------------------------------------------------------------------

export const POLICY_DIFFICULTY_MODES = Object.freeze([
  'from-case',
  'declared',
] as const);

export type PolicyDifficultyMode = (typeof POLICY_DIFFICULTY_MODES)[number];

/** Stable field list for difficulty derivation. */
export const POLICY_DIFFICULTY_FIELDS = Object.freeze([
  'mode',
  'scale',
  'declaredClass',
] as const) as readonly string[];

export interface PolicyDifficulty {
  readonly mode: PolicyDifficultyMode;
  readonly scale: string;
  /** Required iff mode is 'declared'. */
  readonly declaredClass: TaskDifficultyClass | null;
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

export const OBJECTIVES_MAPPING_MODES = Object.freeze(['pass-through', 'first'] as const);
export const CONSTRAINTS_MAPPING_MODES = Object.freeze(['pass-through', 'union'] as const);
export const SHORTCUTS_MAPPING_MODES = Object.freeze(['pass-through', 'union'] as const);
export const TOOLS_MAPPING_MODES = Object.freeze(['pass-through', 'none'] as const);
export const OUTPUTS_MAPPING_MODES = Object.freeze([
  'from-success-conditions',
  'declared',
] as const);

/** The CLOSED instruction-template placeholder vocabulary. */
export const INSTRUCTION_PLACEHOLDERS = Object.freeze([
  '{caseId}',
  '{domain}',
  '{capability}',
  '{objectives}',
  '{difficulty}',
  '{evidenceCount}',
] as const);

/** Stable field list for field mapping. */
export const POLICY_FIELD_MAPPING_FIELDS = Object.freeze([
  'objectives',
  'constraints',
  'prohibitedShortcuts',
  'permittedTools',
  'expectedOutputs',
  'instructions',
] as const) as readonly string[];

export interface PolicyFieldMapping {
  readonly objectives: { mode: 'pass-through' } | { mode: 'first'; count: number };
  readonly constraints:
    | { mode: 'pass-through' }
    | { mode: 'union'; additional: readonly string[] };
  readonly prohibitedShortcuts:
    | { mode: 'pass-through' }
    | { mode: 'union'; additional: readonly string[] };
  readonly permittedTools: { mode: 'pass-through' } | { mode: 'none' };
  readonly expectedOutputs:
    | { mode: 'from-success-conditions' }
    | { mode: 'declared'; outputs: readonly string[] };
  readonly instructions: { mode: 'template'; template: string };
}

// ---------------------------------------------------------------------------
// Environment / identity / expert qualification
// ---------------------------------------------------------------------------

export const ENVIRONMENT_SELECTION_MODES = Object.freeze(['first', 'each'] as const);

/** Stable field list for environment selection. */
export const POLICY_ENVIRONMENT_FIELDS = Object.freeze([
  'selection',
  'seed',
  'note',
] as const) as readonly string[];

export interface PolicyEnvironment {
  readonly selection: 'first' | 'each';
  readonly seed: string | null;
  readonly note: string | null;
}

/** Stable field list for identity derivation. */
export const POLICY_IDENTITY_FIELDS = Object.freeze([
  'taskIdPrefix',
  'initialVersion',
] as const);

export interface PolicyIdentity {
  readonly taskIdPrefix: string;
  readonly initialVersion: string;
}

export const EXPERT_QUALIFICATION_MODES = Object.freeze([
  'from-target-capability',
  'declare',
] as const);

/** Stable field list for the policy's expert-qualification posture. */
export const POLICY_EXPERT_QUALIFICATION_FIELDS = Object.freeze([
  'mode',
  'declared',
  'expectations',
  'qualificationPolicy',
] as const) as readonly string[];

export interface PolicyExpertQualification {
  readonly mode: 'from-target-capability' | 'declare';
  /** Required iff mode is 'declare'. */
  readonly declared: TaskExpertQualificationRequirements | null;
  /** Required iff mode is 'from-target-capability'. */
  readonly expectations: readonly string[] | null;
  readonly qualificationPolicy: QualificationPolicyRefView | null;
}

// ---------------------------------------------------------------------------
// The policy shape
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the policy digest commits to. */
export interface CompilationPolicyView {
  readonly policyVersion: typeof COMPILATION_POLICY_VERSION;
  readonly policyId: NeutralId;
  readonly version: TaskVersion;
  readonly description: string;
  readonly eligibility: PolicyEligibility;
  readonly classSelection: { readonly rules: readonly ClassSelectionRule[] };
  readonly difficulty: PolicyDifficulty;
  readonly fieldMapping: PolicyFieldMapping;
  readonly environment: PolicyEnvironment;
  readonly identity: PolicyIdentity;
  readonly expertQualification: PolicyExpertQualification;
  readonly quality: readonly QualityDeclaration[];
  readonly longHorizon: LongHorizonEvidence | null;
  readonly dataRights: {
    readonly classification: DataRightsClassification;
    readonly licensing: string | null;
    readonly privacyNotes: string | null;
  };
}

/** A frozen, content-addressed compilation policy: view + digest. */
export interface CompilationPolicy extends CompilationPolicyView {
  readonly digest: string;
}

/** The stable top-level field list of the policy view. */
export const COMPILATION_POLICY_FIELDS = Object.freeze([
  'policyVersion',
  'policyId',
  'version',
  'description',
  'eligibility',
  'classSelection',
  'difficulty',
  'fieldMapping',
  'environment',
  'identity',
  'expertQualification',
  'quality',
  'longHorizon',
  'dataRights',
  'digest',
] as const) as readonly string[];

export interface CreateCompilationPolicyInput {
  readonly policyId: string;
  readonly version: string;
  readonly description: string;
  readonly eligibility: {
    readonly compilableStatuses: readonly string[];
    readonly minimumEvidenceCount: number;
  };
  readonly classSelection: readonly {
    readonly matcher: string;
    readonly class: string;
    readonly difficulty?: string;
    readonly count?: number;
  }[];
  readonly difficulty: {
    readonly mode: string;
    readonly scale: string;
    readonly declaredClass?: string | null;
  };
  readonly fieldMapping: {
    readonly objectives: { mode: string; count?: number };
    readonly constraints: { mode: string; additional?: readonly string[] };
    readonly prohibitedShortcuts: { mode: string; additional?: readonly string[] };
    readonly permittedTools: { mode: string };
    readonly expectedOutputs: { mode: string; outputs?: readonly string[] };
    readonly instructions: { mode: string; template: string };
  };
  readonly environment: {
    readonly selection: string;
    readonly seed?: string | null;
    readonly note?: string | null;
  };
  readonly identity: {
    readonly taskIdPrefix: string;
    readonly initialVersion?: string;
  };
  readonly expertQualification: {
    readonly mode: string;
    readonly declared?: {
      competencies: readonly { kind: string; id: string; version: string; digest: string }[];
      qualificationPolicy?: { policyId: string; version: string; digest: string } | null;
      expectations: readonly string[];
    } | null;
    readonly expectations?: readonly string[] | null;
    readonly qualificationPolicy?: { policyId: string; version: string; digest: string } | null;
  };
  readonly quality: readonly {
    dimension: string;
    satisfied: boolean;
    justification: string;
  }[];
  readonly longHorizon?: {
    intermediateStateEvidence: readonly string[];
    recoveryCriteria: readonly string[];
  } | null;
  readonly dataRights: {
    readonly classification: string;
    readonly licensing?: string | null;
    readonly privacyNotes?: string | null;
  };
}

function toPolicyEligibility(value: unknown): PolicyEligibility {
  const record = expectFields(
    value,
    ['compilableStatuses', 'minimumEvidenceCount'],
    [],
    TASK_SPEC_ERROR_CODES.INVALID_POLICY,
    'compilation policy eligibility',
  );
  const statuses = record['compilableStatuses'];
  if (!Array.isArray(statuses) || statuses.length === 0) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_POLICY, {
      message: 'policy eligibility requires a non-empty compilableStatuses list',
    });
  }
  const compilableStatuses = Object.freeze(
    statuses.map((status) => {
      if (
        typeof status !== 'string' ||
        !(POLICY_COMPILABLE_CASE_STATUSES as readonly string[]).includes(status)
      ) {
        throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_POLICY, {
          message: `policy compilable status ${JSON.stringify(status)} is outside the A005 compilable set (the policy may NARROW {triaged, active}, never widen it past non-terminal states)`,
          details: { allowed: [...POLICY_COMPILABLE_CASE_STATUSES] },
        });
      }
      return status as PolicyCompilableCaseStatus;
    }),
  );
  return Object.freeze({
    compilableStatuses,
    minimumEvidenceCount: expectNumberInRange(
      record['minimumEvidenceCount'],
      'minimumEvidenceCount',
      1,
      Number.MAX_SAFE_INTEGER,
      TASK_SPEC_ERROR_CODES.INVALID_POLICY,
      'compilation policy eligibility',
    ),
  });
}

function toClassSelectionRule(value: unknown): ClassSelectionRule {
  const record = expectFields(
    value,
    ['matcher', 'class'],
    ['difficulty', 'count'],
    TASK_SPEC_ERROR_CODES.INVALID_CLASS_SELECTION,
    'class-selection rule',
  );
  const matcher = record['matcher'];
  if (
    typeof matcher !== 'string' ||
    !(CLASS_SELECTION_MATCHER_KINDS as readonly string[]).includes(matcher)
  ) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_CLASS_SELECTION, {
      message: `unknown class-selection matcher: ${JSON.stringify(matcher)} (known: ${CLASS_SELECTION_MATCHER_KINDS.join(', ')})`,
      details: { known: [...CLASS_SELECTION_MATCHER_KINDS] },
    });
  }
  const taskClass = toTaskClass(
    typeof record['class'] === 'string' ? record['class'] : '',
  );
  const difficulty = record['difficulty'];
  if (matcher === 'difficulty-is') {
    if (!isTaskDifficultyClass(difficulty)) {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_CLASS_SELECTION, {
        message: `matcher 'difficulty-is' requires a difficulty class (one of exploratory|standard|routine), got: ${JSON.stringify(difficulty)}`,
      });
    }
    return Object.freeze({
      matcher: 'difficulty-is',
      class: taskClass,
      difficulty,
    } as ClassSelectionRule);
  }
  if (difficulty !== undefined) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_CLASS_SELECTION, {
      message: `class-selection field 'difficulty' is only valid for the 'difficulty-is' matcher (rule for class ${JSON.stringify(taskClass)})`,
    });
  }
  const count = record['count'];
  if (matcher === 'evidence-at-least') {
    return Object.freeze({
      matcher: 'evidence-at-least',
      class: taskClass,
      count: expectNumberInRange(
        count,
        'count',
        1,
        Number.MAX_SAFE_INTEGER,
        TASK_SPEC_ERROR_CODES.INVALID_CLASS_SELECTION,
        'class-selection rule',
      ),
    } as ClassSelectionRule);
  }
  if (count !== undefined) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_CLASS_SELECTION, {
      message: `class-selection field 'count' is only valid for the 'evidence-at-least' matcher (rule for class ${JSON.stringify(taskClass)})`,
    });
  }
  return Object.freeze({ matcher, class: taskClass } as ClassSelectionRule);
}

function toStringListOrPassThrough(
  value: { mode: string; additional?: readonly string[] },
  modes: readonly string[],
  field: string,
): { mode: string; additional?: readonly string[] } {
  if (!modes.includes(value.mode)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING, {
      message: `unknown ${field} mapping mode: ${JSON.stringify(value.mode)} (known: ${modes.join(', ')})`,
      details: { known: [...modes] },
    });
  }
  if (value.mode === 'union') {
    return {
      mode: 'union',
      additional: toStatementList(
        value.additional ?? [],
        'additional',
        0,
        TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING,
        `${field} mapping`,
      ),
    };
  }
  return { mode: value.mode };
}

function validateTemplatePlaceholders(template: string): void {
  const pattern = /\{([^{}]*)\}/g;
  let match = pattern.exec(template);
  while (match !== null) {
    const placeholder = `{${match[1] ?? ''}}`;
    if (!(INSTRUCTION_PLACEHOLDERS as readonly string[]).includes(placeholder)) {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING, {
        message: `unknown instruction template placeholder ${JSON.stringify(placeholder)} (known: ${INSTRUCTION_PLACEHOLDERS.join(', ')})`,
        details: { known: [...INSTRUCTION_PLACEHOLDERS] },
      });
    }
    match = pattern.exec(template);
  }
}

function toPolicyFieldMapping(value: unknown): PolicyFieldMapping {
  const record = expectFields(
    value,
    ['objectives', 'constraints', 'prohibitedShortcuts', 'permittedTools', 'expectedOutputs', 'instructions'],
    [],
    TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING,
    'compilation policy field mapping',
  );

  const objectivesRecord = expectFields(
    record['objectives'],
    ['mode'],
    ['count'],
    TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING,
    'objectives mapping',
  );
  if (!(OBJECTIVES_MAPPING_MODES as readonly string[]).includes(objectivesRecord['mode'] as string)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING, {
      message: `unknown objectives mapping mode: ${JSON.stringify(objectivesRecord['mode'])} (known: ${OBJECTIVES_MAPPING_MODES.join(', ')})`,
    });
  }
  const objectives: PolicyFieldMapping['objectives'] =
    objectivesRecord['mode'] === 'first'
      ? {
          mode: 'first',
          count: expectNumberInRange(
            objectivesRecord['count'],
            'count',
            1,
            Number.MAX_SAFE_INTEGER,
            TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING,
            'objectives mapping',
          ),
        }
      : { mode: 'pass-through' };

  const constraints = toStringListOrPassThrough(
    record['constraints'] as { mode: string; additional?: readonly string[] },
    CONSTRAINTS_MAPPING_MODES,
    'constraints',
  ) as PolicyFieldMapping['constraints'];

  const prohibitedShortcuts = toStringListOrPassThrough(
    record['prohibitedShortcuts'] as { mode: string; additional?: readonly string[] },
    SHORTCUTS_MAPPING_MODES,
    'prohibitedShortcuts',
  ) as PolicyFieldMapping['prohibitedShortcuts'];

  const toolsRecord = expectFields(
    record['permittedTools'],
    ['mode'],
    [],
    TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING,
    'permittedTools mapping',
  );
  if (!(TOOLS_MAPPING_MODES as readonly string[]).includes(toolsRecord['mode'] as string)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING, {
      message: `unknown permittedTools mapping mode: ${JSON.stringify(toolsRecord['mode'])} (known: ${TOOLS_MAPPING_MODES.join(', ')})`,
    });
  }
  const permittedTools: PolicyFieldMapping['permittedTools'] =
    toolsRecord['mode'] === 'none' ? { mode: 'none' } : { mode: 'pass-through' };

  const outputsRecord = expectFields(
    record['expectedOutputs'],
    ['mode'],
    ['outputs'],
    TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING,
    'expectedOutputs mapping',
  );
  if (!(OUTPUTS_MAPPING_MODES as readonly string[]).includes(outputsRecord['mode'] as string)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING, {
      message: `unknown expectedOutputs mapping mode: ${JSON.stringify(outputsRecord['mode'])} (known: ${OUTPUTS_MAPPING_MODES.join(', ')})`,
    });
  }
  const expectedOutputs: PolicyFieldMapping['expectedOutputs'] =
    outputsRecord['mode'] === 'declared'
      ? {
          mode: 'declared',
          outputs: toStatementList(
            outputsRecord['outputs'] ?? [],
            'outputs',
            1,
            TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING,
            'expectedOutputs mapping',
          ),
        }
      : { mode: 'from-success-conditions' };

  const instructionsRecord = expectFields(
    record['instructions'],
    ['mode', 'template'],
    [],
    TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING,
    'instructions mapping',
  );
  if (instructionsRecord['mode'] !== 'template') {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING, {
      message: `instructions mapping mode must be 'template' (got ${JSON.stringify(instructionsRecord['mode'])})`,
    });
  }
  const template = expectNonEmptyString(
    instructionsRecord['template'],
    'template',
    TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING,
    'instructions mapping',
  );
  validateTemplatePlaceholders(template);

  return deepFreeze({
    objectives,
    constraints,
    prohibitedShortcuts,
    permittedTools,
    expectedOutputs,
    instructions: { mode: 'template', template },
  });
}

function toPolicyExpertQualification(value: unknown): PolicyExpertQualification {
  const record = expectFields(
    value,
    ['mode'],
    ['declared', 'expectations', 'qualificationPolicy'],
    TASK_SPEC_ERROR_CODES.INVALID_POLICY,
    'policy expert-qualification posture',
  );
  const mode = record['mode'];
  if (!(EXPERT_QUALIFICATION_MODES as readonly string[]).includes(mode as string)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_POLICY, {
      message: `unknown policy expert-qualification mode: ${JSON.stringify(mode)} (known: ${EXPERT_QUALIFICATION_MODES.join(', ')})`,
    });
  }
  const qualificationPolicyRaw = record['qualificationPolicy'] ?? null;
  const qualificationPolicy =
    qualificationPolicyRaw === null
      ? null
      : toQualificationPolicyRefView(
          qualificationPolicyRaw as QualificationPolicyRefView,
        );

  if (mode === 'declare') {
    const declaredRaw = record['declared'];
    if (declaredRaw === null || declaredRaw === undefined) {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_POLICY, {
        message:
          "policy expert-qualification mode 'declare' requires the declared requirements {competencies, qualificationPolicy, expectations}",
      });
    }
    const declared = toTaskExpertQualificationRequirements(
      declaredRaw as Parameters<typeof toTaskExpertQualificationRequirements>[0],
    );
    return deepFreeze({
      mode: 'declare',
      declared,
      expectations: null,
      qualificationPolicy: declared.qualificationPolicy,
    });
  }

  const expectationsRaw = record['expectations'];
  if (expectationsRaw === null || expectationsRaw === undefined) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_POLICY, {
      message:
        "policy expert-qualification mode 'from-target-capability' requires the expectations statements compiled tasks carry",
    });
  }
  const expectations = toStatementList(
    expectationsRaw,
    'expectations',
    1,
    TASK_SPEC_ERROR_CODES.INVALID_POLICY,
    'policy expert-qualification posture',
  );
  return deepFreeze({
    mode: 'from-target-capability',
    declared: null,
    expectations,
    qualificationPolicy,
  });
}

/** Which task classes can a rule list select (the reachable class set)? */
export function selectableClasses(
  rules: readonly ClassSelectionRule[],
): ReadonlySet<TaskClass> {
  return new Set(rules.map((rule) => rule.class));
}

/**
 * Create a validated, deep-frozen, content-addressed CompilationPolicy.
 * Cross-field guards:
 *   - classSelection: non-empty ordered rules, LAST rule must be 'always'
 *     (total function), no rule may follow an 'always' rule;
 *   - if the rules can select 'long-horizon-execution', longHorizon
 *     evidence MUST be declared (the compiled spec's guard requires it);
 *   - difficulty 'declared' mode requires declaredClass; scale must be a
 *     known scale;
 *   - quality: exactly one declaration per dimension.
 */
export async function createCompilationPolicy(
  input: CreateCompilationPolicyInput,
): Promise<CompilationPolicy> {
  const record = expectFields(
    input,
    [
      'policyId',
      'version',
      'description',
      'eligibility',
      'classSelection',
      'difficulty',
      'fieldMapping',
      'environment',
      'identity',
      'expertQualification',
      'quality',
      'dataRights',
    ],
    ['longHorizon'],
    TASK_SPEC_ERROR_CODES.INVALID_POLICY,
    'compilation policy',
  );

  if (record['policyVersion'] !== undefined && record['policyVersion'] !== COMPILATION_POLICY_VERSION) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `unsupported compilation-policy record version: ${String(record['policyVersion'])}`,
    });
  }

  const policyId = isNeutralId(record['policyId'])
    ? (record['policyId'] as NeutralId)
    : toNeutralId(
        typeof record['policyId'] === 'string' ? record['policyId'] : '',
        'compilation policy policyId',
      );
  const version = toTaskVersion(
    typeof record['version'] === 'string' ? record['version'] : '',
  );
  const description = expectNonEmptyString(
    record['description'],
    'description',
    TASK_SPEC_ERROR_CODES.INVALID_POLICY,
    'compilation policy',
  );

  const eligibility = toPolicyEligibility(record['eligibility']);

  const rawRules = record['classSelection'];
  if (!Array.isArray(rawRules) || rawRules.length === 0) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_CLASS_SELECTION, {
      message: 'classSelection requires a non-empty ordered rule list',
    });
  }
  const rules = Object.freeze(rawRules.map(toClassSelectionRule));
  const lastRule = rules[rules.length - 1] as ClassSelectionRule;
  if (lastRule.matcher !== 'always') {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_CLASS_SELECTION, {
      message:
        "the LAST class-selection rule must be the 'always' matcher (class selection must be a total function — every compilable case resolves to a class)",
      details: { lastMatcher: lastRule.matcher },
    });
  }
  for (let i = 0; i < rules.length - 1; i += 1) {
    const rule = rules[i] as ClassSelectionRule;
    if (rule.matcher === 'always') {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_CLASS_SELECTION, {
        message: `an 'always' rule must be the LAST rule (rule ${i + 1} makes the rest unreachable)`,
        details: { index: i + 1 },
      });
    }
  }

  const difficultyRecord = expectFields(
    record['difficulty'],
    ['mode', 'scale'],
    ['declaredClass'],
    TASK_SPEC_ERROR_CODES.INVALID_DIFFICULTY,
    'policy difficulty derivation',
  );
  if (!(POLICY_DIFFICULTY_MODES as readonly string[]).includes(difficultyRecord['mode'] as string)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_DIFFICULTY, {
      message: `unknown difficulty derivation mode: ${JSON.stringify(difficultyRecord['mode'])} (known: ${POLICY_DIFFICULTY_MODES.join(', ')})`,
    });
  }
  if (!isTaskDifficultyScale(difficultyRecord['scale'])) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_DIFFICULTY, {
      message: `unknown difficulty scale: ${JSON.stringify(difficultyRecord['scale'])} (known: ${TASK_DIFFICULTY_SCALES.join(', ')})`,
    });
  }
  let declaredClass: TaskDifficultyClass | null = null;
  if (difficultyRecord['mode'] === 'declared') {
    if (!isTaskDifficultyClass(difficultyRecord['declaredClass'])) {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_DIFFICULTY, {
        message: "difficulty mode 'declared' requires a declaredClass in the scale",
      });
    }
    declaredClass = difficultyRecord['declaredClass'];
  }
  const difficulty: PolicyDifficulty = Object.freeze({
    mode: difficultyRecord['mode'] as PolicyDifficultyMode,
    scale: difficultyRecord['scale'] as string,
    declaredClass,
  });

  const fieldMapping = toPolicyFieldMapping(record['fieldMapping']);

  const environmentRecord = expectFields(
    record['environment'],
    ['selection'],
    ['seed', 'note'],
    TASK_SPEC_ERROR_CODES.INVALID_ENVIRONMENT,
    'policy environment selection',
  );
  if (!(ENVIRONMENT_SELECTION_MODES as readonly string[]).includes(environmentRecord['selection'] as string)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_ENVIRONMENT, {
      message: `unknown environment selection mode: ${JSON.stringify(environmentRecord['selection'])} (known: ${ENVIRONMENT_SELECTION_MODES.join(', ')})`,
    });
  }
  const seed = environmentRecord['seed'] ?? null;
  if (seed !== null && (typeof seed !== 'string' || seed.length === 0)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_ENVIRONMENT, {
      message: 'policy seed, when present, must be a non-empty string',
    });
  }
  const note = environmentRecord['note'] ?? null;
  if (note !== null && (typeof note !== 'string' || note.length === 0)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_ENVIRONMENT, {
      message: 'policy note, when present, must be a non-empty statement',
    });
  }
  const environment: PolicyEnvironment = Object.freeze({
    selection: environmentRecord['selection'] as 'first' | 'each',
    seed,
    note,
  });

  const identityRecord = expectFields(
    record['identity'],
    ['taskIdPrefix'],
    ['initialVersion'],
    TASK_SPEC_ERROR_CODES.INVALID_IDENTITY,
    'policy identity derivation',
  );
  const taskIdPrefix = expectNonEmptyString(
    identityRecord['taskIdPrefix'],
    'taskIdPrefix',
    TASK_SPEC_ERROR_CODES.INVALID_IDENTITY,
    'policy identity derivation',
  );
  if (!/^[a-z][a-z0-9-]*$/.test(taskIdPrefix)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_IDENTITY, {
      message: `taskIdPrefix must be lowercase kebab without a trailing dash: ${JSON.stringify(taskIdPrefix)}`,
    });
  }
  const identity: PolicyIdentity = Object.freeze({
    taskIdPrefix,
    initialVersion: toTaskVersion(
      typeof identityRecord['initialVersion'] === 'string' ? identityRecord['initialVersion'] : '1.0.0',
    ),
  });

  const expertQualification = toPolicyExpertQualification(record['expertQualification']);

  const qualityRecord = record['quality'];
  if (!Array.isArray(qualityRecord)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_QUALITY, {
      message: 'policy quality declarations must be an array ({dimension, satisfied, justification})',
    });
  }
  const qualityProvenanceRef = `${policyId}@${version}`;
  const quality = toQualityDeclarationSet(
    qualityRecord.map((entry) => {
      const q = expectFields(
        entry,
        ['dimension', 'satisfied', 'justification'],
        [],
        TASK_SPEC_ERROR_CODES.INVALID_QUALITY,
        'policy quality declaration',
      );
      return {
        dimension: q['dimension'] as string,
        satisfied: q['satisfied'] === true,
        justification: q['justification'] as string,
        provenance: { source: 'compilation-policy', ref: qualityProvenanceRef },
      };
    }),
  ) as readonly QualityDeclaration[];

  const rawLongHorizon = record['longHorizon'] ?? null;
  let longHorizon: LongHorizonEvidence | null = null;
  if (rawLongHorizon !== null) {
    const lh = expectFields(
      rawLongHorizon,
      ['intermediateStateEvidence', 'recoveryCriteria'],
      [],
      TASK_SPEC_ERROR_CODES.INVALID_POLICY,
      'policy long-horizon evidence',
    );
    longHorizon = Object.freeze({
      intermediateStateEvidence: toStatementList(
        lh['intermediateStateEvidence'],
        'intermediateStateEvidence',
        1,
        TASK_SPEC_ERROR_CODES.INVALID_POLICY,
        'policy long-horizon evidence',
      ),
      recoveryCriteria: toStatementList(
        lh['recoveryCriteria'],
        'recoveryCriteria',
        1,
        TASK_SPEC_ERROR_CODES.INVALID_POLICY,
        'policy long-horizon evidence',
      ),
    });
  }
  if (selectableClasses(rules).has('long-horizon-execution') && longHorizon === null) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.CROSS_FIELD_CONSISTENCY, {
      message:
        "the class-selection rules can select 'long-horizon-execution', so the policy MUST declare longHorizon evidence (intermediate state + recovery criteria) — the compiled spec's guard requires it",
      details: { selectable: [...selectableClasses(rules)] },
    });
  }

  const dataRightsRecord = expectFields(
    record['dataRights'],
    ['classification'],
    ['licensing', 'privacyNotes'],
    TASK_SPEC_ERROR_CODES.INVALID_DATA_RIGHTS,
    'policy data rights',
  );
  if (!isDataRightsClassification(dataRightsRecord['classification'])) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_DATA_RIGHTS, {
      message: `unknown data-rights classification: ${JSON.stringify(dataRightsRecord['classification'])} (known: ${DATA_RIGHTS_CLASSIFICATIONS.join(', ')})`,
    });
  }
  const licensing = dataRightsRecord['licensing'] ?? null;
  if (licensing !== null && (typeof licensing !== 'string' || licensing.length === 0)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_DATA_RIGHTS, {
      message: 'policy licensing, when present, must be a non-empty statement',
    });
  }
  const privacyNotes = dataRightsRecord['privacyNotes'] ?? null;
  if (
    privacyNotes !== null &&
    (typeof privacyNotes !== 'string' || privacyNotes.length === 0)
  ) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_DATA_RIGHTS, {
      message: 'policy privacyNotes, when present, must be a non-empty statement',
    });
  }

  const view: CompilationPolicyView = {
    policyVersion: COMPILATION_POLICY_VERSION,
    policyId,
    version,
    description,
    eligibility,
    classSelection: Object.freeze({ rules }),
    difficulty,
    fieldMapping,
    environment,
    identity,
    expertQualification,
    quality,
    longHorizon,
    dataRights: Object.freeze({
      classification: dataRightsRecord['classification'] as DataRightsClassification,
      licensing,
      privacyNotes,
    }),
  };
  const digest = await digestCanonical(view);
  return deepFreeze({ ...view, digest });
}

/** The digest-free view of a policy (what the digest commits to). */
export function compilationPolicyView(policy: CompilationPolicy): CompilationPolicyView {
  const { digest: _digest, ...view } = policy;
  return deepFreeze({ ...view }) as CompilationPolicyView;
}

/**
 * Recompute the policy digest and compare. Throws TASK_SPEC_TAMPERED on
 * any mismatch.
 */
export async function recomputeCompilationPolicyDigest(
  policy: CompilationPolicy,
  expectedDigest?: string,
): Promise<string> {
  const actual = await digestCanonical(compilationPolicyView(policy));
  const claimed = expectedDigest ?? policy.digest;
  if (actual !== claimed) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.TAMPERED, {
      message: `compilation policy digest mismatch: expected ${claimed}, recomputed ${actual}`,
      details: { expected: claimed, actual },
    });
  }
  return actual;
}

/** The policy identity key: "policyId@version". */
export function compilationPolicyIdentityKey(policy: CompilationPolicy): string {
  return `${policy.policyId}@${policy.version}`;
}
