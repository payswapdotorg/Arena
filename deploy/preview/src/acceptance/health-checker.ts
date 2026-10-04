import { logger } from '../shared/logger.js'

/**
 * Deployment health probe (Gate B).
 *
 * REAL probe surface: the hosted preview exposes NO dedicated
 * `/api/health` or `/api/readiness` endpoint (verified against the live
 * deployment — those paths 404). The deployment-health signal is the
 * deployment ROOT: `GET /` returning a success response, which is the
 * exact semantic the deploy workflow's own smoke-check step asserts
 * (`.github/workflows/deploy-preview.yml`: 2xx/3xx on the deployment
 * URL). This harness intentionally mirrors that contract — adding a
 * dedicated HTTP health endpoint is a Tech Lead architecture decision
 * outside the B019 surfaces.
 */
export class HealthChecker {
  constructor(private previewUrl?: string) {}

  async checkReadiness(): Promise<void> {
    if (!this.previewUrl) {
      logger.info('Health check: SKIPPED (dry-run mode)')
      return
    }

    logger.info(`Checking deployment health at: ${this.previewUrl}/`)

    // Deployment-root smoke check (workflow parity: 2xx/3xx).
    const response = await this.fetchWithRetry(`${this.previewUrl}/`, {
      method: 'GET',
      headers: { Accept: 'text/html' }
    })

    // fetch follows redirects by default, so a 3xx chain that lands on a
    // 2xx final response is green here — the same acceptance the deploy
    // workflow's smoke-check grants to 2xx/3xx root statuses.
    if (!response.ok) {
      throw new Error(
        `Deployment root returned ${response.status}: ${response.statusText} (expected 2xx/3xx — deploy workflow smoke-check parity)`
      )
    }

    logger.info(`✅ Deployment health check passed (HTTP ${response.status} at /)`)
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries = 3
  ): Promise<Response> {
    let lastError: unknown

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)

        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        })

        clearTimeout(timeoutId)
        return response
      } catch (error) {
        lastError = error
        if (attempt < maxRetries) {
          logger.warn(`Health check attempt ${attempt} failed, retrying...`)
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
        }
      }
    }

    throw lastError
  }
}
