import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestContext } from '../test/setup.js'

// Hoisted controllable implementations: the component modules are mocked
// at module level (hoisted vi.mock), so live-mode suite tests never touch
// the network — every component behaviour is set per-test below.
const mocks = vi.hoisted(() => ({
  checkReadiness: vi.fn(),
  validateCapacityState: vi.fn(),
  testExhaustionBehavior: vi.fn(),
  runDemoRoute: vi.fn(),
  validateNoFallback: vi.fn()
}))

vi.mock('./health-checker', () => ({
  HealthChecker: class {
    checkReadiness = mocks.checkReadiness
  }
}))
vi.mock('./capacity-validator', () => ({
  CapacityValidator: class {
    validateCapacityState = mocks.validateCapacityState
  }
}))
vi.mock('./quota-exhaustion', () => ({
  QuotaExhaustionTester: class {
    testExhaustionBehavior = mocks.testExhaustionBehavior
  }
}))
vi.mock('./demo-route-runner', () => ({
  DemoRouteRunner: class {
    runDemoRoute = mocks.runDemoRoute
  }
}))
vi.mock('./fail-closed-validator', () => ({
  FailClosedValidator: class {
    validateNoFallback = mocks.validateNoFallback
  }
}))

import { previewAcceptanceSuite } from './preview-acceptance.js'

describe('PreviewAcceptanceSuite', () => {
  beforeEach(() => {
    createTestContext()
    mocks.checkReadiness.mockReset().mockResolvedValue(undefined)
    mocks.validateCapacityState.mockReset().mockResolvedValue(undefined)
    mocks.testExhaustionBehavior.mockReset().mockResolvedValue(undefined)
    mocks.runDemoRoute.mockReset().mockResolvedValue(undefined)
    mocks.validateNoFallback.mockReset().mockResolvedValue(undefined)
  })

  describe('dry-run mode (hermetic default)', () => {
    it('should run in dry-run mode when no preview URL is provided', async () => {
      const results = await previewAcceptanceSuite({
        isLiveMode: false
      })

      expect(results).toMatchObject({
        total: 5,
        passed: 0,
        failed: 0,
        skipped: 5
      })
      expect(results.tests.every((test) => test.status === 'skipped')).toBe(true)
      // Dry-run skips honestly: no component probe may run without a URL.
      expect(mocks.checkReadiness).not.toHaveBeenCalled()
      expect(mocks.runDemoRoute).not.toHaveBeenCalled()
    })

    it('should respect test name pattern filter', async () => {
      const results = await previewAcceptanceSuite({
        isLiveMode: false,
        testNamePattern: 'Health'
      })

      expect(results).toMatchObject({
        total: 1,
        passed: 0,
        failed: 0,
        skipped: 1
      })
      expect(results.tests[0]?.name).toBe('Health Readiness')
    })
  })

  describe('live mode', () => {
    it('should pass all five Gate-B probes when every component resolves', async () => {
      const results = await previewAcceptanceSuite({
        previewUrl: 'https://arena-preview.example',
        isLiveMode: true
      })

      expect(results).toMatchObject({
        total: 5,
        passed: 5,
        failed: 0,
        skipped: 0
      })
      expect(results.tests.every((test) => test.status === 'passed')).toBe(true)

      // Every real probe component ran exactly once.
      expect(mocks.checkReadiness).toHaveBeenCalledTimes(1)
      expect(mocks.validateCapacityState).toHaveBeenCalledTimes(1)
      expect(mocks.testExhaustionBehavior).toHaveBeenCalledTimes(1)
      expect(mocks.runDemoRoute).toHaveBeenCalledTimes(1)
      expect(mocks.validateNoFallback).toHaveBeenCalledTimes(1)
    })

    it('should record the failure honestly when a probe rejects', async () => {
      mocks.checkReadiness.mockRejectedValue(new Error('Health check failed'))

      const results = await previewAcceptanceSuite({
        previewUrl: 'https://arena-preview.example',
        isLiveMode: true
      })

      expect(results.failed).toBe(1)
      expect(results.passed).toBe(4)
      expect(results.tests[0]?.status).toBe('failed')
      expect(results.tests[0]?.error).toBe('Health check failed')
      // The remaining probes still ran (failures are isolated per probe).
      expect(mocks.runDemoRoute).toHaveBeenCalledTimes(1)
    })
  })

  describe('timing and metadata', () => {
    it('should record start and end times', async () => {
      const results = await previewAcceptanceSuite({
        isLiveMode: false
      })

      expect(results.startTime).toBeDefined()
      expect(results.endTime).toBeDefined()
      expect(Number.isNaN(Date.parse(results.startTime))).toBe(false)
      expect(Number.isNaN(Date.parse(results.endTime))).toBe(false)
    })

    it('should record test durations (frozen deterministic clock)', async () => {
      // The test setup freezes the clock, so durations are deterministically
      // 0ms — the honest expectation under a fixed time source.
      const results = await previewAcceptanceSuite({
        previewUrl: 'https://arena-preview.example',
        isLiveMode: true
      })

      for (const test of results.tests) {
        expect(Number.isFinite(test.duration)).toBe(true)
        expect(test.duration).toBeGreaterThanOrEqual(0)
      }
    })
  })
})
