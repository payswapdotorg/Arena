/**
 * Test setup for release preview evidence generator
 * 
 * Provides deterministic test environment with fixed seeds and mock data
 */

// Set deterministic test environment
process.env.NODE_ENV = 'test'

// Fixed test seed for deterministic behavior
const TEST_SEED = 'arena-release-preview-2026'

// Export test constants
export const TEST_ENV = {
  SEED: TEST_SEED,
  FIXED_TIME: new Date('2026-10-04T12:00:00.000Z').toISOString(),
  TIMEOUT: 30000,
  RETRY_COUNT: 3
}

// Mock evidence data for testing
export const mockEvidenceData = {
  ci: {
    pipelineId: 'preview-deploy-123',
    commitSha: 'abc123def456',
    duration: 320000,
    stages: [
      { name: 'Build', status: 'completed', duration: 120000 },
      { name: 'Test', status: 'completed', duration: 180000 },
      { name: 'Deploy', status: 'completed', duration: 20000 }
    ]
  },
  e2e: {
    testSuite: 'Product E2E',
    totalTests: 45,
    passedTests: 45,
    failedTests: 0,
    skippedTests: 0,
    duration: 127000,
    coverage: '85.2%',
    testFiles: [
      'tests/product-e2e/auth-flow.test.ts',
      'tests/product-e2e/transaction-flow.test.ts',
      'tests/product-e2e/profile.test.ts'
    ]
  },
  accessibility: {
    auditTool: 'axe-core',
    violations: [
      { id: 'color-contrast', severity: 'minor', description: 'Insufficient color contrast', impact: 'visual', elements: ['.button-primary'] }
    ],
    totalViolations: 1,
    criticalViolations: 0,
    passed: true
  }
}

// Global test utilities
export const createTestContext = () => ({
  seed: TEST_ENV.SEED,
  timestamp: TEST_ENV.FIXED_TIME,
  timeout: TEST_ENV.TIMEOUT,
  mockData: mockEvidenceData
})