/**
 * tests/security/production/ac12-policy-drift.test.ts — AC-12 policy
 * drift (Work Order P007 integrated pass; issue #159).
 *
 * "policy drift (tenant policy changes don't leak into other tenants)"
 * + the pack/unpack control-loss class from the threat model.
 *
 * Attacks the REAL policy surfaces:
 *   - services/security's REAL SecurityService + SecurityPolicyRegistry:
 *     content-addressed bundles, idempotent re-registration, identity
 *     conflicts on silent changes, tampered-digest fail-closed, and the
 *     tenant-scoped evaluation matrix — a tenant-alpha policy change
 *     NEVER changes tenant-beta's verdicts;
 *   - packages/expert-session-policy's REAL pack construction: controls
 *     from tenant B cannot be bundled into tenant A's pack (typed
 *     cross-tenant policy refusal), conflicting controls are detected
 *     at composition (the closed-outcome drift detector), and the pack
 *     round-trip validates with every control intact.
 */

import { describe, expect, it } from 'vitest';
import { SecurityService } from '@arena/security-service';
import { toSecurityPrincipal, toTenantScopedRef } from '@arena/security';
import {
  createPolicyPack,
  validatePolicyPack,
} from '@arena/expert-session-policy';
import {
  makeDataRights,
  validControls,
  validRetentionSchedule,
} from '@arena/expert-session-policy/test-support';
import { toTenantId, toNeutralText } from '@arena/security';

const T0 = '2026-10-09T12:00:00.000Z';

/** A tenant-scoped policy statement (the S1.0 wire shape). */
function statement(
  tenantId: string,
  statementId: string,
  action: string,
  roles: readonly string[],
) {
  return {
    recordVersion: 1,
    statementId,
    effect: 'allow',
    tenantId,
    roles: [...roles],
    action,
    boundaryClass: 'dataset',
  };
}

/** A bundle wire shape for one tenant. */
function bundle(tenantId: string, bundleId: string, actions: readonly string[]) {
  return {
    recordVersion: 1,
    bundleId,
    version: '1.0.0',
    statements: actions.map((action, index) =>
      statement(tenantId, `${bundleId}-allow-${action}-${String(index)}`, action, [
        'tenant-member',
        'tenant-admin',
      ]),
    ),
  };
}

function principal(tenantId: string, principalId: string) {
  return toSecurityPrincipal({
    recordVersion: 1,
    principalId,
    kind: 'customer-identity',
    tenantScope: tenantId,
    roles: ['tenant-member'],
    label: null,
  });
}

async function register(service: SecurityService, raw: Record<string, unknown>, key: string) {
  const command = service.makeRegisterCommand(raw, 'corr-ac12', `idem-ac12-${key}`);
  return service.handleRegisterPolicyBundleCommand(JSON.stringify(command));
}

async function evaluate(
  service: SecurityService,
  tenantId: string,
  action = 'read',
  address: { readonly bundleId: string; readonly version: string } = {
    bundleId: 'bundle-ac12-alpha',
    version: '1.0.0',
  },
) {
  const command = service.makeEvaluateCommand(
    principal(tenantId, `principal-${tenantId}`),
    action,
    toTenantScopedRef({
      recordVersion: 1,
      tenantId,
      boundaryClass: 'dataset',
      recordId: 'dataset-77',
    }),
    T0,
    `corr-ac12-${tenantId}-${action}`,
    `idem-ac12-${tenantId}-${action}`,
  );
  // The registry has NO ambient policy: every evaluation ADDRESSES a
  // bundle explicitly ({bundleId, version} — fail closed otherwise).
  return service.handleEvaluateAuthorizationCommand(JSON.stringify(command), address);
}

describe('AC-12 — tenant policy changes never leak across tenants (the REAL registry)', () => {
  it('an alpha policy drift (a hardened new bundle) leaves beta verdicts identical', async () => {
    // Both tenants register their own v1 policy (both permissive).
    const alphaService = new SecurityService();
    const betaService = new SecurityService();
    await register(alphaService, bundle('tenant-alpha', 'bundle-ac12-alpha', ['read', 'write']), 'a1');
    await register(betaService, bundle('tenant-beta', 'bundle-ac12-beta', ['read', 'write']), 'b1');

    // Baseline: each tenant's member may read its own dataset (each
    // evaluation ADDRESSES its own tenant's registered bundle).
    const alphaBefore = await evaluate(alphaService, 'tenant-alpha');
    const betaBefore = await evaluate(
      betaService,
      'tenant-beta',
      'read',
      { bundleId: 'bundle-ac12-beta', version: '1.0.0' },
    );
    expect((alphaBefore.decision as { effect?: string }).effect).toBe('allow');
    expect((betaBefore.decision as { effect?: string }).effect).toBe('allow');

    // ALPHA DRIFTS: registers a HARDENED bundle (read removed entirely)
    // under a NEW identity. The registry never mutates a registered
    // bundle in place (content-addressed, version-pinned) — evaluating
    // against the hardened identity now DENIES read for alpha members.
    await register(
      alphaService,
      bundle('tenant-alpha', 'bundle-ac12-alpha-hardened', []),
      'a2',
    );
    const driftedAlpha = await evaluate(
      alphaService,
      'tenant-alpha',
      'read',
      { bundleId: 'bundle-ac12-alpha-hardened', version: '1.0.0' },
    );
    expect((driftedAlpha.decision as { effect?: string }).effect).toBe('deny');
    // …while the ORIGINAL v1 identity still allows (the drift never
    // rewrote the registered bundle — no in-place mutation).
    const originalStillAllows = await evaluate(alphaService, 'tenant-alpha');
    expect((originalStillAllows.decision as { effect?: string }).effect).toBe('allow');

    // BETA's verdicts are UNCHANGED by alpha's drift: a fresh beta
    // registry (its own policy world) evaluates identically. The
    // cross-tenant leak would be beta's verdict CHANGING because alpha
    // hardened its own policy — impossible here (and pinned below by
    // the cross-tenant deny matrix).
    const betaAfter = await evaluate(
      betaService,
      'tenant-beta',
      'read',
      { bundleId: 'bundle-ac12-beta', version: '1.0.0' },
    );
    expect((betaAfter.decision as { effect?: string }).effect).toBe(
      (betaBefore.decision as { effect?: string }).effect,
    );

    // A BETA principal is NEVER allowed by ALPHA policy: evaluating a
    // beta principal against an ALPHA-governed resource denies.
    const crossCommand = alphaService.makeEvaluateCommand(
      principal('tenant-beta', 'principal-beta-intruder'),
      'read',
      toTenantScopedRef({
        recordVersion: 1,
        tenantId: 'tenant-alpha',
        boundaryClass: 'dataset',
        recordId: 'dataset-alpha-1',
      }),
      T0,
      'corr-ac12-cross',
      'idem-ac12-cross',
    );
    const cross = await alphaService.handleEvaluateAuthorizationCommand(
      JSON.stringify(crossCommand),
      { bundleId: 'bundle-ac12-alpha', version: '1.0.0' },
    );
    expect((cross.decision as { effect?: string }).effect).toBe('deny');
  });

  it('re-registering the SAME statement set is idempotent; a SILENT change is an identity conflict; a tampered digest fails closed', async () => {
    const service = new SecurityService();
    const alphaBundle = bundle('tenant-alpha', 'bundle-ac12-idem', ['read']);

    // Idempotent re-registration: same content → the stored bundle.
    const first = await register(service, alphaBundle, 'i1');
    const again = await register(service, alphaBundle, 'i2');
    expect(again.bundle.digest).toBe(first.bundle.digest);

    // A DIFFERENT statement set under the SAME (bundleId, version)
    // identity → typed IDENTITY_CONFLICT (changing a policy requires a
    // new version — silent drift is refused).
    const drifted = bundle('tenant-alpha', 'bundle-ac12-idem', ['read', 'write']);
    let conflictCode = '';
    try {
      await register(service, drifted, 'i3');
    } catch (error) {
      conflictCode = (error as { code?: string }).code ?? '';
    }
    expect(conflictCode).toBe('SECURITY_IDENTITY_CONFLICT');

    // A TAMPERED digest on the wire fails closed (digest verification
    // at registration).
    const tampered = { ...alphaBundle, digest: 'f'.repeat(64) };
    let tamperCode = '';
    try {
      await register(service, tampered, 'i4');
    } catch (error) {
      tamperCode = (error as { code?: string }).code ?? '';
    }
    expect(tamperCode.startsWith('SECURITY_')).toBe(true);
  });

  it('a tenant with NO registered policy is denied (no ambient policy drift)', async () => {
    const service = new SecurityService();
    await register(service, bundle('tenant-alpha', 'bundle-ac12-ambient', ['read']), 'amb');
    // Beta has NO bundle of its own — and NO ambient default from
    // alpha's registration: addressing the ONLY registered bundle with
    // a beta principal + beta-governed resource denies (the tenancy
    // wall inside the evaluation, never an ambient fallback).
    const verdict = await evaluate(
      service,
      'tenant-beta',
      'read',
      { bundleId: 'bundle-ac12-ambient', version: '1.0.0' },
    );
    expect((verdict.decision as { effect?: string }).effect).toBe('deny');

    // And WITHOUT any bundle address at all the evaluation fails closed
    // typed (NOT_FOUND — no ambient policy is reachable).
    const command = service.makeEvaluateCommand(
      principal('tenant-beta', 'principal-beta-orphan'),
      'read',
      toTenantScopedRef({
        recordVersion: 1,
        tenantId: 'tenant-beta',
        boundaryClass: 'dataset',
        recordId: 'dataset-beta-1',
      }),
      T0,
      'corr-ac12-orphan',
      'idem-ac12-orphan',
    );
    let orphanCode = '';
    try {
      await service.handleEvaluateAuthorizationCommand(JSON.stringify(command));
    } catch (error) {
      orphanCode = (error as { code?: string }).code ?? '';
    }
    expect(orphanCode).toBe('SECURITY_NOT_FOUND');
  });
});

describe('AC-12 — the expert-session policy pack (cross-tenant bundling + control conflicts)', () => {
  const packInput = (
    tenantId: string,
    controls: readonly unknown[],
    packId = 'pack-ac12',
  ) => ({
    packId,
    version: 1,
    tenantId,
    displayName: 'adversarial pack probe',
    description: null,
    controls,
    retention: validRetentionSchedule(),
    dataRights: makeDataRights(tenantId, T0),
    jurisdictions: ['EU'],
    residencyRegions: ['eu-central-1'],
    now: T0,
  });

  it('controls from tenant B cannot be bundled into tenant A\'s pack (typed refusal)', () => {
    // Attack shape 1: a pack claiming tenant A whose controls are ALL
    // tenant B's (a whole-sale re-scope attempt) — the tenancy loop
    // refuses typed CROSS_TENANT_POLICY.
    const wholesale = packInput('tenant-alpha', validControls('tenant-beta'));
    let refused = false;
    let code = '';
    try {
      createPolicyPack(wholesale as never);
    } catch (error) {
      refused = true;
      code = (error as { code?: string }).code ?? '';
    }
    expect(refused).toBe(true);
    expect(code).toBe('EXPERT_SESSION_POLICY_CROSS_TENANT_POLICY');

    // Attack shape 2: a MIXED pack (tenant A's controls + one tenant B
    // control smuggled in) — the composition itself refuses the
    // multi-tenant scope as the typed CONFLICTING_CONTROLS failure
    // (tenant-boundary-mismatch: a pack composition is single-tenant,
    // never a silent boundary move).
    const smuggled = packInput('tenant-alpha', [
      ...(validControls('tenant-alpha') as readonly Record<string, unknown>[]),
      validControls('tenant-beta')[0] as Record<string, unknown>,
    ]);
    let mixedCode = '';
    try {
      createPolicyPack(smuggled as never);
    } catch (error) {
      mixedCode = (error as { code?: string }).code ?? '';
    }
    expect(mixedCode).toBe('EXPERT_SESSION_POLICY_CONFLICTING_CONTROLS');
  });

  it('the pack round-trip validates with every control intact; multi-scope controls are the closed conflict', () => {
    // The honest round-trip: a valid pack validates.
    const pack = createPolicyPack(packInput('tenant-alpha', validControls('tenant-alpha')) as never);
    expect(validatePolicyPack(pack).outcome).toBe('valid');
    expect(pack.controls).toHaveLength(validControls('tenant-alpha').length);

    // Multiple action-allowlist controls INTERSECT (the monotone
    // composition — never a conflict, never a silent union either:
    // two disjoint allowlists compose to the empty effective set, the
    // inverse-failure law again).
    const intersecting = createPolicyPack(
      packInput('tenant-alpha', [
        {
          controlVersion: 1,
          kind: 'action-allowlist',
          tenantId: 'tenant-alpha',
          payload: { kind: 'action-allowlist', actions: ['observe-state', 'submit-result'] },
        },
        {
          controlVersion: 1,
          kind: 'action-allowlist',
          tenantId: 'tenant-alpha',
          payload: { kind: 'action-allowlist', actions: ['submit-result', 'annotate'] },
        },
      ]) as never,
    );
    expect(validatePolicyPack(intersecting).outcome).toBe('valid');

    // The closed conflict verdict is reachable through the WIRE shape:
    // a hand-built pack document (the forged-envelope class — bypassing
    // the throwing constructor) carrying controls from TWO tenant
    // scopes gets the closed 'conflicting-controls' outcome from
    // validatePolicyPack (tenant-boundary-mismatch — never a silent
    // boundary move).
    const forged = {
      ...pack,
      controls: [
        validControls('tenant-alpha')[0],
        validControls('tenant-beta')[0],
      ],
    } as never;
    const verdict = validatePolicyPack(forged);
    expect(verdict.outcome).toBe('conflicting-controls');

    // WEAKENING is unrepresentable: the closed payload vocabulary has
    // no 'unrestrict'/'admit' shape — a smuggled weakening control is
    // rejected typed at construction.
    let weakeningRefused = false;
    let weakeningCode = '';
    try {
      createPolicyPack(
        packInput('tenant-alpha', [
          ...(validControls('tenant-alpha') as readonly Record<string, unknown>[]),
          {
            controlVersion: 1,
            kind: 'download-restriction',
            tenantId: 'tenant-alpha',
            payload: { kind: 'download-restriction', restricted: false },
          },
        ]) as never,
      );
    } catch (error) {
      weakeningRefused = true;
      weakeningCode = (error as { code?: string }).code ?? '';
    }
    expect(weakeningRefused).toBe(true);
    expect(weakeningCode.startsWith('EXPERT_SESSION_POLICY_')).toBe(true);
  });

  it('data rights from another owner cannot ride a tenant\'s pack (typed refusal)', () => {
    const attack = packInput('tenant-alpha', validControls('tenant-alpha'));
    (attack as Record<string, unknown>)['dataRights'] = makeDataRights('tenant-beta', T0);
    let refused = false;
    let code = '';
    try {
      createPolicyPack(attack as never);
    } catch (error) {
      refused = true;
      code = (error as { code?: string }).code ?? '';
    }
    expect(refused).toBe(true);
    expect(code).toBe('EXPERT_SESSION_POLICY_CROSS_TENANT_POLICY');
    void toNeutralText;
  });
});
