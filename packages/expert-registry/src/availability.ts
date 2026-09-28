/**
 * Expert availability (Work Order A006; docs/architecture.md §8
 * "availability" — typed windows).
 *
 * Availability is a typed record of WINDOWS, not free text:
 *   - `recurrence` ∈ {daily, weekly, one-time};
 *   - a daily window is an HH:MM–HH:MM UTC interval;
 *   - a weekly window adds the ISO day number (1=Monday … 7=Sunday);
 *   - a one-time window adds an exact calendar date (YYYY-MM-DD).
 *
 * Windows are pure data for the A007 matching engine; this module never
 * interprets them into commitments. All times are UTC — deliberate honesty:
 * a protocol-level window is a machine-comparable statement, and any
 * local-time phrasing belongs to presentation layers.
 */

import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import { deepFreeze } from './shared.js';

/** Wire version of the availability record shape. */
export const EXPERT_AVAILABILITY_VERSION = 1 as const;

/** Wire version of the availability window shape. */
export const AVAILABILITY_WINDOW_VERSION = 1 as const;

/** Closed recurrence vocabulary. */
export const AVAILABILITY_RECURRENCES = ['daily', 'weekly', 'one-time'] as const;

export type AvailabilityRecurrence = (typeof AVAILABILITY_RECURRENCES)[number];

export function isAvailabilityRecurrence(
  value: unknown,
): value is AvailabilityRecurrence {
  return (
    typeof value === 'string' &&
    (AVAILABILITY_RECURRENCES as readonly string[]).includes(value)
  );
}

/** UTC time-of-day pattern: exactly HH:MM, 24-hour clock. */
export const TIME_OF_DAY_PATTERN_SOURCE = '^([01]\\d|2[0-3]):[0-5]\\d$';

/** Calendar date pattern: exactly YYYY-MM-DD (validated as a real date). */
export const CALENDAR_DATE_PATTERN_SOURCE = '^\\d{4}-\\d{2}-\\d{2}$';

const TIME_OF_DAY_PATTERN = new RegExp(TIME_OF_DAY_PATTERN_SOURCE);
const CALENDAR_DATE_PATTERN = new RegExp(CALENDAR_DATE_PATTERN_SOURCE);

/**
 * One typed availability window. `dayOfWeek` is REQUIRED for weekly
 * windows (ISO 1–7), `date` is REQUIRED for one-time windows, and both are
 * rejected on the other recurrences.
 */
export interface AvailabilityWindow {
  readonly windowVersion: typeof AVAILABILITY_WINDOW_VERSION;
  readonly recurrence: AvailabilityRecurrence;
  /** ISO day number, 1 (Monday) … 7 (Sunday) — weekly windows only. */
  readonly dayOfWeek?: number;
  /** Window opening, UTC HH:MM. */
  readonly startUtc: string;
  /** Window closing, UTC HH:MM (strictly after the opening). */
  readonly endUtc: string;
  /** Exact calendar date — one-time windows only. */
  readonly date?: string;
  readonly note?: string;
}

export function isAvailabilityWindow(value: unknown): value is AvailabilityWindow {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['windowVersion'] !== AVAILABILITY_WINDOW_VERSION ||
    !isAvailabilityRecurrence(candidate['recurrence']) ||
    typeof candidate['startUtc'] !== 'string' ||
    !TIME_OF_DAY_PATTERN.test(candidate['startUtc']) ||
    typeof candidate['endUtc'] !== 'string' ||
    !TIME_OF_DAY_PATTERN.test(candidate['endUtc']) ||
    candidate['startUtc'] >= candidate['endUtc']
  ) {
    return false;
  }
  if (candidate['recurrence'] === 'weekly') {
    if (
      typeof candidate['dayOfWeek'] !== 'number' ||
      !Number.isInteger(candidate['dayOfWeek']) ||
      candidate['dayOfWeek'] < 1 ||
      candidate['dayOfWeek'] > 7
    ) {
      return false;
    }
  } else if (candidate['dayOfWeek'] !== undefined) {
    return false;
  }
  if (candidate['recurrence'] === 'one-time') {
    if (
      typeof candidate['date'] !== 'string' ||
      !CALENDAR_DATE_PATTERN.test(candidate['date']) ||
      !isRealDate(candidate['date'])
    ) {
      return false;
    }
  } else if (candidate['date'] !== undefined) {
    return false;
  }
  if (
    candidate['note'] !== undefined &&
    (typeof candidate['note'] !== 'string' || candidate['note'].length === 0)
  ) {
    return false;
  }
  return true;
}

function isRealDate(value: string): boolean {
  const parts = value.split('-').map((part) => Number.parseInt(part, 10));
  const [year, month, day] = parts;
  if (year === undefined || month === undefined || day === undefined) return false;
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Reject rollovers (e.g. 2026-02-30 parses as 2026-03-02 in Date).
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Validate and freeze one availability window; throws INVALID_AVAILABILITY otherwise. */
export function toAvailabilityWindow(value: {
  recurrence: string;
  dayOfWeek?: number;
  startUtc: string;
  endUtc: string;
  date?: string;
  note?: string;
}): AvailabilityWindow {
  if (!isAvailabilityRecurrence(value.recurrence)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_AVAILABILITY, {
      message: `unknown availability recurrence: ${JSON.stringify(value.recurrence)} (known: ${AVAILABILITY_RECURRENCES.join(', ')})`,
      details: { known: [...AVAILABILITY_RECURRENCES] },
    });
  }
  if (typeof value.startUtc !== 'string' || !TIME_OF_DAY_PATTERN.test(value.startUtc)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_AVAILABILITY, {
      message: `invalid window opening: ${JSON.stringify(value.startUtc)} (UTC HH:MM, 24-hour clock)`,
      details: { pattern: TIME_OF_DAY_PATTERN_SOURCE },
    });
  }
  if (typeof value.endUtc !== 'string' || !TIME_OF_DAY_PATTERN.test(value.endUtc)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_AVAILABILITY, {
      message: `invalid window closing: ${JSON.stringify(value.endUtc)} (UTC HH:MM, 24-hour clock)`,
      details: { pattern: TIME_OF_DAY_PATTERN_SOURCE },
    });
  }
  if (value.startUtc >= value.endUtc) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_AVAILABILITY, {
      message: `empty availability window: startUtc ${JSON.stringify(value.startUtc)} must be strictly before endUtc ${JSON.stringify(value.endUtc)}`,
      details: { startUtc: value.startUtc, endUtc: value.endUtc },
    });
  }
  if (value.recurrence === 'weekly') {
    if (
      typeof value.dayOfWeek !== 'number' ||
      !Number.isInteger(value.dayOfWeek) ||
      value.dayOfWeek < 1 ||
      value.dayOfWeek > 7
    ) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_AVAILABILITY, {
        message: `a weekly window requires an ISO day number 1 (Monday) … 7 (Sunday): ${JSON.stringify(value.dayOfWeek)}`,
        details: { field: 'dayOfWeek' },
      });
    }
  } else if (value.dayOfWeek !== undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_AVAILABILITY, {
      message: `dayOfWeek is only valid on weekly windows (this window is ${JSON.stringify(value.recurrence)})`,
      details: { field: 'dayOfWeek', recurrence: value.recurrence },
    });
  }
  if (value.recurrence === 'one-time') {
    if (typeof value.date !== 'string' || !CALENDAR_DATE_PATTERN.test(value.date) || !isRealDate(value.date)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_AVAILABILITY, {
        message: `a one-time window requires a real calendar date YYYY-MM-DD: ${JSON.stringify(value.date)}`,
        details: { pattern: CALENDAR_DATE_PATTERN_SOURCE },
      });
    }
  } else if (value.date !== undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_AVAILABILITY, {
      message: `date is only valid on one-time windows (this window is ${JSON.stringify(value.recurrence)})`,
      details: { field: 'date', recurrence: value.recurrence },
    });
  }
  if (value.note !== undefined && value.note.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_AVAILABILITY, {
      message: 'window notes, when present, must be non-empty',
    });
  }
  return deepFreeze({
    windowVersion: AVAILABILITY_WINDOW_VERSION,
    recurrence: value.recurrence,
    ...(value.dayOfWeek !== undefined ? { dayOfWeek: value.dayOfWeek } : {}),
    startUtc: value.startUtc,
    endUtc: value.endUtc,
    ...(value.date !== undefined ? { date: value.date } : {}),
    ...(value.note !== undefined ? { note: value.note } : {}),
  });
}

/**
 * The expert's availability record: >= 1 typed windows (§8: "availability
 * (typed windows)" — a zero-window record is meaningless; a currently
 * unavailable expert is SUSPENDED, not windowless).
 */
export interface ExpertAvailability {
  readonly availabilityVersion: typeof EXPERT_AVAILABILITY_VERSION;
  readonly windows: readonly AvailabilityWindow[];
  readonly note?: string;
}

export function isExpertAvailability(value: unknown): value is ExpertAvailability {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['availabilityVersion'] === EXPERT_AVAILABILITY_VERSION &&
    Array.isArray(candidate['windows']) &&
    candidate['windows'].length > 0 &&
    candidate['windows'].every((w) => isAvailabilityWindow(w)) &&
    (candidate['note'] === undefined ||
      (typeof candidate['note'] === 'string' && candidate['note'].length > 0))
  );
}

/** Validate and freeze the availability record; throws INVALID_AVAILABILITY otherwise. */
export function toExpertAvailability(value: {
  windows: readonly {
    recurrence: string;
    dayOfWeek?: number;
    startUtc: string;
    endUtc: string;
    date?: string;
    note?: string;
  }[];
  note?: string;
}): ExpertAvailability {
  if (!Array.isArray(value.windows) || value.windows.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_AVAILABILITY, {
      message:
        'availability requires at least one typed window (§8: availability (typed windows); a currently unavailable expert is suspended, not windowless)',
      details: { field: 'windows' },
    });
  }
  const windows = Object.freeze(value.windows.map((w) => toAvailabilityWindow(w)));
  if (value.note !== undefined && value.note.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_AVAILABILITY, {
      message: 'availability notes, when present, must be non-empty',
    });
  }
  return deepFreeze({
    availabilityVersion: EXPERT_AVAILABILITY_VERSION,
    windows,
    ...(value.note !== undefined ? { note: value.note } : {}),
  });
}
