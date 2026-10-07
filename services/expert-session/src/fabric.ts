/**
 * In-memory reference fabric for the expert-session service (Work Order
 * C006) — the services-layer house pattern (A013/A015/A025/C001):
 * injected ports with an in-process, zero-external-dependency reference
 * implementation. Hosts swap the fabric for real persistence
 * (adapters/*, never here).
 *
 *   - InMemorySessionStore — tenant-scoped session records with a
 *     one-session-per-escalation binding index;
 *   - InMemoryEscalationSessionPort — the C001 seam over plain
 *     @arena/escalation records (pure delegation; the C001 domain owns
 *     every transition this service applies);
 *   - DefaultCapsuleMaterializer — a REFERENCE (clearly labelled)
 *     materializer that derives the EES1.0 privacy barrier from the
 *     escalation's declared policy fields. The A009/A010-aware
 *     materializer lives in adapters/expert-environment.
 */

import type { EscalationRecord } from '@arena/escalation';
import {
  composePrivacyBarrier,
  deriveExpertSessionCapsule,
} from '@arena/expert-session';
import type {
  ExpertSessionCapsule,
  ExpertSessionRecord,
  PrivacyBarrier,
} from '@arena/expert-session';
import type {
  CapsuleMaterializationCommand,
  CapsuleMaterializer,
  EscalationSessionPort,
  SessionStore,
} from './ports.js';

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------

export class InMemorySessionStore implements SessionStore {
  private readonly bySessionId = new Map<string, ExpertSessionRecord>();
  private readonly byEscalation = new Map<string, string>();

  async insert(record: ExpertSessionRecord): Promise<void> {
    const sessionId = record.capsule.sessionId;
    if (this.bySessionId.has(sessionId)) {
      throw new Error(`duplicate expert session id: ${sessionId}`);
    }
    const escalationKey = `${record.capsule.escalationRef.tenantId}:${record.capsule.escalationRef.requestId}`;
    if (this.byEscalation.has(escalationKey)) {
      throw new Error(`escalation already has a bound expert session: ${escalationKey}`);
    }
    this.bySessionId.set(sessionId, record);
    this.byEscalation.set(escalationKey, sessionId);
  }

  async update(record: ExpertSessionRecord): Promise<void> {
    const sessionId = record.capsule.sessionId;
    if (!this.bySessionId.has(sessionId)) {
      throw new Error(`unknown expert session id: ${sessionId}`);
    }
    this.bySessionId.set(sessionId, record);
  }

  async get(sessionId: string, tenantId: string): Promise<ExpertSessionRecord | undefined> {
    // TENANT SCOPING: a session is only visible to its owning tenant.
    const record = this.bySessionId.get(sessionId);
    if (record === undefined || record.capsule.escalationRef.tenantId !== tenantId) {
      return undefined;
    }
    return record;
  }

  async list(): Promise<readonly ExpertSessionRecord[]> {
    return [...this.bySessionId.values()];
  }
}

// ---------------------------------------------------------------------------
// C001 escalation seam
// ---------------------------------------------------------------------------

export class InMemoryEscalationSessionPort implements EscalationSessionPort {
  private readonly byRequestId = new Map<string, EscalationRecord>();

  async seed(record: EscalationRecord): Promise<void> {
    this.byRequestId.set(record.request.requestId, record);
  }

  async get(requestId: string, tenantId: string): Promise<EscalationRecord | undefined> {
    const record = this.byRequestId.get(requestId);
    if (record === undefined || record.request.tenantId !== tenantId) return undefined;
    return record;
  }

  async findById(requestId: string): Promise<EscalationRecord | undefined> {
    return this.byRequestId.get(requestId);
  }

  async update(record: EscalationRecord): Promise<void> {
    if (!this.byRequestId.has(record.request.requestId)) {
      throw new Error(`unknown escalation request id: ${record.request.requestId}`);
    }
    this.byRequestId.set(record.request.requestId, record);
  }
}

// ---------------------------------------------------------------------------
// Reference capsule materializer
// ---------------------------------------------------------------------------

/**
 * DEFAULT (REFERENCE) capsule materializer — derives the EES1.0 privacy
 * barrier from the escalation's declared policy fields and delegates to
 * the pure domain derivation. The A009/A010-aware materializer
 * (environment-protocol secret/network/filesystem policies) lives in
 * adapters/expert-environment; hosts wire that one in production.
 *
 * Barrier derivation from the EscalationRequest's declared fields:
 *   - actionAllowlist — the request's permittedActions mapped onto
 *     session actions, plus the session-completion actions that are
 *     inherent to the EES1.0 flow (submit-result, capture-checkpoint);
 *   - identityMasking + PII field redaction — from privacyPolicy.pii;
 *   - export restrictions ON, time-limited credentials bounded by the
 *     escalation deadline (fail-closed defaults);
 *   - readOnlyResources — the source's read-only files.
 */

/** C001 permitted actions mapped onto expert-session actions. */
export const PERMITTED_ACTION_TO_SESSION_ACTION: Readonly<Record<string, string>> = Object.freeze({
  'read-context': 'observe-state',
  'run-approved-tools': 'invoke-tool',
  'propose-patch': 'edit-artifact',
  'annotate-evidence': 'annotate',
  'ask-clarification': 'supply-information',
  'signal-tool-gap': 'signal-tool-gap',
});

/** Session actions inherent to the EES1.0 session flow (not host-granted). */
export const INHERENT_SESSION_ACTIONS = Object.freeze(['submit-result', 'capture-checkpoint'] as const);

/** Default PII-shaped fields redacted unless privacyPolicy.pii === 'allow'. */
export const DEFAULT_PII_FIELDS = Object.freeze([
  'customerEmail',
  'customerPhone',
  'accountNumber',
] as const);

export class DefaultCapsuleMaterializer implements CapsuleMaterializer {
  async materialize(command: CapsuleMaterializationCommand): Promise<ExpertSessionCapsule> {
    const policy = command.escalationPolicy;
    const allowlist = [
      ...command.escalationPolicy.permittedActions
        .map((action) => PERMITTED_ACTION_TO_SESSION_ACTION[action])
        .filter((action) => action !== undefined),
      ...INHERENT_SESSION_ACTIONS,
    ];
    if (allowlist.length === INHERENT_SESSION_ACTIONS.length) {
      // Fail-closed: a request permitting NO expert action still needs
      // the observation floor to have any session at all.
      allowlist.push('observe-state');
    }
    const redactedFields = policy.pii === 'allow' ? [] : [...DEFAULT_PII_FIELDS];
    const credentialsExpiry =
      Date.parse(policy.deadline) < Date.parse(String(command.expiresAt))
        ? policy.deadline
        : String(command.expiresAt);
    const barrierInput = {
      tenantId: command.escalationRef.tenantId,
      actionAllowlist: allowlist,
      redactedFields,
      redactedDocuments: [] as string[],
      excludedTools: [] as string[],
      identityMasking: policy.pii !== 'allow',
      timeLimitedCredentials: true,
      credentialsExpiresAt: credentialsExpiry,
      readOnlyResources: command.source.files
        .filter((file) => file.readOnly === true)
        .map((file) => file.path),
      restrictions: { download: true, clipboard: true, screenshot: true },
    };
    const barrier: PrivacyBarrier = composePrivacyBarrier(barrierInput);
    return deriveExpertSessionCapsule({
      escalationRef: command.escalationRef,
      sessionMode: command.sessionMode,
      allowedModes: command.allowedModes,
      barrier,
      source: command.source,
      now: command.now,
      expiresAt: command.expiresAt,
      ...(command.sessionId !== undefined ? { sessionId: command.sessionId } : {}),
    });
  }
}
