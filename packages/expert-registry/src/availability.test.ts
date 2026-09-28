/**
 * Availability tests (Work Order A006; §8 availability — typed windows).
 * Positive and negative for recurrences, times, days, dates and the
 * record-level window requirement.
 */

import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_RECURRENCES,
  AVAILABILITY_WINDOW_VERSION,
  EXPERT_AVAILABILITY_VERSION,
  TIME_OF_DAY_PATTERN_SOURCE,
  isAvailabilityWindow,
  isExpertAvailability,
  toAvailabilityWindow,
  toExpertAvailability,
} from './availability.js';
import { ExpertRegistryError } from './errors.js';

const daily = () => ({
  recurrence: 'daily',
  startUtc: '09:00',
  endUtc: '17:00',
});

describe('availability windows (positive)', () => {
  it('accepts daily, weekly and one-time windows and freezes them', () => {
    const d = toAvailabilityWindow(daily());
    expect(isAvailabilityWindow(d)).toBe(true);
    expect(d.windowVersion).toBe(AVAILABILITY_WINDOW_VERSION);
    expect(Object.isFrozen(d)).toBe(true);

    const w = toAvailabilityWindow({
      recurrence: 'weekly',
      dayOfWeek: 2,
      startUtc: '09:00',
      endUtc: '13:00',
    });
    expect(w.dayOfWeek).toBe(2);

    const o = toAvailabilityWindow({
      recurrence: 'one-time',
      startUtc: '10:00',
      endUtc: '12:00',
      date: '2026-10-05',
    });
    expect(o.date).toBe('2026-10-05');
  });

  it('exposes the closed recurrence vocabulary and time pattern', () => {
    expect(AVAILABILITY_RECURRENCES).toEqual(['daily', 'weekly', 'one-time']);
    expect(TIME_OF_DAY_PATTERN_SOURCE).toBe('^([01]\\d|2[0-3]):[0-5]\\d$');
  });
});

describe('availability windows (negative)', () => {
  it('rejects unknown recurrences', () => {
    expect(() => toAvailabilityWindow({ ...daily(), recurrence: 'monthly' })).toThrow(
      /unknown availability recurrence/,
    );
  });

  it('rejects malformed times and empty windows', () => {
    expect(() => toAvailabilityWindow({ ...daily(), startUtc: '9:00' })).toThrow(
      /invalid window opening/,
    );
    expect(() => toAvailabilityWindow({ ...daily(), endUtc: '25:00' })).toThrow(
      /invalid window closing/,
    );
    expect(() => toAvailabilityWindow({ ...daily(), endUtc: '09:00' })).toThrow(
      /empty availability window/,
    );
    expect(() =>
      toAvailabilityWindow({ ...daily(), startUtc: '14:00', endUtc: '09:00' }),
    ).toThrow(/empty availability window/);
  });

  it('weekly windows REQUIRE an ISO day 1..7; other recurrences reject one', () => {
    expect(() =>
      toAvailabilityWindow({ ...daily(), recurrence: 'weekly' } as never),
    ).toThrow(/ISO day number/);
    expect(() =>
      toAvailabilityWindow({ ...daily(), recurrence: 'weekly', dayOfWeek: 8 }),
    ).toThrow(/ISO day number/);
    expect(() => toAvailabilityWindow({ ...daily(), dayOfWeek: 2 })).toThrow(
      /only valid on weekly windows/,
    );
  });

  it('one-time windows REQUIRE a real calendar date; other recurrences reject one', () => {
    expect(() =>
      toAvailabilityWindow({ ...daily(), recurrence: 'one-time' } as never),
    ).toThrow(/calendar date/);
    expect(() =>
      toAvailabilityWindow({
        ...daily(),
        recurrence: 'one-time',
        date: '2026-02-30',
      }),
    ).toThrow(/calendar date/);
    expect(() => toAvailabilityWindow({ ...daily(), date: '2026-10-05' })).toThrow(
      /only valid on one-time windows/,
    );
  });
});

describe('the availability record (positive + negative)', () => {
  it('accepts >= 1 windows and freezes the record', () => {
    const availability = toExpertAvailability({
      windows: [daily(), { recurrence: 'weekly', dayOfWeek: 4, startUtc: '09:00', endUtc: '13:00' }],
    });
    expect(isExpertAvailability(availability)).toBe(true);
    expect(availability.availabilityVersion).toBe(EXPERT_AVAILABILITY_VERSION);
    expect(Object.isFrozen(availability)).toBe(true);
    expect(Object.isFrozen(availability.windows)).toBe(true);
  });

  it('rejects zero-window records (§8: availability (typed windows))', () => {
    expect(() => toExpertAvailability({ windows: [] })).toThrow(
      /at least one typed window/,
    );
    expect(() => toExpertAvailability({ windows: [] as never })).toThrow(
      ExpertRegistryError,
    );
    expect(isExpertAvailability({ windows: [] })).toBe(false);
  });

  it('rejects empty notes', () => {
    expect(() => toExpertAvailability({ windows: [daily()], note: '' })).toThrow(
      /non-empty/,
    );
  });
});
