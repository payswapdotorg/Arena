/**
 * Test setup for ops preview harness
 * 
 * Provides deterministic test environment with fixed seeds and mock data
 */

// Set deterministic test environment
process.env.NODE_ENV = 'test'

// Fixed test seed for deterministic behavior
const TEST_SEED = 'arena-ops-preview-2026'

// Export test constants
export const TEST_ENV = {
  SEED: TEST_SEED,
  FIXED_TIME: new Date('2026-10-04T12:00:00.000Z').toISOString(),
  TIMEOUT: 30000,
  RETRY_COUNT: 3
}

// Mock capacity data for testing
export const mockCapacityData = {
  database: {
    cuHours: 45,
    storage: 0.2,
    cuHoursTrend: 'increasing',
    storageTrend: 'stable'
  },
  storage: {
    storage: 3.2,
    operations: 450000,
    bandwidth: 4200000,
    storageTrend: 'stable',
    operationsTrend: 'increasing',
    bandwidthTrend: 'stable'
  },
  compute: {
    concurrent: 12,
    timeout: 120,
    concurrentTrend: 'stable',
    timeoutTrend: 'stable'
  },
  coordination: {
    commands: 250000,
    memory: 128,
    bandwidth: 5200000,
    commandsTrend: 'increasing',
    memoryTrend: 'stable',
    bandwidthTrend: 'stable'
  }
}

// Global test utilities
export const createTestContext = () => ({
  seed: TEST_ENV.SEED,
  timestamp: TEST_ENV.FIXED_TIME,
  timeout: TEST_ENV.TIMEOUT,
  mockData: mockCapacityData
})