#!/usr/bin/env node
/**
 * Demo entry for the A034 reference security service (Work Order gate:
 * a typed programmatic API + this main.mjs demo entry is the required
 * surface; REST/HTTP layers are NOT).
 *
 * Drives ONE deterministic end-to-end scenario against the REAL
 * @arena/security protocol:
 *   register a PolicyBundle → evaluate an allowed read → evaluate a
 *   denied export → evaluate a CROSS-TENANT read (tenancy overrides
 *   policy) → run the cross-tenant learning gate (allowed with an
 *   explicit grant; denied without) → negative probes (unknown bundle,
 *   tampered digest, replayed audit event) → audit chain verify.
 *
 * Run:
 *   cd services/security && pnpm demo     (or: node main.mjs)
 *
 * The entry self-bootstraps `node --experimental-strip-types` and the
 * .js→.ts resolve hook (ts-source-hooks.mjs) so the REAL workspace
 * packages run straight from their TypeScript sources — no build step,
 * zero new dependencies. (Mirrors the A012/A013/A023 demo entries'
 * bootstrap verbatim.)
 */

if (
  !process.execArgv.some((arg) => arg.includes('strip-types')) &&
  process.env.ARENA_A034_DEMO !== 'respawned'
) {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '--',
      import.meta.filename,
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit', env: { ...process.env, ARENA_A034_DEMO: 'respawned' } },
  );
  process.exit(result.status ?? 1);
}

const { register } = await import('node:module');
register('./ts-source-hooks.mjs', import.meta.url);

const { SecurityService } = await import('./src/index.js');
const security = await import('@arena/security');
const { toCorrelationId, toIdempotencyKey, serializeEnvelope } = await import('@arena/protocol-core');

const T1 = '2026-09-30T01:00:00.000Z';
const T2 = '2026-09-30T02:00:00.000Z';
const T5 = '2026-09-30T05:00:00.000Z';

const CORR = toCorrelationId('corr-a034-demo-0001');
const IDEM = toIdempotencyKey('idem-a034-demo-0001');

const PRINCIPAL = security.toSecurityPrincipal({
  recordVersion: 1,
  principalId: 'principal-demo-alpha',
  kind: 'customer-identity',
  tenantScope: 'tenant-alpha',
  roles: ['tenant-member'],
  label: null,
});

const RESOURCE = security.toTenantScopedRef({
  recordVersion: 1,
  tenantId: 'tenant-alpha',
  boundaryClass: 'dataset',
  recordId: 'dataset-demo-1',
});

const FOREIGN_RESOURCE = security.toTenantScopedRef({
  recordVersion: 1,
  tenantId: 'tenant-beta',
  boundaryClass: 'dataset',
  recordId: 'dataset-beta-1',
});

const BUNDLE = {
  recordVersion: 1,
  bundleId: 'bundle-demo',
  version: '1.0.0',
  statements: [
    {
      recordVersion: 1,
      statementId: 'allow-read-datasets',
      effect: 'allow',
      tenantId: 'tenant-alpha',
      roles: ['tenant-member'],
      action: 'read',
      boundaryClass: 'dataset',
    },
    {
      recordVersion: 1,
      statementId: 'deny-export-datasets',
      effect: 'deny',
      tenantId: 'tenant-alpha',
      roles: ['tenant-member', 'tenant-admin'],
      action: 'export',
      boundaryClass: 'dataset',
    },
  ],
};

const say = (label, value) => {
  process.stdout.write(`\n=== ${label} ===\n${JSON.stringify(value, null, 2)}\n`);
};

// 1. Register the policy bundle (idempotent by digest, audited).
const service = new SecurityService();
const registration = await service.handleRegisterPolicyBundleCommand(
  serializeEnvelope(security.makeRegisterPolicyBundleCommand({ bundle: BUNDLE }, CORR, IDEM)),
);
say('policy bundle registered', {
  bundleId: registration.bundle.bundleId,
  digest: registration.bundle.digest,
  statementCount: registration.bundle.statements.length,
  auditSequence: registration.auditRecord.sequence,
});

const wired = new SecurityService({
  registry: service.registry,
  auditLog: service.auditLog,
  defaultBundle: { bundleId: 'bundle-demo', version: '1.0.0' },
});

// 2. Allowed read (policy-allowed).
const allowed = await wired.handleEvaluateAuthorizationCommand(
  serializeEnvelope(
    security.makeEvaluateAuthorizationCommand(
      { principal: PRINCIPAL, action: 'read', resource: RESOURCE, evaluatedAt: T1 },
      CORR,
      IDEM,
    ),
  ),
);
say('evaluate read (tenant-scoped)', {
  effect: allowed.decision.effect,
  reason: allowed.decision.reason,
  policyStatementId: allowed.decision.policyStatementId,
  auditKind: allowed.auditRecord.payload.kind,
});

// 3. Denied export (deny-overrides).
const denied = await wired.handleEvaluateAuthorizationCommand(
  serializeEnvelope(
    security.makeEvaluateAuthorizationCommand(
      { principal: PRINCIPAL, action: 'export', resource: RESOURCE, evaluatedAt: T1 },
      CORR,
      IDEM,
    ),
  ),
);
say('evaluate export (deny statement)', {
  effect: denied.decision.effect,
  reason: denied.decision.reason,
  matchedDenyIds: denied.decision.matchedDenyIds,
  auditKind: denied.auditRecord.payload.kind,
});

// 4. Cross-tenant read: tenancy OVERRIDES policy (fail closed).
const cross = await wired.handleEvaluateAuthorizationCommand(
  serializeEnvelope(
    security.makeEvaluateAuthorizationCommand(
      { principal: PRINCIPAL, action: 'read', resource: FOREIGN_RESOURCE, evaluatedAt: T1 },
      CORR,
      IDEM,
    ),
  ),
);
say('evaluate read (cross-tenant resource)', {
  effect: cross.decision.effect,
  reason: cross.decision.reason,
  auditKind: cross.auditRecord.payload.kind,
});

// 5. Cross-tenant learning gate: explicit grant + rights allow.
const dataset = {
  recordVersion: 1,
  tenantId: 'tenant-alpha',
  boundaryClass: 'dataset',
  recordId: 'dataset-demo-1',
};
const grant = security.toLearningAuthorizationGrant({
  recordVersion: 1,
  grantId: 'grant-demo-1',
  grantor: 'tenant-alpha',
  datasets: [dataset],
  grantedAt: T1,
  expiresAt: T5,
  status: 'active',
  revokedAt: null,
});
const rights = security.toDataRightsRecord({
  recordVersion: 1,
  owner: 'tenant-alpha',
  source: 'demo source',
  permittedUse: 'cross-tenant-learning',
  contractRef: 'demo-contract-2026',
  retention: { recordVersion: 1, mode: 'none', retentionDays: null, expiresAt: null },
  publicationStatus: 'tenant-internal',
  recordedAt: T1,
});
const learning = await wired.handleAuthorizeLearningCommand(
  serializeEnvelope(
    security.makeAuthorizeLearningCommand(
      {
        consumerTenant: 'tenant-beta',
        datasets: [dataset],
        grants: [grant],
        dataRights: { 'dataset-demo-1': rights },
        asOf: T2,
      },
      CORR,
      IDEM,
    ),
  ),
);
say('cross-tenant learning (explicit grant)', {
  allowed: learning.decision.allowed,
  reason: learning.decision.reason,
  grantId: learning.decision.grantId,
});

// 6. Same request WITHOUT the grant: denied (grant-missing).
const learningDenied = await wired.handleAuthorizeLearningCommand(
  serializeEnvelope(
    security.makeAuthorizeLearningCommand(
      {
        consumerTenant: 'tenant-beta',
        datasets: [dataset],
        grants: [],
        dataRights: { 'dataset-demo-1': rights },
        asOf: T2,
      },
      CORR,
      IDEM,
    ),
  ),
);
say('cross-tenant learning (no grant)', {
  allowed: learningDenied.decision.allowed,
  reason: learningDenied.decision.reason,
});

// 7. Negative probes (fail closed).
try {
  wired.registry.byIdentity('unknown-bundle', '0.0.1');
} catch (error) {
  say('unknown bundle probe', { code: error.code, message: error.message });
}
try {
  await wired.handleRegisterPolicyBundleCommand(
    serializeEnvelope(
      security.makeRegisterPolicyBundleCommand(
        { bundle: { ...BUNDLE, digest: 'e'.repeat(64) } },
        CORR,
        IDEM,
      ),
    ),
  );
} catch (error) {
  say('tampered digest probe', { code: error.code });
}
const event = security.toSecurityAuditEvent({
  recordVersion: 1,
  eventId: registration.auditRecord.payload.eventId,
  kind: 'policy-registered',
  tenantId: null,
  principalId: null,
  action: null,
  boundaryClass: null,
  outcome: null,
  correlationId: 'corr-a034-demo-replay',
  causationId: null,
  occurredAt: T2,
});
try {
  await wired.auditLog.append(event);
} catch (error) {
  say('replayed audit event probe', { code: error.code });
}

// 8. Audit chain verify + snapshot summary.
const records = await wired.auditSnapshot();
say('audit trail', {
  sealed: records.length,
  verified: await wired.verifyAuditChain(),
  kinds: records.map((record) => record.payload.kind),
});

process.stdout.write('\nA034 demo complete.\n');
