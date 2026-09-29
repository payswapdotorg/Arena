/**
 * ExpertMatchingEngine — the deterministic, pure reference matcher
 * (Work Order A007; requirement R8 "Match expert requirements to
 * qualified experts"; "no silent best-effort").
 *
 * `match(request, policy, pool)` is PURE given the pool state: same
 * qualified-expert set + same request ⇒ same ranked result — no hidden
 * state, no clock reads (the request's evaluatedAt is the only time), no
 * registration-order dependence (candidates are re-sorted deterministically
 * before ranking), and NO aggregate quality score or reputation input —
 * per-requirement qualification evidence only (spec/quality-model.md).
 *
 * Pipeline:
 *   1. TENANT FILTER (lock rule 11): only cards of the request's tenant or
 *      the reserved global `public` scope are even CONSIDERED —
 *      cross-tenant experts are invisible BEFORE any evaluation (a
 *      security boundary, not a match judgment; they never appear in
 *      results, not even as unmatched).
 *   2. REQUEST-LEVEL SCOPE: domain fit (kind+id on the domain node),
 *      jurisdiction fit (country-level any-of with region refinement),
 *      availability fit (window intersection). The FIRST failing scope
 *      check in the fixed order (domain, jurisdiction, availability)
 *      becomes the unmatched reason carried by EVERY requirement entry of
 *      that candidate.
 *   3. PER REQUIREMENT: resolve the expert's ACTIVE claim for the EXACT
 *      capability ref (kind:id@version#digest — content-addressed
 *      matching); check the proficiency threshold; resolve the LATEST
 *      qualification record; require it to be `qualified` AND in force at
 *      request.evaluatedAt. Every failure carries its closed-vocabulary
 *      reason.
 *   4. RANK (deterministic): fully-satisfying first; then satisfied-count
 *      descending; then distinct-evidence count descending; then
 *      tie-break by content digest (the candidate's sorted matched claim
 *      digests, lexicographically ascending, then expertId) — never
 *      registration order.
 *   5. CAP: keep at most policy.maxCandidates (truncated=true when cut);
 *      partial candidates are kept only when the policy says so.
 *   6. requirementsUnmet: the request requirement ids NO returned
 *      candidate satisfies — the explicit negative space.
 */

import {
  EXPERT_QUALIFICATION_ERROR_CODES,
  ExpertQualificationError,
  isQualificationInForce,
  isTenantVisible,
  proficiencyMeets,
} from '@arena/expert-qualification';
import type {
  MatchCandidate,
  MatchRequest,
  MatchRequirement,
  MatchResult,
  MatchingPolicy,
  PerRequirementEntry,
  QualifiedExpertCard,
  QualificationRecord,
  UnmatchedReason,
} from '@arena/expert-qualification';
import { createMatchResult } from '@arena/expert-qualification';
import type { QualifiedExpertPool } from './pool.js';

/** The cap on availability-day iterations (bounded, deterministic compute). */
const MAX_AVAILABILITY_DAYS_PROBED = 366;

// ---------------------------------------------------------------------------
// Scope-fit checks (pure)
// ---------------------------------------------------------------------------

/** Domain fit: the card's domain refs contain the requested domain node (kind+id). */
function domainFits(request: MatchRequest, card: QualifiedExpertCard): boolean {
  if (request.domainRef === undefined) return true;
  return card.domainRefs.some(
    (ref) => ref.kind === 'domain' && ref.id === request.domainRef?.id,
  );
}

/**
 * Jurisdiction fit (any-of): one of the request's jurisdictions is covered
 * by one of the expert's jurisdictions. A request jurisdiction with a
 * region matches an expert jurisdiction with the same country+region OR an
 * expert country-wide entry (no region); a country-wide request
 * jurisdiction matches any expert jurisdiction of the same country.
 */
function jurisdictionFits(request: MatchRequest, card: QualifiedExpertCard): boolean {
  if (request.jurisdictions === undefined || request.jurisdictions.length === 0) return true;
  for (const wanted of request.jurisdictions) {
    for (const declared of card.jurisdictions) {
      if (declared.country !== wanted.country) continue;
      if (wanted.region === undefined || declared.region === undefined) return true;
      if (declared.region === wanted.region) return true;
    }
  }
  return false;
}

function hhmmToMinutesOfDay(value: string): number {
  const [hours, minutes] = value.split(':');
  const h = Number.parseInt(hours ?? '0', 10);
  const m = Number.parseInt(minutes ?? '0', 10);
  return (Number.isNaN(h) ? 0 : h) * 60 + (Number.isNaN(m) ? 0 : m);
}

function dateOfIso(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function isoDayNumber(date: string): number {
  const probe = new Date(`${date}T00:00:00.000Z`);
  return probe.getUTCDay() === 0 ? 7 : probe.getUTCDay();
}

/**
 * Availability fit: at least one expert availability window overlaps the
 * request window. Windows are UTC:
 *   - one-time windows cover [date+start, date+end];
 *   - daily windows cover [D+start, D+end] for every date D in the request
 *     range (bounded by MAX_AVAILABILITY_DAYS_PROBED);
 *   - weekly windows cover the same for dates whose ISO day matches.
 */
function availabilityFits(
  request: MatchRequest,
  card: QualifiedExpertCard,
  policy: MatchingPolicy,
): boolean {
  if (request.availabilityWindow === undefined) return true;
  if (!policy.availabilityRequired) return true; // informational only
  const fromMs = Date.parse(request.availabilityWindow.from);
  const untilMs = Date.parse(request.availabilityWindow.until);
  if (Number.isNaN(fromMs) || Number.isNaN(untilMs)) return false;

  for (const window of card.availability) {
    if (window.recurrence === 'one-time') {
      if (window.date === undefined) continue;
      const startMs = Date.parse(`${window.date}T${window.startUtc}:00.000Z`);
      const endMs = Date.parse(`${window.date}T${window.endUtc}:00.000Z`);
      if (startMs < untilMs && endMs > fromMs) return true;
      continue;
    }
    // daily / weekly: probe the request's date range (bounded)
    const fromDate = dateOfIso(request.availabilityWindow.from);
    const untilDate = dateOfIso(request.availabilityWindow.until);
    const startMinutes = hhmmToMinutesOfDay(window.startUtc);
    const endMinutes = hhmmToMinutesOfDay(window.endUtc);
    const startMs = Date.parse(`${fromDate}T00:00:00.000Z`);
    let day = 0;
    while (day < MAX_AVAILABILITY_DAYS_PROBED) {
      const dayStartMs = startMs + day * 24 * 60 * 60 * 1000;
      const date = new Date(dayStartMs).toISOString().slice(0, 10);
      if (date > untilDate && dayStartMs > untilMs) break;
      if (window.recurrence === 'daily' || isoDayNumber(date) === window.dayOfWeek) {
        const windowStartMs = dayStartMs + startMinutes * 60 * 1000;
        const windowEndMs = dayStartMs + endMinutes * 60 * 1000;
        if (windowStartMs < untilMs && windowEndMs > fromMs) return true;
      }
      day += 1;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-requirement resolution (pure)
// ---------------------------------------------------------------------------

function reasonForLatestRecord(
  record: QualificationRecord,
  evaluatedAt: string,
): 'in-force' | UnmatchedReason {
  if (record.status === 'qualified') {
    return isQualificationInForce(record, evaluatedAt) ? 'in-force' : 'qualification-expired';
  }
  if (record.status === 'unqualified') return 'qualification-unqualified';
  if (record.status === 'stale') return 'qualification-stale';
  if (record.status === 'expired') return 'qualification-expired';
  return 'qualification-revoked';
}

function evaluateRequirement(
  request: MatchRequest,
  pool: QualifiedExpertPool,
  card: QualifiedExpertCard,
  requirement: MatchRequirement,
): PerRequirementEntry {
  const capabilityKey = `${requirement.capability.kind}:${requirement.capability.id}@${requirement.capability.version}#${requirement.capability.digest}`;
  const identity = `${card.expertId}@${card.tenant}::${requirement.capability.kind}:${requirement.capability.id}@${requirement.capability.version}`;
  const activeClaims = pool
    .activeClaimsForIdentity(identity)
    .filter((claim) => {
      const claimKey = `${claim.capability.kind}:${claim.capability.id}@${claim.capability.version}#${claim.capability.digest}`;
      return claimKey === capabilityKey;
    });
  if (activeClaims.length === 0) {
    return {
      requirementId: requirement.requirementId,
      satisfied: false,
      evidenceDigests: [],
      unmatchedReason: 'no-competency-claim',
    };
  }
  // Latest active claim (declaredAt asc, digest asc → last).
  const claim = [...activeClaims].sort((a, b) =>
    a.declaredAt === b.declaredAt ? (a.digest < b.digest ? -1 : 1) : a.declaredAt < b.declaredAt ? -1 : 1,
  )[activeClaims.length - 1];
  if (claim === undefined || !proficiencyMeets(claim.proficiency, requirement.minimumProficiency)) {
    return {
      requirementId: requirement.requirementId,
      satisfied: false,
      evidenceDigests: [],
      unmatchedReason: 'proficiency-below-threshold',
    };
  }
  const record = pool.latestRecordForClaim(claim.digest);
  if (record === undefined) {
    return {
      requirementId: requirement.requirementId,
      satisfied: false,
      evidenceDigests: [],
      unmatchedReason: 'qualification-missing',
    };
  }
  const reason = reasonForLatestRecord(record, request.evaluatedAt);
  if (reason !== 'in-force') {
    return {
      requirementId: requirement.requirementId,
      satisfied: false,
      evidenceDigests: [],
      unmatchedReason: reason,
    };
  }
  return {
    requirementId: requirement.requirementId,
    satisfied: true,
    matchedProficiency: claim.proficiency,
    claimDigest: claim.digest,
    recordDigest: record.digest,
    evidenceDigests: [...record.qualifyingEvidence],
  };
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * The in-process reference matcher. Pure given the pool state; async only
 * because the result digest is computed via WebCrypto.
 */
export class ExpertMatchingEngine {
  /**
   * Match one request under one policy against the pool.
   * Deterministic: identical (pool state, request, policy) ⇒ identical
   * result digest — including tie-breaks by content digest.
   */
  async match(
    request: MatchRequest,
    policy: MatchingPolicy,
    pool: QualifiedExpertPool,
  ): Promise<MatchResult> {
    if (policy.maxCandidates < 1) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_MATCHING_POLICY, {
        message: `matching policy must cap candidates at a positive integer, got ${policy.maxCandidates}`,
      });
    }

    // 1. Tenant filter (lock rule 11) — cross-tenant experts are invisible.
    const visibleCards = pool.listCards().filter((card) => isTenantVisible(card.tenant, request.tenant));

    // 2-3. Evaluate every visible card.
    const evaluated: MatchCandidate[] = [];
    for (const card of visibleCards) {
      // Request-level scope: fixed precedence domain → jurisdiction →
      // availability; the first failure applies to EVERY requirement.
      let scopeReason: UnmatchedReason | null = null;
      if (!domainFits(request, card)) scopeReason = 'domain-mismatch';
      else if (!jurisdictionFits(request, card)) scopeReason = 'jurisdiction-mismatch';
      else if (!availabilityFits(request, card, policy)) scopeReason = 'availability-conflict';

      const perRequirement: PerRequirementEntry[] = request.requirements.map((requirement) => {
        if (scopeReason !== null) {
          return {
            requirementId: requirement.requirementId,
            satisfied: false,
            evidenceDigests: [],
            unmatchedReason: scopeReason,
          };
        }
        return evaluateRequirement(request, pool, card, requirement);
      });

      const satisfiedEntries = perRequirement.filter((entry) => entry.satisfied);
      const distinctEvidence = new Set(
        satisfiedEntries.flatMap((entry) => [...entry.evidenceDigests]),
      );
      evaluated.push({
        expertId: card.expertId,
        tenant: card.tenant,
        satisfiedAll: perRequirement.every((entry) => entry.satisfied),
        satisfiedCount: satisfiedEntries.length,
        evidenceCount: distinctEvidence.size,
        perRequirement,
      });
    }

    // 4. Deterministic ranking (never registration order).
    const ranked = [...evaluated].sort((a, b) => {
      if (a.satisfiedAll !== b.satisfiedAll) return a.satisfiedAll ? -1 : 1;
      if (a.satisfiedCount !== b.satisfiedCount) return b.satisfiedCount - a.satisfiedCount;
      if (a.evidenceCount !== b.evidenceCount) return b.evidenceCount - a.evidenceCount;
      const aClaims = a.perRequirement
        .filter((entry) => entry.satisfied && entry.claimDigest !== undefined)
        .map((entry) => entry.claimDigest as string)
        .sort()
        .join('|');
      const bClaims = b.perRequirement
        .filter((entry) => entry.satisfied && entry.claimDigest !== undefined)
        .map((entry) => entry.claimDigest as string)
        .sort()
        .join('|');
      if (aClaims !== bClaims) return aClaims < bClaims ? -1 : 1;
      if (a.expertId !== b.expertId) return a.expertId < b.expertId ? -1 : 1;
      return a.tenant < b.tenant ? -1 : 1;
    });

    // 5. Keep full matches always; partial only per policy; cap last.
    const kept = ranked.filter(
      (candidate) => candidate.satisfiedAll || policy.includePartialMatches,
    );
    const truncated = kept.length > policy.maxCandidates;
    const capped = kept.slice(0, policy.maxCandidates);

    // 6. The explicit negative space: requirements no returned candidate
    // satisfies.
    const requirementsUnmet: string[] = [];
    for (const requirement of request.requirements) {
      const satisfied = capped.some((candidate) =>
        candidate.perRequirement.some(
          (entry) => entry.requirementId === requirement.requirementId && entry.satisfied,
        ),
      );
      if (!satisfied) requirementsUnmet.push(requirement.requirementId);
    }

    return createMatchResult({
      requestDigest: request.digest,
      matchingPolicyDigest: policy.digest,
      evaluatedAt: request.evaluatedAt,
      candidates: capped.map((candidate) => ({
        expertId: candidate.expertId,
        tenant: candidate.tenant,
        satisfiedAll: candidate.satisfiedAll,
        satisfiedCount: candidate.satisfiedCount,
        evidenceCount: candidate.evidenceCount,
        perRequirement: candidate.perRequirement.map((entry) =>
          entry.satisfied
            ? {
                requirementId: entry.requirementId,
                satisfied: true as const,
                ...(entry.matchedProficiency !== undefined
                  ? { matchedProficiency: entry.matchedProficiency }
                  : {}),
                ...(entry.claimDigest !== undefined ? { claimDigest: entry.claimDigest } : {}),
                ...(entry.recordDigest !== undefined ? { recordDigest: entry.recordDigest } : {}),
                evidenceDigests: [...entry.evidenceDigests],
              }
            : {
                requirementId: entry.requirementId,
                satisfied: false as const,
                evidenceDigests: [],
                ...(entry.unmatchedReason !== undefined
                  ? { unmatchedReason: entry.unmatchedReason }
                  : {}),
              },
        ),
      })),
      requirementsUnmet,
      truncated,
    });
  }
}
