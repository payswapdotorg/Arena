/**
 * SecurityPolicyRegistry — the in-process policy bundle registry (Work
 * Order A034).
 *
 * registerBundle is idempotent by content digest: re-registering the
 * same statement set is a no-op returning the stored bundle; a
 * DIFFERENT statement set under the same (bundleId, version) identity
 * is an IDENTITY_CONFLICT — changing a policy requires a new version.
 * Bundles are validated with digest verification at registration
 * (tampered digests fail closed) and stored frozen.
 */

import { SECURITY_ERROR_CODES, SecurityError, toPolicyBundle } from '@arena/security';
import type { PolicyBundle } from '@arena/security';

export class SecurityPolicyRegistry {
  private readonly bundles = new Map<string, PolicyBundle>();
  private readonly byDigest = new Map<string, PolicyBundle>();

  /** Register (or idempotently re-register) a policy bundle. */
  async registerBundle(raw: unknown): Promise<PolicyBundle> {
    const bundle = await toPolicyBundle(raw, { verifyDigest: true });
    const identityKey = `${bundle.bundleId}@${bundle.version}`;
    const existing = this.bundles.get(identityKey);
    if (existing !== undefined) {
      if (existing.digest === bundle.digest) {
        return existing; // idempotent re-registration
      }
      throw new SecurityError(SECURITY_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `policy bundle identity conflict: ${identityKey} is already registered with a different statement set (changing a policy requires a new version)`,
        details: {
          bundleId: bundle.bundleId,
          version: bundle.version,
          registeredDigest: existing.digest,
          receivedDigest: bundle.digest,
        },
      });
    }
    const digestExisting = this.byDigest.get(bundle.digest);
    if (digestExisting !== undefined) {
      // The same statement set under a different (bundleId, version)
      // identity is allowed (registries dedup by digest) — store both
      // addresses, one canonical object.
      this.bundles.set(identityKey, digestExisting);
      return digestExisting;
    }
    this.bundles.set(identityKey, bundle);
    this.byDigest.set(bundle.digest, bundle);
    return bundle;
  }

  /** Look up a bundle by (bundleId, version). */
  byIdentity(bundleId: string, version: string): PolicyBundle {
    const bundle = this.bundles.get(`${bundleId}@${version}`);
    if (bundle === undefined) {
      throw new SecurityError(SECURITY_ERROR_CODES.NOT_FOUND, {
        message: `policy bundle not found: ${bundleId}@${version}`,
        details: { bundleId, version },
      });
    }
    return bundle;
  }

  /** Look up a bundle by content digest. */
  byDigestAddress(digest: string): PolicyBundle {
    const bundle = this.byDigest.get(digest);
    if (bundle === undefined) {
      throw new SecurityError(SECURITY_ERROR_CODES.NOT_FOUND, {
        message: `policy bundle not found by digest: ${digest}`,
        details: { digest },
      });
    }
    return bundle;
  }

  /** All registered bundles (frozen snapshot). */
  list(): readonly PolicyBundle[] {
    return Object.freeze([...this.byDigest.values()]);
  }

  /** Number of distinct statement sets registered. */
  get size(): number {
    return this.byDigest.size;
  }
}
