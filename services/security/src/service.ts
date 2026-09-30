/**
 * SecurityService — the envelope-wired reference security service
 * facade (Work Order A034; architecture-lock rules 17, 18, 22; mirrors
 * the sibling reference services' envelope wiring).
 *
 * Pure reference fabric: injected dependencies (the policy registry and
 * the audit log are constructor-injected), fail-closed error
 * normalization, NO network/HTTP layer (the A034 reference slice, like
 * the A013/A023 fabrics).
 *
 * Wire round trips:
 *
 *   register-policy-bundle-command (envelope, REQUIRED idempotency key)
 *     → registry.registerBundle (validate + content-address + conflict)
 *     → audit 'policy-registered' append (tamper-evident chain)
 *     → policy-bundle-registered-event (envelope).
 *
 *   evaluate-authorization-command (envelope, REQUIRED idempotency key)
 *     → AuthorizationEngine.evaluate (fail-closed, closed reasons)
 *     → tenancy check against the resource (audit BOTH outcomes)
 *     → audit 'authorization-decision' / 'tenant-access-denied' append
 *     → authorization-decided-event (envelope carrying the decision AND
 *       the sealed audit record).
 *
 *   authorize-learning-command (envelope, REQUIRED idempotency key)
 *     → authorizeCrossTenantLearning (explicit-consent gate)
 *     → audit 'learning-authorization' append
 *     → learning-authorization-decided-event.
 *
 * Every command's evaluation is BOTH decided and AUDITED — a denial is
 * returned as a decision, recorded in the append-only audit trail, and
 * the event still carries it (the caller learns "no" from the wire, and
 * the auditor learns why from the chain).
 */

import {
  AuthorizationEngine,
  authorizeCrossTenantLearning,
  isAuthorizationAction,
  checkTenantBoundary,
  makeAuthorizationDecidedEvent,
  makeAuthorizeLearningCommand,
  makeEvaluateAuthorizationCommand,
  makePolicyBundleRegisteredEvent,
  makeRegisterPolicyBundleCommand,
  normalizeToSecurityError,
  SECURITY_ERROR_CODES,
  SecurityAuditLog,
  SecurityError,
  toLearningAuthorizationGrant,
  toDataRightsRecord,
  toSecurityAuditEvent,
  toSecurityPrincipal,
  toTenantId,
  toTenantScopedRef,
} from '@arena/security';
import type {
  AuthorizationAction,
  AuthorizationDecision,
  SecurityTimestamp,
  LearningAuthorizationGrant,
  PolicyBundle,
  SecurityAuditRecord,
  SecurityPrincipal,
  TenantScopedRef,
} from '@arena/security';
import { serializeEnvelope, toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import { SecurityPolicyRegistry } from './registry.js';

/** Service configuration (all injected; defaults are fresh instances). */
export interface SecurityServiceConfig {
  readonly registry?: SecurityPolicyRegistry;
  readonly auditLog?: SecurityAuditLog;
  /** The default policy bundle identity used by evaluate(). */
  readonly defaultBundle?: { readonly bundleId: string; readonly version: string } | null;
}

/** The result of one handled register-policy-bundle-command. */
export interface RegisterPolicyBundleOutcome {
  readonly command: Envelope<unknown>;
  readonly event: Envelope<unknown>;
  readonly serializedEvent: string;
  readonly bundle: PolicyBundle;
  readonly auditRecord: SecurityAuditRecord;
}

/** The result of one handled evaluate-authorization-command. */
export interface EvaluateAuthorizationOutcome {
  readonly command: Envelope<unknown>;
  readonly event: Envelope<unknown>;
  readonly serializedEvent: string;
  readonly decision: AuthorizationDecision;
  readonly auditRecord: SecurityAuditRecord;
}

/** The result of one handled authorize-learning-command. */
export interface AuthorizeLearningOutcome {
  readonly command: Envelope<unknown>;
  readonly event: Envelope<unknown>;
  readonly serializedEvent: string;
  readonly decision: ReturnType<typeof authorizeCrossTenantLearning>;
  readonly auditRecord: SecurityAuditRecord;
}

/**
 * The envelope-wired security service. Construct with
 * `new SecurityService()` or inject a pre-populated registry / audit log.
 */
export class SecurityService {
  readonly registry: SecurityPolicyRegistry;
  readonly auditLog: SecurityAuditLog;
  readonly defaultBundle: { readonly bundleId: string; readonly version: string } | null;

  constructor(config: SecurityServiceConfig = {}) {
    this.registry = config.registry ?? new SecurityPolicyRegistry();
    this.auditLog = config.auditLog ?? new SecurityAuditLog();
    this.defaultBundle = config.defaultBundle ?? null;
  }

  // -------------------------------------------------------------------------
  // Command handling (fail-closed, envelope-wired)
  // -------------------------------------------------------------------------

  /**
   * Handle one register-policy-bundle-command wire message: strict-parse
   * the envelope (REQUIRED idempotency key; security-namespace schema),
   * register the bundle in the registry, append a 'policy-registered'
   * audit event and return the policy-bundle-registered-event.
   */
  async handleRegisterPolicyBundleCommand(
    raw: string,
  ): Promise<RegisterPolicyBundleOutcome> {
    let command;
    try {
      command = parseRegisterCommand(raw);
    } catch (error) {
      throw normalizeToSecurityError(error);
    }
    try {
      const bundle = await this.registry.registerBundle(command.payload.bundle);
      const auditRecord = await this.auditLog.append(
        toSecurityAuditEvent({
          recordVersion: 1,
          eventId: newEventId(),
          kind: 'policy-registered',
          tenantId: null,
          principalId: null,
          action: null,
          boundaryClass: null,
          outcome: {
            effect: 'recorded',
            reason: `bundle-${String(bundle.bundleId)}-digest-${bundle.digest.slice(0, 12)}`,
          },
          correlationId: command.correlationId,
          causationId: command.id,
          occurredAt: newOccurredAt(),
        }),
      );
      const event = makePolicyBundleRegisteredEvent(
        {
          bundleId: bundle.bundleId,
          version: bundle.version,
          digest: bundle.digest,
          statementCount: bundle.statements.length,
        },
        command.correlationId,
      );
      return {
        command,
        event,
        serializedEvent: serializeEnvelope(event),
        bundle,
        auditRecord,
      };
    } catch (error) {
      throw normalizeToSecurityError(error, command.correlationId);
    }
  }

  /**
   * Handle one evaluate-authorization-command wire message: strict-parse
   * the envelope, evaluate the authorization against the addressed (or
   * default) policy bundle, audit the decision AND the tenancy outcome,
   * and return the authorization-decided-event.
   *
   * A DENIAL is a normal outcome (the decision + audit records travel on
   * the event); failures to parse or resolve the policy bundle throw
   * typed SecurityErrors — fail closed.
   */
  async handleEvaluateAuthorizationCommand(
    raw: string,
    options: { bundleId?: string; version?: string } = {},
  ): Promise<EvaluateAuthorizationOutcome> {
    let command;
    try {
      command = parseEvaluateCommand(raw);
    } catch (error) {
      throw normalizeToSecurityError(error);
    }
    const payload = command.payload;
    try {
      const principal = toSecurityPrincipal(payload.principal);
      const resource = toTenantScopedRef(payload.resource);
      const bundleAddress =
        options.bundleId !== undefined && options.version !== undefined
          ? { bundleId: options.bundleId, version: options.version }
          : this.defaultBundle;
      if (bundleAddress === null) {
        throw new SecurityError(SECURITY_ERROR_CODES.NOT_FOUND, {
          message:
            'no policy bundle addressed: pass {bundleId, version} or configure defaultBundle (fail closed — no ambient policy)',
          correlationId: command.correlationId,
        });
      }
      const bundle = this.registry.byIdentity(bundleAddress.bundleId, bundleAddress.version);
      const engine = new AuthorizationEngine(bundle);
      // The envelope parser already validated the action against the
      // closed vocabulary; the cast is the validated view of it.
      if (!isAuthorizationAction(payload.action)) {
        throw new SecurityError(SECURITY_ERROR_CODES.INVALID_ACTION, {
          message: `evaluate-authorization-command action is not in the closed vocabulary: ${payload.action}`,
          correlationId: command.correlationId,
        });
      }
      const policyDecision = engine.evaluate({
        principal,
        action: payload.action,
        resource,
        evaluatedAt: payload.evaluatedAt as SecurityTimestamp,
      });

      // TENANCY IS A HARD BOUNDARY: the tenancy check OVERRIDES any
      // policy ALLOW — an allow statement in the principal's tenant can
      // never authorize access to another tenant's resource (the
      // effective decision fails closed to deny/tenant-mismatch). A
      // policy DENY keeps its own, more specific closed reason (the
      // tenancy boundary must never MASK why the policy itself said no).
      const tenancy = checkTenantBoundary(principal.tenantScope, resource);
      const decision: AuthorizationDecision =
        tenancy.allowed || policyDecision.effect === 'deny'
          ? policyDecision
          : {
              ...policyDecision,
              effect: 'deny',
              reason: 'tenant-mismatch',
              policyStatementId: null,
            };

      const auditRecord = await this.auditLog.append(
        toSecurityAuditEvent({
          recordVersion: 1,
          eventId: newEventId(),
          kind:
            tenancy.allowed && decision.effect === 'allow'
              ? 'tenant-access-allowed'
              : tenancy.allowed
                ? 'authorization-decision'
                : 'tenant-access-denied',
          tenantId: resource.tenantId,
          principalId: principal.principalId,
          action: decision.action,
          boundaryClass: resource.boundaryClass,
          outcome: { effect: decision.effect, reason: decision.reason },
          correlationId: command.correlationId,
          causationId: command.id,
          occurredAt: payload.evaluatedAt,
        }),
      );

      const event = makeAuthorizationDecidedEvent(
        { decision, auditRecord },
        command.correlationId,
      );
      return {
        command,
        event,
        serializedEvent: serializeEnvelope(event),
        decision,
        auditRecord,
      };
    } catch (error) {
      throw normalizeToSecurityError(error, command.correlationId);
    }
  }

  /**
   * Handle one authorize-learning-command wire message: strict-parse the
   * envelope, run the explicit-consent cross-tenant learning gate, audit
   * the decision, and return the learning-authorization-decided-event.
   */
  async handleAuthorizeLearningCommand(raw: string): Promise<AuthorizeLearningOutcome> {
    let command;
    try {
      command = parseLearningCommand(raw);
    } catch (error) {
      throw normalizeToSecurityError(error);
    }
    const payload = command.payload;
    try {
      const consumerTenant = toTenantId(payload.consumerTenant, 'consumerTenant');
      const datasets = payload.datasets.map((dataset) => toTenantScopedRef(dataset));
      const grants: LearningAuthorizationGrant[] = [];
      for (const grant of payload.grants) {
        if (grant !== null && grant !== undefined) {
          grants.push(toLearningAuthorizationGrant(grant));
        }
      }
      const dataRights: Record<string, ReturnType<typeof toDataRightsRecord>> = {};
      for (const [recordId, rights] of Object.entries(payload.dataRights)) {
        dataRights[recordId] = toDataRightsRecord(rights);
      }
      const decision = authorizeCrossTenantLearning(
        { consumerTenant, datasets, dataRights },
        grants,
        payload.asOf,
      );
      const auditRecord = await this.auditLog.append(
        toSecurityAuditEvent({
          recordVersion: 1,
          eventId: newEventId(),
          kind: 'learning-authorization',
          tenantId: consumerTenant,
          principalId: null,
          action: 'use-for-learning',
          boundaryClass: 'dataset',
          outcome: { effect: decision.allowed ? 'allow' : 'deny', reason: decision.reason },
          correlationId: command.correlationId,
          causationId: command.id,
          occurredAt: payload.asOf,
        }),
      );
      const event = makeLearningDecidedEvent({ decision, auditRecord }, command.correlationId);
      return {
        command,
        event,
        serializedEvent: serializeEnvelope(event),
        decision,
        auditRecord,
      };
    } catch (error) {
      throw normalizeToSecurityError(error, command.correlationId);
    }
  }

  // -------------------------------------------------------------------------
  // Client-side command builders + queries
  // -------------------------------------------------------------------------

  /** Build (but do not handle) an evaluate-authorization-command. */
  makeEvaluateCommand(
    principal: SecurityPrincipal,
    action: string,
    resource: TenantScopedRef,
    evaluatedAt: string,
    correlationId: string,
    idempotencyKey: string,
  ): Envelope<unknown> {
    return makeEvaluateAuthorizationCommand(
      {
        principal,
        action: action as AuthorizationAction,
        resource,
        evaluatedAt: evaluatedAt as SecurityTimestamp,
      },
      toCorrelationId(correlationId),
      toIdempotencyKey(idempotencyKey),
    ) as Envelope<unknown>;
  }

  /** Build (but do not handle) a register-policy-bundle-command. */
  makeRegisterCommand(
    bundle: unknown,
    correlationId: string,
    idempotencyKey: string,
  ): Envelope<unknown> {
    return makeRegisterPolicyBundleCommand(
      { bundle },
      toCorrelationId(correlationId),
      toIdempotencyKey(idempotencyKey),
    ) as Envelope<unknown>;
  }

  /** Build (but do not handle) an authorize-learning-command. */
  makeLearningCommand(
    consumerTenant: string,
    datasets: readonly TenantScopedRef[],
    grants: readonly unknown[],
    dataRights: Readonly<Record<string, unknown>>,
    asOf: string,
    correlationId: string,
    idempotencyKey: string,
  ): Envelope<unknown> {
    return makeAuthorizeLearningCommand(
      { consumerTenant, datasets, grants, dataRights, asOf },
      toCorrelationId(correlationId),
      toIdempotencyKey(idempotencyKey),
    ) as Envelope<unknown>;
  }

  /** The append-only audit trail snapshot (query surface). */
  async auditSnapshot(): Promise<readonly SecurityAuditRecord[]> {
    const snapshot = await this.auditLog.verify();
    return snapshot.records;
  }

  /** Verify the audit chain (tamper evidence, fail closed). */
  async verifyAuditChain(): Promise<boolean> {
    await this.auditLog.verify();
    return true;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function newEventId(): string {
  return globalThis.crypto.randomUUID();
}

function newOccurredAt(): string {
  return new Date().toISOString();
}

// Local strict parsers (envelope-as + payload validation, fail-closed):
import {
  parseAuthorizeLearningCommand,
  parseEvaluateAuthorizationCommand,
  parseRegisterPolicyBundleCommand,
  makeLearningAuthorizationDecidedEvent,
} from '@arena/security';

function parseRegisterCommand(raw: string): Envelope<{ bundle: unknown }> {
  return parseRegisterPolicyBundleCommand(raw) as Envelope<{ bundle: unknown }>;
}

function parseEvaluateCommand(
  raw: string,
): Envelope<{
  principal: unknown;
  action: string;
  resource: unknown;
  evaluatedAt: string;
}> {
  return parseEvaluateAuthorizationCommand(raw) as Envelope<{
    principal: unknown;
    action: string;
    resource: unknown;
    evaluatedAt: string;
  }>;
}

function parseLearningCommand(
  raw: string,
): Envelope<{
  consumerTenant: string;
  datasets: readonly unknown[];
  grants: readonly unknown[];
  dataRights: Readonly<Record<string, unknown>>;
  asOf: string;
}> {
  return parseAuthorizeLearningCommand(raw) as Envelope<{
    consumerTenant: string;
    datasets: readonly unknown[];
    grants: readonly unknown[];
    dataRights: Readonly<Record<string, unknown>>;
    asOf: string;
  }>;
}

function makeLearningDecidedEvent(
  payload: { decision: unknown; auditRecord: SecurityAuditRecord },
  correlationId: CorrelationId,
): Envelope<unknown> {
  return makeLearningAuthorizationDecidedEvent(
    payload as never,
    correlationId,
  ) as Envelope<unknown>;
}

export type _IdempotencyKey = IdempotencyKey;
