/**
 * MatchRequest — a task's expert requirements (Work Order A007;
 * requirement R8 "Match expert requirements to qualified experts";
 * docs/architecture.md §8; architecture-lock rule 11 tenant scoping).
 *
 * A request declares:
 *   - `tenant` — the requesting scope: the matching fabric evaluates ONLY
 *     experts of the same tenant or the reserved global `public` scope
 *     (lock rule 11 — fail closed, never a silent cross-tenant leak);
 *   - `requirements` — competency refs with proficiency thresholds
 *     (requirement ids unique; capability refs content-addressed);
 *   - OPTIONAL `domainRef` — the capability-graph domain node the task
 *     lives in (domain fit, spec/quality-model.md);
 *   - OPTIONAL `jurisdictions` — typed jurisdictions the task needs (ANY
 *     of the listed fits — an expert jurisdiction with no region matches a
 *     request jurisdiction with a region at country level);
 *   - OPTIONAL `availabilityWindow` — the UTC window the task needs the
 *     expert to be available in;
 *   - `evaluatedAt` — the FIXED evaluation time (determinism anchor: no
 *     clock reads; qualification in-force checks and evidence freshness
 *     evaluate against THIS time).
 *
 * Content-addressed and immutable; the digest commits to the digest-free
 * view.
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_QUALIFICATION_ERROR_CODES, ExpertQualificationError } from './errors.js';
import {
  COMPETENCY_NODE_KINDS,
  deepFreeze,
  expectFields,
  isContentDigest,
  isExpertQualificationTimestamp,
  isJurisdictionView,
  isProficiencyLevel,
  isTenantScope,
  toCapabilityNodeRefView,
  toContentDigest,
  toExpertQualificationTimestamp,
  toJurisdictionView,
  toProficiencyLevel,
  toTenantScope,
} from './shared.js';
import type {
  CapabilityNodeRefView,
  ContentDigest,
  JurisdictionView,
  ProficiencyLevel,
  TenantScope,
} from './shared.js';

/** Wire version of the match-request record shape. */
export const MATCH_REQUEST_VERSION = 1 as const;

/** Stable field list for the request (tests + contracts mirror it). */
export const MATCH_REQUEST_FIELDS = Object.freeze([
  'requestVersion',
  'tenant',
  'requirements',
  'evaluatedAt',
  'domainRef',
  'jurisdictions',
  'availabilityWindow',
  'digest',
] as const) as readonly string[];

/** Stable field list for one match competency requirement. */
export const MATCH_REQUIREMENT_FIELDS = Object.freeze([
  'requirementId',
  'capability',
  'minimumProficiency',
] as const);

/** One competency requirement: the capability ref + the proficiency threshold. */
export interface MatchRequirement {
  readonly requirementId: string;
  readonly capability: CapabilityNodeRefView;
  readonly minimumProficiency: ProficiencyLevel;
}

/** The requested UTC availability window (ms-precision UTC, until > from). */
export interface AvailabilityWindow {
  readonly from: string;
  readonly until: string;
}

/** The digest-free view — exactly what the request digest commits to. */
export interface MatchRequestView {
  readonly requestVersion: typeof MATCH_REQUEST_VERSION;
  readonly tenant: TenantScope;
  readonly requirements: readonly MatchRequirement[];
  readonly evaluatedAt: string;
  readonly domainRef?: CapabilityNodeRefView;
  readonly jurisdictions?: readonly JurisdictionView[];
  readonly availabilityWindow?: AvailabilityWindow;
}

/** A frozen, content-addressed match request: view + digest. */
export interface MatchRequest extends MatchRequestView {
  readonly digest: ContentDigest;
}

export interface CreateMatchRequestInput {
  readonly tenant: string;
  readonly requirements: readonly {
    readonly requirementId: string;
    readonly capability: {
      readonly kind: string;
      readonly id: string;
      readonly version: string;
      readonly digest: string;
    };
    readonly minimumProficiency: string;
  }[];
  readonly evaluatedAt: string;
  readonly domainRef?: {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly jurisdictions?: readonly { readonly country: string; readonly region?: string }[];
  readonly availabilityWindow?: { readonly from: string; readonly until: string };
}

function toMatchRequirement(value: unknown): MatchRequirement {
  const record = expectFields(
    value,
    ['requirementId', 'capability', 'minimumProficiency'],
    [],
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_REQUEST,
    'match requirement',
  );
  const requirementId =
    typeof record['requirementId'] === 'string' ? record['requirementId'] : '';
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(requirementId)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_REQUEST, {
      message: `match requirement id must be a lowercase neutral identifier: ${JSON.stringify(requirementId)}`,
      details: { pattern: '^[a-z][a-z0-9-]{0,63}$' },
    });
  }
  return Object.freeze({
    requirementId,
    capability: toCapabilityNodeRefView(
      record['capability'] as {
        kind: string;
        id: string;
        version: string;
        digest: string;
      },
      COMPETENCY_NODE_KINDS,
    ),
    minimumProficiency: toProficiencyLevel(
      typeof record['minimumProficiency'] === 'string' ? record['minimumProficiency'] : '',
      'match requirement minimumProficiency',
    ),
  });
}

function toAvailabilityWindow(value: unknown): AvailabilityWindow {
  const record = expectFields(
    value,
    ['from', 'until'],
    [],
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_REQUEST,
    'match request availability window',
  );
  const from = toExpertQualificationTimestamp(
    typeof record['from'] === 'string' ? record['from'] : '',
    'match request availability window from',
  );
  const until = toExpertQualificationTimestamp(
    typeof record['until'] === 'string' ? record['until'] : '',
    'match request availability window until',
  );
  if (Date.parse(until) <= Date.parse(from)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_REQUEST, {
      message: `match request availability window is empty: until ${JSON.stringify(until)} is not after from ${JSON.stringify(from)}`,
      details: { from, until },
    });
  }
  return Object.freeze({ from, until });
}

/** Structural (non-throwing) check for the digest-free view. */
export function isMatchRequestView(value: unknown): value is MatchRequestView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['requestVersion'] !== MATCH_REQUEST_VERSION ||
    !isTenantScope(candidate['tenant']) ||
    !isExpertQualificationTimestamp(candidate['evaluatedAt'])
  ) {
    return false;
  }
  const requirements = candidate['requirements'];
  if (
    !Array.isArray(requirements) ||
    requirements.length === 0 ||
    !requirements.every((entry) => {
      if (typeof entry !== 'object' || entry === null) return false;
      const req = entry as Record<string, unknown>;
      if (typeof req['requirementId'] !== 'string' || req['requirementId'].length === 0) {
        return false;
      }
      const capability = req['capability'];
      if (typeof capability !== 'object' || capability === null) return false;
      const cap = capability as Record<string, unknown>;
      if (!COMPETENCY_NODE_KINDS.includes(cap['kind'] as (typeof COMPETENCY_NODE_KINDS)[number])) {
        return false;
      }
      return isProficiencyLevel(req['minimumProficiency']);
    })
  ) {
    return false;
  }
  const jurisdictions = candidate['jurisdictions'];
  if (
    jurisdictions !== undefined &&
    (!Array.isArray(jurisdictions) ||
      jurisdictions.length === 0 ||
      !jurisdictions.every((entry) => isJurisdictionView(entry)))
  ) {
    return false;
  }
  const window = candidate['availabilityWindow'];
  if (window !== undefined) {
    if (typeof window !== 'object' || window === null) return false;
    const win = window as Record<string, unknown>;
    if (
      !isExpertQualificationTimestamp(win['from']) ||
      !isExpertQualificationTimestamp(win['until'])
    ) {
      return false;
    }
  }
  const domainRef = candidate['domainRef'];
  if (domainRef !== undefined && typeof domainRef !== 'object') {
    const domain = domainRef as Record<string, unknown>;
    if (domain['kind'] !== 'domain') return false;
  }
  return true;
}

/** Structural (non-throwing) check for the full request (view + digest). */
export function isMatchRequest(value: unknown): value is MatchRequest {
  if (!isMatchRequestView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed match request.
 * Rejects empty/duplicate-id requirement lists, non-competency capability
 * kinds, unknown proficiency levels, empty jurisdiction lists, inverted
 * availability windows and unknown fields — typed errors throughout.
 */
export async function createMatchRequest(
  input: CreateMatchRequestInput,
): Promise<MatchRequest> {
  const record = expectFields(
    input,
    ['tenant', 'requirements', 'evaluatedAt'],
    ['domainRef', 'jurisdictions', 'availabilityWindow'],
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_REQUEST,
    'match request',
  );

  const tenant = toTenantScope(
    typeof record['tenant'] === 'string' ? record['tenant'] : '',
    'match request tenant',
  );
  const evaluatedAt = toExpertQualificationTimestamp(
    typeof record['evaluatedAt'] === 'string' ? record['evaluatedAt'] : '',
    'match request evaluatedAt',
  );

  if (!Array.isArray(record['requirements']) || record['requirements'].length === 0) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_REQUEST, {
      message:
        'a match request requires at least one competency requirement (R8 — a requirement-free match is meaningless)',
      details: { field: 'requirements' },
    });
  }
  const requirements = Object.freeze(
    (record['requirements'] as unknown[]).map((entry) => toMatchRequirement(entry)),
  );
  const seen = new Set<string>();
  for (const requirement of requirements) {
    if (seen.has(requirement.requirementId)) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.DUPLICATE_REQUIREMENT, {
        message: `duplicate match requirement id: ${requirement.requirementId}`,
        details: { requirementId: requirement.requirementId },
      });
    }
    seen.add(requirement.requirementId);
  }

  const domainRef =
    record['domainRef'] === undefined
      ? undefined
      : toCapabilityNodeRefView(
          record['domainRef'] as {
            kind: string;
            id: string;
            version: string;
            digest: string;
          },
          ['domain'],
        );
  const jurisdictions =
    record['jurisdictions'] === undefined
      ? undefined
      : Object.freeze(
          (record['jurisdictions'] as { country: string; region?: string }[]).map((entry) =>
            toJurisdictionView(entry),
          ),
        );
  if (jurisdictions !== undefined && jurisdictions.length === 0) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'match request jurisdictions, when present, must list at least one jurisdiction',
    });
  }
  const availabilityWindow =
    record['availabilityWindow'] === undefined
      ? undefined
      : toAvailabilityWindow(record['availabilityWindow']);

  const view: MatchRequestView = {
    requestVersion: MATCH_REQUEST_VERSION,
    tenant,
    requirements,
    evaluatedAt,
    ...(domainRef !== undefined ? { domainRef } : {}),
    ...(jurisdictions !== undefined ? { jurisdictions } : {}),
    ...(availabilityWindow !== undefined ? { availabilityWindow } : {}),
  };

  const digest = toContentDigest(
    await digestCanonical(view),
    'match request digest',
  );
  return deepFreeze({ ...view, digest }) as MatchRequest;
}

/** The digest-free view of a request (what the digest commits to). */
export function matchRequestView(request: MatchRequest): MatchRequestView {
  const { digest: _digest, ...view } = request;
  return deepFreeze({ ...view }) as MatchRequestView;
}

/**
 * Recompute the request digest over the digest-free view and compare.
 * Throws EXPERT_QUALIFICATION_TAMPERED on any mismatch.
 */
export async function recomputeMatchRequestDigest(
  request: MatchRequest,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isMatchRequest(request)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'request digest recomputation requires a structurally valid match request',
    });
  }
  const actual = await digestCanonical(matchRequestView(request));
  if (actual !== request.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.TAMPERED, {
      message: `match request digest mismatch: expected ${expectedDigest ?? request.digest}, got ${actual}`,
      details: {
        tenant: request.tenant,
        requirementCount: request.requirements.length,
        expected: expectedDigest ?? request.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed request digest');
}
