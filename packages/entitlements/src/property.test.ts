import { describe, expect, it } from 'vitest';
import {
  amendEntitlementGrant,
  appendUsageMeterEvent,
  createQuotaGrant,
  createUsageMeterLog,
  isGrantActive,
  meteredTotals,
  resolveEntitlements,
  revokeEntitlementGrant,
  toUsageRecordedEvent,
  toUsageRevisedEvent,
  verifyUsageMeterLog,
} from './index.js';
import type { EntitlementGrant, QuotaGrant } from './index.js';
import { FEATURE_COMPUTE, TENANT_A, TENANT_B, T0 } from './test-support.js';

/** Deterministic in-file LCG (the house property-test discipline: no Math.random). */
class Lcg {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

const SEEDS = [1, 42, 20260201, 777, 314159];

/** Deterministic ms-UTC timestamps on a fixed grid (seconds granularity). */
function ts(seconds: number): string {
  return new Date(Date.parse(T0) + seconds * 1000).toISOString();
}

describe('property tests (seeded, deterministic)', () => {
  it('the LCG is deterministic', () => {
    const a = new Lcg(7);
    const b = new Lcg(7);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('P1: resolution never crosses tenants and never allows without an active grant', () => {
    for (const seed of SEEDS) {
      const rng = new Lcg(seed);
      const grants: EntitlementGrant[] = [];
      for (let i = 0; i < 8; i += 1) {
        grants.push(
          createQuotaGrant({
            grantId: `g-${seed}-${i}`,
            tenantId: rng.next() < 0.5 ? TENANT_A : TENANT_B,
            featureKey: rng.next() < 0.5 ? FEATURE_COMPUTE : 'evaluation.run',
            issuedAt: ts(0),
            validFrom: ts(rng.int(0, 100)),
            ...(rng.next() < 0.5 ? { expiresAt: ts(rng.int(200, 400)) } : {}),
            limit: rng.int(1, 50),
            window: 'day',
          }),
        );
      }
      for (let probe = 0; probe < 40; probe += 1) {
        const at = ts(rng.int(0, 500));
        const resolution = resolveEntitlements(grants, TENANT_A, FEATURE_COMPUTE, at);
        for (const grant of resolution.grants) {
          expect(grant.tenantId).toBe(TENANT_A);
          expect(grant.featureKey).toBe(FEATURE_COMPUTE);
          expect(isGrantActive(grant, at)).toBe(true);
        }
        if (!resolution.allowed) {
          expect(resolution.grants).toEqual([]);
        }
      }
    }
  });

  it('P2: lineage is append-only — originals stay frozen and sequences stay contiguous', () => {
    for (const seed of SEEDS) {
      const rng = new Lcg(seed);
      let grant: EntitlementGrant = createQuotaGrant({
        grantId: `g-${seed}`,
        tenantId: TENANT_A,
        featureKey: FEATURE_COMPUTE,
        issuedAt: ts(0),
        validFrom: ts(0),
        limit: 10,
        window: 'day',
      });
      const snapshots: EntitlementGrant[] = [grant];
      let clock = 1;
      let revoked = false;
      for (let step = 0; step < 6 && !revoked; step += 1) {
        clock += rng.int(1, 50);
        if (rng.next() < 0.2) {
          grant = revokeEntitlementGrant(grant, ts(clock));
          revoked = true;
        } else {
          grant = amendEntitlementGrant(grant, { limit: rng.int(1, 99) }, ts(clock));
        }
        snapshots.push(grant);
        expect(grant.lineage).toHaveLength(step + 2);
        expect(grant.lineage[grant.lineage.length - 1]?.sequence).toBe(step + 2);
      }
      // every earlier snapshot is unchanged and still validates
      snapshots.forEach((snapshot, index) => {
        expect(snapshot.lineage).toHaveLength(index + 1);
      });
      expect((snapshots[0] as QuotaGrant | undefined)?.limit).toBe(10);
    }
  });

  it('P3: the expiry boundary is exact — active at expiresAt-1ms, inactive at expiresAt', () => {
    for (const seed of SEEDS) {
      const rng = new Lcg(seed);
      const expiryMs = Date.parse(T0) + rng.int(1, 1000) * 1000;
      const grant = createQuotaGrant({
        grantId: `g-${seed}`,
        tenantId: TENANT_A,
        featureKey: FEATURE_COMPUTE,
        issuedAt: T0,
        validFrom: T0,
        expiresAt: new Date(expiryMs).toISOString(),
        limit: 1,
        window: 'day',
      });
      expect(isGrantActive(grant, new Date(expiryMs - 1).toISOString())).toBe(true);
      expect(isGrantActive(grant, new Date(expiryMs).toISOString())).toBe(false);
    }
  });

  it('P4: random legal meter streams verify and totals equal the replayed sum', () => {
    for (const seed of SEEDS) {
      const rng = new Lcg(seed);
      let log = createUsageMeterLog(TENANT_A);
      let clock = 0;
      let total = 0;
      for (let sequence = 1; sequence <= 30; sequence += 1) {
        clock += rng.int(0, 30);
        if (total > 0 && rng.next() < 0.3) {
          const delta = -rng.int(1, Math.min(total, 5));
          total += delta;
          log = appendUsageMeterEvent(
            log,
            toUsageRevisedEvent({
              sequence,
              occurredAt: ts(clock),
              tenantId: TENANT_A,
              featureKey: FEATURE_COMPUTE,
              delta,
              reason: `deterministic correction ${sequence}`,
            }),
          );
        } else {
          const units = rng.int(1, 9);
          total += units;
          log = appendUsageMeterEvent(
            log,
            toUsageRecordedEvent({
              sequence,
              occurredAt: ts(clock),
              tenantId: TENANT_A,
              featureKey: FEATURE_COMPUTE,
              units,
            }),
          );
        }
      }
      expect(verifyUsageMeterLog(log)).toBeUndefined();
      expect(meteredTotals(log)[FEATURE_COMPUTE]).toBe(total);
      expect(total).toBeGreaterThan(0);
    }
  });
});
