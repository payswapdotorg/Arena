/**
 * CapabilityCase — the versioned, content-addressed unit of capability
 * development intake (Work Order A005; docs/architecture.md §5; spec CC1.0;
 * requirements R5, R6-bridge, R3-style addressability; architecture-lock
 * rules 6, 11, 24).
 *
 * "The bridge from observed failure to capability development. Records
 * target capability, domain, context, observed failure, evidence, current
 * body/substrate, uncertainty, desired outcome, expert requirements,
 * environment requirements, task requirements and evaluation/verification
 * requirements." (architecture.md §5, verbatim)
 *
 * A case binds:
 *   - its identity (tenant scope + case id) and a semver version;
 *   - its current lifecycle status (see lifecycle.ts) and the append-only
 *     lifecycle event log accumulated so far;
 *   - every §5 field as a validated object (see requirements.ts);
 *   - the spec CC1.0 required fields: source (principal), problem
 *     statement, priority, risk, provenance;
 *   - OPTIONAL current body version / substrate references (a case may
 *     predate a body — §5: "when known");
 *   - OPTIONAL parent ref (a follow-up case branched from another case's
 *     version — spec CC1.0: "Branches may create follow-up cases") and
 *     OPTIONAL supersedes ref (a NEW version of THIS case replacing the
 *     previous version — gate 4)
 * to a sha256 `digest` computed over the canonical JSON serialization of
 * the digest-free view. Canonicalization and hashing are REUSED from
 * @arena/protocol-core (digestCanonical) — never reimplemented here.
 *
 * Immutability: `createCapabilityCase` validates, computes the digest and
 * DEEP-FREEZES the result. There is no mutation API in this package — no
 * setStatus, no edit field, no removeEvidence — so "same content, different
 * state" can only exist as a DIFFERENT content-addressed object with a
 * DIFFERENT digest, and any object claiming a stale digest fails
 * `verifyCapabilityCase` (fail-closed tamper detection).
 *
 * Content addressing note: the digest covers the ENTIRE digest-free view,
 * INCLUDING the lifecycle status and the event log. A case version's digest
 * therefore pins its exact lifecycle state; every historical state stays
 * addressable by its digest, which is what makes the append-only lifecycle
 * auditable (lock rule 6).
 */

import { computeCapabilityCaseDigest, capabilityCaseContentView } from './digest.js';
import { CAPABILITY_CASE_ERROR_CODES, CapabilityCaseError } from './errors.js';
import {
  formatCaseVersionRef,
  isCaseVersionRef,
  toCaseVersionRef,
} from './identity.js';
import type { CaseIdentity, CaseVersionRef } from './identity.js';
import { caseLogicalKey, isCaseIdentity, toCaseIdentity } from './identity.js';
import {
  assertNoDuplicateEvidence,
  compareCaseVersions,
  deepFreeze,
  isBodyVersionRefView,
  isCaseVersion,
  isContentDigest,
  isEvidenceRef,
  isPrincipalRefView,
  isProvenanceRefView,
  isSubstrateRefView,
  toBodyVersionRefView,
  toCaseVersion,
  toContentDigest,
  toEvidenceRef,
  toPrincipalRefView,
  toProvenanceRefView,
  toSubstrateRefView,
} from './shared.js';
import type {
  BodyVersionRefView,
  CaseVersion,
  ContentDigest,
  EvidenceRef,
  PrincipalRefView,
  ProvenanceRefView,
  SubstrateRefView,
} from './shared.js';
import { toCapabilityCaseTimestamp } from './timestamp.js';
import {
  isEvaluationRequirements,
  isExpertRequirements,
  isEnvironmentRequirements,
  isObservedFailureRecord,
  isTaskRequirements,
  isVerificationRequirements,
  toEvaluationRequirements,
  toEnvironmentRequirements,
  toExpertRequirements,
  toObservedFailureRecord,
  toTaskRequirements,
  toVerificationRequirements,
} from './requirements.js';
import { toCapabilityNodeRefView } from './shared.js';
import type { CapabilityNodeRefView } from './shared.js';
import type {
  EvaluationRequirements,
  EnvironmentRequirements,
  ExpertRequirements,
  ObservedFailureRecord,
  TaskRequirements,
  VerificationRequirements,
} from './requirements.js';
import {
  CASE_STATUSES,
  isCaseStatus,
  makeCaseCreatedEvent,
  toCaseStatus,
} from './lifecycle.js';
import type { CaseLifecycleEvent, CaseStatus } from './lifecycle.js';

/** Wire version of the capability-case record shape. */
export const CAPABILITY_CASE_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Priority / risk (spec CC1.0 required fields "priority", "risk")
// ---------------------------------------------------------------------------

/** Case priority classes (advisory ordering data; classification only). */
export const CASE_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;

export type CasePriority = (typeof CASE_PRIORITIES)[number];

export function isCasePriority(value: unknown): value is CasePriority {
  return (
    typeof value === 'string' &&
    (CASE_PRIORITIES as readonly string[]).includes(value)
  );
}

/** Case risk classes (explicit risk metadata — lock rule 23 family). */
export const CASE_RISK_LEVELS = ['low', 'moderate', 'high', 'severe'] as const;

export type CaseRisk = (typeof CASE_RISK_LEVELS)[number];

export function isCaseRisk(value: unknown): value is CaseRisk {
  return (
    typeof value === 'string' &&
    (CASE_RISK_LEVELS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// The case shape
// ---------------------------------------------------------------------------

/** Digest-free view of a capability case — exactly what the digest covers. */
export interface CapabilityCaseContentView {
  readonly recordVersion: typeof CAPABILITY_CASE_RECORD_VERSION;
  /** Identity: owning tenant scope + case id. */
  readonly identity: CaseIdentity;
  /** Semver version of this case version (no build metadata). */
  readonly version: CaseVersion;
  /** Current lifecycle status of this case version. */
  readonly status: CaseStatus;
  /** Who/what raised the case (spec CC1.0 "source"). */
  readonly source: PrincipalRefView;
  /** The problem statement (non-empty prose). */
  readonly problemStatement: string;
  /** Target capability (capability-graph capability/sub-capability node ref). */
  readonly targetCapability: CapabilityNodeRefView;
  /** Domain (capability-graph domain node ref). */
  readonly domain: CapabilityNodeRefView;
  /** Known context (non-empty prose). */
  readonly context: string;
  /** The observed failure/opportunity record. */
  readonly observedFailure: ObservedFailureRecord;
  /** Evidence references (digest-addressed; append-only — lock rule 6). */
  readonly evidence: readonly EvidenceRef[];
  /** Uncertainty assessment: the known unknowns (>= 1 statement). */
  readonly unknowns: readonly string[];
  /** The desired outcome (non-empty prose). */
  readonly desiredOutcome: string;
  /** Expert requirements. */
  readonly expertRequirements: ExpertRequirements;
  /** Environment requirements. */
  readonly environmentRequirements: EnvironmentRequirements;
  /** Task requirements (the A008 compiler's requirement source). */
  readonly taskRequirements: TaskRequirements;
  /** Evaluation requirements (distinct from verification — lock rule 7). */
  readonly evaluationRequirements: EvaluationRequirements;
  /** Verification requirements (distinct from evaluation — lock rule 7). */
  readonly verificationRequirements: VerificationRequirements;
  /** Current body version (OPTIONAL — a case may predate a body). */
  readonly currentBody?: BodyVersionRefView;
  /** Current cognitive substrate (OPTIONAL; never the case's identity — lock rule 2). */
  readonly currentSubstrate?: SubstrateRefView;
  /** Provenance record reference (spec CC1.0 "provenance"). */
  readonly provenance: ProvenanceRefView;
  /** Priority class. */
  readonly priority: CasePriority;
  /** Risk class. */
  readonly risk: CaseRisk;
  /** Follow-up lineage: the case version this case was branched from. */
  readonly parent?: CaseVersionRef;
  /** Supersession: the previous version of THIS case that this version replaces. */
  readonly supersedes?: CaseVersionRef;
  /** The version that superseded THIS version, once terminal-superseded. */
  readonly supersededBy?: CaseVersionRef;
  /** Append-only lifecycle event log (deep-frozen; never rewritten). */
  readonly lifecycle: readonly CaseLifecycleEvent[];
}

/** A frozen capability case: the content view plus its sha256 digest. */
export interface CapabilityCase extends CapabilityCaseContentView {
  readonly digest: ContentDigest;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export interface CreateCapabilityCaseInput {
  readonly identity: {
    tenant: string;
    caseId: string;
  };
  readonly version: string;
  readonly source: {
    type: string;
    tenant: string;
    principalId: string;
  };
  readonly problemStatement: string;
  readonly targetCapability: {
    kind: string;
    id: string;
    version: string;
    digest: string;
  };
  readonly domain: {
    kind: string;
    id: string;
    version: string;
    digest: string;
  };
  readonly context: string;
  readonly observedFailure: {
    summary: string;
    observedAt: string;
    reproduction?: string;
    failureNode?: {
      kind: string;
      id: string;
      version: string;
      digest: string;
    };
  };
  readonly evidence: readonly {
    digest: string;
    description: string;
  }[];
  readonly unknowns: readonly string[];
  readonly desiredOutcome: string;
  readonly expertRequirements: Parameters<typeof toExpertRequirements>[0];
  readonly environmentRequirements: Parameters<
    typeof toEnvironmentRequirements
  >[0];
  readonly taskRequirements: Parameters<typeof toTaskRequirements>[0];
  readonly evaluationRequirements: Parameters<typeof toEvaluationRequirements>[0];
  readonly verificationRequirements: Parameters<
    typeof toVerificationRequirements
  >[0];
  readonly currentBody?: {
    tenant: string;
    name: string;
    version: string;
    digest: string;
  };
  readonly currentSubstrate?: {
    adapterId: string;
    modelFamily: string;
    modelId: string;
    modelRevision: string;
    contentDigest: string;
  };
  readonly provenance: {
    recordDigest: string;
  };
  readonly priority: string;
  readonly risk: string;
  readonly parent?: {
    tenant: string;
    caseId: string;
    version: string;
    digest: string;
  };
  readonly supersedes?: {
    tenant: string;
    caseId: string;
    version: string;
    digest: string;
  };
  readonly createdAt: string;
}

/**
 * Create an immutable capability case in the DRAFT status: validates every
 * field (a missing or invalid required field is a structured
 * CapabilityCaseError naming the field group), computes the sha256 digest
 * over the canonical serialization of the content view, appends the initial
 * `case-created` lifecycle event, and DEEP-FREEZES the result. The returned
 * object can never be mutated in place.
 */
export async function createCapabilityCase(
  input: CreateCapabilityCaseInput,
): Promise<CapabilityCase> {
  const identity = toCaseIdentity(input.identity);
  const version = toCaseVersion(input.version);

  if (
    typeof input.problemStatement !== 'string' ||
    input.problemStatement.length === 0
  ) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_CASE, {
      message: 'case requires a non-empty problem statement',
      details: { field: 'problemStatement' },
    });
  }
  if (typeof input.context !== 'string' || input.context.length === 0) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_CASE, {
      message: 'case requires a non-empty known-context statement',
      details: { field: 'context' },
    });
  }
  if (typeof input.desiredOutcome !== 'string' || input.desiredOutcome.length === 0) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_CASE, {
      message: 'case requires a non-empty desired-outcome statement',
      details: { field: 'desiredOutcome' },
    });
  }
  if (!Array.isArray(input.unknowns) || input.unknowns.length === 0) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_CASE, {
      message:
        'case requires an uncertainty assessment with at least one unknown (an honest case always carries known unknowns)',
      details: { field: 'unknowns' },
    });
  }
  for (const unknown of input.unknowns) {
    if (typeof unknown !== 'string' || unknown.length === 0) {
      throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_CASE, {
        message: `unknowns must be non-empty statements: ${JSON.stringify(unknown)}`,
        details: { field: 'unknowns' },
      });
    }
  }
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_CASE, {
      message:
        'case requires at least one digest-addressed evidence reference (an observed failure without evidence is not a case)',
      details: { field: 'evidence' },
    });
  }
  const evidence = Object.freeze(input.evidence.map((ref) => toEvidenceRef(ref)));
  assertNoDuplicateEvidence(evidence);

  const source = toPrincipalRefView(input.source);
  const targetCapability = toCapabilityNodeRefView(input.targetCapability, [
    'capability',
    'sub-capability',
  ]);
  const domain = toCapabilityNodeRefView(input.domain, ['domain']);
  const observedFailure = toObservedFailureRecord(input.observedFailure);
  const expertRequirements = toExpertRequirements(input.expertRequirements);
  const environmentRequirements = toEnvironmentRequirements(
    input.environmentRequirements,
  );
  const taskRequirements = toTaskRequirements(input.taskRequirements);
  const evaluationRequirements = toEvaluationRequirements(
    input.evaluationRequirements,
  );
  const verificationRequirements = toVerificationRequirements(
    input.verificationRequirements,
  );

  const currentBody =
    input.currentBody === undefined ? undefined : toBodyVersionRefView(input.currentBody);
  if (currentBody !== undefined && currentBody.tenant !== identity.tenant) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_CASE, {
      message: `current body reference must live in the case's tenant scope: body tenant ${JSON.stringify(currentBody.tenant)} vs case tenant ${JSON.stringify(identity.tenant)} (lock rule 11)`,
      details: { field: 'currentBody', bodyTenant: currentBody.tenant, caseTenant: identity.tenant },
    });
  }
  const currentSubstrate =
    input.currentSubstrate === undefined
      ? undefined
      : toSubstrateRefView(input.currentSubstrate);

  if (!isProvenanceRefView(input.provenance)) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_REF, {
      message: `case requires a valid provenance reference: ${JSON.stringify(input.provenance)}`,
      details: { field: 'provenance' },
    });
  }
  const provenance = toProvenanceRefView(input.provenance);

  if (!isCasePriority(input.priority)) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_CASE, {
      message: `unknown case priority: ${JSON.stringify(input.priority)} (known: ${CASE_PRIORITIES.join(', ')})`,
      details: { field: 'priority', known: [...CASE_PRIORITIES] },
    });
  }
  if (!isCaseRisk(input.risk)) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_CASE, {
      message: `unknown case risk: ${JSON.stringify(input.risk)} (known: ${CASE_RISK_LEVELS.join(', ')})`,
      details: { field: 'risk', known: [...CASE_RISK_LEVELS] },
    });
  }

  const parent =
    input.parent === undefined ? undefined : toCaseVersionRef(input.parent);
  const supersedes =
    input.supersedes === undefined ? undefined : toCaseVersionRef(input.supersedes);
  if (supersedes !== undefined) {
    if (
      supersedes.tenant !== identity.tenant ||
      supersedes.caseId !== identity.caseId
    ) {
      throw new CapabilityCaseError(
        CAPABILITY_CASE_ERROR_CODES.INVALID_SUPERSESSION,
        {
          message: `supersession must target the same logical case: ${JSON.stringify(supersedes.tenant)}/${JSON.stringify(supersedes.caseId)} does not match ${JSON.stringify(identity.tenant)}/${JSON.stringify(identity.caseId)}`,
          details: {
            supersedes: formatCaseVersionRef(supersedes),
            case: caseLogicalKey(identity),
          },
        },
      );
    }
    if (compareCaseVersions(supersedes.version, version) >= 0) {
      throw new CapabilityCaseError(
        CAPABILITY_CASE_ERROR_CODES.INVALID_SUPERSESSION,
        {
          message: `a superseding case version must have STRICTLY higher semver precedence than the version it supersedes: ${JSON.stringify(version)} does not supersede ${JSON.stringify(supersedes.version)}`,
          details: { supersedes: formatCaseVersionRef(supersedes), version },
        },
      );
    }
  }

  const createdAt = toCapabilityCaseTimestamp(input.createdAt);
  const createdEvent = makeCaseCreatedEvent({
    sequence: 1,
    occurredAt: createdAt,
    actor: source,
    caseIdentity: identity,
  });

  const view: CapabilityCaseContentView = {
    recordVersion: CAPABILITY_CASE_RECORD_VERSION,
    identity,
    version,
    status: 'draft',
    source,
    problemStatement: input.problemStatement,
    targetCapability,
    domain,
    context: input.context,
    observedFailure,
    evidence,
    unknowns: Object.freeze([...input.unknowns]),
    desiredOutcome: input.desiredOutcome,
    expertRequirements,
    environmentRequirements,
    taskRequirements,
    evaluationRequirements,
    verificationRequirements,
    ...(currentBody !== undefined ? { currentBody } : {}),
    ...(currentSubstrate !== undefined ? { currentSubstrate } : {}),
    provenance,
    priority: input.priority,
    risk: input.risk,
    ...(parent !== undefined ? { parent } : {}),
    ...(supersedes !== undefined ? { supersedes } : {}),
    lifecycle: Object.freeze([createdEvent]),
  };
  const digest = toContentDigest(await computeCapabilityCaseDigest(view));
  const caseRecord: CapabilityCase = deepFreeze({ ...view, digest });
  return caseRecord;
}

// ---------------------------------------------------------------------------
// Digest / verification
// ---------------------------------------------------------------------------

// Digest helpers live in digest.ts (shared with lifecycle.ts, no runtime
// cycle); re-exported here so the package surface keeps one home.
export {
  computeCapabilityCaseDigest,
  capabilityCaseContentView,
} from './digest.js';

export function isCapabilityCase(value: unknown): value is CapabilityCase {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === CAPABILITY_CASE_RECORD_VERSION &&
    isCaseIdentity(candidate['identity']) &&
    isCaseVersion(candidate['version']) &&
    isCaseStatus(candidate['status']) &&
    isPrincipalRefView(candidate['source']) &&
    typeof candidate['problemStatement'] === 'string' &&
    candidate['problemStatement'].length > 0 &&
    typeof candidate['context'] === 'string' &&
    candidate['context'].length > 0 &&
    isObservedFailureRecord(candidate['observedFailure']) &&
    Array.isArray(candidate['evidence']) &&
    candidate['evidence'].length > 0 &&
    candidate['evidence'].every((ref) => isEvidenceRef(ref)) &&
    Array.isArray(candidate['unknowns']) &&
    candidate['unknowns'].length > 0 &&
    typeof candidate['desiredOutcome'] === 'string' &&
    candidate['desiredOutcome'].length > 0 &&
    isExpertRequirements(candidate['expertRequirements']) &&
    isEnvironmentRequirements(candidate['environmentRequirements']) &&
    isTaskRequirements(candidate['taskRequirements']) &&
    isEvaluationRequirements(candidate['evaluationRequirements']) &&
    isVerificationRequirements(candidate['verificationRequirements']) &&
    (candidate['currentBody'] === undefined ||
      isBodyVersionRefView(candidate['currentBody'])) &&
    (candidate['currentSubstrate'] === undefined ||
      isSubstrateRefView(candidate['currentSubstrate'])) &&
    isProvenanceRefView(candidate['provenance']) &&
    isCasePriority(candidate['priority']) &&
    isCaseRisk(candidate['risk']) &&
    (candidate['parent'] === undefined || isCaseVersionRef(candidate['parent'])) &&
    (candidate['supersedes'] === undefined ||
      isCaseVersionRef(candidate['supersedes'])) &&
    (candidate['supersededBy'] === undefined ||
      isCaseVersionRef(candidate['supersededBy'])) &&
    Array.isArray(candidate['lifecycle']) &&
    candidate['lifecycle'].every(
      (event) =>
        typeof event === 'object' &&
        event !== null &&
        typeof (event as Record<string, unknown>)['sequence'] === 'number',
    ) &&
    isContentDigest(candidate['digest'])
  );
}

/**
 * Re-compute a case's digest and compare it with the claimed digest (or an
 * explicitly expected one). FAILS CLOSED with CAPABILITY_CASE_TAMPERED on
 * any mismatch — a mutation of any field, evidence entry, status or history
 * event is always detected. Returns the verified digest.
 */
export async function verifyCapabilityCase(
  caseRecord: CapabilityCase,
  expectedDigest?: string,
): Promise<string> {
  if (!isCapabilityCase(caseRecord)) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_CASE, {
      message: 'not a structurally valid capability case',
    });
  }
  const actual = await computeCapabilityCaseDigest(
    capabilityCaseContentView(caseRecord),
  );
  const claimed = expectedDigest ?? caseRecord.digest;
  if (actual !== claimed) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.TAMPERED, {
      message: `capability case digest mismatch: expected ${claimed}, recomputed ${actual}`,
      details: { expected: claimed, actual },
    });
  }
  return actual;
}

/** A content-addressed ref to this exact case state (identity+version+digest). */
export function caseVersionRef(caseRecord: CapabilityCase): CaseVersionRef {
  return Object.freeze({
    tenant: caseRecord.identity.tenant,
    caseId: caseRecord.identity.caseId,
    version: caseRecord.version,
    digest: caseRecord.digest,
  });
}

// Re-export the status vocabulary for consumers of the case shape.
export { CASE_STATUSES, isCaseStatus, toCaseStatus };
export type { CaseStatus };
