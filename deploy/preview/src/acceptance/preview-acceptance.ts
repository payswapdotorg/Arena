import { logger } from '../shared/logger.js'
import { HealthChecker } from './health-checker.js'
import { CapacityValidator } from './capacity-validator.js'
import { QuotaExhaustionTester } from './quota-exhaustion.js'
import { DemoRouteRunner } from './demo-route-runner.js'
import { FailClosedValidator } from './fail-closed-validator.js'

export interface PreviewAcceptanceConfig {
  previewUrl?: string | undefined
  testNamePattern?: string
  isLiveMode: boolean
}

export interface TestResult {
  name: string
  status: 'passed' | 'failed' | 'skipped'
  duration: number
  error?: string
  details?: unknown
}

export interface AcceptanceResults {
  total: number
  passed: number
  failed: number
  skipped: number
  tests: TestResult[]
  startTime: string
  endTime: string
}

/**
 * The Gate-B acceptance suite.
 *
 * Dry-run default (no ARENA_PREVIEW_URL): every live-path probe is
 * skipped honestly — the suite passes hermetically with visible skip
 * marks and never fakes a live pass. Live mode (ARENA_PREVIEW_URL set):
 * every probe runs against the REAL product routes (deployment root,
 * /demo, /operations, /demo/operations, POST /demo/reset) — see each
 * validator's header comment for its real probe surface.
 */
export async function previewAcceptanceSuite(
  config: PreviewAcceptanceConfig
): Promise<AcceptanceResults> {
  const startTime = new Date().toISOString()
  const tests: TestResult[] = []

  logger.info('Starting preview acceptance suite...')

  // Initialize test components
  const healthChecker = new HealthChecker(config.previewUrl)
  const capacityValidator = new CapacityValidator(config.previewUrl)
  const quotaTester = new QuotaExhaustionTester(config.previewUrl)
  const demoRunner = new DemoRouteRunner(config.previewUrl)
  const failClosedValidator = new FailClosedValidator(config.previewUrl)

  // Test suite definition
  const testSuite = [
    {
      name: 'Health Readiness',
      test: async () => await healthChecker.checkReadiness(),
      skipCondition: !config.isLiveMode
    },
    {
      name: 'Provider Capacity Visibility',
      test: async () => await capacityValidator.validateCapacityState(),
      skipCondition: !config.isLiveMode
    },
    {
      name: 'Quota Exhaustion Fail-Closed',
      test: async () => await quotaTester.testExhaustionBehavior(),
      skipCondition: !config.isLiveMode
    },
    {
      name: 'Hosted Demo Route Walk',
      test: async () => await demoRunner.runDemoRoute(),
      skipCondition: !config.isLiveMode
    },
    {
      name: 'No Hidden Paid Fallback',
      test: async () => await failClosedValidator.validateNoFallback(),
      skipCondition: !config.isLiveMode
    }
  ]

  // A test-name pattern filters the suite: non-matching tests are
  // excluded from the run entirely (they are neither run nor counted as
  // skipped); matching tests run under the normal dry-run/live rules.
  const pattern = config.testNamePattern
  const selectedSuite =
    pattern !== undefined
      ? testSuite.filter((testCase) => testCase.name.includes(pattern))
      : testSuite

  // Run tests
  for (const testCase of selectedSuite) {
    const shouldSkip = testCase.skipCondition

    if (shouldSkip) {
      tests.push({
        name: testCase.name,
        status: 'skipped',
        duration: 0
      })
      continue
    }

    const testStart = Date.now()
    try {
      logger.info(`Running test: ${testCase.name}`)

      await testCase.test()

      const duration = Date.now() - testStart
      tests.push({
        name: testCase.name,
        status: 'passed',
        duration
      })

      logger.info(`✅ ${testCase.name} passed (${duration}ms)`)
    } catch (error) {
      const duration = Date.now() - testStart
      tests.push({
        name: testCase.name,
        status: 'failed',
        duration,
        error: error instanceof Error ? error.message : String(error)
      })

      logger.error(`❌ ${testCase.name} failed:`, error)
    }
  }

  const endTime = new Date().toISOString()

  return {
    total: tests.length,
    passed: tests.filter((t) => t.status === 'passed').length,
    failed: tests.filter((t) => t.status === 'failed').length,
    skipped: tests.filter((t) => t.status === 'skipped').length,
    tests,
    startTime,
    endTime
  }
}
