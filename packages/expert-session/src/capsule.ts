/**
 * ExpertSessionCapsule derivation (Work Order C006; spec
 * expert-environment-session.md EES1.0 "Environment Capsule" —
 * architecture-lock rules 28, 29).
 *
 * At escalation time Arena receives or requests a snapshot reference —
 * the ExecutionCapsule: task + world state + files/data + tool
 * availability + policy + relevant history. Arena then creates a
 * BOUNDED ExpertSessionCapsule derived from that state. Per EES1.0 the
 * derived capsule is:
 *
 *   - ISOLATED          — every resource/tool is screened against the
 *                         privacy barrier before entering the capsule;
 *   - SCOPED TO ONE ESCALATION — bound to exactly one escalation
 *                         request id + tenant;
 *   - TIME-BOUNDED      — expiresAt (bounded by the escalation
 *                         deadline) is mandatory; expired capsules
 *                         admit no action;
 *   - PRIVACY-CONTROLLED— the full EES1.0 barrier travels WITH the
 *                         capsule and every observation is screened;
 *   - NON-AUTHORITATIVE — the capsule is a derived replica; it carries
 *                         a typed authority marker
 *                         ('non-authoritative-replica') and NO
 *                         live-world write channel exists in the
 *                         object model.
 *
 * The capsule is content-addressed: sha256 over the canonical JSON of
 * the digest-free view via @arena/protocol-core's digestCanonical
 * (never reimplemented here), and deep-frozen on construction.
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_SESSION_ERROR_CODES, ExpertSessionError } from './errors.js';
import type { CapsuleResource, ComposePrivacyBarrierInput, PrivacyBarrier } from './barrier.js';
import { composePrivacyBarrier, screenObservation } from './barrier.js';
import type { ExpertSessionMode } from './modes.js';
import { assertModeAllowed, isExpertSessionMode } from './modes.js';
import type { ExpertSessionId, ExpertSessionTimestamp, EscalationIdRef, PlainJsonValue, TenantId } from './shared.js';
import {
  deepFreeze,
  isEscalationIdRef,
  isExpertSessionId,
  isPlainJsonValue,
  isTenantId,
  newExpertSessionId,
  toEscalationIdRef,
  toExpertSessionTimestamp,
  toExpertSessionId,
  toTenantId,
} from './shared.js';

/** Wire version of the capsule shape. */
export const EXPERT_SESSION_CAPSULE_VERSION = 1 as const;

/** Typed authority marker: a capsule is NEVER a live-world authority. */
export const CAPSULE_AUTHORITY = 'non-authoritative-replica' as const;

// ---------------------------------------------------------------------------
// ExecutionCapsule source (structural — what the host supplies)
// ---------------------------------------------------------------------------

/** One file/data reference inside the host's execution capsule. */
export interface CapsuleFileRef {
  readonly path: string;
  /** True when the file is read-only for the expert. */
  readonly readOnly?: boolean;
}

/** The host-side policy fields that drive derivation. */
export interface CapsuleSourcePolicy {
  readonly privacyClassification: 'public' | 'internal' | 'confidential';
  readonly pii: 'forbid' | 'redact' | 'allow';
  readonly sanitization: 'standard' | 'strict';
}

/**
 * The ExecutionCapsule reference (EES1.0): task + world state + files/
 * data + tool availability + policy + relevant history. This is the
 * STRUCTURAL input the adapters/expert-environment materializer builds
 * from the A009/A010 environment protocol vocabulary.
 */
export interface ExecutionCapsuleSource {
  /** Task reference (the subproblem being escalated). */
  readonly taskRef: string;
  /** World-state snapshot (plain JSON; screened on derivation). */
  readonly worldState: PlainJsonValue;
  /** Files/data references (bounded; readOnly flags honoured). */
  readonly files: readonly CapsuleFileRef[];
  /** Tool availability inside the agent's environment. */
  readonly toolAvailability: readonly string[];
  /** Host-declared secret-bound tools excluded from the expert surface (EES1.0 secret/tool exclusion). */
  readonly excludedTools?: readonly string[];
  /** Host-side policy driving privacy derivation. */
  readonly policy: CapsuleSourcePolicy;
  /** Relevant history references (trajectories, artifacts). */
  readonly relevantHistory: readonly string[];
  /** A009 environment definition digest when the source is environment-addressed. */
  readonly environmentDigest?: string;
}

// ---------------------------------------------------------------------------
// Derivation input
// ---------------------------------------------------------------------------

export interface DeriveCapsuleInput {
  /** The escalation this capsule is scoped to (exactly one). */
  readonly escalationRef: { readonly requestId: string; readonly tenantId: string };
  /** The session mode the expert will operate under. */
  readonly sessionMode: ExpertSessionMode;
  /** Allowed session modes derived from the EscalationRequest. */
  readonly allowedModes: readonly ExpertSessionMode[];
  /** The composed EES1.0 privacy barrier (or a compose input). */
  readonly barrier: PrivacyBarrier | ComposePrivacyBarrierInput;
  /** The execution capsule source. */
  readonly source: ExecutionCapsuleSource;
  /** Injected derivation time. */
  readonly now: number | string | Date;
  /** Capsule expiry (bounded by the escalation deadline; > now). */
  readonly expiresAt: number | string | Date;
  /** Fixed session id (idempotent derivations / tests); generated when omitted. */
  readonly sessionId?: string;
}



// ---------------------------------------------------------------------------
// ExpertSessionCapsule
// ---------------------------------------------------------------------------

export interface ExpertSessionCapsule {
  readonly capsuleVersion: typeof EXPERT_SESSION_CAPSULE_VERSION;
  readonly sessionId: ExpertSessionId;
  /** Scoped to EXACTLY one escalation (request id + tenant). */
  readonly escalationRef: { readonly requestId: EscalationIdRef; readonly tenantId: TenantId };
  readonly sessionMode: ExpertSessionMode;
  readonly allowedModes: readonly ExpertSessionMode[];
  /** The full EES1.0 privacy barrier travels with the capsule. */
  readonly barrier: PrivacyBarrier;
  /** Derived, screened world state (redactions applied at derivation). */
  readonly worldState: PlainJsonValue;
  /** Bounded resources (files/data that survived screening). */
  readonly resources: readonly CapsuleResource[];
  /** Bounded tool surface (availability minus barrier exclusions). */
  readonly tools: readonly string[];
  /** Read-only view of the source declaration (provenance). */
  readonly derivedFrom: {
    readonly taskRef: string;
    readonly environmentDigest: string | null;
    readonly relevantHistory: readonly string[];
    readonly sourcePolicy: CapsuleSourcePolicy;
    readonly redactedDocumentCount: number;
    readonly excludedToolCount: number;
  };
  readonly createdAt: ExpertSessionTimestamp;
  readonly expiresAt: ExpertSessionTimestamp;
  /** EES1.0: the capsule is non-authoritative for the host's live world. */
  readonly authority: typeof CAPSULE_AUTHORITY;
  /** sha256 over the canonical JSON of the digest-free view. */
  readonly digest: string;
}

function digestFreeView(capsule: Omit<ExpertSessionCapsule, 'digest'>): Record<string, unknown> {
  return {
    capsuleVersion: capsule.capsuleVersion,
    sessionId: capsule.sessionId,
    escalationRef: capsule.escalationRef,
    sessionMode: capsule.sessionMode,
    allowedModes: capsule.allowedModes,
    barrier: capsule.barrier,
    worldState: capsule.worldState,
    resources: capsule.resources,
    tools: capsule.tools,
    derivedFrom: capsule.derivedFrom,
    createdAt: capsule.createdAt,
    expiresAt: capsule.expiresAt,
    authority: capsule.authority,
  };
}

function validateRefList(values: readonly unknown[], field: string): readonly string[] {
  if (!Array.isArray(values)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: `${field} must be an array`,
    });
  }
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
        message: `${field} entries must be non-empty strings: ${JSON.stringify(value)}`,
      });
    }
  }
  return [...values];
}

/**
 * Derive a bounded ExpertSessionCapsule from an ExecutionCapsule source.
 * Fail-closed on every field: mode must be within the allowed set; the
 * barrier's tenant must match the escalation tenant; expiry must be
 * strictly after derivation time; the source must be plain JSON.
 *
 * Derivation applies the privacy barrier IMMEDIATELY: world state is
 * screened, redacted documents are dropped from the resource set and
 * excluded tools are removed from the tool surface — the expert never
 * sees pre-barrier data.
 */
export async function deriveExpertSessionCapsule(input: DeriveCapsuleInput): Promise<ExpertSessionCapsule> {
  if (typeof input !== 'object' || input === null) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'capsule derivation input must be an object',
    });
  }
  if (!isEscalationIdRef(input.escalationRef?.requestId)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: `escalationRef.requestId is invalid: ${JSON.stringify(input.escalationRef?.requestId)}`,
    });
  }
  if (!isTenantId(input.escalationRef?.tenantId)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: `escalationRef.tenantId is invalid: ${JSON.stringify(input.escalationRef?.tenantId)}`,
    });
  }
  if (!isExpertSessionMode(input.sessionMode)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_MODE, {
      message: `sessionMode is not one of the six EES1.0 modes: ${JSON.stringify(input.sessionMode)}`,
    });
  }
  if (!Array.isArray(input.allowedModes) || input.allowedModes.length === 0) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_MODE, {
      message: 'allowedModes must be a non-empty array of session modes',
    });
  }
  for (const mode of input.allowedModes) {
    if (!isExpertSessionMode(mode)) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_MODE, {
        message: `allowedModes entry is not a session mode: ${JSON.stringify(mode)}`,
      });
    }
  }
  assertModeAllowed(input.sessionMode, input.allowedModes);

  const rawBarrier: PrivacyBarrier | ComposePrivacyBarrierInput = input.barrier;
  if (typeof rawBarrier !== 'object' || rawBarrier === null) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'barrier must be a composed privacy barrier or a compose input object',
    });
  }
  const barrier =
    (rawBarrier as unknown as Record<string, unknown>)['barrierVersion'] === 1
      ? (rawBarrier as PrivacyBarrier)
      : composePrivacyBarrier(rawBarrier as ComposePrivacyBarrierInput);
  if (barrier.tenantBoundary.tenantId !== input.escalationRef.tenantId) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.CROSS_TENANT_ACCESS, {
      message: `privacy barrier tenant ${barrier.tenantBoundary.tenantId} does not match escalation tenant ${input.escalationRef.tenantId}`,
    });
  }

  const source = input.source;
  if (typeof source?.taskRef !== 'string' || source.taskRef.length === 0) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'source.taskRef must be a non-empty string',
    });
  }
  if (!isPlainJsonValue(source?.worldState)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'source.worldState must be a plain-JSON value',
    });
  }
  if (!Array.isArray(source?.files) || !Array.isArray(source?.toolAvailability)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'source.files and source.toolAvailability must be arrays',
    });
  }
  if (
    source?.policy === undefined ||
    !['public', 'internal', 'confidential'].includes(String(source.policy?.privacyClassification)) ||
    !['forbid', 'redact', 'allow'].includes(String(source.policy?.pii)) ||
    !['standard', 'strict'].includes(String(source.policy?.sanitization))
  ) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: `source.policy is invalid: ${JSON.stringify(source?.policy)}`,
    });
  }

  const createdAt = toExpertSessionTimestamp(input.now);
  const expiresAt = toExpertSessionTimestamp(input.expiresAt);
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: `capsule expiresAt ${expiresAt} must be after createdAt ${createdAt} (time-bounded)`,
    });
  }
  // The barrier's time-limited access material may not outlive the capsule.
  if (barrier.credentials.timeLimited && barrier.credentials.expiresAt !== null) {
    if (Date.parse(barrier.credentials.expiresAt) > Date.parse(expiresAt)) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
        message: 'barrier credentials expiry must not outlive the capsule expiry',
      });
    }
  }

  const sessionId =
    input.sessionId === undefined ? newExpertSessionId() : toExpertSessionId(input.sessionId);

  // Derivation applies the barrier: screen world state, drop redacted
  // documents, remove excluded tools.
  const screenedWorldState = screenObservation(barrier, source.worldState);
  const redactedDocuments = new Set(barrier.redactedDocuments);
  const resources: CapsuleResource[] = [];
  for (const file of source.files) {
    if (typeof file?.path !== 'string' || file.path.length === 0) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
        message: `source.files entry is invalid: ${JSON.stringify(file)}`,
      });
    }
    if (redactedDocuments.has(file.path)) continue;
    resources.push({ ref: file.path, readOnly: file.readOnly === true });
  }
  const tools = [...new Set(validateRefList(source.toolAvailability, 'source.toolAvailability'))].filter(
    (tool) => !barrier.excludedTools.includes(tool),
  );

  const view: Omit<ExpertSessionCapsule, 'digest'> = {
    capsuleVersion: EXPERT_SESSION_CAPSULE_VERSION,
    sessionId,
    escalationRef: {
      requestId: toEscalationIdRef(input.escalationRef.requestId),
      tenantId: toTenantId(input.escalationRef.tenantId),
    },
    sessionMode: input.sessionMode,
    allowedModes: Object.freeze([...input.allowedModes]),
    barrier,
    worldState: screenedWorldState,
    resources: Object.freeze(resources),
    tools: Object.freeze(tools),
    derivedFrom: Object.freeze({
      taskRef: source.taskRef,
      environmentDigest: source.environmentDigest ?? null,
      relevantHistory: Object.freeze(validateRefList(source.relevantHistory ?? [], 'source.relevantHistory')),
      sourcePolicy: Object.freeze({ ...source.policy }),
      redactedDocumentCount: source.files.length - resources.length,
      excludedToolCount: source.toolAvailability.length - tools.length,
    }),
    createdAt,
    expiresAt,
    authority: CAPSULE_AUTHORITY,
  };

  const digest = await digestCanonical(digestFreeView(view));
  const capsule: ExpertSessionCapsule = Object.freeze({ ...view, digest });
  deepFreeze(capsule as unknown as PlainJsonValue);
  return capsule;
}

/** Is the capsule still within its time bound at the given instant? */
export function isCapsuleWithinTimeBound(capsule: ExpertSessionCapsule, now: number | string | Date): boolean {
  const at = toExpertSessionTimestamp(now);
  return Date.parse(at) < Date.parse(capsule.expiresAt);
}

/** Structural guard for wire values claiming to be capsules. */
export function isExpertSessionCapsule(value: unknown): value is ExpertSessionCapsule {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['capsuleVersion'] === EXPERT_SESSION_CAPSULE_VERSION &&
    isExpertSessionId(candidate['sessionId']) &&
    isEscalationIdRef((candidate['escalationRef'] as Record<string, unknown> | undefined)?.['requestId']) &&
    isTenantId((candidate['escalationRef'] as Record<string, unknown> | undefined)?.['tenantId']) &&
    isExpertSessionMode(candidate['sessionMode']) &&
    Array.isArray(candidate['allowedModes']) &&
    typeof candidate['createdAt'] === 'string' &&
    typeof candidate['expiresAt'] === 'string' &&
    candidate['authority'] === CAPSULE_AUTHORITY &&
    typeof candidate['digest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['digest'])
  );
}
