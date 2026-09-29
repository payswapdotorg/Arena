/**
 * Evaluator and verifier bindings (Work Order A008; spec/task-spec.md
 * TS1.0 "evaluator bindings; verifier bindings"; architecture-lock rule 7
 * — evaluation and verification are DISTINCT responsibilities, so the two
 * binding types are separate, separately-required lists and neither can
 * substitute for the other).
 *
 * A binding is a DESCRIPTOR DIGEST reference in the A012/A013 shape
 * (packages/evaluation/src/descriptor.ts EvaluatorDescriptor and
 * packages/verification/src/descriptor.ts VerifierDescriptor): the
 * descriptor's own neutral id, its semver version and the sha256 content
 * digest of the descriptor object. The descriptor SEMANTICS stay owned by
 * A012/A013 — this package references descriptors by content address and
 * never redefines them (lock rule 16: one responsibility, one authority).
 *
 * The view types here are STRUCTURALLY COMPATIBLE with the identity
 * triples of the owning packages' descriptors (plain strings accept
 * branded strings), so a compiled TaskSpec can be cross-checked against
 * the real descriptor registries without any adapter layer.
 */

import { TASK_SPEC_ERROR_CODES, TaskSpecError } from './errors.js';
import {
  CONTENT_DIGEST_PATTERN_SOURCE,
  NEUTRAL_ID_PATTERN_SOURCE,
  TASK_VERSION_PATTERN_SOURCE,
  expectFields,
  isContentDigest,
  isNeutralId,
  isTaskVersion,
} from './shared.js';

/** Stable field list for a binding (tests + contracts mirror it). */
export const DESCRIPTOR_BINDING_FIELDS = Object.freeze([
  'evaluatorId',
  'version',
  'descriptorDigest',
] as const) as readonly string[];

/** Shared structural check for the binding shape (id differs per role). */
function isDescriptorBinding(value: unknown, idField: string): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate[idField]) &&
    isTaskVersion(candidate['version']) &&
    isContentDigest(candidate['descriptorDigest'])
  );
}

function toDescriptorBinding(
  value: unknown,
  idField: 'evaluatorId' | 'verifierId',
  role: string,
): { id: string; version: string; descriptorDigest: string } {
  const record = expectFields(
    value,
    [idField, 'version', 'descriptorDigest'],
    [],
    TASK_SPEC_ERROR_CODES.INVALID_BINDING,
    `${role} binding`,
  );
  const id = record[idField];
  if (!isNeutralId(id)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_BINDING, {
      message: `${role} binding: invalid ${idField}: ${JSON.stringify(id)} (lowercase neutral identifier required)`,
      details: { pattern: NEUTRAL_ID_PATTERN_SOURCE },
    });
  }
  const version = record['version'];
  if (!isTaskVersion(version)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_BINDING, {
      message: `${role} binding: invalid descriptor version: ${JSON.stringify(version)} (semver, no build metadata)`,
      details: { pattern: TASK_VERSION_PATTERN_SOURCE },
    });
  }
  const descriptorDigest = record['descriptorDigest'];
  if (!isContentDigest(descriptorDigest)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_BINDING, {
      message: `${role} binding: malformed descriptor digest: ${JSON.stringify(descriptorDigest)} (expected the A0${role === 'evaluator' ? '12' : '13'} descriptor's sha256 content digest)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return { id, version, descriptorDigest };
}

// ---------------------------------------------------------------------------
// Evaluator bindings (A012 shape)
// ---------------------------------------------------------------------------

/**
 * An evaluator binding: the A012 EvaluatorDescriptor identity triple —
 * evaluatorId + version + the descriptor's sha256 content digest.
 */
export interface EvaluatorBinding {
  readonly evaluatorId: string;
  readonly version: string;
  readonly descriptorDigest: string;
}

export function isEvaluatorBinding(value: unknown): value is EvaluatorBinding {
  return isDescriptorBinding(value, 'evaluatorId');
}

function toEvaluatorBinding(value: unknown): EvaluatorBinding {
  const binding = toDescriptorBinding(value, 'evaluatorId', 'evaluator');
  return { evaluatorId: binding.id, version: binding.version, descriptorDigest: binding.descriptorDigest };
}

/**
 * Validate a non-empty evaluator-binding list (>= 1 — a task without an
 * evaluator binding cannot be judged; rule 7 keeps this distinct from
 * verifier bindings).
 */
export function toEvaluatorBindings(
  value: readonly { evaluatorId: string; version: string; descriptorDigest: string }[],
): readonly EvaluatorBinding[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_BINDING, {
      message:
        'a TaskSpec requires at least one evaluator binding (evaluation judges performance — lock rule 7)',
    });
  }
  return Object.freeze(value.map(toEvaluatorBinding));
}

// ---------------------------------------------------------------------------
// Verifier bindings (A013 shape)
// ---------------------------------------------------------------------------

/**
 * A verifier binding: the A013 VerifierDescriptor identity triple —
 * verifierId + version + the descriptor's sha256 content digest.
 */
export interface VerifierBinding {
  readonly verifierId: string;
  readonly version: string;
  readonly descriptorDigest: string;
}

export function isVerifierBinding(value: unknown): value is VerifierBinding {
  return isDescriptorBinding(value, 'verifierId');
}

function toVerifierBinding(value: unknown): VerifierBinding {
  const binding = toDescriptorBinding(value, 'verifierId', 'verifier');
  return { verifierId: binding.id, version: binding.version, descriptorDigest: binding.descriptorDigest };
}

/**
 * Validate a non-empty verifier-binding list (>= 1 — a task without a
 * verifier binding cannot establish evidence/proof; rule 7 keeps this
 * distinct from evaluator bindings).
 */
export function toVerifierBindings(
  value: readonly { verifierId: string; version: string; descriptorDigest: string }[],
): readonly VerifierBinding[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_BINDING, {
      message:
        'a TaskSpec requires at least one verifier binding (verification establishes evidence/proof — lock rule 7)',
    });
  }
  return Object.freeze(value.map(toVerifierBinding));
}
