/**
 * The escalation routing engine (Work Order C002; issue #76; spec/
 * expert-escalation-api.md ES1.0 "Routing"). Pure, deterministic routing
 * over the ES1.0 routing inputs:
 *
 *   qualified capabilities · demonstrated performance · current
 *   availability · historical task fit · geography/locale · required
 *   tools · conflict-of-interest rules · privacy clearance · budget ·
 *   deadline.
 *
 * Pipeline (the filter ORDER is part of the contract — unit-tested):
 *   1. tenant scope       — only the demand tenant or the reserved global
 *                           `public` scope (lock rule 11; cross-tenant
 *                           candidates are ELIMINATED, never routed);
 *   2. conflict of interest — declared tenant/client conflicts BLOCK;
 *   3. privacy clearance  — clearance must cover the demand
 *                           classification AND PII policy;
 *   4. qualification      — every required competency (from the
 *                           DemandProfile) must be qualified (A007
 *                           evidence DATA — INPUT to ranking, NEVER
 *                           an access grant);
 *   5. required tools     — every required tool ref must be supported;
 *   6. locale             — the candidate locale must cover the demand
 *                           locales (request locale first, then
 *                           preferred);
 *   7. jurisdiction       — ANY-of country-level matching (A007 rule);
 *   8. budget             — currency-equal rate at or under the cap
 *                           (fail-closed: a 0 cap authorizes nothing but
 *                           zero-rate engagements);
 *   9. availability/deadline — an availability window must intersect
 *                           [evaluatedAt, deadline].
 *
 * Survivors are ranked deterministically (historical task fit, then
 * demonstrated performance, then exact-locale match, then qualification
 * evidence depth, then expert-id lexicographic tie-break) and the verdict
 * is a TYPED machine-readable decision with a closed outcome vocabulary:
 * matched / no-match-with-causes / blocked-by-COI / blocked-by-privacy /
 * budget-infeasible / deadline-infeasible / locale-uncovered. Identical
 * inputs always produce identical digests.
 */

import { digestCanonical } from '@arena/protocol-core';
import { ESCALATION_ROUTING_ERROR_CODES, EscalationRoutingError } from './errors.js';
import type { DemandProfile } from './demand-profile.js';
import { PRIVACY_CLASSIFICATION_RANK } from './demand-profile.js';
import type { RoutingCandidate } from './candidate.js';

/** Wire version of the routing verdict shape. */
export const ROUTING_VERDICT_VERSION = 1 as const;

/**
 * The CLOSED elimination vocabulary (no silent best-effort — every
 * eliminated candidate carries exactly one reason).
 */
export const ELIMINATION_REASONS = Object.freeze([
  'cross-tenant',
  'blocked-by-coi',
  'blocked-by-privacy',
  'qualification-missing',
  'tools-unsupported',
  'locale-uncovered',
  'jurisdiction-uncovered',
  'budget-infeasible',
  'deadline-infeasible',
  'unavailable',
] as const);
export type EliminationReason = (typeof ELIMINATION_REASONS)[number];

/** The closed no-route outcome vocabulary (machine-readable decisions). */
export const ROUTING_OUTCOMES = Object.freeze([
  'matched',
  'no-match',
  'blocked-by-coi',
  'blocked-by-privacy',
  'budget-infeasible',
  'deadline-infeasible',
  'locale-uncovered',
] as const);
export type RoutingOutcome = (typeof ROUTING_OUTCOMES)[number];

/** Why one candidate did not survive the pipeline. */
export interface EliminationCause {
  readonly expertId: string;
  readonly reason: EliminationReason;
}

/** The deterministic ranking score of one survivor (typed data, not a quality aggregate). */
export interface RoutingScore {
  /** Prior engagements in the demand's domain (historical task fit). */
  readonly taskFit: number;
  /** completed / total reliability counters (demonstrated performance). */
  readonly completionRatio: number;
  /** 1 iff the candidate locale IS the request locale (geography/locale). */
  readonly localeMatch: number;
  /** Distinct qualification evidence digests (qualified capabilities). */
  readonly evidenceDepth: number;
}

/** One ranked survivor of the filter pipeline. */
export interface RankedSurvivor {
  readonly expertId: string;
  readonly rank: number;
  readonly score: RoutingScore;
}

/** The digest-free view — exactly what the verdict digest commits to. */
export interface RoutingVerdictView {
  readonly verdictVersion: typeof ROUTING_VERDICT_VERSION;
  readonly requestId: string;
  readonly tenantId: string;
  readonly profileDigest: string;
  readonly evaluatedAt: string;
  readonly outcome: RoutingOutcome;
  /** EVERY eliminated candidate + its closed reason — the machine-readable
   *  negative space, present on matched verdicts too. */
  readonly causes: readonly EliminationCause[];
  readonly expertRef?: string;
  readonly shortlist?: readonly RankedSurvivor[];
}

/** A frozen, content-addressed routing verdict: view + digest. */
export interface RoutingVerdict extends RoutingVerdictView {
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Availability arithmetic (pure; no clock reads — evaluatedAt is injected)
// ---------------------------------------------------------------------------

const MINUTES_PER_DAY = 24 * 60;
const MAX_SCAN_DAYS = 400;

function parseTimeOfDay(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number.parseInt(hours, 10) * 60 + Number.parseInt(minutes, 10);
}

function isoDayOfWeek(ms: number): number {
  const jsDay = new Date(ms).getUTCDay(); // 0=Sunday … 6=Saturday
  return ((jsDay + 6) % 7) + 1; // ISO 1=Monday … 7=Sunday
}

function dayStart(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * True iff the availability window intersects the demand interval
 * [fromMs, untilMs]. Deterministic day scan, bounded at MAX_SCAN_DAYS
 * (intervals longer than the horizon are scanned over the first
 * MAX_SCAN_DAYS days — documented, deterministic).
 */
function windowCovers(
  window: {
    readonly recurrence: string;
    readonly dayOfWeek?: number;
    readonly startUtc: string;
    readonly endUtc: string;
    readonly date?: string;
  },
  fromMs: number,
  untilMs: number,
): boolean {
  if (untilMs <= fromMs) return false;
  const startMinutes = parseTimeOfDay(window.startUtc);
  const endMinutes = parseTimeOfDay(window.endUtc);
  const scanDays = Math.min(
    Math.ceil((untilMs - dayStart(fromMs)) / (MINUTES_PER_DAY * 60000)) + 1,
    MAX_SCAN_DAYS,
  );
  for (let dayOffset = 0; dayOffset < scanDays; dayOffset += 1) {
    const dayMs = dayStart(fromMs) + dayOffset * MINUTES_PER_DAY * 60000;
    if (window.recurrence === 'weekly') {
      if (window.dayOfWeek !== undefined && isoDayOfWeek(dayMs) !== window.dayOfWeek) continue;
    } else if (window.recurrence === 'one-time') {
      if (window.date === undefined) continue;
      const dateMs = Date.parse(`${window.date}T00:00:00.000Z`);
      if (dayMs !== dateMs) continue;
    }
    const windowStart = dayMs + startMinutes * 60000;
    const windowEnd = dayMs + endMinutes * 60000;
    if (Math.max(windowStart, fromMs) < Math.min(windowEnd, untilMs)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

function logicalKey(ref: { readonly kind: string; readonly id: string }): string {
  return `${ref.kind}/${ref.id}`;
}

/** The first failing filter reason for one candidate — the pipeline order IS the contract. */
function eliminate(
  profile: DemandProfile,
  candidate: RoutingCandidate,
  evaluatedAtMs: number,
): EliminationReason | null {
  // 1. tenant scope (lock rule 11 — cross-tenant is ELIMINATED, never routed).
  if (candidate.tenant !== profile.tenantId && candidate.tenant !== 'public') {
    return 'cross-tenant';
  }
  // 2. conflict of interest.
  if (
    candidate.coi.blockedTenantIds.includes(profile.tenantId) ||
    candidate.coi.blockedClientAppIds.includes(profile.clientAppId)
  ) {
    return 'blocked-by-coi';
  }
  // 3. privacy clearance.
  const clearanceRank = PRIVACY_CLASSIFICATION_RANK[candidate.privacyClearance.maxDataClassification] ?? 0;
  const demandRank = PRIVACY_CLASSIFICATION_RANK[profile.privacyPolicy.dataClassification] ?? 0;
  if (clearanceRank < demandRank) return 'blocked-by-privacy';
  // A PII-permitting demand (pii=allow) requires an expert cleared to
  // operate with PII visible; forbid/redact demands expose no PII and
  // impose no extra expert requirement.
  if (profile.privacyPolicy.pii === 'allow' && candidate.privacyClearance.piiHandling !== 'allow') {
    return 'blocked-by-privacy';
  }
  // 4. qualification (DATA — input to ranking, never an access grant).
  const qualifiedKeys = new Set(
    candidate.qualifiedCapabilities.map((entry) => logicalKey(entry.capability)),
  );
  for (const ref of profile.requiredCompetencyRefs) {
    if (!qualifiedKeys.has(logicalKey(ref))) return 'qualification-missing';
  }
  // 5. required tools.
  const toolKeys = new Set(candidate.supportedToolRefs.map((ref) => logicalKey(ref)));
  for (const ref of profile.requiredToolRefs) {
    if (!toolKeys.has(logicalKey(ref))) return 'tools-unsupported';
  }
  // 6. locale.
  if (!profile.locales.includes(candidate.locale)) return 'locale-uncovered';
  // 7. jurisdiction (ANY-of, country-level; a region-less expert covers a
  //    region-ful demand at country level — the A007 rule).
  if (profile.jurisdictions.length > 0) {
    const covered = profile.jurisdictions.some((demand) =>
      candidate.jurisdictions.some((offered) => offered.country === demand.country),
    );
    if (!covered) return 'jurisdiction-uncovered';
  }
  // 8. budget (fail-closed: currency must equal; 0 cap ⇒ only 0-rate).
  if (
    candidate.rateCard.currency !== profile.budget.currency ||
    candidate.rateCard.engagementRateMinorUnits > profile.budget.amountMinorUnits
  ) {
    return 'budget-infeasible';
  }
  // 9. availability / deadline.
  if (candidate.availability.length === 0) return 'unavailable';
  const covered = candidate.availability.some((window) =>
    windowCovers(window, evaluatedAtMs, profile.deadlineMs),
  );
  if (!covered) return 'deadline-infeasible';
  return null;
}

function scoreOf(profile: DemandProfile, candidate: RoutingCandidate): RoutingScore {
  const domainKey = profile.domainRef !== undefined ? logicalKey(profile.domainRef) : null;
  const taskFit =
    domainKey === null
      ? 0
      : candidate.historicalTaskDomainRefs.filter((ref) => logicalKey(ref) === domainKey).length;
  const total =
    candidate.reliability.completed + candidate.reliability.failed + candidate.reliability.noResponse;
  const completionRatio = total === 0 ? 0 : candidate.reliability.completed / total;
  const requestLocale = profile.locales[0] ?? '';
  const localeMatch = candidate.locale === requestLocale ? 1 : 0;
  const evidence = new Set(
    candidate.qualifiedCapabilities.flatMap((entry) => [...entry.evidenceDigests]),
  );
  return Object.freeze({
    taskFit,
    completionRatio,
    localeMatch,
    evidenceDepth: evidence.size,
  });
}

function compareSurvivors(
  a: { readonly expertId: string; readonly score: RoutingScore },
  b: { readonly expertId: string; readonly score: RoutingScore },
): number {
  if (a.score.taskFit !== b.score.taskFit) return b.score.taskFit - a.score.taskFit;
  if (a.score.completionRatio !== b.score.completionRatio) {
    return b.score.completionRatio - a.score.completionRatio;
  }
  if (a.score.localeMatch !== b.score.localeMatch) return b.score.localeMatch - a.score.localeMatch;
  if (a.score.evidenceDepth !== b.score.evidenceDepth) return b.score.evidenceDepth - a.score.evidenceDepth;
  if (a.expertId !== b.expertId) return a.expertId < b.expertId ? -1 : 1;
  return 0;
}

/** Classify the no-survivor outcome from the closed cause set. */
function classifyNoSurvivor(causes: readonly EliminationCause[]): RoutingOutcome {
  const reasons = new Set(causes.map((cause) => cause.reason));
  if (reasons.size === 0) return 'no-match';
  if (reasons.size === 1 && reasons.has('blocked-by-coi')) return 'blocked-by-coi';
  if (reasons.size === 1 && reasons.has('blocked-by-privacy')) return 'blocked-by-privacy';
  if (reasons.size === 1 && reasons.has('budget-infeasible')) return 'budget-infeasible';
  if (reasons.size === 1 && reasons.has('locale-uncovered')) return 'locale-uncovered';
  if (reasons.size <= 2 && reasons.has('deadline-infeasible') && (reasons.has('unavailable') || reasons.size === 1)) {
    return 'deadline-infeasible';
  }
  return 'no-match';
}

/**
 * Route one compiled demand profile over the candidate set. Deterministic:
 * identical inputs ⇒ identical verdict digests, independent of candidate
 * input order. Never throws for routing semantics — failures are typed
 * outcomes; only structurally invalid inputs throw.
 */
export async function routeEscalation(
  profile: DemandProfile,
  candidates: readonly RoutingCandidate[],
  options: { readonly requestId: string; readonly evaluatedAt: string },
): Promise<RoutingVerdict> {
  if (!Array.isArray(candidates)) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'candidates must be an array',
    });
  }
  const evaluatedAtMs = Date.parse(options.evaluatedAt);
  if (!Number.isFinite(evaluatedAtMs)) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_DEMAND_INPUT, {
      message: `evaluatedAt must be a parseable timestamp: ${JSON.stringify(options.evaluatedAt)}`,
    });
  }

  const causes: EliminationCause[] = [];
  const survivors: { expertId: string; score: RoutingScore }[] = [];
  for (const candidate of candidates) {
    const reason = eliminate(profile, candidate, evaluatedAtMs);
    if (reason !== null) {
      causes.push(Object.freeze({ expertId: candidate.expertId, reason }));
      continue;
    }
    survivors.push({ expertId: candidate.expertId, score: scoreOf(profile, candidate) });
  }
  causes.sort((a, b) => (a.expertId < b.expertId ? -1 : a.expertId > b.expertId ? 1 : 0));
  survivors.sort(compareSurvivors);

  let view: RoutingVerdictView;
  if (survivors.length > 0) {
    const shortlist: RankedSurvivor[] = survivors.map((survivor, index) =>
      Object.freeze({ expertId: survivor.expertId, rank: index + 1, score: survivor.score }),
    );
    const top = shortlist[0];
    if (top === undefined) {
      throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_VERDICT, {
        message: 'a non-empty survivor set must have a ranked head',
      });
    }
    view = {
      verdictVersion: ROUTING_VERDICT_VERSION,
      requestId: options.requestId,
      tenantId: profile.tenantId,
      profileDigest: profile.digest,
      evaluatedAt: options.evaluatedAt,
      outcome: 'matched',
      causes: Object.freeze([...causes]),
      expertRef: top.expertId,
      shortlist: Object.freeze(shortlist),
    };
  } else {
    view = {
      verdictVersion: ROUTING_VERDICT_VERSION,
      requestId: options.requestId,
      tenantId: profile.tenantId,
      profileDigest: profile.digest,
      evaluatedAt: options.evaluatedAt,
      outcome: classifyNoSurvivor(causes),
      causes: Object.freeze([...causes]),
    };
  }

  const digest = await digestCanonical(view);
  return Object.freeze({ ...view, digest }) as RoutingVerdict;
}

/** Every elimination cause of a verdict (the machine-readable negative space). */
export function routingVerdictCauses(verdict: RoutingVerdict): readonly EliminationCause[] {
  return Object.freeze([...(verdict.causes ?? [])]);
}

/** Structural (non-throwing) guard for a routing verdict. */
export function isRoutingVerdict(value: unknown): value is RoutingVerdict {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['verdictVersion'] === ROUTING_VERDICT_VERSION &&
    typeof candidate['requestId'] === 'string' &&
    typeof candidate['tenantId'] === 'string' &&
    typeof candidate['profileDigest'] === 'string' &&
    typeof candidate['evaluatedAt'] === 'string' &&
    (ROUTING_OUTCOMES as readonly string[]).includes(String(candidate['outcome'])) &&
    typeof candidate['digest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['digest'])
  );
}

/** The digest-free view of a verdict (what the digest commits to). */
export function routingVerdictView(verdict: RoutingVerdict): RoutingVerdictView {
  const { digest: _digest, ...view } = verdict;
  return view;
}

/**
 * Recompute the verdict digest over the digest-free view and compare.
 * Throws ESCALATION_ROUTING_TAMPERED on any mismatch.
 */
export async function recomputeRoutingVerdictDigest(
  verdict: RoutingVerdict,
  expectedDigest?: string,
): Promise<string> {
  if (!isRoutingVerdict(verdict)) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_VERDICT, {
      message: 'verdict digest recomputation requires a structurally valid routing verdict',
    });
  }
  const actual = await digestCanonical(routingVerdictView(verdict));
  if (actual !== verdict.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.TAMPERED, {
      message: `routing verdict digest mismatch: expected ${expectedDigest ?? verdict.digest}, got ${actual}`,
      details: {
        requestId: verdict.requestId,
        outcome: verdict.outcome,
        expected: expectedDigest ?? verdict.digest,
        actual,
      },
    });
  }
  return actual;
}
