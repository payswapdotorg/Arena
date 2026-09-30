/**
 * Authorization policy objects and the authorization engine (Work Order
 * A034; spec/security.md S1.0; AGENTS.md "Identity, tenancy,
 * authorization, policy and expert qualification are separate
 * concerns").
 *
 * Decisions are CLOSED objects — allow/deny with a machine-readable
 * reason drawn from a closed vocabulary — never a bare boolean:
 *
 *   - FAIL-CLOSED DEFAULT: no matching policy ⇒ DENY
 *     ('no-matching-policy'). Absence of evidence is never permission.
 *   - DENY OVERRIDES ALLOW: if both an allow and a deny statement match,
 *     the deny wins ('deny-overrides').
 *   - TENANT MATCH REQUIRED: policy statements are tenant-scoped — a
 *     statement for tenant T never authorizes a principal of tenant U
 *     ('tenant-mismatch').
 *   - ANONYMOUS PRINCIPALS ARE DENIED EVERYTHING
 *     ('principal-unauthenticated').
 *   - NO WILDCARDS: actions and boundary classes are closed vocabulary
 *     members; a policy carrying an unknown action or class is REJECTED
 *     at construction (privilege escalation via crafted policies is a
 *     validation error, never a grant).
 *   - STRUCTURED PRINCIPALS: an invalid principal shape ⇒ DENY
 *     ('principal-invalid') — never an exception path that could be
 *     mistaken for an allow.
 *
 * The engine is a PURE deterministic function of (bundle, principal,
 * action, resource, evaluatedAt) — no clock, no I/O, no ambient
 * authority. Policy bundles are content-addressed (sha256 canonical
 * digest via @arena/protocol-core — consumed, never reimplemented).
 */

import { digestCanonical } from '@arena/protocol-core';
import { SECURITY_ERROR_CODES, SecurityError } from './errors.js';
import { deepFreeze, expectEnumMember, expectFields, isEnumMember } from './shared.js';
import { toNeutralId, toSecurityTimestamp, toTenantId } from './shared.js';
import type { NeutralId, SecurityTimestamp, TenantId } from './shared.js';
import { isTenantBoundaryClass, TENANT_BOUNDARY_CLASSES } from './tenancy.js';
import type { TenantBoundaryClass, TenantScopedRef } from './tenancy.js';
import { isSecurityPrincipal, PRINCIPAL_ROLES } from './identity.js';
import type { PrincipalRole, SecurityPrincipal } from './identity.js';

// ---------------------------------------------------------------------------
// Closed action vocabulary
// ---------------------------------------------------------------------------

/**
 * The closed action vocabulary. Deliberately small and coarse; there are
 * NO wildcards — 'administer' is tenant administration, 'audit-read' is
 * read access to the audit trail, 'use-for-learning' covers learning-
 * experiment consumption of tenant data (the learning gate layers
 * explicit-consent enforcement on top, see learning-authorization.ts).
 */
export const AUTHORIZATION_ACTIONS = Object.freeze([
  'read',
  'write',
  'delete',
  'export',
  'publish',
  'use-for-learning',
  'certify',
  'administer',
  'audit-read',
] as const);

export type AuthorizationAction = (typeof AUTHORIZATION_ACTIONS)[number];

export function isAuthorizationAction(value: unknown): value is AuthorizationAction {
  return isEnumMember(value, AUTHORIZATION_ACTIONS);
}

// ---------------------------------------------------------------------------
// Closed decision reason vocabulary (allow AND deny reasons)
// ---------------------------------------------------------------------------

/** The closed authorization-decision reason vocabulary. */
export const AUTHORIZATION_DECISION_REASONS = Object.freeze([
  // allow reasons
  'policy-allowed',
  // deny reasons — the fail-closed taxonomy
  'no-matching-policy',
  'deny-overrides',
  'tenant-mismatch',
  'principal-unauthenticated',
  'principal-invalid',
  'action-not-permitted',
  'unknown-action',
  'resource-invalid',
  'fail-closed',
] as const);

export type AuthorizationDecisionReason = (typeof AUTHORIZATION_DECISION_REASONS)[number];

/** Every deny reason, as a closed sub-list (adversarial battery pins this). */
export const DENY_DECISION_REASONS = Object.freeze(
  AUTHORIZATION_DECISION_REASONS.filter(
    (reason) => reason !== 'policy-allowed',
  ) as readonly Exclude<AuthorizationDecisionReason, 'policy-allowed'>[],
);

export function isAuthorizationDecisionReason(value: unknown): value is AuthorizationDecisionReason {
  return isEnumMember(value, AUTHORIZATION_DECISION_REASONS);
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/** Wire version of the decision record shape. */
export const AUTHORIZATION_DECISION_VERSION = 1 as const;

/**
 * The machine-readable allow/deny decision. `policyStatementId` is the
 * allow statement that drove an allow (null otherwise); `matchedDenyIds`
 * lists every matching deny statement (empty unless reason is
 * 'deny-overrides'). Decisions are FROZEN immutable records.
 */
export interface AuthorizationDecision {
  readonly recordVersion: typeof AUTHORIZATION_DECISION_VERSION;
  readonly effect: 'allow' | 'deny';
  readonly reason: AuthorizationDecisionReason;
  readonly principalId: string;
  readonly tenantScope: TenantId | 'untenanted';
  readonly action: AuthorizationAction | null;
  readonly boundaryClass: TenantBoundaryClass | null;
  readonly recordId: string | null;
  readonly policyStatementId: NeutralId | null;
  readonly matchedDenyIds: readonly NeutralId[];
  readonly evaluatedAt: SecurityTimestamp;
}

const DECISION_CONTEXT = 'AuthorizationDecision';

export function isAuthorizationDecision(value: unknown): value is AuthorizationDecision {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== AUTHORIZATION_DECISION_VERSION) return false;
  if (record['effect'] !== 'allow' && record['effect'] !== 'deny') return false;
  if (!isAuthorizationDecisionReason(record['reason'])) return false;
  if (record['effect'] === 'allow' && record['reason'] !== 'policy-allowed') return false;
  if (record['effect'] === 'deny' && record['reason'] === 'policy-allowed') return false;
  if (typeof record['principalId'] !== 'string') return false;
  if (typeof record['evaluatedAt'] !== 'string') return false;
  if (!Array.isArray(record['matchedDenyIds'])) return false;
  return true;
}

export function toAuthorizationDecision(value: unknown): AuthorizationDecision {
  const record = expectFields(
    value,
    [
      'recordVersion',
      'effect',
      'reason',
      'principalId',
      'tenantScope',
      'action',
      'boundaryClass',
      'recordId',
      'policyStatementId',
      'matchedDenyIds',
      'evaluatedAt',
    ],
    [],
    SECURITY_ERROR_CODES.INVALID_DECISION,
    DECISION_CONTEXT,
  );
  if (record['recordVersion'] !== AUTHORIZATION_DECISION_VERSION) {
    throw new SecurityError(SECURITY_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `${DECISION_CONTEXT}: unsupported recordVersion: ${String(record['recordVersion'])}`,
    });
  }
  const effect = expectEnumMember(
    record['effect'],
    ['allow', 'deny'] as const,
    'effect',
    SECURITY_ERROR_CODES.INVALID_DECISION,
    DECISION_CONTEXT,
  );
  const reason = expectEnumMember(
    record['reason'],
    AUTHORIZATION_DECISION_REASONS,
    'reason',
    SECURITY_ERROR_CODES.INVALID_DECISION,
    DECISION_CONTEXT,
  );
  if (effect === 'allow' && reason !== 'policy-allowed') {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_DECISION, {
      message: `${DECISION_CONTEXT}: allow decisions must carry reason 'policy-allowed', got '${reason}'`,
    });
  }
  if (effect === 'deny' && reason === 'policy-allowed') {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_DECISION, {
      message: `${DECISION_CONTEXT}: deny decisions must never carry reason 'policy-allowed'`,
    });
  }
  const evaluatedAt = toSecurityTimestamp(
    String(record['evaluatedAt']),
    `${DECISION_CONTEXT}.evaluatedAt`,
  );
  if (!Array.isArray(record['matchedDenyIds'])) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_DECISION, {
      message: `${DECISION_CONTEXT}.matchedDenyIds: must be an array`,
    });
  }
  return deepFreeze({
    recordVersion: AUTHORIZATION_DECISION_VERSION,
    effect,
    reason,
    principalId: String(record['principalId']),
    tenantScope: record['tenantScope'] as TenantId | 'untenanted',
    action: (record['action'] as AuthorizationAction | null),
    boundaryClass: (record['boundaryClass'] as TenantBoundaryClass | null),
    recordId: (record['recordId'] as string | null),
    policyStatementId: (record['policyStatementId'] as NeutralId | null),
    matchedDenyIds: Object.freeze([...(record['matchedDenyIds'] as readonly NeutralId[])]),
    evaluatedAt,
  });
}

// ---------------------------------------------------------------------------
// Policy statements and bundles
// ---------------------------------------------------------------------------

/** Wire version of the policy statement shape. */
export const POLICY_STATEMENT_VERSION = 1 as const;

/**
 * One policy statement. `tenantId` scopes the statement to exactly one
 * tenant (NO cross-tenant statements — cross-tenant data flow is
 * governed by explicit learning grants, never by policy bundles).
 * `roles` lists the principal roles the statement matches (empty list
 * matches NO principal — never all principals). There are no wildcards
 * anywhere: effect, action and boundaryClass are single closed-vocabulary
 * members.
 */
export interface PolicyStatement {
  readonly recordVersion: typeof POLICY_STATEMENT_VERSION;
  readonly statementId: NeutralId;
  readonly effect: 'allow' | 'deny';
  readonly tenantId: TenantId;
  readonly roles: readonly PrincipalRole[];
  readonly action: AuthorizationAction;
  readonly boundaryClass: TenantBoundaryClass;
}

const STATEMENT_CONTEXT = 'PolicyStatement';

export function isPolicyStatement(value: unknown): value is PolicyStatement {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== POLICY_STATEMENT_VERSION) return false;
  if (record['effect'] !== 'allow' && record['effect'] !== 'deny') return false;
  if (typeof record['statementId'] !== 'string') return false;
  if (typeof record['tenantId'] !== 'string') return false;
  if (!isAuthorizationAction(record['action'])) return false;
  if (!isTenantBoundaryClass(record['boundaryClass'])) return false;
  if (!Array.isArray(record['roles'])) return false;
  return true;
}

export function toPolicyStatement(value: unknown): PolicyStatement {
  const record = expectFields(
    value,
    ['recordVersion', 'statementId', 'effect', 'tenantId', 'roles', 'action', 'boundaryClass'],
    [],
    SECURITY_ERROR_CODES.INVALID_POLICY,
    STATEMENT_CONTEXT,
  );
  if (record['recordVersion'] !== POLICY_STATEMENT_VERSION) {
    throw new SecurityError(SECURITY_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `${STATEMENT_CONTEXT}: unsupported recordVersion: ${String(record['recordVersion'])}`,
    });
  }
  const statementId = toNeutralId(String(record['statementId']), `${STATEMENT_CONTEXT}.statementId`);
  const effect = expectEnumMember(
    record['effect'],
    ['allow', 'deny'] as const,
    'effect',
    SECURITY_ERROR_CODES.INVALID_POLICY,
    STATEMENT_CONTEXT,
  );
  const tenantId = toTenantId(String(record['tenantId']), `${STATEMENT_CONTEXT}.tenantId`);
  const action = expectEnumMember(
    record['action'],
    AUTHORIZATION_ACTIONS,
    'action',
    SECURITY_ERROR_CODES.INVALID_POLICY,
    STATEMENT_CONTEXT,
  );
  const boundaryClass = expectEnumMember(
    record['boundaryClass'],
    TENANT_BOUNDARY_CLASSES,
    'boundaryClass',
    SECURITY_ERROR_CODES.INVALID_BOUNDARY_CLASS,
    STATEMENT_CONTEXT,
  );
  const rawRoles = record['roles'];
  if (!Array.isArray(rawRoles)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_POLICY, {
      message: `${STATEMENT_CONTEXT}.roles: must be an array of closed-vocabulary roles`,
    });
  }
  const roles = rawRoles.map((role, index) =>
    expectEnumMember(
      role,
      PRINCIPAL_ROLES,
      `roles[${String(index)}]`,
      SECURITY_ERROR_CODES.INVALID_ROLE,
      STATEMENT_CONTEXT,
    ),
  );
  if (new Set(roles).size !== roles.length) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_POLICY, {
      message: `${STATEMENT_CONTEXT}.roles: must be unique (duplicates rejected)`,
      details: { roles: [...roles] },
    });
  }
  return deepFreeze({
    recordVersion: POLICY_STATEMENT_VERSION,
    statementId,
    effect,
    tenantId,
    roles: Object.freeze([...roles]),
    action,
    boundaryClass: boundaryClass as TenantBoundaryClass,
  });
}

/** Wire version of the policy bundle shape. */
export const POLICY_BUNDLE_VERSION = 1 as const;

/**
 * A validated, content-addressed policy bundle. The digest is sha256
 * over the canonical JSON of the bundle's STATEMENT SET (sorted by
 * statementId) — bundles with the same statements in different array
 * order are the SAME policy (digest equality), mirroring the registry
 * dedup discipline of the sibling packages.
 */
export interface PolicyBundle {
  readonly recordVersion: typeof POLICY_BUNDLE_VERSION;
  readonly bundleId: NeutralId;
  readonly version: string;
  readonly statements: readonly PolicyStatement[];
  readonly digest: string;
}

const BUNDLE_CONTEXT = 'PolicyBundle';

export function isPolicyBundle(value: unknown): value is PolicyBundle {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== POLICY_BUNDLE_VERSION) return false;
  if (typeof record['bundleId'] !== 'string') return false;
  if (typeof record['version'] !== 'string') return false;
  if (typeof record['digest'] !== 'string') return false;
  if (!Array.isArray(record['statements'])) return false;
  return true;
}

/**
 * Validate a policy bundle: every statement is strictly validated, the
 * bundle's statement ids are unique, and the digest is RECOMPUTED from
 * the statement set (a supplied digest that does not match the
 * recomputed one is SECURITY_TAMPERED — fail closed).
 */
export async function toPolicyBundle(
  value: unknown,
  options: { verifyDigest?: boolean } = {},
): Promise<PolicyBundle> {
  const verifyDigest = options.verifyDigest ?? true;
  const record = expectFields(
    value,
    ['recordVersion', 'bundleId', 'version', 'statements'],
    ['digest'],
    SECURITY_ERROR_CODES.INVALID_POLICY,
    BUNDLE_CONTEXT,
  );
  if (record['recordVersion'] !== POLICY_BUNDLE_VERSION) {
    throw new SecurityError(SECURITY_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `${BUNDLE_CONTEXT}: unsupported recordVersion: ${String(record['recordVersion'])}`,
    });
  }
  const bundleId = toNeutralId(String(record['bundleId']), `${BUNDLE_CONTEXT}.bundleId`);
  const version = record['version'];
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.test(version)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_POLICY, {
      message: `${BUNDLE_CONTEXT}.version: must be semver without build metadata`,
      details: { received: JSON.stringify(version) },
    });
  }
  const rawStatements = record['statements'];
  if (!Array.isArray(rawStatements)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_POLICY, {
      message: `${BUNDLE_CONTEXT}.statements: must be an array`,
    });
  }
  const statements = rawStatements.map((statement) => toPolicyStatement(statement));
  const ids = new Set(statements.map((statement) => statement.statementId));
  if (ids.size !== statements.length) {
    throw new SecurityError(SECURITY_ERROR_CODES.IDENTITY_CONFLICT, {
      message: `${BUNDLE_CONTEXT}: duplicate statementIds are rejected (policy identity must be unique)`,
      details: { statementIds: statements.map((statement) => statement.statementId) },
    });
  }
  const digest = await computePolicyBundleDigest(statements);
  if (verifyDigest && typeof record['digest'] === 'string' && record['digest'] !== digest) {
    throw new SecurityError(SECURITY_ERROR_CODES.TAMPERED, {
      message: `${BUNDLE_CONTEXT}: digest mismatch — the supplied digest does not match the recomputed statement-set digest (fail closed)`,
      details: { supplied: record['digest'], recomputed: digest },
    });
  }
  return deepFreeze({
    recordVersion: POLICY_BUNDLE_VERSION,
    bundleId,
    version,
    statements: Object.freeze([...statements]),
    digest,
  });
}

/**
 * Content-addressed policy identity: sha256 over the canonical JSON of
 * the statement set sorted by statementId (order-independent — the
 * policy's meaning, not its serialization order).
 */
export async function computePolicyBundleDigest(
  statements: readonly PolicyStatement[],
): Promise<string> {
  const sorted = [...statements].sort((a, b) =>
    a.statementId < b.statementId ? -1 : a.statementId > b.statementId ? 1 : 0,
  );
  return digestCanonical({ statements: sorted });
}

// ---------------------------------------------------------------------------
// The authorization engine
// ---------------------------------------------------------------------------

/** One evaluation request (all inputs explicit — no ambient authority). */
export interface EvaluationRequest {
  readonly principal: SecurityPrincipal;
  readonly action: AuthorizationAction;
  readonly resource: TenantScopedRef;
  readonly evaluatedAt: SecurityTimestamp;
}

/**
 * The PURE authorization engine. `evaluate` is a total deterministic
 * function: it NEVER throws for an evaluable request; every
 * unevaluable input (invalid principal, unknown action, invalid
 * resource) is a DENY with a closed reason — the fail-closed default.
 *
 * Deny-overrides-allow evaluation order:
 *   1. anonymous principal           ⇒ deny 'principal-unauthenticated';
 *   2. invalid principal shape       ⇒ deny 'principal-invalid';
 *   3. unknown action                ⇒ deny 'unknown-action';
 *   4. invalid resource              ⇒ deny 'resource-invalid';
 *   5. collect statements matching (tenant, role-set overlap, action,
 *      boundaryClass);
 *   6. ANY matching deny statement   ⇒ deny 'deny-overrides' (with the
 *      matched deny ids);
 *   7. a matching allow statement    ⇒ allow 'policy-allowed' (with the
 *      driving statement id);
 *   8. no matching statement at all  ⇒ deny 'no-matching-policy' —
 *      THE fail-closed default.
 */
export class AuthorizationEngine {
  readonly bundle: PolicyBundle;

  constructor(bundle: PolicyBundle) {
    if (!isPolicyBundle(bundle)) {
      throw new SecurityError(SECURITY_ERROR_CODES.INVALID_POLICY, {
        message: 'AuthorizationEngine requires a validated PolicyBundle',
      });
    }
    this.bundle = bundle;
  }

  evaluate(request: EvaluationRequest): AuthorizationDecision {
    const { principal, action, resource, evaluatedAt } = request;
    const base = {
      recordVersion: AUTHORIZATION_DECISION_VERSION,
      principalId: typeof principal?.principalId === 'string' ? principal.principalId : 'unknown',
      tenantScope:
        principal !== null && typeof principal === 'object' && 'tenantScope' in principal
          ? (principal as SecurityPrincipal).tenantScope
          : 'untenanted',
      action: isAuthorizationAction(action) ? action : null,
      boundaryClass: resource !== null && resource !== undefined ? resource.boundaryClass : null,
      recordId: resource !== null && resource !== undefined ? resource.recordId : null,
    };

    if (principal === null || principal === undefined || !isSecurityPrincipal(principal)) {
      return deepFreeze({
        ...base,
        effect: 'deny',
        reason: 'principal-invalid',
        policyStatementId: null,
        matchedDenyIds: [],
        evaluatedAt,
      });
    }
    if (principal.kind === 'anonymous') {
      return deepFreeze({
        ...base,
        effect: 'deny',
        reason: 'principal-unauthenticated',
        policyStatementId: null,
        matchedDenyIds: [],
        evaluatedAt,
      });
    }
    if (!isAuthorizationAction(action)) {
      return deepFreeze({
        ...base,
        effect: 'deny',
        reason: 'unknown-action',
        policyStatementId: null,
        matchedDenyIds: [],
        evaluatedAt,
      });
    }
    if (resource === null || resource === undefined || !isTenantBoundaryClass(resource.boundaryClass)) {
      return deepFreeze({
        ...base,
        effect: 'deny',
        reason: 'resource-invalid',
        policyStatementId: null,
        matchedDenyIds: [],
        evaluatedAt,
      });
    }

    // Tenancy discipline: statements are tenant-scoped; a principal
    // outside the statement's tenant is never matched by it.
    const matching = this.bundle.statements.filter((statement) => {
      if (statement.tenantId !== principal.tenantScope) return false;
      if (!statement.roles.some((role) => principal.roles.includes(role))) return false;
      if (statement.action !== action) return false;
      if (statement.boundaryClass !== resource.boundaryClass) return false;
      return true;
    });

    const denyMatches = matching.filter((statement) => statement.effect === 'deny');
    if (denyMatches.length > 0) {
      return deepFreeze({
        ...base,
        effect: 'deny',
        reason: 'deny-overrides',
        policyStatementId: null,
        matchedDenyIds: Object.freeze(denyMatches.map((statement) => statement.statementId)),
        evaluatedAt,
      });
    }
    const allowMatch = matching.find((statement) => statement.effect === 'allow');
    if (allowMatch !== undefined) {
      return deepFreeze({
        ...base,
        effect: 'allow',
        reason: 'policy-allowed',
        policyStatementId: allowMatch.statementId,
        matchedDenyIds: [],
        evaluatedAt,
      });
    }
    return deepFreeze({
      ...base,
      effect: 'deny',
      reason: 'no-matching-policy',
      policyStatementId: null,
      matchedDenyIds: [],
      evaluatedAt,
    });
  }
}
