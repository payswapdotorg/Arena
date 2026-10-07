/**
 * Privacy barrier (Work Order C006; spec expert-environment-session.md
 * EES1.0 "Privacy barrier" — architecture-lock rules 28, 29).
 *
 * The host application declares what is visible. The EES1.0 control set
 * is modelled as ONE composable barrier record:
 *
 *   - field-level redaction;
 *   - document-level redaction;
 *   - secret/tool exclusion;
 *   - tenant boundary;
 *   - customer identity masking;
 *   - time-limited credentials;
 *   - read-only resources;
 *   - action allowlist;
 *   - download restrictions;
 *   - clipboard restrictions (where supported);
 *   - screenshot restrictions (where supported).
 *
 * Composition is FAIL-CLOSED: export restrictions default ON and the
 * action allowlist is mandatory (an empty allowlist admits nothing).
 *
 * THE ESCAPE LAW (EES1.0): the expert CANNOT escape the bounded session
 * into the application's live environment. Every resource/tool/export
 * check returns a machine-readable verdict; assertNoEscape throws the
 * typed ESCAPE_ATTEMPT failure when an expert action reaches for
 * live-world or cross-tenant resources or tools outside the capsule.
 */

import { EXPERT_SESSION_ERROR_CODES, ExpertSessionError } from './errors.js';
import type { ExpertSessionTimestamp, PlainJsonValue } from './shared.js';
import { deepFreeze, isExpertSessionTimestamp, toExpertSessionTimestamp } from './shared.js';

// ---------------------------------------------------------------------------
// The EES1.0 control set
// ---------------------------------------------------------------------------

export const PRIVACY_CONTROL_KINDS = Object.freeze([
  'field-redaction',
  'document-redaction',
  'tool-exclusion',
  'tenant-boundary',
  'identity-masking',
  'time-limited-credentials',
  'read-only-resources',
  'action-allowlist',
  'download-restriction',
  'clipboard-restriction',
  'screenshot-restriction',
] as const);
export type PrivacyControlKind = (typeof PRIVACY_CONTROL_KINDS)[number];

/** Export channels EES1.0 allows hosts to restrict. */
export const EXPORT_CHANNELS = Object.freeze(['download', 'clipboard', 'screenshot'] as const);
export type ExportChannel = (typeof EXPORT_CHANNELS)[number];

export function isExportChannel(value: unknown): value is ExportChannel {
  return typeof value === 'string' && (EXPORT_CHANNELS as readonly string[]).includes(value);
}

/**
 * The composable privacy barrier. Every field is an EES1.0 control;
 * `restrictions` values are true = RESTRICTED (fail-closed defaults).
 */
export interface PrivacyBarrier {
  readonly barrierVersion: 1;
  /** Field-level redaction: keys removed from every screened observation. */
  readonly redactedFields: readonly string[];
  /** Document-level redaction: resource refs replaced in screened output. */
  readonly redactedDocuments: readonly string[];
  /** Secret/tool exclusion: tools the expert may never invoke. */
  readonly excludedTools: readonly string[];
  /** Tenant boundary: the capsule is invisible to every other tenant. */
  readonly tenantBoundary: { readonly tenantId: string };
  /** Customer identity masking: identity-shaped fields are masked. */
  readonly identityMasking: boolean;
  /** Time-limited credentials: capsule access material expiry. */
  readonly credentials: {
    readonly timeLimited: boolean;
    readonly expiresAt: ExpertSessionTimestamp | null;
  };
  /** Read-only resources: refs the expert may read but never write. */
  readonly readOnlyResources: readonly string[];
  /** Action allowlist: the ONLY session actions admitted (non-empty). */
  readonly actionAllowlist: readonly string[];
  /** Channel restrictions (true = restricted). */
  readonly restrictions: {
    readonly download: boolean;
    readonly clipboard: boolean;
    readonly screenshot: boolean;
  };
}

export interface ComposePrivacyBarrierInput {
  readonly redactedFields?: readonly string[];
  readonly redactedDocuments?: readonly string[];
  readonly excludedTools?: readonly string[];
  readonly tenantId: string;
  readonly identityMasking?: boolean;
  readonly timeLimitedCredentials?: boolean;
  readonly credentialsExpiresAt?: number | string | Date;
  readonly readOnlyResources?: readonly string[];
  readonly actionAllowlist: readonly string[];
  readonly restrictions?: { readonly download?: boolean; readonly clipboard?: boolean; readonly screenshot?: boolean };
}

function validateRefList(values: readonly string[] | undefined, field: string): readonly string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: `${field} must be an array of resource refs`,
    });
  }
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
        message: `${field} entries must be non-empty strings (<= 512 chars): ${JSON.stringify(value)}`,
      });
    }
  }
  return Object.freeze([...values]);
}

/**
 * Compose an EES1.0 privacy barrier. FAIL-CLOSED defaults:
 *   - download/clipboard/screenshot restrictions default ON;
 *   - identity masking defaults ON;
 *   - the action allowlist is REQUIRED and non-empty (an empty allowlist
 *     admits nothing — the expert can do no session action);
 *   - time-limited credentials default to time-limited with the supplied
 *     expiry (a time-limited barrier without an expiry is rejected).
 */
export function composePrivacyBarrier(input: ComposePrivacyBarrierInput): PrivacyBarrier {
  if (typeof input !== 'object' || input === null) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'privacy barrier input must be an object',
    });
  }
  if (typeof input.tenantId !== 'string' || input.tenantId.length === 0) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'privacy barrier requires a tenantBoundary tenantId',
    });
  }
  const allowlist = validateRefList(input.actionAllowlist, 'actionAllowlist');
  if (allowlist.length === 0) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'privacy barrier actionAllowlist must be non-empty (fail-closed: an empty allowlist admits nothing)',
    });
  }

  const timeLimited = input.timeLimitedCredentials ?? true;
  let credentialsExpiresAt: ExpertSessionTimestamp | null = null;
  if (input.credentialsExpiresAt !== undefined) {
    credentialsExpiresAt = toExpertSessionTimestamp(input.credentialsExpiresAt);
  }
  if (timeLimited && credentialsExpiresAt === null) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'time-limited credentials require a credentialsExpiresAt',
    });
  }

  const barrier: PrivacyBarrier = Object.freeze({
    barrierVersion: 1,
    redactedFields: validateRefList(input.redactedFields, 'redactedFields'),
    redactedDocuments: validateRefList(input.redactedDocuments, 'redactedDocuments'),
    excludedTools: validateRefList(input.excludedTools, 'excludedTools'),
    tenantBoundary: Object.freeze({ tenantId: input.tenantId }),
    identityMasking: input.identityMasking ?? true,
    credentials: Object.freeze({ timeLimited, expiresAt: credentialsExpiresAt }),
    readOnlyResources: validateRefList(input.readOnlyResources, 'readOnlyResources'),
    actionAllowlist: allowlist,
    restrictions: Object.freeze({
      download: input.restrictions?.download ?? true,
      clipboard: input.restrictions?.clipboard ?? true,
      screenshot: input.restrictions?.screenshot ?? true,
    }),
  });
  return barrier;
}

// ---------------------------------------------------------------------------
// Observation screening (redaction / masking — the visible side)
// ---------------------------------------------------------------------------

/** Identity-shaped field names masked when identityMasking is on. */
export const IDENTITY_FIELD_NAMES = Object.freeze([
  'customerName',
  'customerEmail',
  'customerPhone',
  'customerRef',
  'userIdentity',
] as const);

const REDACTED_PLACEHOLDER = '[REDACTED]';
const MASKED_PLACEHOLDER = 'masked-identity';

function isPlainRecord(value: PlainJsonValue): value is { readonly [key: string]: PlainJsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function screenValue(barrier: PrivacyBarrier, value: PlainJsonValue): PlainJsonValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => screenValue(barrier, entry)));
  }
  if (isPlainRecord(value)) {
    const out: Record<string, PlainJsonValue> = {};
    for (const key of Object.keys(value)) {
      const entry = (value as Record<string, PlainJsonValue>)[key] ?? null;
      if (barrier.redactedFields.includes(key)) {
        out[key] = REDACTED_PLACEHOLDER;
        continue;
      }
      if (
        barrier.identityMasking &&
        (IDENTITY_FIELD_NAMES as readonly string[]).includes(key) &&
        typeof entry === 'string'
      ) {
        out[key] = MASKED_PLACEHOLDER;
        continue;
      }
      if (typeof entry === 'string' && barrier.redactedDocuments.includes(entry)) {
        out[key] = REDACTED_PLACEHOLDER;
        continue;
      }
      out[key] = screenValue(barrier, entry);
    }
    return Object.freeze(out);
  }
  if (typeof value === 'string' && barrier.redactedDocuments.includes(value)) {
    return REDACTED_PLACEHOLDER;
  }
  return value;
}

/**
 * Screen one observation through the barrier: redacted fields are
 * replaced, redacted documents are replaced wherever their ref appears,
 * identity-shaped fields are masked. The INPUT is never mutated.
 */
export function screenObservation(barrier: PrivacyBarrier, observation: PlainJsonValue): PlainJsonValue {
  return deepFreeze(screenValue(barrier, observation));
}

// ---------------------------------------------------------------------------
// Escape detection (the expert CANNOT reach the live environment)
// ---------------------------------------------------------------------------

/** One bounded resource inside a capsule. */
export interface CapsuleResource {
  /** Resource reference (path/uri/artifact ref — capsule-bounded). */
  readonly ref: string;
  /** True when the resource is read-only for the expert. */
  readonly readOnly: boolean;
}

export const ACCESS_REASONS = Object.freeze([
  'access_ok',
  'resource_outside_capsule',
  'cross_tenant_resource',
  'resource_read_only',
  'tool_not_in_capsule',
  'tool_excluded',
  'export_restricted',
  'action_not_allowlisted',
  'credentials_expired',
] as const);
export type AccessReason = (typeof ACCESS_REASONS)[number];

export interface AccessCheck {
  readonly allowed: boolean;
  readonly reason: AccessReason;
}

const OK: AccessCheck = Object.freeze({ allowed: true, reason: 'access_ok' });

function denied(reason: AccessReason): AccessCheck {
  return { allowed: false, reason };
}

/** Live-world refs can never appear inside a capsule resource set. */
export const LIVE_WORLD_PREFIXES = Object.freeze(['live:', 'prod:', 'ws://live.', 'https://live.'] as const);

function isLiveWorldRef(ref: string): boolean {
  return LIVE_WORLD_PREFIXES.some((prefix) => ref.startsWith(prefix));
}

/**
 * Check a resource access attempt against the capsule scope and the
 * tenant boundary. A resource that is not one of the capsule's bounded
 * resources — or that reaches into the host application's live world —
 * is an ESCAPE ATTEMPT (fail-closed).
 */
export function checkResourceAccess(
  barrier: PrivacyBarrier,
  scope: { readonly resources: readonly CapsuleResource[]; readonly tenantId: string },
  attempt: { readonly resourceRef: string; readonly mode: 'read' | 'write' },
): AccessCheck {
  if (typeof attempt.resourceRef !== 'string' || attempt.resourceRef.length === 0) {
    return denied('resource_outside_capsule');
  }
  if (isLiveWorldRef(attempt.resourceRef)) {
    return denied('resource_outside_capsule');
  }
  const resource = scope.resources.find((entry) => entry.ref === attempt.resourceRef);
  if (resource === undefined) {
    return denied('resource_outside_capsule');
  }
  if (scope.tenantId !== barrier.tenantBoundary.tenantId) {
    return denied('cross_tenant_resource');
  }
  if (attempt.mode === 'write' && (resource.readOnly || barrier.readOnlyResources.includes(attempt.resourceRef))) {
    return denied('resource_read_only');
  }
  return OK;
}

/**
 * Check a tool invocation attempt. Tools outside the capsule's declared
 * availability are escape attempts; tools excluded by the privacy
 * barrier are privacy violations.
 */
export function checkToolUse(
  barrier: PrivacyBarrier,
  availableTools: readonly string[],
  toolName: string,
): AccessCheck {
  if (typeof toolName !== 'string' || toolName.length === 0) {
    return denied('tool_not_in_capsule');
  }
  if (!availableTools.includes(toolName)) {
    return denied('tool_not_in_capsule');
  }
  if (barrier.excludedTools.includes(toolName)) {
    return denied('tool_excluded');
  }
  return OK;
}

/** Check an export-channel attempt (download/clipboard/screenshot). */
export function checkExportAction(barrier: PrivacyBarrier, channel: ExportChannel): AccessCheck {
  if (barrier.restrictions[channel]) {
    return denied('export_restricted');
  }
  return OK;
}

/** Check a session action against the barrier's action allowlist. */
export function checkActionAllowlisted(barrier: PrivacyBarrier, action: string): AccessCheck {
  if (!barrier.actionAllowlist.includes(action)) {
    return denied('action_not_allowlisted');
  }
  return OK;
}

/** Check capsule access material freshness (time-limited credentials). */
export function checkCredentials(barrier: PrivacyBarrier, now: number | string | Date): AccessCheck {
  if (barrier.credentials.timeLimited && barrier.credentials.expiresAt !== null) {
    const at = toExpertSessionTimestamp(now);
    if (Date.parse(at) >= Date.parse(barrier.credentials.expiresAt)) {
      return denied('credentials_expired');
    }
  }
  return OK;
}

/**
 * THE ESCAPE LAW, enforced: any denied access verdict throws the typed
 * failure. Outside-capsule / cross-tenant / unknown-tool reach is an
 * ESCAPE_ATTEMPT; barrier control violations (read-only writes, excluded
 * tools, restricted exports, unallowlisted actions, expired capsule
 * access material) are PRIVACY_VIOLATION. Both fail closed.
 */
export function assertNoEscape(check: AccessCheck): void {
  if (check.allowed) return;
  const details: Record<string, unknown> = { reason: check.reason };
  if (check.reason === 'resource_outside_capsule' || check.reason === 'cross_tenant_resource' || check.reason === 'tool_not_in_capsule') {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.ESCAPE_ATTEMPT, {
      message: `expert session escape attempt denied (${check.reason}): the capsule is bounded and non-authoritative for the host application's live world`,
      details,
    });
  }
  throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.PRIVACY_VIOLATION, {
    message: `privacy barrier violation denied (${check.reason})`,
    details,
  });
}

/** Structural guard for wire values claiming to be privacy barriers. */
export function isPrivacyBarrier(value: unknown): value is PrivacyBarrier {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['barrierVersion'] === 1 &&
    Array.isArray(candidate['redactedFields']) &&
    Array.isArray(candidate['redactedDocuments']) &&
    Array.isArray(candidate['excludedTools']) &&
    typeof candidate['tenantBoundary'] === 'object' &&
    candidate['tenantBoundary'] !== null &&
    typeof (candidate['tenantBoundary'] as Record<string, unknown>)['tenantId'] === 'string' &&
    typeof candidate['identityMasking'] === 'boolean' &&
    typeof candidate['credentials'] === 'object' &&
    candidate['credentials'] !== null &&
    Array.isArray(candidate['readOnlyResources']) &&
    Array.isArray(candidate['actionAllowlist']) &&
    (candidate['actionAllowlist'] as readonly unknown[]).length > 0 &&
    typeof candidate['restrictions'] === 'object' &&
    candidate['restrictions'] !== null &&
    (candidate['credentials'] as Record<string, unknown>)['expiresAt'] !== null
      ? isExpertSessionTimestamp((candidate['credentials'] as Record<string, unknown>)['expiresAt'])
      : true
  );
}
