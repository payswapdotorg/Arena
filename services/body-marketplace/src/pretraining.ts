/**
 * The ON-DEMAND PRETRAINING request domain (Work Order C014 — where the
 * learning loop meets the marketplace).
 *
 * A PretrainingRequest compiles rights-cleared inputs into a forge-bound
 * training proposal. NOTHING becomes a reusable marketplace asset merely
 * because an expert typed it (spec/human-escalation-work-items.md
 * "Learning loop"): rights, validation, provenance and scope are
 * mandatory — enforced here as typed closed compilation outcomes:
 *
 *   compilable          — every input carries sufficient rights AND the
 *                         evidence set contains at least one C009-VALIDATED
 *                         intervention evidence record (verdict 'accepted');
 *   blocked-with-reasons — rights-insufficient and/or evidence-insufficient,
 *                         each reason citing the implicated input index and
 *                         ref (machine-readable, never a bare string).
 *
 * The compilation is PURE over the resolved inputs: the caller resolves
 * refs through the injected C009/C008 ports (see ports.ts) and passes the
 * resolved views here — no I/O, no clock reads.
 */

import {
  BODY_MARKETPLACE_ERROR_CODES,
  BodyMarketplaceError,
} from './errors.js';
import {
  deepFreeze,
  expectEnumMember,
  expectFields,
  isBodyMarketplaceId,
  isBodyMarketplaceText,
  isBodyMarketplaceTimestamp,
  isEnumMember,
  isPlainObject,
  isTenant,
} from './shared.js';

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** The closed pretraining input-kind vocabulary (the C008/C009 seams). */
export const PRETRAINING_INPUT_KINDS = Object.freeze([
  'validated-intervention-evidence',
  'body-improvement-candidate',
  'knowledge-candidate',
  'tool-specification-candidate',
  'customer-commission',
] as const);
export type PretrainingInputKind = (typeof PRETRAINING_INPUT_KINDS)[number];

/** Structural (non-throwing) check for the input-kind vocabulary. */
export function isPretrainingInputKind(value: unknown): value is PretrainingInputKind {
  return isEnumMember(value, PRETRAINING_INPUT_KINDS);
}

/** The closed training-use rights vocabulary. */
export const TRAINING_USE_RIGHTS = Object.freeze(['permitted', 'forbidden', 'unspecified'] as const);
export type TrainingUseRight = (typeof TRAINING_USE_RIGHTS)[number];

/** Structural (non-throwing) check for the training-use vocabulary. */
export function isTrainingUseRight(value: unknown): value is TrainingUseRight {
  return isEnumMember(value, TRAINING_USE_RIGHTS);
}

/** The closed compilation-block reason vocabulary (typed blocked outcomes). */
export const PRETRAINING_BLOCK_REASON_CODES = Object.freeze([
  'rights-insufficient',
  'evidence-insufficient',
] as const);
export type PretrainingBlockReasonCode = (typeof PRETRAINING_BLOCK_REASON_CODES)[number];

// ---------------------------------------------------------------------------
// Input shapes (wire form — validated then frozen)
// ---------------------------------------------------------------------------

/** Rights metadata every pretraining input MUST carry (the learning-loop law). */
export interface InputRightsMetadata {
  readonly license: string;
  readonly trainingUse: TrainingUseRight;
  readonly scope: string;
  readonly attribution: string | null;
}

/** One rights-cleared pretraining input reference (wire form). */
export interface PretrainingInputInput {
  readonly kind: PretrainingInputKind;
  /** The content digest / candidate id the owning port resolves. */
  readonly refId: string;
  readonly source: {
    readonly interventionId: string | null;
    readonly requestId: string | null;
    readonly sessionId: string | null;
    readonly signalId: string | null;
  };
  readonly rights: InputRightsMetadata;
  readonly scope: string;
  readonly evidenceOfUse: readonly string[];
}

/** A customer commission accompanying the request (explicit demand-side provenance). */
export interface CustomerCommission {
  readonly commissionId: string;
  readonly customer: string;
  readonly scope: string;
}

/** The pretraining request (wire form). */
export interface PretrainingRequestInput {
  readonly requestId: string;
  readonly tenantId: string;
  readonly capabilityNeed: {
    readonly summary: string;
    readonly domainScope: readonly string[];
  };
  /** The target body identity + the NEW version number the forge will propose. */
  readonly targetBody: { readonly tenant: string; readonly name: string };
  readonly targetVersion: string;
  readonly inputs: readonly PretrainingInputInput[];
  readonly commission: CustomerCommission | null;
  readonly requestedAt: string;
  readonly requestedBy: { readonly type: string; readonly tenant: string; readonly principalId: string };
}

// ---------------------------------------------------------------------------
// Resolved evidence views (what the injected ports return; see ports.ts)
// ---------------------------------------------------------------------------

/** A C009-validated intervention evidence view (an accepted adjudication). */
export interface ValidatedInterventionEvidenceView {
  readonly verdictId: string;
  readonly requestId: string;
  readonly tenantId: string;
  /** MUST be 'accepted' — the C009 validation gate on training evidence. */
  readonly verdict: string;
  readonly adjudicatedAt: string;
  readonly evidenceDigests: readonly string[];
  readonly digest: string;
}

/** A C008 improvement-candidate view (body/tool/knowledge candidates). */
export interface ImprovementCandidateView {
  readonly candidateId: string;
  readonly kind: 'body-improvement' | 'tool-specification' | 'knowledge';
  readonly tenantId: string;
  readonly summary: string;
  readonly evidenceOfUse: readonly string[];
  readonly proposedAt: string;
}

// ---------------------------------------------------------------------------
// Compilation outcome (typed closed outcomes — never a boolean)
// ---------------------------------------------------------------------------

/** One machine-readable block reason citing the implicated input. */
export interface PretrainingBlockReason {
  readonly code: PretrainingBlockReasonCode;
  readonly detail: string;
  readonly inputIndex: number | null;
  readonly refId: string | null;
}

/** The compilable outcome: the resolved, rights-cleared input set. */
export interface CompilablePretrainingRequest {
  readonly outcome: 'compilable';
  readonly requestId: string;
  readonly tenantId: string;
  readonly totalInputs: number;
  readonly validatedEvidenceRefs: readonly string[];
  readonly candidateRefs: readonly string[];
  readonly commission: CustomerCommission | null;
}

/** The blocked outcome: rights and/or validation are insufficient — nothing trains. */
export interface BlockedPretrainingRequest {
  readonly outcome: 'blocked';
  readonly requestId: string;
  readonly tenantId: string;
  readonly reasons: readonly PretrainingBlockReason[];
}

/** The typed closed compilation outcome. */
export type PretrainingCompilation = CompilablePretrainingRequest | BlockedPretrainingRequest;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function toInputRights(value: unknown, context: string): InputRightsMetadata {
  const record = expectFields(
    value,
    ['license', 'trainingUse', 'scope', 'attribution'],
    [],
    BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST,
    context,
  );
  const license = record['license'];
  if (typeof license !== 'string' || license.length === 0) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: `${context}.license must be a non-empty string`,
    });
  }
  const trainingUse = expectEnumMember(
    record['trainingUse'],
    TRAINING_USE_RIGHTS,
    BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST,
    `${context}.trainingUse`,
  );
  const scope = record['scope'];
  if (typeof scope !== 'string' || scope.length === 0) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: `${context}.scope must be a non-empty string`,
    });
  }
  const attribution = record['attribution'];
  if (attribution !== null && typeof attribution !== 'string') {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: `${context}.attribution must be a string or null`,
    });
  }
  return deepFreeze({ license, trainingUse, scope, attribution });
}

function toInputSource(value: unknown, context: string): PretrainingInputInput['source'] {
  const record = expectFields(
    value,
    ['interventionId', 'requestId', 'sessionId', 'signalId'],
    [],
    BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST,
    context,
  );
  const out: Record<string, string | null> = {};
  for (const field of ['interventionId', 'requestId', 'sessionId', 'signalId'] as const) {
    const entry = record[field];
    if (entry === null || typeof entry === 'string') {
      out[field] = entry;
    } else {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
        message: `${context}.${field} must be a string or null`,
      });
    }
  }
  return deepFreeze(out) as PretrainingInputInput['source'];
}

function toInput(value: unknown, index: number): PretrainingInputInput {
  const context = `pretraining input [${String(index)}]`;
  const record = expectFields(
    value,
    ['kind', 'refId', 'source', 'rights', 'scope', 'evidenceOfUse'],
    [],
    BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST,
    context,
  );
  const kind = expectEnumMember(
    record['kind'],
    PRETRAINING_INPUT_KINDS,
    BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST,
    `${context}.kind`,
  );
  const refId = record['refId'];
  if (typeof refId !== 'string' || refId.length === 0) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: `${context}.refId must be a non-empty string`,
    });
  }
  if (!Array.isArray(record['evidenceOfUse'])) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: `${context}.evidenceOfUse must be an array of strings`,
    });
  }
  for (const entry of record['evidenceOfUse'] as unknown[]) {
    if (typeof entry !== 'string') {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
        message: `${context}.evidenceOfUse entries must be strings`,
      });
    }
  }
  const scope = record['scope'];
  if (typeof scope !== 'string' || scope.length === 0) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: `${context}.scope must be a non-empty string`,
    });
  }
  return deepFreeze({
    kind,
    refId,
    source: toInputSource(record['source'], `${context}.source`),
    rights: toInputRights(record['rights'], `${context}.rights`),
    scope,
    evidenceOfUse: Object.freeze([...(record['evidenceOfUse'] as string[])]),
  });
}

function toCommission(value: unknown): CustomerCommission {
  const record = expectFields(
    value,
    ['commissionId', 'customer', 'scope'],
    [],
    BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST,
    'pretraining request commission',
  );
  const commissionId = record['commissionId'];
  const customer = record['customer'];
  const scope = record['scope'];
  if (typeof commissionId !== 'string' || typeof customer !== 'string' || typeof scope !== 'string') {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: 'pretraining request commission fields must be strings',
    });
  }
  return deepFreeze({ commissionId, customer, scope });
}

/** Validate + freeze one pretraining request (fail closed on shape). */
export function toPretrainingRequest(value: unknown): PretrainingRequestInput {
  const record = expectFields(
    value,
    [
      'requestId',
      'tenantId',
      'capabilityNeed',
      'targetBody',
      'targetVersion',
      'inputs',
      'commission',
      'requestedAt',
      'requestedBy',
    ],
    [],
    BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST,
    'pretraining request',
  );
  if (!isBodyMarketplaceId(record['requestId'])) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: 'pretraining request requestId must be a marketplace id',
    });
  }
  if (!isTenant(record['tenantId'])) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: 'pretraining request tenantId must be a valid tenant',
    });
  }
  const need = record['capabilityNeed'];
  if (
    !isPlainObject(need) ||
    typeof need['summary'] !== 'string' ||
    !Array.isArray(need['domainScope']) ||
    (need['domainScope'] as unknown[]).some((entry) => typeof entry !== 'string')
  ) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: 'pretraining request capabilityNeed must carry a summary and a string domainScope',
    });
  }
  const targetBody = record['targetBody'];
  if (
    !isPlainObject(targetBody) ||
    !isTenant(targetBody['tenant']) ||
    typeof targetBody['name'] !== 'string'
  ) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: 'pretraining request targetBody must carry a tenant and a name',
    });
  }
  if (typeof record['targetVersion'] !== 'string' || record['targetVersion'].length === 0) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: 'pretraining request targetVersion must be a non-empty string',
    });
  }
  if (!Array.isArray(record['inputs'])) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: 'pretraining request inputs must be an array',
    });
  }
  const inputs = (record['inputs'] as unknown[]).map((entry, index) => toInput(entry, index));
  if (inputs.length === 0) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: 'pretraining request requires at least one input (rights-cleared training input)',
    });
  }
  if (!isBodyMarketplaceTimestamp(record['requestedAt'])) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: 'pretraining request requestedAt must be an ms-precision UTC timestamp',
    });
  }
  const requestedBy = record['requestedBy'];
  if (
    !isPlainObject(requestedBy) ||
    typeof requestedBy['type'] !== 'string' ||
    !isTenant(requestedBy['tenant']) ||
    typeof requestedBy['principalId'] !== 'string'
  ) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: 'pretraining request requestedBy must be a principal ref',
    });
  }
  const commission =
    record['commission'] === null ? null : toCommission(record['commission']);
  return deepFreeze({
    requestId: record['requestId'],
    tenantId: record['tenantId'],
    capabilityNeed: deepFreeze({
      summary: (need as Record<string, unknown>)['summary'] as string,
      domainScope: Object.freeze([...((need as Record<string, unknown>)['domainScope'] as string[])]),
    }),
    targetBody: deepFreeze({
      tenant: targetBody['tenant'],
      name: targetBody['name'],
    }),
    targetVersion: record['targetVersion'],
    inputs: Object.freeze(inputs),
    commission,
    requestedAt: record['requestedAt'],
    requestedBy: deepFreeze({
      type: requestedBy['type'] as string,
      tenant: requestedBy['tenant'] as string,
      principalId: requestedBy['principalId'] as string,
    }),
  });
}

// ---------------------------------------------------------------------------
// The compilation (PURE over resolved evidence/candidate views)
// ---------------------------------------------------------------------------

export interface CompilePretrainingRequestOptions {
  /**
   * The C009 seam: resolved validated-intervention-evidence views, keyed
   * by refId. ONLY entries here count as validated evidence; an evidence
   * input that did not resolve is evidence-insufficient.
   */
  readonly resolvedEvidence: ReadonlyMap<string, ValidatedInterventionEvidenceView>;
  /**
   * The C008 seam: resolved improvement-candidate views, keyed by refId.
   * Unresolvable candidate inputs do not block compilation by themselves
   * (they are not training evidence), but they are dropped — never
   * silently admitted.
   */
  readonly resolvedCandidates?: ReadonlyMap<string, ImprovementCandidateView>;
}

/**
 * Compile one pretraining request into the typed closed outcome. PURE:
 * no I/O, no clock. Rights-insufficient fires per-input; a request whose
 * evidence set contains NO accepted C009 adjudication is
 * evidence-insufficient — nothing trains on unvalidated data.
 */
export function compilePretrainingRequest(
  request: PretrainingRequestInput,
  options: CompilePretrainingRequestOptions,
): PretrainingCompilation {
  const reasons: PretrainingBlockReason[] = [];
  const validatedEvidenceRefs: string[] = [];
  const candidateRefs: string[] = [];
  const candidates = options.resolvedCandidates ?? new Map<string, ImprovementCandidateView>();

  for (const [index, input] of request.inputs.entries()) {
    // --- the rights gate (per input; training use must be explicit) ------
    if (input.rights.trainingUse !== 'permitted' || input.rights.license.length === 0) {
      reasons.push({
        code: 'rights-insufficient',
        detail:
          input.rights.trainingUse !== 'permitted'
            ? `input ${input.refId} declares trainingUse=${JSON.stringify(input.rights.trainingUse)} — training use must be explicitly 'permitted'`
            : `input ${input.refId} carries no license`,
        inputIndex: index,
        refId: input.refId,
      });
      continue;
    }
    // --- the validation gate (C009 accepted adjudications only) ----------
    if (input.kind === 'validated-intervention-evidence') {
      const evidence = options.resolvedEvidence.get(input.refId);
      if (evidence === undefined) {
        reasons.push({
          code: 'evidence-insufficient',
          detail: `validated-intervention-evidence input ${input.refId} did not resolve through the C009 validation seam`,
          inputIndex: index,
          refId: input.refId,
        });
        continue;
      }
      if (evidence.verdict !== 'accepted') {
        reasons.push({
          code: 'evidence-insufficient',
          detail: `intervention evidence ${input.refId} carries C009 verdict ${JSON.stringify(evidence.verdict)} — only 'accepted' adjudications are admissible training input`,
          inputIndex: index,
          refId: input.refId,
        });
        continue;
      }
      if (evidence.tenantId !== request.tenantId) {
        reasons.push({
          code: 'evidence-insufficient',
          detail: `intervention evidence ${input.refId} belongs to tenant ${evidence.tenantId} — cross-tenant training evidence is not admissible`,
          inputIndex: index,
          refId: input.refId,
        });
        continue;
      }
      validatedEvidenceRefs.push(input.refId);
      continue;
    }
    // --- C008 candidates resolve or drop (fail-closed admission) ---------
    const candidate = candidates.get(input.refId);
    if (candidate === undefined) {
      reasons.push({
        code: 'evidence-insufficient',
        detail: `${input.kind} input ${input.refId} did not resolve through the C008 candidate seam and is not admissible`,
        inputIndex: index,
        refId: input.refId,
      });
      continue;
    }
    if (candidate.tenantId !== request.tenantId) {
      reasons.push({
        code: 'evidence-insufficient',
        detail: `${input.kind} input ${input.refId} belongs to tenant ${candidate.tenantId} — cross-tenant candidates are not admissible`,
        inputIndex: index,
        refId: input.refId,
      });
      continue;
    }
    candidateRefs.push(input.refId);
  }

  if (validatedEvidenceRefs.length === 0) {
    reasons.push({
      code: 'evidence-insufficient',
      detail:
        'the request carries no C009-validated intervention evidence — validated evidence is the only admissible training input (the learning-loop law)',
      inputIndex: null,
      refId: null,
    });
  }

  if (reasons.length > 0) {
    return deepFreeze({
      outcome: 'blocked',
      requestId: request.requestId,
      tenantId: request.tenantId,
      reasons: Object.freeze(reasons),
    });
  }
  return deepFreeze({
    outcome: 'compilable',
    requestId: request.requestId,
    tenantId: request.tenantId,
    totalInputs: request.inputs.length,
    validatedEvidenceRefs: Object.freeze(validatedEvidenceRefs),
    candidateRefs: Object.freeze(candidateRefs),
    commission: request.commission,
  });
}

/** Structural (non-throwing) check for a free-text scope summary. */
export function isCapabilityNeedSummary(value: unknown): value is string {
  return isBodyMarketplaceText(value);
}
