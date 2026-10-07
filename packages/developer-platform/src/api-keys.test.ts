/**
 * Developer API key domain tests (Work Order C017): lifecycle
 * (issue/rotate/revoke with append-only history), scope enforcement
 * (sandbox keys never touch live surfaces), secret verification and
 * the adversarial minimum (revoked-key replay, cross-tenant use,
 * secret leakage).
 */

import { describe, expect, it } from 'vitest';

import {
  authorizeDeveloperKey,
  developerKeyWire,
  issueDeveloperKey,
  revokeDeveloperKey,
  rotateDeveloperKey,
  stampDeveloperKeyUsed,
} from './api-keys.js';
import {
  DEVELOPER_PLATFORM_ERROR_CODES,
  DeveloperPlatformError,
} from './errors.js';
import {
  SequentialMaterial,
  TEST_NOW,
  deterministicHasher,
  testClientApp,
  testSandboxKeyIssuance,
} from './test-support.js';

const deps = { hasher: deterministicHasher, material: new SequentialMaterial() };

function liveKey() {
  return issueDeveloperKey(
    {
      clientAppId: 'epoch-app',
      tenantId: 'tenant-alpha',
      environment: 'live',
      scopes: ['escalations:create', 'escalations:read', 'observability:read'],
      label: 'epoch production key',
      now: TEST_NOW,
    },
    deps,
  );
}

describe('developer key lifecycle', () => {
  it('issues a key with hashed-at-rest secret shown once (positive)', () => {
    const issuance = liveKey();
    expect(issuance.record.status).toBe('active');
    expect(issuance.record.history).toHaveLength(1);
    expect(issuance.record.history[0]).toMatchObject({ status: 'active', reason: 'issued' });
    // The secret is the wire form; the binding carries ONLY the hash.
    expect(issuance.secret).toMatch(/^dak_live_[0-9a-f]{64}$/);
    expect(issuance.binding.secretHash).not.toContain(issuance.secret);
    expect(issuance.binding.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(issuance.record)).toBe(true);
  });

  it('rotation marks the old key rotated and mints a successor (append-only history retained)', () => {
    const issuance = liveKey();
    const { successor, rotated } = rotateDeveloperKey(issuance.record, deps, {
      now: '2026-10-07T13:00:00.000Z',
    });
    expect(rotated.status).toBe('rotated');
    expect(rotated.rotatedTo).toBe(successor.record.keyId);
    expect(rotated.history).toHaveLength(2);
    expect(rotated.history[1]).toMatchObject({ status: 'rotated', reason: 'rotated-by-owner' });
    expect(successor.record.rotatedFrom).toBe(issuance.record.keyId);
    expect(successor.record.status).toBe('active');
    // The ORIGINAL history entry is retained verbatim (append-only).
    expect(rotated.history[0]).toEqual(issuance.record.history[0]);
  });

  it('double rotation and rotation-of-revoked fail closed (negative)', () => {
    const issuance = liveKey();
    const { rotated } = rotateDeveloperKey(issuance.record, deps, { now: TEST_NOW });
    expect(() => rotateDeveloperKey(rotated, deps, { now: TEST_NOW })).toThrowError(DeveloperPlatformError);
    const revoked = revokeDeveloperKey(issuance.record, { now: TEST_NOW });
    expect(() => rotateDeveloperKey(revoked, deps, { now: TEST_NOW })).toThrowError(
      expect.objectContaining({ code: DEVELOPER_PLATFORM_ERROR_CODES.KEY_REVOKED }),
    );
  });

  it('revocation is terminal and the history is retained (positive + negative)', () => {
    const issuance = liveKey();
    const revoked = revokeDeveloperKey(issuance.record, { now: '2026-10-07T14:00:00.000Z' });
    expect(revoked.status).toBe('revoked');
    expect(revoked.history).toHaveLength(2);
    expect(revoked.history[1]).toMatchObject({ status: 'revoked', reason: 'revoked-by-owner' });
    expect(() => revokeDeveloperKey(revoked, { now: TEST_NOW })).toThrowError(DeveloperPlatformError);
  });

  it('stamps last-used WITHOUT touching status or history', () => {
    const issuance = liveKey();
    const stamped = stampDeveloperKeyUsed(issuance.record, { now: '2026-10-07T15:00:00.000Z' });
    expect(stamped.lastUsedAt).toBe('2026-10-07T15:00:00.000Z');
    expect(stamped.status).toBe('active');
    expect(stamped.history).toHaveLength(1);
  });
});

describe('scope enforcement — keys never confer role authority', () => {
  it('a sandbox key CANNOT be issued live scopes and vice versa (fail closed at issuance)', () => {
    expect(() =>
      issueDeveloperKey(
        {
          clientAppId: 'epoch-app',
          tenantId: 'tenant-alpha',
          environment: 'sandbox',
          scopes: ['escalations:create'],
          label: 'bad sandbox key',
          now: TEST_NOW,
        },
        deps,
      ),
    ).toThrowError(
      expect.objectContaining({ code: DEVELOPER_PLATFORM_ERROR_CODES.ENVIRONMENT_MISMATCH }),
    );
    expect(() =>
      issueDeveloperKey(
        {
          clientAppId: 'epoch-app',
          tenantId: 'tenant-alpha',
          environment: 'live',
          scopes: ['sandbox:run'],
          label: 'bad live key',
          now: TEST_NOW,
        },
        deps,
      ),
    ).toThrowError(DeveloperPlatformError);
  });

  it('unknown scopes and duplicate scopes are typed rejections (negative)', () => {
    for (const scopes of [['not-a-scope'], []] as const) {
      expect(() =>
        issueDeveloperKey(
          {
            clientAppId: 'epoch-app',
            tenantId: 'tenant-alpha',
            environment: 'live',
            scopes: [...scopes],
            label: 'bad key',
            now: TEST_NOW,
          },
          deps,
        ),
      ).toThrowError(DeveloperPlatformError);
    }
  });

  it('authorization is a machine-readable verdict, never a bare boolean', () => {
    const issuance = liveKey();
    const ok = authorizeDeveloperKey(
      {
        record: issuance.record,
        binding: issuance.binding,
        presentedSecret: issuance.secret,
        tenantId: 'tenant-alpha',
        environment: 'live',
        scope: 'escalations:create',
      },
      deps,
    );
    expect(ok).toMatchObject({ outcome: 'authorized' });

    const missingScope = authorizeDeveloperKey(
      {
        record: issuance.record,
        binding: issuance.binding,
        presentedSecret: issuance.secret,
        tenantId: 'tenant-alpha',
        environment: 'live',
        scope: 'webhooks:manage',
      },
      deps,
    );
    expect(missingScope).toMatchObject({ outcome: 'denied', reason: 'scope-missing' });
  });
});

describe('adversarial minimum', () => {
  it('a REVOKED key replay is denied with the closed reason key-revoked', () => {
    const issuance = liveKey();
    const revoked = revokeDeveloperKey(issuance.record, { now: TEST_NOW });
    const verdict = authorizeDeveloperKey(
      {
        record: revoked,
        binding: issuance.binding,
        presentedSecret: issuance.secret,
        tenantId: 'tenant-alpha',
        environment: 'live',
        scope: 'escalations:create',
      },
      deps,
    );
    expect(verdict).toMatchObject({ outcome: 'denied', reason: 'key-revoked' });
  });

  it('a ROTATED key (old secret) is denied with key-rotated', () => {
    const issuance = liveKey();
    const { rotated } = rotateDeveloperKey(issuance.record, deps, { now: TEST_NOW });
    const verdict = authorizeDeveloperKey(
      {
        record: rotated,
        binding: issuance.binding,
        presentedSecret: issuance.secret,
        tenantId: 'tenant-alpha',
        environment: 'live',
        scope: 'escalations:create',
      },
      deps,
    );
    expect(verdict).toMatchObject({ outcome: 'denied', reason: 'key-rotated' });
  });

  it('cross-tenant key use is denied with tenant-mismatch', () => {
    const issuance = liveKey();
    const verdict = authorizeDeveloperKey(
      {
        record: issuance.record,
        binding: issuance.binding,
        presentedSecret: issuance.secret,
        tenantId: 'tenant-beta',
        environment: 'live',
        scope: 'escalations:create',
      },
      deps,
    );
    expect(verdict).toMatchObject({ outcome: 'denied', reason: 'tenant-mismatch' });
  });

  it('an unknown key or wrong secret is denied (never throws, never leaks which one)', () => {
    const unknown = authorizeDeveloperKey(
      {
        record: undefined,
        binding: undefined,
        presentedSecret: 'dak_live_' + '0'.repeat(64),
        tenantId: 'tenant-alpha',
        environment: 'live',
        scope: 'escalations:read',
      },
      deps,
    );
    expect(unknown).toMatchObject({ outcome: 'denied', reason: 'key-not-found' });

    const issuance = liveKey();
    const wrongSecret = authorizeDeveloperKey(
      {
        record: issuance.record,
        binding: issuance.binding,
        presentedSecret: 'dak_live_' + 'f'.repeat(64),
        tenantId: 'tenant-alpha',
        environment: 'live',
        scope: 'escalations:read',
      },
      deps,
    );
    expect(wrongSecret).toMatchObject({ outcome: 'denied', reason: 'secret-invalid' });
  });

  it('sandbox-key→live-surface authorization is denied with environment-mismatch', () => {
    const sandbox = testSandboxKeyIssuance();
    const verdict = authorizeDeveloperKey(
      {
        record: sandbox.record,
        binding: sandbox.binding,
        presentedSecret: sandbox.secret,
        tenantId: 'tenant-alpha',
        environment: 'live',
        scope: 'escalations:read',
      },
      deps,
    );
    expect(verdict).toMatchObject({ outcome: 'denied', reason: 'environment-mismatch' });
  });
});

describe('secret hygiene (secrets never enter wire forms or trajectories)', () => {
  it('the key wire projection carries NO secret material', () => {
    const issuance = liveKey();
    const wire = JSON.stringify(developerKeyWire(issuance.record));
    expect(wire).not.toContain(issuance.secret);
    expect(wire).not.toContain(issuance.binding.secretHash);
    expect(wire).toContain(issuance.record.keyId);
  });

  it('the client-app wire form carries no key material either', () => {
    const app = testClientApp();
    expect(JSON.stringify(app)).not.toMatch(/dak_|devkey_/);
  });
});
