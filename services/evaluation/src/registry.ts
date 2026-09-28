/**
 * EvaluatorRegistry — the in-process reference registry of evaluators
 * and criteria (Work Order A012 gate 6).
 *
 * Pure TypeScript, zero external runtime dependencies (only
 * @arena/protocol-core + @arena/evaluation workspace packages).
 *
 * Registration discipline (the enforcement point of the quality
 * model's evaluator-versioning rule):
 *   - registerEvaluator is IDEMPOTENT by descriptor digest —
 *     re-registering the same content-addressed descriptor returns the
 *     stored binding unchanged (the first hook binding wins);
 *   - registering a DIFFERENT digest under the same (evaluatorId,
 *     version) identity is an IDENTITY CONFLICT — changing an
 *     evaluator requires a new version, never a silent redefinition
 *     (spec/quality-model.md);
 *   - registerCriteria is idempotent by digest; a different digest
 *     under the same (criteriaId, version) is likewise a conflict.
 *
 * Lookups: evaluator by digest, criteria by digest. Queries: list
 * evaluators (all / by kind / by case-ref), list criteria.
 */

import { EVALUATION_ERROR_CODES, EvaluationError } from '@arena/evaluation';
import type { EvaluatorDescriptor, EvaluationCriteria } from '@arena/evaluation';
import { evaluatorIdentityKey, isEvaluatorDescriptor } from '@arena/evaluation';
import type { EvaluatorHook } from './evaluators.js';

/** One registered evaluator: descriptor + its hook binding. */
export interface RegisteredEvaluator {
  readonly descriptor: EvaluatorDescriptor;
  readonly hook: EvaluatorHook;
}

/**
 * The in-process reference registry. Construct with
 * `new EvaluatorRegistry()`; every operation is synchronous and pure
 * aside from the Map mutations of registration itself.
 */
export class EvaluatorRegistry {
  private readonly byDigest = new Map<string, RegisteredEvaluator>();
  private readonly byIdentity = new Map<string, string>(); // identityKey → digest
  private readonly criteriaByDigest = new Map<string, EvaluationCriteria>();
  private readonly criteriaByIdentity = new Map<string, string>(); // criteriaId@version → digest

  /**
   * Register an evaluator by descriptor digest. Idempotent: the SAME
   * descriptor re-registers as a no-op returning the stored binding
   * (the hook binding of the FIRST registration wins). A DIFFERENT
   * descriptor under the same (evaluatorId, version) identity throws
   * EVALUATION_IDENTITY_CONFLICT (gate 6 negative test).
   */
  registerEvaluator(descriptor: EvaluatorDescriptor, hook: EvaluatorHook): RegisteredEvaluator {
    if (!isEvaluatorDescriptor(descriptor)) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_DESCRIPTOR, {
        message: 'evaluator registration requires a structurally valid evaluator descriptor',
      });
    }
    const identity = evaluatorIdentityKey(descriptor);
    const existingDigest = this.byIdentity.get(identity);
    if (existingDigest !== undefined && existingDigest !== descriptor.digest) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `evaluator identity ${JSON.stringify(identity)} is already registered with a different descriptor digest (changing an evaluator requires a new version — spec/quality-model.md)`,
        details: {
          identity,
          registeredDigest: existingDigest,
          attemptedDigest: descriptor.digest,
        },
      });
    }
    const existing = this.byDigest.get(descriptor.digest);
    if (existing !== undefined) {
      return existing; // idempotent re-registration — same content, no new state
    }
    const registration: RegisteredEvaluator = Object.freeze({ descriptor, hook });
    this.byDigest.set(descriptor.digest, registration);
    this.byIdentity.set(identity, descriptor.digest);
    return registration;
  }

  /**
   * Register a criteria object by digest. Idempotent by digest; a
   * different digest under the same (criteriaId, version) is an
   * identity conflict.
   */
  registerCriteria(criteria: EvaluationCriteria): EvaluationCriteria {
    const identity = `${criteria.criteriaId}@${criteria.version}`;
    const existingDigest = this.criteriaByIdentity.get(identity);
    if (existingDigest !== undefined && existingDigest !== criteria.digest) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `criteria identity ${JSON.stringify(identity)} is already registered with a different digest (criteria are content-addressed; changing content requires a new version)`,
        details: {
          identity,
          registeredDigest: existingDigest,
          attemptedDigest: criteria.digest,
        },
      });
    }
    const existing = this.criteriaByDigest.get(criteria.digest);
    if (existing !== undefined) {
      return existing; // idempotent re-registration
    }
    this.criteriaByDigest.set(criteria.digest, criteria);
    this.criteriaByIdentity.set(identity, criteria.digest);
    return criteria;
  }

  /** Look up an evaluator registration by descriptor digest. */
  getEvaluator(ref: string): RegisteredEvaluator | undefined {
    return this.byDigest.get(ref);
  }

  /** Look up a criteria object by digest. */
  getCriteria(ref: string): EvaluationCriteria | undefined {
    return this.criteriaByDigest.get(ref);
  }

  /** All registered evaluator descriptors (insertion order). */
  listEvaluators(): readonly EvaluatorDescriptor[] {
    return [...this.byDigest.values()].map((registration) => registration.descriptor);
  }

  /** Registered evaluator descriptors of one EV1.0 kind. */
  listEvaluatorsByKind(kind: string): readonly EvaluatorDescriptor[] {
    return this.listEvaluators().filter((descriptor) => descriptor.kind === kind);
  }

  /**
   * Registered evaluators whose input contract pins the given case
   * digest (digest-ref binding — the evaluators eligible to judge that
   * case version).
   */
  listEvaluatorsByCase(caseRef: string): readonly EvaluatorDescriptor[] {
    return this.listEvaluators().filter((descriptor) => descriptor.inputs.caseRef === caseRef);
  }

  /** All registered criteria objects (insertion order). */
  listCriteria(): readonly EvaluationCriteria[] {
    return [...this.criteriaByDigest.values()];
  }
}
