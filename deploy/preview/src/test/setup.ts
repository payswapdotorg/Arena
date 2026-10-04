/**
 * Test setup for the preview acceptance harness
 *
 * Provides a deterministic test environment: a fixed default clock for
 * `new Date()` (no-argument construction) and `Date.now()` so evidence
 * timestamps and suite timings are byte-stable across runs. Explicit
 * Date constructions (numbers, strings) pass through unchanged.
 */

// Set deterministic test environment
process.env.NODE_ENV = 'test'

// Fixed test seed / time for deterministic behavior (house style: fixed clocks)
const TEST_SEED = 'arena-preview-acceptance-2026'
const FIXED_TIME = '2026-10-04T12:00:00.000Z'

// Deterministic clock: patch the global Date constructor once, here, with a
// properly derived class (super delegation + override modifiers, per the
// base tsconfig noImplicitOverride/exactOptionalPropertyTypes posture).
const OriginalDate: DateConstructor = global.Date

class FakeDate extends OriginalDate {
  constructor(...args: [value?: number | string]) {
    // No-argument construction lands on the fixed test time; explicit
    // values pass through to the real Date constructor unchanged.
    super(args[0] ?? FIXED_TIME)
  }

  static override now(): number {
    return new OriginalDate(FIXED_TIME).getTime()
  }
}

global.Date = FakeDate as unknown as typeof global.Date

// Export test constants
export const TEST_ENV = {
  SEED: TEST_SEED,
  FIXED_TIME,
  TIMEOUT: 30000,
  RETRY_COUNT: 3
}

// Global test utilities
export const createTestContext = () => ({
  seed: TEST_ENV.SEED,
  timestamp: TEST_ENV.FIXED_TIME,
  timeout: TEST_ENV.TIMEOUT
})
