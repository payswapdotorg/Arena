/**
 * B015 fail-closed tests: quota exhaustion and disabled wiring REFUSE the
 * operation through the typed capacity error; there is no fallback path
 * (FT2.0: "Adapters never silently switch to a paid path"). These are the
 * deterministic, credential-free proofs of the product truth.
 */

import { describe, expect, it } from 'vitest';
import {
  isCapacityUsable,
  isPersistenceCapacityError,
  ManualClock,
  PERSISTENCE_ERROR_CODES,
  toCapacitySnapshot,
} from '@arena/persistence';
import type {
  CapacityReason,
  CapacitySnapshot,
  Clock,
  ProviderCapacityStatus,
} from '@arena/persistence';
import type { RegisteredPersistenceProvider } from '@arena/persistence-service';
import {
  evaluateHostedQuotaReading,
  guardHostedPreviewCapacity,
  HOSTED_PREVIEW_EXHAUSTION_POLICY,
  NO_BILLABLE_FALLBACK,
  refuseHostedOperationWhenBlocking,
} from './fail-closed.js';
import { composeHostedPersistenceStack } from './wiring.js';
import { DRY_RUN_PLACEHOLDER_ENV } from './dry-run.js';
import { FakeObjectStorageTransport, FakeRestTransport, FakeSqlTransport } from './fakes.js';

const CLOCK: Clock = new ManualClock(42);

function probeWithStatus(
  status: ProviderCapacityStatus,
  reasons: readonly CapacityReason[] = [],
): { capacityProbe(): Promise<CapacitySnapshot> } {
  return {
    capacityProbe: async () =>
      toCapacitySnapshot({ status, checkedAt: CLOCK.now(), dimensions: [], reasons }),
  };
}

function providerOf(
  providerId: string,
  status: ProviderCapacityStatus,
  reasons: readonly CapacityReason[] = [],
): RegisteredPersistenceProvider {
  return { providerId, probe: probeWithStatus(status, reasons) };
}

describe('B015 quota fail-closed policy', () => {
  it('pins the exhaustion policy to fail-closed with no billable fallback', () => {
    expect(HOSTED_PREVIEW_EXHAUSTION_POLICY).toBe('fail-closed');
    expect(NO_BILLABLE_FALLBACK).toBe(true);
  });
});

describe('B015 capacity guard (composition-level gate)', () => {
  it('passes usable providers (AVAILABLE) and returns the capacity report', async () => {
    const report = await guardHostedPreviewCapacity(
      [providerOf('control-plane-store', 'AVAILABLE'), providerOf('object-store', 'AVAILABLE')],
      CLOCK,
    );
    expect(report.overall).toBe('AVAILABLE');
    expect(report.providers.map((entry) => entry.providerId)).toEqual([
      'control-plane-store',
      'object-store',
    ]);
  });

  it('REFUSES an EXHAUSTED provider with the typed error (no fallback)', async () => {
    let caught: unknown;
    try {
      await guardHostedPreviewCapacity(
        [providerOf('control-plane-store', 'AVAILABLE'), providerOf('object-store', 'EXHAUSTED', [{ code: 'quota-exhausted' }])],
        CLOCK,
      );
    } catch (error) {
      caught = error;
    }
    if (!isPersistenceCapacityError(caught)) {
      throw new Error('expected a PersistenceCapacityError');
    }
    expect(caught.capacityStatus).toBe('EXHAUSTED');
    expect(caught.code).toBe(PERSISTENCE_ERROR_CODES.CAPACITY_EXHAUSTED);
    expect(caught.capacityReasons).toContainEqual({ code: 'quota-exhausted' });
    expect(caught.message).toContain('no alternate path');
  });

  it('REFUSES a DISABLED provider with the typed error (first blocking provider wins)', async () => {
    await expect(
      guardHostedPreviewCapacity(
        [providerOf('control-plane-store', 'DISABLED'), providerOf('object-store', 'EXHAUSTED')],
        CLOCK,
      ),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        isPersistenceCapacityError(error) &&
        error.capacityStatus === 'DISABLED' &&
        error.code === PERSISTENCE_ERROR_CODES.CAPACITY_DISABLED
      );
    });
  });

  it('DEGRADED (near-limit) stays usable — flagged, never refused', async () => {
    const report = await guardHostedPreviewCapacity(
      [providerOf('coordination-store', 'DEGRADED')],
      CLOCK,
    );
    expect(report.overall).toBe('DEGRADED');
    expect(isCapacityUsable(report.overall)).toBe(true);
  });
});

describe('B015 quota reading evaluation (deterministic boundaries)', () => {
  it('AVAILABLE while quota remains above the near-limit fraction', () => {
    expect(evaluateHostedQuotaReading(400_000, 500_000).status).toBe('AVAILABLE');
    expect(evaluateHostedQuotaReading(0, 500_000).status).toBe('AVAILABLE');
  });

  it('DEGRADED when remaining falls below 10% of the limit (near-limit flag)', () => {
    const near = evaluateHostedQuotaReading(475_000, 500_000);
    expect(near.status).toBe('DEGRADED');
    expect(near.reasons).toContainEqual({ code: 'dimension-near-limit', dimension: 'quota' });
  });

  it('EXHAUSTED exactly at the limit', () => {
    expect(evaluateHostedQuotaReading(500_000, 500_000).status).toBe('EXHAUSTED');
    expect(evaluateHostedQuotaReading(500_000, 500_000).reasons).toContainEqual({
      code: 'quota-exhausted',
      dimension: 'quota',
    });
  });
});

describe('B015 refusal reaction (the only sanctioned reaction)', () => {
  it('throws the typed error for EXHAUSTED/DISABLED observations, returns void otherwise', () => {
    expect(() => refuseHostedOperationWhenBlocking({ status: 'AVAILABLE' })).not.toThrow();
    expect(() => refuseHostedOperationWhenBlocking({ status: 'DEGRADED' })).not.toThrow();
    expect(() => refuseHostedOperationWhenBlocking({ status: 'EXHAUSTED' })).toThrowError(
      /exhausted; failing closed/,
    );
    expect(() => refuseHostedOperationWhenBlocking({ status: 'DISABLED' })).toThrowError(
      /disabled \(missing configuration\); failing closed/,
    );
  });
});

describe('B015 fail-closed against the composed wiring (adversarial)', () => {
  it('an unconfigured composed stack is refused by the guard (DISABLED posture)', async () => {
    const stack = composeHostedPersistenceStack({ env: {}, clock: CLOCK });
    await expect(guardHostedPreviewCapacity(stack.providers, CLOCK)).rejects.toSatisfy(
      (error: unknown) =>
        isPersistenceCapacityError(error) && error.capacityStatus === 'DISABLED',
    );
  });

  it('a fully-configured stack against local fakes passes the guard', async () => {
    const stack = composeHostedPersistenceStack({
      env: DRY_RUN_PLACEHOLDER_ENV,
      clock: CLOCK,
      transports: {
        sql: new FakeSqlTransport({ enforceTables: true }),
        objectStorage: new FakeObjectStorageTransport(),
        rest: new FakeRestTransport({ clock: CLOCK }),
      },
    });
    const report = await guardHostedPreviewCapacity(stack.providers, CLOCK);
    expect(report.overall).toBe('AVAILABLE');
  });
});
