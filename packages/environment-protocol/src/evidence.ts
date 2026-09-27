/**
 * Evidence outputs and evaluator/verifier hooks (spec ENV1.0 declare
 * fields 14 and 15; spec ENV1.0 "Evidence"; requirements R9, R22; Work
 * Order A009 gate 2).
 *
 *   - EvidenceOutputs: the closed set of evidence kinds a run of this
 *     environment produces, each with its addressing policy. Together with
 *     the RunAddress (run-address.ts) this makes every run addressable by
 *     task version, environment version, run id, initial snapshot digest,
 *     trajectory digest and evidence digests.
 *   - EvaluationHooks: the evaluator and verifier hooks bound to this
 *     environment. Hooks are declared by neutral id, phase and the
 *     SchemaRef of their invocation payload — at least one evaluator and
 *     one verifier must be declared (evaluation and verification are
 *     first-class Arena pillars; an environment that cannot be evaluated
 *     or verified is not part of the capability lifecycle).
 */

import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import { parseSchemaRef } from '@arena/protocol-core';
import type { NeutralId, NeutralText } from './shared.js';
import {
  expectEnumMember,
  expectFields,
  isNeutralId,
  isNeutralText,
  toNeutralId,
  toNeutralText,
} from './shared.js';

// ---------------------------------------------------------------------------
// EvidenceOutputs (declare field 14)
// ---------------------------------------------------------------------------

/** Closed evidence output kinds (what a run produces as evidence). */
export const EVIDENCE_OUTPUT_KINDS = Object.freeze([
  'trajectory',
  'artifacts',
  'logs',
  'metrics',
  'observations',
  'environment-state',
] as const);
export type EvidenceOutputKind = (typeof EVIDENCE_OUTPUT_KINDS)[number];

/** How each evidence output is addressed (always digest-addressed). */
export const EVIDENCE_ADDRESSING_POLICIES = Object.freeze(['content-addressed', 'append-only-ledger'] as const);
export type EvidenceAddressing = (typeof EVIDENCE_ADDRESSING_POLICIES)[number];

export interface EvidenceOutput {
  readonly outputId: NeutralId;
  readonly kind: EvidenceOutputKind;
  readonly addressing: EvidenceAddressing;
  readonly description: NeutralText | null;
}

export interface EvidenceOutputs {
  readonly outputs: readonly EvidenceOutput[];
}

export function isEvidenceOutput(value: unknown): value is EvidenceOutput {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['outputId']) &&
    typeof candidate['kind'] === 'string' &&
    (EVIDENCE_OUTPUT_KINDS as readonly string[]).includes(candidate['kind']) &&
    typeof candidate['addressing'] === 'string' &&
    (EVIDENCE_ADDRESSING_POLICIES as readonly string[]).includes(candidate['addressing']) &&
    (candidate['description'] === null ||
      candidate['description'] === undefined ||
      isNeutralText(candidate['description']))
  );
}

export function isEvidenceOutputs(value: unknown): value is EvidenceOutputs {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate['outputs']) &&
    candidate['outputs'].length > 0 &&
    candidate['outputs'].every((entry) => isEvidenceOutput(entry))
  );
}

function toEvidenceOutput(value: unknown): EvidenceOutput {
  const record = expectFields(
    value,
    ['outputId', 'kind', 'addressing'],
    ['description'],
    ENVIRONMENT_ERROR_CODES.INVALID_EVIDENCE_OUTPUTS,
    'evidence output',
  );
  const outputId = toNeutralId(
    typeof record['outputId'] === 'string' ? record['outputId'] : '',
  );
  const kind = expectEnumMember(
    record['kind'],
    EVIDENCE_OUTPUT_KINDS,
    'kind',
    ENVIRONMENT_ERROR_CODES.INVALID_EVIDENCE_OUTPUTS,
    'evidence output',
  );
  const addressing = expectEnumMember(
    record['addressing'],
    EVIDENCE_ADDRESSING_POLICIES,
    'addressing',
    ENVIRONMENT_ERROR_CODES.INVALID_EVIDENCE_OUTPUTS,
    'evidence output',
  );
  const rawDescription = record['description'];
  if (rawDescription !== null && rawDescription !== undefined && typeof rawDescription !== 'string') {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_EVIDENCE_OUTPUTS, {
      message: 'evidence output: description must be neutral text or null',
    });
  }
  const description =
    rawDescription === null || rawDescription === undefined
      ? null
      : toNeutralText(rawDescription, 'evidenceOutput.description', ENVIRONMENT_ERROR_CODES.INVALID_EVIDENCE_OUTPUTS);
  return Object.freeze({ outputId, kind, addressing, description });
}

/** Validate and freeze the evidence outputs (non-empty, duplicate-free). */
export function toEvidenceOutputs(value: {
  outputs: readonly {
    outputId: string;
    kind: string;
    addressing: string;
    description?: string | null;
  }[];
}): EvidenceOutputs {
  const record = expectFields(
    value,
    ['outputs'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_EVIDENCE_OUTPUTS,
    'evidence outputs',
  );
  const rawOutputs = record['outputs'];
  if (!Array.isArray(rawOutputs) || rawOutputs.length === 0) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_EVIDENCE_OUTPUTS, {
      message: 'evidence outputs: at least one evidence output must be declared',
    });
  }
  const outputs = Object.freeze(rawOutputs.map((entry) => toEvidenceOutput(entry)));
  const seen = new Set<string>();
  for (const output of outputs) {
    if (seen.has(output.outputId)) {
      throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_EVIDENCE_OUTPUTS, {
        message: `evidence outputs: duplicate output id '${output.outputId}'`,
        details: { outputId: output.outputId },
      });
    }
    seen.add(output.outputId);
  }
  return Object.freeze({ outputs });
}

// ---------------------------------------------------------------------------
// EvaluationHooks (declare field 15 — evaluator/verifier hooks)
// ---------------------------------------------------------------------------

/** Closed hook phases. */
export const HOOK_PHASES = Object.freeze(['pre-run', 'post-run', 'on-evidence', 'on-completion'] as const);
export type HookPhase = (typeof HOOK_PHASES)[number];

/** Closed hook roles: evaluator and verifier hooks. */
export const HOOK_ROLES = Object.freeze(['evaluator', 'verifier'] as const);
export type HookRole = (typeof HOOK_ROLES)[number];

/**
 * A declared hook: neutral id, invocation phase, and the SchemaRef of the
 * payload contract used when the hook is invoked (hooks are addressed by
 * contract, never by implementation binding).
 */
export interface HookDeclaration {
  readonly hookId: NeutralId;
  readonly role: HookRole;
  readonly phase: HookPhase;
  readonly invocationSchema: string;
  readonly description: NeutralText | null;
}

export interface EvaluationHooks {
  readonly evaluators: readonly HookDeclaration[];
  readonly verifiers: readonly HookDeclaration[];
}

export function isHookDeclaration(value: unknown): value is HookDeclaration {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !isNeutralId(candidate['hookId']) ||
    typeof candidate['invocationSchema'] !== 'string'
  ) {
    return false;
  }
  if (
    typeof candidate['role'] !== 'string' ||
    !(HOOK_ROLES as readonly string[]).includes(candidate['role'])
  ) {
    return false;
  }
  if (
    typeof candidate['phase'] !== 'string' ||
    !(HOOK_PHASES as readonly string[]).includes(candidate['phase'])
  ) {
    return false;
  }
  return (
    candidate['description'] === null ||
    candidate['description'] === undefined ||
    isNeutralText(candidate['description'])
  );
}

export function isEvaluationHooks(value: unknown): value is EvaluationHooks {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate['evaluators']) ||
    candidate['evaluators'].length === 0 ||
    !candidate['evaluators'].every((entry) => isHookDeclaration(entry))
  ) {
    return false;
  }
  if (
    !Array.isArray(candidate['verifiers']) ||
    candidate['verifiers'].length === 0 ||
    !candidate['verifiers'].every((entry) => isHookDeclaration(entry))
  ) {
    return false;
  }
  return true;
}

function toHookDeclaration(value: unknown): HookDeclaration {
  const record = expectFields(
    value,
    ['hookId', 'role', 'phase', 'invocationSchema'],
    ['description'],
    ENVIRONMENT_ERROR_CODES.INVALID_EVALUATION_HOOKS,
    'hook declaration',
  );
  const hookId = toNeutralId(typeof record['hookId'] === 'string' ? record['hookId'] : '');
  const role = expectEnumMember(
    record['role'],
    HOOK_ROLES,
    'role',
    ENVIRONMENT_ERROR_CODES.INVALID_EVALUATION_HOOKS,
    'hook declaration',
  );
  const phase = expectEnumMember(
    record['phase'],
    HOOK_PHASES,
    'phase',
    ENVIRONMENT_ERROR_CODES.INVALID_EVALUATION_HOOKS,
    'hook declaration',
  );
  const invocationSchema =
    typeof record['invocationSchema'] === 'string' ? record['invocationSchema'] : '';
  // Reuse the core SchemaRef parser — the invocation contract is a
  // versioned Arena schema address, never an implementation URL.
  try {
    parseSchemaRef(invocationSchema);
  } catch (cause) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_EVALUATION_HOOKS, {
      message: `hook declaration: invocationSchema must be a valid versioned schema ref, got: ${invocationSchema}`,
      cause,
    });
  }
  const rawDescription = record['description'];
  if (rawDescription !== null && rawDescription !== undefined && typeof rawDescription !== 'string') {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_EVALUATION_HOOKS, {
      message: 'hook declaration: description must be neutral text or null',
    });
  }
  const description =
    rawDescription === null || rawDescription === undefined
      ? null
      : toNeutralText(rawDescription, 'hookDeclaration.description', ENVIRONMENT_ERROR_CODES.INVALID_EVALUATION_HOOKS);
  return Object.freeze({ hookId, role, phase, invocationSchema, description });
}

/** Validate and freeze the evaluator/verifier hooks (both non-empty). */
export function toEvaluationHooks(value: {
  evaluators: readonly {
    hookId: string;
    role: string;
    phase: string;
    invocationSchema: string;
    description?: string | null;
  }[];
  verifiers: readonly {
    hookId: string;
    role: string;
    phase: string;
    invocationSchema: string;
    description?: string | null;
  }[];
}): EvaluationHooks {
  const record = expectFields(
    value,
    ['evaluators', 'verifiers'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_EVALUATION_HOOKS,
    'evaluation hooks',
  );
  const rawEvaluators = record['evaluators'];
  if (!Array.isArray(rawEvaluators) || rawEvaluators.length === 0) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_EVALUATION_HOOKS, {
      message:
        'evaluation hooks: at least one evaluator hook must be declared (environments are evaluable by construction)',
    });
  }
  const evaluators = Object.freeze(rawEvaluators.map((entry) => toHookDeclaration(entry)));
  const rawVerifiers = record['verifiers'];
  if (!Array.isArray(rawVerifiers) || rawVerifiers.length === 0) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_EVALUATION_HOOKS, {
      message:
        'evaluation hooks: at least one verifier hook must be declared (environments are verifiable by construction)',
    });
  }
  const verifiers = Object.freeze(rawVerifiers.map((entry) => toHookDeclaration(entry)));

  const seen = new Set<string>();
  for (const hook of [...evaluators, ...verifiers]) {
    if (seen.has(hook.hookId)) {
      throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_EVALUATION_HOOKS, {
        message: `evaluation hooks: duplicate hook id '${hook.hookId}'`,
        details: { hookId: hook.hookId },
      });
    }
    seen.add(hook.hookId);
  }
  // Role coherence: the evaluators list carries evaluator-role hooks and
  // the verifiers list carries verifier-role hooks.
  for (const hook of evaluators) {
    if (hook.role !== 'evaluator') {
      throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_EVALUATION_HOOKS, {
        message: `evaluation hooks: evaluators list carries a '${hook.role}' hook (role mismatch)`,
        details: { hookId: hook.hookId, role: hook.role },
      });
    }
  }
  for (const hook of verifiers) {
    if (hook.role !== 'verifier') {
      throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_EVALUATION_HOOKS, {
        message: `evaluation hooks: verifiers list carries a '${hook.role}' hook (role mismatch)`,
        details: { hookId: hook.hookId, role: hook.role },
      });
    }
  }
  return Object.freeze({ evaluators, verifiers });
}
