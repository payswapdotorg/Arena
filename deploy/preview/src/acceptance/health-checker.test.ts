import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HealthChecker } from './health-checker.js'
import { logger } from '../shared/logger.js'
import { createTestContext } from '../test/setup.js'

describe('HealthChecker', () => {
  beforeEach(() => {
    createTestContext()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('dry-run mode', () => {
    it('should skip the deployment health check when no preview URL is provided', async () => {
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})

      const checker = new HealthChecker()

      await checker.checkReadiness()

      expect(infoSpy).toHaveBeenCalledWith('Health check: SKIPPED (dry-run mode)')
    })
  })

  describe('live mode (deployment-root probe, workflow smoke-check parity)', () => {
    it('should pass when the deployment root returns 2xx', async () => {
      const mockUrl = 'https://arena-preview.example'
      const checker = new HealthChecker(mockUrl)

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: 'OK'
        })
      )

      await expect(checker.checkReadiness()).resolves.not.toThrow()
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        `${mockUrl}/`,
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('should fail when the deployment root returns a non-2xx/3xx status', async () => {
      const mockUrl = 'https://arena-preview.example'
      const checker = new HealthChecker(mockUrl)

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable'
        })
      )

      await expect(checker.checkReadiness()).rejects.toThrow(
        'Deployment root returned 503'
      )
    })

    it('should retry failed requests and succeed on the third attempt', async () => {
      const mockUrl = 'https://arena-preview.example'
      const checker = new HealthChecker(mockUrl)
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

      // The transport fails twice (network errors), then succeeds on the
      // third attempt — the retry sequence must be deterministic.
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed (attempt 1)'))
        .mockRejectedValueOnce(new TypeError('fetch failed (attempt 2)'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK'
        })
      vi.stubGlobal('fetch', mockFetch)

      // Fake timers make the linear backoff (1s, 2s between attempts)
      // advance instantly and deterministically — no real waiting, no network.
      vi.useFakeTimers()

      const assertion = expect(checker.checkReadiness()).resolves.not.toThrow()
      await vi.advanceTimersByTimeAsync(1000) // backoff after attempt 1
      await vi.advanceTimersByTimeAsync(2000) // backoff after attempt 2
      await assertion

      // Attempt sequence: exactly three transport calls, in order.
      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        `${mockUrl}/`,
        expect.objectContaining({ method: 'GET' })
      )
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        `${mockUrl}/`,
        expect.objectContaining({ method: 'GET' })
      )
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        `${mockUrl}/`,
        expect.objectContaining({ method: 'GET' })
      )

      // Honest retry logging for each failed attempt.
      expect(warnSpy).toHaveBeenCalledWith(
        'Health check attempt 1 failed, retrying...'
      )
      expect(warnSpy).toHaveBeenCalledWith(
        'Health check attempt 2 failed, retrying...'
      )
      expect(warnSpy).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })

    it('should exhaust retries and rethrow the last transport error', async () => {
      const mockUrl = 'https://arena-preview.example'
      const checker = new HealthChecker(mockUrl)
      vi.spyOn(logger, 'warn').mockImplementation(() => {})

      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed (attempt 1)'))
        .mockRejectedValueOnce(new TypeError('fetch failed (attempt 2)'))
        .mockRejectedValueOnce(new TypeError('fetch failed (attempt 3)'))
      vi.stubGlobal('fetch', mockFetch)

      vi.useFakeTimers()

      const assertion = expect(checker.checkReadiness()).rejects.toThrow(
        'fetch failed (attempt 3)'
      )
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(2000)
      await assertion

      expect(mockFetch).toHaveBeenCalledTimes(3)
      vi.useRealTimers()
    })
  })
})
