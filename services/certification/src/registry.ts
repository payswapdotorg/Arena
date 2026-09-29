/**
 * CertificationSuiteRegistry — the in-process reference registry of
 * certification suites (Work Order A023; mirrors the A013
 * VerifierRegistry).
 *
 * Registration discipline (the enforcement point of the quality
 * model's assessor-versioning rule):
 *   - registerSuite is IDEMPOTENT by suite digest — re-registering the
 *     same content-addressed suite returns the stored suite unchanged;
 *   - registering a DIFFERENT digest under the same (suiteId, version)
 *     identity is an IDENTITY CONFLICT — changing a suite requires a
 *     new version, never a silent redefinition (spec/quality-model.md).
 *
 * Lookups: suite by digest. Queries: list suites (all / by identity).
 */

import {
  CERTIFICATION_ERROR_CODES,
  CertificationError,
  certificationSuiteIdentityKey,
} from '@arena/certification';
import type { CertificationSuite } from '@arena/certification';
import { isCertificationSuite } from '@arena/certification';

/**
 * The in-process reference registry. Construct with
 * `new CertificationSuiteRegistry()`; every operation is synchronous
 * and pure aside from the Map mutations of registration itself.
 */
export class CertificationSuiteRegistry {
  private readonly byDigest = new Map<string, CertificationSuite>();
  private readonly byIdentity = new Map<string, string>(); // identityKey → digest

  /**
   * Register a certification suite. Idempotent: the SAME suite
   * re-registers as a no-op returning the stored suite. A DIFFERENT
   * suite under the same (suiteId, version) identity throws
   * CERTIFICATION_IDENTITY_CONFLICT (negative test).
   */
  registerSuite(suite: CertificationSuite): CertificationSuite {
    if (!isCertificationSuite(suite)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUITE, {
        message: 'suite registration requires a structurally valid certification suite',
      });
    }
    const identity = certificationSuiteIdentityKey(suite);
    const existingDigest = this.byIdentity.get(identity);
    if (existingDigest !== undefined && existingDigest !== suite.digest) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `suite identity ${JSON.stringify(identity)} is already registered with a different digest (changing a suite requires a new version — spec/quality-model.md)`,
        details: {
          identity,
          registeredDigest: existingDigest,
          attemptedDigest: suite.digest,
        },
      });
    }
    const existing = this.byDigest.get(suite.digest);
    if (existing !== undefined) {
      return existing; // idempotent re-registration — same content, no new state
    }
    this.byDigest.set(suite.digest, suite);
    this.byIdentity.set(identity, suite.digest);
    return suite;
  }

  /** Look up a suite by its digest (the "revision X" address). */
  getSuite(ref: string): CertificationSuite | undefined {
    return this.byDigest.get(ref);
  }

  /** All registered suites (insertion order). */
  listSuites(): readonly CertificationSuite[] {
    return [...this.byDigest.values()];
  }

  /** Registered suites of one suiteId (any version, insertion order). */
  listSuitesByIdentity(suiteId: string): readonly CertificationSuite[] {
    return this.listSuites().filter((suite) => suite.suiteId === suiteId);
  }
}

/** Construct a fresh, empty suite registry. */
export function createCertificationSuiteRegistry(): CertificationSuiteRegistry {
  return new CertificationSuiteRegistry();
}
