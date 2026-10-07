/**
 * Availability/capacity model unit + adversarial tests (Work Order C011).
 */

import { describe, expect, it } from 'vitest';
import {
  availabilityWindowKey,
  checkCapacity,
  committedSlotsByWindow,
  createAvailabilityDeclaration,
  engagementWindowKey,
  isAvailabilityWindow,
  occupiesCapacity,
  resolveAvailabilityAtOfferTime,
  resolveCurrentDeclaration,
  supersedes,
  toRoutingAvailabilityInput,
  verifyAvailabilityDeclarationDigest,
  windowIntersectsInterval,
} from './availability.js';
import type { AvailabilityDeclaration, CapacityCommitment, DeclaredWindow } from './availability.js';
import { EXPERT_ENGAGEMENT_ERROR_CODES, ExpertEngagementError } from './errors.js';

const T0 = '2026-10-07T09:00:00.000Z';
const DEADLINE = '2026-10-08T09:00:00.000Z';
const DIGEST = 'a'.repeat(64);

function expectCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(ExpertEngagementError);
  expect((error as ExpertEngagementError).code).toBe(code);
}

async function declare(overrides: {
  version?: number;
  windows?: {
    window: { recurrence: 'weekly' | 'one-time'; dayOfWeek?: number; startUtc: string; endUtc: string; date?: string };
    capacitySlots: number;
  }[];
  declarationId?: string;
}): Promise<AvailabilityDeclaration> {
  return createAvailabilityDeclaration({
    declarationId: overrides.declarationId ?? 'avail-expert-one-1',
    tenant: 'tenant-a',
    expertId: 'expert-one',
    version: overrides.version ?? 1,
    windows:
      overrides.windows ?? [
        {
          window: { recurrence: 'weekly' as const, dayOfWeek: 3, startUtc: '09:00', endUtc: '17:00' },
          capacitySlots: 2,
        },
      ],
    declaredAt: T0,
  });
}

describe('createAvailabilityDeclaration', () => {
  it('constructs a frozen, content-addressed versioned declaration', async () => {
    const declaration = await declare({});
    expect(declaration.version).toBe(1);
    expect(declaration.windows.length).toBe(1);
    expect(declaration.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(declaration)).toBe(true);
  });

  it('rejects empty window sets and duplicate windows', async () => {
    await expect(declare({ windows: [] })).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_WINDOW);
      return true;
    });
    const duplicateWindow = {
      window: { recurrence: 'weekly' as const, dayOfWeek: 3, startUtc: '09:00', endUtc: '17:00' },
      capacitySlots: 1,
    };
    await expect(declare({ windows: [duplicateWindow, duplicateWindow] })).rejects.toSatisfy(
      (error: unknown) => {
        expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_WINDOW);
        return true;
      },
    );
  });

  it('rejects invalid windows and non-positive capacity (fail-closed)', async () => {
    await expect(
      declare({
        windows: [
          { window: { recurrence: 'hourly' as 'weekly' | 'one-time', startUtc: '09:00', endUtc: '17:00' }, capacitySlots: 1 },
        ],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_WINDOW);
      return true;
    });
    await expect(
      declare({
        windows: [
          {
            window: { recurrence: 'weekly' as const, dayOfWeek: 3, startUtc: '09:00', endUtc: '17:00' },
            capacitySlots: 0,
          },
        ],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD);
      return true;
    });
    expect(isAvailabilityWindow({ recurrence: 'weekly', startUtc: '17:00', endUtc: '09:00' })).toBe(
      false,
    );
    // A one-time window without a date is shape-valid (A006/A007 view
    // compatibility) but never intersects an interval (C002 arithmetic).
    expect(isAvailabilityWindow({ recurrence: 'one-time', startUtc: '09:00', endUtc: '17:00' })).toBe(
      true,
    );
  });
});

describe('versioning + current-version resolution', () => {
  it('higher versions supersede lower; current resolves deterministically', async () => {
    const v1 = await declare({ version: 1 });
    const v2 = await declare({ version: 2 });
    expect(supersedes(v2, v1)).toBe(true);
    expect(supersedes(v1, v2)).toBe(false);
    expect(resolveCurrentDeclaration([v1, v2], 'tenant-a', 'expert-one')?.version).toBe(2);
    expect(resolveCurrentDeclaration([v1], 'tenant-a', 'expert-one')?.version).toBe(1);
    expect(resolveCurrentDeclaration([v1], 'tenant-b', 'expert-one')).toBeNull();
  });

  it('same-version duplicates fail closed (VERSION_CONFLICT)', async () => {
    const a = await declare({ version: 3, declarationId: 'avail-expert-one-3a' });
    const b = await declare({ version: 3, declarationId: 'avail-expert-one-3b' });
    expect(() => resolveCurrentDeclaration([a, b], 'tenant-a', 'expert-one')).toThrow(
      ExpertEngagementError,
    );
  });

  it('ADVERSARIAL: tampered declaration fails digest verification', async () => {
    const declaration = await declare({});
    await expect(verifyAvailabilityDeclarationDigest(declaration)).resolves.toBe(
      declaration.digest,
    );
    const firstWindow = declaration.windows[0] as DeclaredWindow;
    const tampered = {
      ...declaration,
      windows: [...declaration.windows, firstWindow],
    };
    await expect(verifyAvailabilityDeclarationDigest(tampered)).rejects.toSatisfy(
      (error: unknown) => {
        expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.TAMPERED);
        return true;
      },
    );
  });
});

describe('capacity accounting', () => {
  const commitmentFor = (engagementId: string, windowKey: string): CapacityCommitment => ({
    engagementId,
    tenant: 'tenant-a',
    expertId: 'expert-one',
    windowKey,
  });

  it('recomputes committed slots; accepted/active occupy, offered does not', () => {
    expect(occupiesCapacity('accepted')).toBe(true);
    expect(occupiesCapacity('active')).toBe(true);
    expect(occupiesCapacity('offered')).toBe(false);
    const counts = committedSlotsByWindow(
      'tenant-a',
      'expert-one',
      [
        commitmentFor('eng-1', 'k'),
        commitmentFor('eng-2', 'k'),
        commitmentFor('eng-3', 'other'),
        { engagementId: 'eng-4', tenant: 'tenant-b', expertId: 'expert-one', windowKey: 'k' },
      ],
    );
    expect(counts.get('k')).toBe(2);
    expect(counts.get('other')).toBe(1);
  });

  it('ADVERSARIAL: a fully-committed window refuses one more engagement (cannot overcommit)', async () => {
    const declaration = await declare({}); // capacitySlots = 2
    const window = declaration.windows[0]?.window;
    if (window === undefined) throw new Error('fixture');
    const key = availabilityWindowKey(window);
    const commitments = [commitmentFor('eng-1', key), commitmentFor('eng-2', key)];
    const verdict = checkCapacity(declaration, window, commitments);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('capacity-exceeded');
    expect(verdict.remaining).toBe(0);
    expect(verdict.committed).toBe(2);
    expect(verdict.capacitySlots).toBe(2);
    // One free slot still admits.
    const withOne = checkCapacity(declaration, window, [commitmentFor('eng-1', key)]);
    expect(withOne.allowed).toBe(true);
    expect(withOne.reason).toBe('capacity-available');
    expect(withOne.remaining).toBe(1);
  });

  it('an unknown window fails closed (capacity-window-unknown)', async () => {
    const declaration = await declare({});
    const verdict = checkCapacity(
      declaration,
      { recurrence: 'weekly' as const, dayOfWeek: 5, startUtc: '09:00', endUtc: '17:00' },
      [],
    );
    expect(verdict.reason).toBe('capacity-window-unknown');
    expect(verdict.allowed).toBe(false);
  });
});

describe('deterministic availability resolution', () => {
  it('a weekly window intersecting [offer, deadline] resolves available', async () => {
    const declaration = await declare({});
    // 2026-10-07 is a Wednesday (ISO day 3) — the fixture window matches.
    const resolution = resolveAvailabilityAtOfferTime(declaration, T0, DEADLINE, []);
    expect(resolution.available).toBe(true);
    expect(resolution.reason).toBe('availability-ok');
    expect(resolution.remaining).toBe(2);
  });

  it('no declaration resolves unavailable with the typed reason', () => {
    const resolution = resolveAvailabilityAtOfferTime(null, T0, DEADLINE, []);
    expect(resolution.available).toBe(false);
    expect(resolution.reason).toBe('availability-no-declaration');
  });

  it('a window outside the demand interval is not available', async () => {
    const declaration = await declare({
      windows: [
        {
          window: { recurrence: 'one-time' as const, date: '2026-11-01', startUtc: '09:00', endUtc: '17:00' },
          capacitySlots: 1,
        },
      ],
    });
    const resolution = resolveAvailabilityAtOfferTime(declaration, T0, DEADLINE, []);
    expect(resolution.available).toBe(false);
    expect(resolution.reason).toBe('availability-no-window-in-interval');
  });

  it('ADVERSARIAL: a window in-interval with zero remaining capacity is unavailable', async () => {
    const declaration = await declare({
      windows: [
        {
          window: { recurrence: 'weekly' as const, dayOfWeek: 3, startUtc: '09:00', endUtc: '17:00' },
          capacitySlots: 1,
        },
      ],
    });
    const window = declaration.windows[0]?.window;
    if (window === undefined) throw new Error('fixture');
    const commitments: CapacityCommitment[] = [
      { engagementId: 'eng-1', tenant: 'tenant-a', expertId: 'expert-one', windowKey: availabilityWindowKey(window) },
    ];
    const resolution = resolveAvailabilityAtOfferTime(declaration, T0, DEADLINE, commitments);
    expect(resolution.available).toBe(false);
    expect(resolution.reason).toBe('availability-no-remaining-capacity');
  });

  it('windowIntersectsInterval is deterministic and bounded', () => {
    const window = { recurrence: 'weekly' as const, dayOfWeek: 3, startUtc: '09:00', endUtc: '17:00' };
    expect(windowIntersectsInterval(window, Date.parse(T0), Date.parse(DEADLINE))).toBe(true);
    expect(windowIntersectsInterval(window, Date.parse(DEADLINE), Date.parse(T0))).toBe(false);
    const oneTime = {
      recurrence: 'one-time' as const,
      date: '2026-10-07',
      startUtc: '09:00',
      endUtc: '17:00',
    };
    expect(windowIntersectsInterval(oneTime, Date.parse(T0), Date.parse(DEADLINE))).toBe(true);
    expect(
      windowIntersectsInterval(oneTime, Date.parse('2026-10-09T00:00:00.000Z'), Date.parse(DEADLINE) + 86_400_000),
    ).toBe(false);
  });

  it('engagementWindowKey resolves the occupied window (typed failure when none)', async () => {
    const declaration = await declare({});
    expect(engagementWindowKey(declaration, T0, DEADLINE)).toMatch(/^weekly\|/);
    const empty = await declare({
      windows: [
        {
          window: { recurrence: 'one-time' as const, date: '2026-11-01', startUtc: '09:00', endUtc: '17:00' },
          capacitySlots: 1,
        },
      ],
    });
    expect(() => engagementWindowKey(empty, T0, DEADLINE)).toThrow(ExpertEngagementError);
  });
});

describe('the ES1.0 routing-input projection (read-only)', () => {
  it('projects available windows with remaining slots; never mutates routing', async () => {
    const declaration = await declare({});
    const window = declaration.windows[0]?.window;
    if (window === undefined) throw new Error('fixture');
    const projection = toRoutingAvailabilityInput(declaration, [], T0);
    expect(projection.tenant).toBe('tenant-a');
    expect(projection.expertId).toBe('expert-one');
    expect(projection.declarationVersion).toBe(1);
    expect(projection.availableWindows.length).toBe(1);
    expect(projection.availableWindows[0]?.remainingSlots).toBe(2);
    expect(projection.fullyCommittedWindows).toBe(0);
    // The window shape is C002-compatible (RoutingCandidateView.availability).
    expect(projection.availableWindows[0]?.window.recurrence).toBe('weekly');

    const commitments: CapacityCommitment[] = [
      { engagementId: 'eng-1', tenant: 'tenant-a', expertId: 'expert-one', windowKey: availabilityWindowKey(window) },
      { engagementId: 'eng-2', tenant: 'tenant-a', expertId: 'expert-one', windowKey: availabilityWindowKey(window) },
    ];
    const committed = toRoutingAvailabilityInput(declaration, commitments, T0);
    expect(committed.availableWindows.length).toBe(0);
    expect(committed.fullyCommittedWindows).toBe(1);
  });

  it('a null declaration projects the empty input (deterministic)', () => {
    const projection = toRoutingAvailabilityInput(null, [], T0);
    expect(projection.declarationDigest).toBeNull();
    expect(projection.availableWindows.length).toBe(0);
    void DIGEST;
  });
});
