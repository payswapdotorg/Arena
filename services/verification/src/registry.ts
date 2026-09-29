/**
 * VerifierRegistry — the in-process reference registry of verifiers
 * (Work Order A013; mirrors the A012 reference registry).
 *
 * Pure TypeScript, zero external runtime dependencies (only
 * @arena/protocol-core + @arena/verification + @arena/artifact-protocol
 * workspace packages).
 *
 * Registration discipline (the enforcement point of the quality
 * model's assessor-versioning rule):
 *   - registerVerifier is IDEMPOTENT by descriptor digest —
 *     re-registering the same content-addressed descriptor returns the
 *     stored binding unchanged (the first hook binding wins);
 *   - registering a DIFFERENT digest under the same (verifierId,
 *     version) identity is an IDENTITY CONFLICT — changing a verifier
 *     requires a new version, never a silent redefinition
 *     (spec/quality-model.md).
 *
 * Lookups: verifier by digest. Queries: list verifiers (all / by
 * method).
 */

import { VERIFICATION_ERROR_CODES, VerificationError } from '@arena/verification';
import type { VerifierDescriptor } from '@arena/verification';
import { isVerifierDescriptor, verifierIdentityKey } from '@arena/verification';
import type { VerifierHook } from './verifiers.js';

/** One registered verifier: descriptor + its hook binding. */
export interface RegisteredVerifier {
  readonly descriptor: VerifierDescriptor;
  readonly hook: VerifierHook;
}

/**
 * The in-process reference registry. Construct with
 * `new VerifierRegistry()`; every operation is synchronous and pure
 * aside from the Map mutations of registration itself.
 */
export class VerifierRegistry {
  private readonly byDigest = new Map<string, RegisteredVerifier>();
  private readonly byIdentity = new Map<string, string>(); // identityKey → digest

  /**
   * Register a verifier by descriptor digest. Idempotent: the SAME
   * descriptor re-registers as a no-op returning the stored binding
   * (the hook binding of the FIRST registration wins). A DIFFERENT
   * descriptor under the same (verifierId, version) identity throws
   * VERIFICATION_IDENTITY_CONFLICT (negative test).
   */
  registerVerifier(descriptor: VerifierDescriptor, hook: VerifierHook): RegisteredVerifier {
    if (!isVerifierDescriptor(descriptor)) {
      throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_DESCRIPTOR, {
        message: 'verifier registration requires a structurally valid verifier descriptor',
      });
    }
    const identity = verifierIdentityKey(descriptor);
    const existingDigest = this.byIdentity.get(identity);
    if (existingDigest !== undefined && existingDigest !== descriptor.digest) {
      throw new VerificationError(VERIFICATION_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `verifier identity ${JSON.stringify(identity)} is already registered with a different descriptor digest (changing a verifier requires a new version — spec/quality-model.md)`,
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
    const registration: RegisteredVerifier = Object.freeze({ descriptor, hook });
    this.byDigest.set(descriptor.digest, registration);
    this.byIdentity.set(identity, descriptor.digest);
    return registration;
  }

  /** Look up a verifier registration by descriptor digest. */
  getVerifier(ref: string): RegisteredVerifier | undefined {
    return this.byDigest.get(ref);
  }

  /** All registered verifier descriptors (insertion order). */
  listVerifiers(): readonly VerifierDescriptor[] {
    return [...this.byDigest.values()].map((registration) => registration.descriptor);
  }

  /** Registered verifier descriptors of one EV1.0 method. */
  listVerifiersByMethod(method: string): readonly VerifierDescriptor[] {
    return this.listVerifiers().filter((descriptor) => descriptor.method === method);
  }
}
