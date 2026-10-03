import { describe, expect, it } from 'vitest';

import {
  buildEntitlementHistory,
  entitlementGrantInput,
  entitlementStateFromGrantRecord,
  entitlementStateFromMarketplaceGrant,
  entitlementStateLabel,
  MARKETPLACE_FIXTURE_AT,
  MARKETPLACE_FIXTURE_TIMELINE,
  noGrantEntitlement,
} from './index.js';

const T = MARKETPLACE_FIXTURE_TIMELINE;

describe('entitlement state machine (B013 — explicit, never implied)', () => {
  it('derives granted from an active grant at a valid time (positive)', () => {
    const view = entitlementStateFromGrantRecord(entitlementGrantInput('granted'), MARKETPLACE_FIXTURE_AT);
    expect(view.state).toBe('granted');
    expect(view.stateLabel).toBe('Granted');
    expect(view.truthClass).toBe('verified-fact');
    expect(view.validFrom).toBe(T.validFrom);
    expect(view.unknownFields).toHaveLength(0);
  });

  it('derives pending before validFrom — its own truth class (positive)', () => {
    const view = entitlementStateFromGrantRecord(entitlementGrantInput('pending'), MARKETPLACE_FIXTURE_AT);
    expect(view.state).toBe('pending');
    expect(view.stateLabel).toBe('Pending (not yet active)');
    expect(view.truthClass).toBe('pending');
  });

  it('derives revoked from the terminal lineage event — revoked wins over expiry (boundary)', () => {
    const grant = {
      ...(entitlementGrantInput('granted') as Record<string, unknown>),
      expiresAt: T.expiresAt,
      lineage: [
        { sequence: 1, kind: 'granted', occurredAt: T.grantedAt, note: 'initial grant' },
        { sequence: 2, kind: 'revoked', occurredAt: T.revokedAt, note: 'policy violation — terminal' },
      ],
    };
    const view = entitlementStateFromGrantRecord(grant, MARKETPLACE_FIXTURE_AT);
    expect(view.state).toBe('revoked');
    expect(view.revokedAt).toBe(T.revokedAt);
    expect(view.grounds).toBe('policy violation — terminal');
    expect(view.truthClass).toBe('verified-fact');
  });

  it('derives expired at the exact expiry boundary (at === expiresAt) (boundary)', () => {
    const grant = {
      ...(entitlementGrantInput('granted') as Record<string, unknown>),
      expiresAt: T.expiresAt,
    };
    expect(entitlementStateFromGrantRecord(grant, T.expiresAt).state).toBe('expired');
    // One millisecond before expiry the grant is still granted.
    const before = new Date(Date.parse(T.expiresAt) - 1).toISOString();
    expect(entitlementStateFromGrantRecord(grant, before).state).toBe('granted');
  });

  it('derives granted at the exact validity boundary (at === validFrom) (boundary)', () => {
    expect(
      entitlementStateFromGrantRecord(entitlementGrantInput('granted'), T.validFrom).state,
    ).toBe('granted');
    const before = new Date(Date.parse(T.validFrom) - 1).toISOString();
    expect(
      entitlementStateFromGrantRecord(entitlementGrantInput('granted'), before).state,
    ).toBe('pending');
  });

  it('fails closed to unknown without an evaluation time (negative)', () => {
    const view = entitlementStateFromGrantRecord(entitlementGrantInput('granted'), undefined);
    expect(view.state).toBe('unknown');
    // The lineage-decidable revoked state survives even without a time.
    const revoked = entitlementStateFromGrantRecord(entitlementGrantInput('revoked'), undefined);
    expect(revoked.state).toBe('revoked');
  });

  it('fails closed to unknown on malformed grants (negative)', () => {
    const view = entitlementStateFromGrantRecord(entitlementGrantInput('malformed'), MARKETPLACE_FIXTURE_AT);
    expect(view.state).toBe('unknown');
    expect(view.unknownFields).toContain('lineage');
    expect(view.unknownFields).toContain('grantId');
  });

  it('maps marketplace grant records: issuance, revocation, expiry, pending (positive)', () => {
    const issuance = {
      kind: 'grant-issuance',
      grantId: 'g1',
      offer: { offerId: 'solder-defect-dataset' },
      granteeTenant: 'tenant-a',
      permittedUse: 'evaluation',
      grantedAt: T.grantedAt,
      expiresAt: null,
    };
    expect(entitlementStateFromMarketplaceGrant(issuance, MARKETPLACE_FIXTURE_AT).state).toBe('granted');
    const revocation = {
      kind: 'grant-revocation',
      grantId: 'g1',
      offer: { offerId: 'solder-defect-dataset' },
      granteeTenant: 'tenant-a',
      grounds: 'licence review',
      provenance: { recordedAt: T.revokedAt },
    };
    const revokedView = entitlementStateFromMarketplaceGrant(revocation, MARKETPLACE_FIXTURE_AT);
    expect(revokedView.state).toBe('revoked');
    expect(revokedView.revokedAt).toBe(T.revokedAt);
    expect(revokedView.lineage[0]?.kind).toBe('revoked');
    const expiredIssuance = { ...issuance, expiresAt: T.expiresAt };
    expect(entitlementStateFromMarketplaceGrant(expiredIssuance, MARKETPLACE_FIXTURE_AT).state).toBe(
      'expired',
    );
    const futureIssuance = { ...issuance, grantedAt: T.pendingFrom };
    expect(entitlementStateFromMarketplaceGrant(futureIssuance, MARKETPLACE_FIXTURE_AT).state).toBe(
      'pending',
    );
  });

  it('renders the no-grant state explicitly — never implied by ownership (negative)', () => {
    const view = noGrantEntitlement();
    expect(view.state).toBe('unknown');
    expect(view.stateLabel).toBe('Entitlement unknown');
    expect(view.scopeNote).toContain('never implied');
    expect(view.unknownFields).toContain('grant record (absent)');
  });

  it('projects the append-only lineage history of a grant (positive)', () => {
    const history = buildEntitlementHistory(entitlementGrantInput('revoked'));
    expect(history).toHaveLength(2);
    expect(history[0]?.kind).toBe('granted');
    expect(history[1]?.kind).toBe('revoked');
    expect(history[1]?.occurredAt).toBe(T.revokedAt);
  });

  it('is deterministic (positive)', () => {
    expect(entitlementStateFromGrantRecord(entitlementGrantInput('granted'), MARKETPLACE_FIXTURE_AT)).toEqual(
      entitlementStateFromGrantRecord(entitlementGrantInput('granted'), MARKETPLACE_FIXTURE_AT),
    );
    expect(entitlementStateLabel('expired')).toBe('Expired');
  });
});
