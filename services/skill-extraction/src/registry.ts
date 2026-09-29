/**
 * ExtractionPolicyRegistry — the in-process registry of extraction
 * policies for the reference fabric (Work Order A019; requirement R17).
 *
 * Registration is IDEMPOTENT BY DIGEST (bit-identical re-registration
 * is a no-op); a DIFFERENT digest under the same (policyId, version)
 * identity is an IDENTITY_CONFLICT — changing a policy requires a new
 * version (mirroring the A012 evaluator registry and A013 verifier
 * registry semantics: the quality model's "changing an evaluator
 * requires a new version").
 */

import {
  isExtractionPolicy,
  verifyExtractionPolicy,
  SKILL_EXTRACTION_ERROR_CODES,
  SkillExtractionError,
} from '@arena/skill-extraction';
import type { ExtractionPolicy } from '@arena/skill-extraction';

interface Registration {
  readonly policy: ExtractionPolicy;
}

/** The in-process, content-addressed policy registry. */
export class ExtractionPolicyRegistry {
  private readonly byDigest = new Map<string, Registration>();
  private readonly byIdentity = new Map<string, string>();
  private readonly byId = new Map<string, Set<string>>();
  private readonly ledger: ExtractionPolicy[] = [];

  /** Register a policy (idempotent by digest; identity conflicts rejected). */
  async registerPolicy(policy: ExtractionPolicy): Promise<ExtractionPolicy> {
    if (!isExtractionPolicy(policy)) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
        message: 'policy registration requires a structurally valid extraction policy',
      });
    }
    await verifyExtractionPolicy(policy);

    const existingDigest = this.byDigest.get(policy.digest);
    if (existingDigest !== undefined) {
      return existingDigest.policy; // idempotent re-registration
    }

    const identity = `${policy.policyId}@${policy.version}`;
    const bound = this.byIdentity.get(identity);
    if (bound !== undefined) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `policy identity ${JSON.stringify(identity)} is already bound to digest ${bound}; attempted to register digest ${policy.digest} (changing a policy requires a new version)`,
        details: { identity, bound, attempted: policy.digest },
      });
    }

    this.byDigest.set(policy.digest, { policy });
    this.byIdentity.set(identity, policy.digest);
    const ids = this.byId.get(policy.policyId as string) ?? new Set<string>();
    ids.add(policy.digest);
    this.byId.set(policy.policyId as string, ids);
    this.ledger.push(policy);
    return policy;
  }

  /** Look up a policy by its content digest. */
  getPolicy(digest: string): ExtractionPolicy | undefined {
    return this.byDigest.get(digest)?.policy;
  }

  /** All registered versions of a policy id (registration order). */
  listPoliciesById(policyId: string): readonly ExtractionPolicy[] {
    const digests = this.byId.get(policyId);
    if (digests === undefined) return [];
    return [...digests].map((digest) => this.byDigest.get(digest)?.policy).filter(
      (policy): policy is ExtractionPolicy => policy !== undefined,
    );
  }

  /** The full registry (registration order) — observability dump. */
  listPolicies(): readonly ExtractionPolicy[] {
    return [...this.ledger];
  }
}
