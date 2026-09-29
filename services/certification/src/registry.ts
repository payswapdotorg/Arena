/**
 * CertificationRegistry — the in-process reference registry of suites
 * (Work Order A023; mirrors the A013 VerifierRegistry + A012
 * EvaluatorRegistry + A021 ForgeRegistry patterns).
 *
 * Pure TypeScript, zero external runtime dependencies (only
 * @arena/protocol-core + @arena/certification workspace packages).
 *
 * Registration discipline (the enforcement point of the quality
 * model's assessor-versioning rule):
 *   - registerSuite is IDEMPOTENT by descriptor digest — re-registering
 *     the same content-addressed descriptor returns the stored binding
 *     unchanged (the suite's identity stays as authored);
 *   - registering a DIFFERENT digest under the same (suiteId, version)
 *     identity is an IDENTITY CONFLICT — changing a suite requires a new
 *     version, never a silent redefinition (spec/quality-model.md).
 *
 * Lookups: suite by digest. Queries: list suites (all).
 */

import {
  CERTIFICATION_ERROR_CODES,
  CertificationError,
  certificationSuiteIdentityKey,
  isCertificationSuiteDescriptor,
} from '@arena/certification';
import type { CertificationSuiteDescriptor } from '@arena/certification';

/**
 * The in-process reference registry. Construct with `new CertificationRegistry()`;
 * every operation is synchronous and pure aside from the Map mutations of
 * registration itself.
 */
export class CertificationRegistry {
  private readonly byDigest = new Map<string, CertificationSuiteDescriptor>();
  private readonly byIdentity = new Map<string, string>(); // identityKey → digest

  /**
   * Register a suite by descriptor digest. Idempotent: the SAME descriptor
   * re-registers as a no-op returning the stored suite. A DIFFERENT
   * descriptor under the same (suiteId, version) identity throws
   * CERTIFICATION_IDENTITY_CONFLICT (negative test).
   */
  registerSuite(descriptor: CertificationSuiteDescriptor): CertificationSuiteDescriptor {
    if (!isCertificationSuiteDescriptor(descriptor)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUITE, {
        message: 'suite registration requires a structurally valid certification suite descriptor',
      });
    }
    const identity = certificationSuiteIdentityKey(descriptor);
    const existingDigest = this.byIdentity.get(identity);
    if (existingDigest !== undefined && existingDigest !== descriptor.digest) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `suite identity ${JSON.stringify(identity)} is already registered with a different descriptor digest (changing a suite requires a new version — spec/quality-model.md)`,
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
    this.byDigest.set(descriptor.digest, descriptor);
    this.byIdentity.set(identity, descriptor.digest);
    return descriptor;
  }

  /** Look up a suite by descriptor digest. */
  getSuite(ref: string): CertificationSuiteDescriptor | undefined {
    return this.byDigest.get(ref);
  }

  /** All registered suite descriptors (insertion order). */
  listSuites(): readonly CertificationSuiteDescriptor[] {
    return [...this.byDigest.values()];
  }
}

/** Construct a fresh registry. */
export function createCertificationRegistry(): CertificationRegistry {
  return new CertificationRegistry();
}
