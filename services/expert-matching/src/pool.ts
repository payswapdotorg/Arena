/**
 * QualifiedExpertPool — the in-process reference registry of expert cards,
 * evidence records, claims, qualification policies and qualification
 * records (Work Order A007; requirement R8; mirrors the A012/A013
 * reference registries).
 *
 * Pure TypeScript, zero external runtime dependencies (only
 * @arena/expert-qualification + @arena/protocol-core workspace packages —
 * the REAL qualification protocol guards and constructors anchor every
 * registration, exactly like the A013 fabric anchors its inputs to the
 * REAL MaterialArtifact guards).
 *
 * Registration discipline:
 *   - every register* API is IDEMPOTENT by content digest — re-registering
 *     the same content-addressed object is a no-op returning the stored
 *     value;
 *   - registering a DIFFERENT digest under the same identity key
 *     ((expertId, tenant) for cards, policyId@version for policies,
 *     claim-identity + claim digest lineage for claims) is an
 *     IDENTITY/SUPERSESSION CONFLICT — changing an object requires a new
 *     version or a superseding append, never a silent redefinition;
 *   - a claim REQUIRES a registered expert card of the same
 *     (expertId, tenant) — scope metadata is always well-defined
 *     (fail closed);
 *   - a qualification record REQUIRES its claim and policy to be
 *     registered, and its supersedes chain must reference a registered
 *     record of the SAME claim;
 *   - evidence, claims and records are APPEND-ONLY: no update/delete APIs
 *     exist; everything stays addressable by digest forever.
 *
 * The pool stores no scores and no standings — only protocol objects with
 * their per-requirement evidence (spec/quality-model.md).
 */

import {
  EXPERT_QUALIFICATION_ERROR_CODES,
  ExpertQualificationError,
  competencyClaimIdentityKey,
  isCompetencyClaim,
  isQualificationEvidence,
  qualificationPolicyIdentityKey,
  qualifiedExpertCardIdentityKey,
  replayQualificationRecord,
} from '@arena/expert-qualification';
import type {
  CompetencyClaim,
  QualificationEvidence,
  QualificationPolicy,
  QualificationRecord,
  QualifiedExpertCard,
} from '@arena/expert-qualification';

/** One registered claim plus its supersession state. */
export interface RegisteredClaim {
  readonly claim: CompetencyClaim;
  /** Digests of claims (same identity key) that supersede this one. */
  readonly supersededBy: ReadonlySet<string>;
}

/**
 * The in-process reference pool. Construct with `new QualifiedExpertPool()`;
 * every operation is synchronous and pure aside from the Map mutations of
 * registration itself.
 */
export class QualifiedExpertPool {
  /** Cards by digest; identity key → digest. */
  private readonly cardsByDigest = new Map<string, QualifiedExpertCard>();
  private readonly cardIdentities = new Map<string, string>();
  /** Evidence records by digest (append-only). */
  private readonly evidenceByDigest = new Map<string, QualificationEvidence>();
  /** Claims by digest; identity key → claim digests (supersession chains). */
  private readonly claimsByDigest = new Map<string, CompetencyClaim>();
  private readonly claimsByIdentity = new Map<string, Set<string>>();
  private readonly claimSupersededBy = new Map<string, Set<string>>();
  /** Policies by digest; identity key → digest. */
  private readonly policiesByDigest = new Map<string, QualificationPolicy>();
  private readonly policyIdentities = new Map<string, string>();
  /** Records by digest; claim digest → record digests (insertion order). */
  private readonly recordsByDigest = new Map<string, QualificationRecord>();
  private readonly recordsByClaim = new Map<string, string[]>();

  // -------------------------------------------------------------------------
  // Cards
  // -------------------------------------------------------------------------

  /** Register an expert card (idempotent by digest; identity conflicts fail). */
  registerExpertCard(card: QualifiedExpertCard): QualifiedExpertCard {
    const identity = qualifiedExpertCardIdentityKey(card);
    const existingDigest = this.cardIdentities.get(identity);
    if (existingDigest !== undefined && existingDigest !== card.digest) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `expert identity ${JSON.stringify(identity)} is already registered with a different card digest (changing a card requires a new card version)`,
        details: { identity, registeredDigest: existingDigest, attemptedDigest: card.digest },
      });
    }
    const existing = this.cardsByDigest.get(card.digest);
    if (existing !== undefined) return existing;
    this.cardsByDigest.set(card.digest, card);
    this.cardIdentities.set(identity, card.digest);
    return card;
  }

  /** Look up a card by (expertId, tenant). */
  getCard(expertId: string, tenant: string): QualifiedExpertCard | undefined {
    const digest = this.cardIdentities.get(`${expertId}@${tenant}`);
    return digest === undefined ? undefined : this.cardsByDigest.get(digest);
  }

  /** All registered cards (insertion order). */
  listCards(): readonly QualifiedExpertCard[] {
    return [...this.cardsByDigest.values()];
  }

  // -------------------------------------------------------------------------
  // Evidence (append-only)
  // -------------------------------------------------------------------------

  /** Register an evidence record (idempotent by digest; append-only). */
  registerEvidence(evidence: QualificationEvidence): QualificationEvidence {
    if (!isQualificationEvidence(evidence)) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
        message: 'evidence registration requires a structurally valid qualification evidence record',
      });
    }
    const existing = this.evidenceByDigest.get(evidence.digest);
    if (existing !== undefined) return existing;
    this.evidenceByDigest.set(evidence.digest, evidence);
    return evidence;
  }

  /** Look up an evidence record by digest. */
  getEvidence(digest: string): QualificationEvidence | undefined {
    return this.evidenceByDigest.get(digest);
  }

  /** All registered evidence records (insertion order). */
  listEvidence(): readonly QualificationEvidence[] {
    return [...this.evidenceByDigest.values()];
  }

  // -------------------------------------------------------------------------
  // Policies
  // -------------------------------------------------------------------------

  /** Register a qualification policy (idempotent; version discipline). */
  registerQualificationPolicy(policy: QualificationPolicy): QualificationPolicy {
    if (
      typeof policy !== 'object' ||
      policy === null ||
      !('policyId' in policy) ||
      !('version' in policy) ||
      !('digest' in policy)
    ) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_POLICY, {
        message: 'policy registration requires a structurally valid qualification policy',
      });
    }
    const identity = qualificationPolicyIdentityKey(policy);
    const existingDigest = this.policyIdentities.get(identity);
    if (existingDigest !== undefined && existingDigest !== policy.digest) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.VERSION_CONFLICT, {
        message: `policy identity ${JSON.stringify(identity)} is already registered with a different digest (changing a policy requires a new version — spec/quality-model.md)`,
        details: { identity, registeredDigest: existingDigest, attemptedDigest: policy.digest },
      });
    }
    const existing = this.policiesByDigest.get(policy.digest);
    if (existing !== undefined) return existing;
    this.policiesByDigest.set(policy.digest, policy);
    this.policyIdentities.set(identity, policy.digest);
    return policy;
  }

  /** Look up a qualification policy by digest. */
  getQualificationPolicy(digest: string): QualificationPolicy | undefined {
    return this.policiesByDigest.get(digest);
  }

  /** All registered qualification policies (insertion order). */
  listQualificationPolicies(): readonly QualificationPolicy[] {
    return [...this.policiesByDigest.values()];
  }

  // -------------------------------------------------------------------------
  // Claims
  // -------------------------------------------------------------------------

  /**
   * Register a competency claim (idempotent by digest). The claim's
   * (expertId, tenant) MUST have a registered card — scope metadata is
   * always well-defined (fail closed). Supersession: registering a claim
   * that supersedes a REGISTERED claim of the same identity links the
   * chain; superseding an UNREGISTERED or different-identity claim is a
   * SUPERSESSION_CONFLICT (fail loudly — lineage is auditable or absent).
   */
  registerClaim(claim: CompetencyClaim): RegisteredClaim {
    if (!isCompetencyClaim(claim)) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_CLAIM, {
        message: 'claim registration requires a structurally valid competency claim',
      });
    }
    const card = this.getCard(claim.expertId, claim.tenant);
    if (card === undefined) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.NOT_FOUND, {
        message: `no expert card registered for ${claim.expertId}@${claim.tenant} (claims require scope metadata — register the card first)`,
        details: { expertId: claim.expertId, tenant: claim.tenant },
      });
    }
    const existing = this.claimsByDigest.get(claim.digest);
    if (existing !== undefined) {
      return { claim: existing, supersededBy: this.claimSupersededBy.get(claim.digest) ?? new Set() };
    }
    if (claim.supersedes !== undefined) {
      const superseded = this.claimsByDigest.get(claim.supersedes);
      if (superseded === undefined) {
        throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.SUPERSESSION_CONFLICT, {
          message: `claim supersedes an unregistered claim digest ${claim.supersedes} (lineage is auditable or absent — register the superseded claim first)`,
          details: { supersedes: claim.supersedes },
        });
      }
      if (competencyClaimIdentityKey(superseded) !== competencyClaimIdentityKey(claim)) {
        throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.SUPERSESSION_CONFLICT, {
          message: `claim supersedes a claim of a DIFFERENT identity (${competencyClaimIdentityKey(superseded)})`,
          details: {
            supersedes: claim.supersedes,
            supersededIdentity: competencyClaimIdentityKey(superseded),
            claimIdentity: competencyClaimIdentityKey(claim),
          },
        });
      }
      const chain = this.claimSupersededBy.get(claim.supersedes) ?? new Set<string>();
      chain.add(claim.digest);
      this.claimSupersededBy.set(claim.supersedes, chain);
    }
    this.claimsByDigest.set(claim.digest, claim);
    const identity = competencyClaimIdentityKey(claim);
    const chain = this.claimsByIdentity.get(identity) ?? new Set<string>();
    chain.add(claim.digest);
    this.claimsByIdentity.set(identity, chain);
    return { claim, supersededBy: new Set() };
  }

  /** Look up a claim by digest. */
  getClaim(digest: string): CompetencyClaim | undefined {
    return this.claimsByDigest.get(digest);
  }

  /** All registered claims (insertion order). */
  listClaims(): readonly CompetencyClaim[] {
    return [...this.claimsByDigest.values()];
  }

  /**
   * The ACTIVE (not superseded) claims of one identity key, sorted by
   * (declaredAt asc, digest asc) — the deterministic supersession
   * resolution the matcher consumes. Superseded claims remain registered
   * for audit but never match.
   */
  activeClaimsForIdentity(identityKey: string): readonly CompetencyClaim[] {
    const chain = this.claimsByIdentity.get(identityKey);
    if (chain === undefined) return [];
    const active = [...chain].filter(
      (digest) => (this.claimSupersededBy.get(digest)?.size ?? 0) === 0,
    );
    return active
      .map((digest) => this.claimsByDigest.get(digest))
      .filter((claim): claim is CompetencyClaim => claim !== undefined)
      .sort((a, b) => (a.declaredAt === b.declaredAt ? (a.digest < b.digest ? -1 : 1) : a.declaredAt < b.declaredAt ? -1 : 1));
  }

  // -------------------------------------------------------------------------
  // Qualification records (append-only)
  // -------------------------------------------------------------------------

  /**
   * Register a qualification record (idempotent by digest; append-only).
   * The claim and the policy MUST be registered; the record is strictly
   * replay-validated (shape + digest); a supersedes reference must point
   * at a registered record of the SAME claim.
   */
  async registerQualificationRecord(record: QualificationRecord): Promise<QualificationRecord> {
    const replayed = await replayQualificationRecord(record);
    const existing = this.recordsByDigest.get(replayed.digest);
    if (existing !== undefined) return existing;
    if (this.claimsByDigest.get(replayed.claimDigest) === undefined) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.NOT_FOUND, {
        message: `no claim registered at digest ${replayed.claimDigest} (register the claim before its records)`,
        details: { claimDigest: replayed.claimDigest },
      });
    }
    if (this.policiesByDigest.get(replayed.policyDigest) === undefined) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.NOT_FOUND, {
        message: `no qualification policy registered at digest ${replayed.policyDigest}`,
        details: { policyDigest: replayed.policyDigest },
      });
    }
    if (replayed.supersedes !== undefined) {
      const superseded = this.recordsByDigest.get(replayed.supersedes);
      if (superseded === undefined) {
        throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.SUPERSESSION_CONFLICT, {
          message: `qualification record supersedes an unregistered record digest ${replayed.supersedes}`,
          details: { supersedes: replayed.supersedes },
        });
      }
      if (superseded.claimDigest !== replayed.claimDigest) {
        throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.SUPERSESSION_CONFLICT, {
          message: `qualification record supersedes a record of a DIFFERENT claim (${superseded.claimDigest})`,
          details: { supersedes: replayed.supersedes, supersededClaim: superseded.claimDigest },
        });
      }
    }
    this.recordsByDigest.set(replayed.digest, replayed);
    const chain = this.recordsByClaim.get(replayed.claimDigest) ?? [];
    chain.push(replayed.digest);
    this.recordsByClaim.set(replayed.claimDigest, chain);
    return replayed;
  }

  /** Look up a qualification record by digest. */
  getQualificationRecord(digest: string): QualificationRecord | undefined {
    return this.recordsByDigest.get(digest);
  }

  /** All records of one claim (append/insertion order). */
  listRecordsForClaim(claimDigest: string): readonly QualificationRecord[] {
    const chain = this.recordsByClaim.get(claimDigest) ?? [];
    return chain
      .map((digest) => this.recordsByDigest.get(digest))
      .filter((record): record is QualificationRecord => record !== undefined);
  }

  /** All registered records (insertion order). */
  listQualificationRecords(): readonly QualificationRecord[] {
    return [...this.recordsByDigest.values()];
  }

  /**
   * The LATEST record of one claim — deterministic: last when sorted by
   * (evaluatedAt asc, digest asc; ties broken by the LARGER digest).
   * Matching consumes exactly this record.
   */
  latestRecordForClaim(claimDigest: string): QualificationRecord | undefined {
    const records = this.listRecordsForClaim(claimDigest);
    if (records.length === 0) return undefined;
    const sorted = [...records].sort((a, b) => {
      if (a.evaluatedAt !== b.evaluatedAt) {
        return a.evaluatedAt < b.evaluatedAt ? -1 : 1;
      }
      return a.digest < b.digest ? -1 : 1;
    });
    return sorted[sorted.length - 1];
  }
}
