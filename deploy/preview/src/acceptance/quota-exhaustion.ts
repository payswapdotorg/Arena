import { logger } from '../shared/logger.js'

/**
 * Free-tier quota-exhaustion posture probe (Gate B).
 *
 * REAL probe surface (verified against the live deployment): the hosted
 * preview exposes no `/api/capacity` JSON endpoint to drive an exhaustion
 * drill against. The DOCUMENTED quota-exhaustion posture is rendered on
 * the deterministic demo operations surface (`GET /demo/operations`):
 * an EXHAUSTED provider renders "fail closed" operations with the
 * "quota-exhausted" reason — the exhaustion policy has exactly one
 * inhabitant (fail-closed), never a silent degradation to "unlimited"
 * and never a switch to a billable path (FT2.0).
 *
 * This probe asserts that rendered posture over the REAL route. The
 * deeper drill (driving a live provider to actual exhaustion) is the
 * preview quota-exhaustion drill runbook in `ops/preview/`.
 */
export class QuotaExhaustionTester {
  constructor(private previewUrl?: string) {}

  async testExhaustionBehavior(): Promise<void> {
    if (!this.previewUrl) {
      logger.info('Quota exhaustion test: SKIPPED (dry-run mode)')
      return
    }

    logger.info('Probing the rendered quota-exhaustion fail-closed posture...')

    const response = await this.fetchPage(`${this.previewUrl}/demo/operations`)
    if (!response.ok) {
      throw new Error(
        `Demo operations route returned ${response.status}: ${response.statusText}`
      )
    }
    const body = await response.text()

    if (!body.includes('Provider capacity')) {
      throw new Error('Demo operations page does not render the provider capacity board')
    }

    // The exhaustion posture: an EXHAUSTED provider with fail-closed
    // operations and the quota-exhausted reason, rendered as measured fact.
    const exhaustedRendered = body.includes('EXHAUSTED')
    if (!exhaustedRendered) {
      throw new Error(
        'Capacity board does not render the EXHAUSTED (quota-exhausted) provider posture'
      )
    }
    if (!body.includes('fail closed')) {
      throw new Error(
        'Capacity board does not render the fail-closed operations posture for exhausted providers'
      )
    }
    if (!body.includes('quota-exhausted')) {
      throw new Error(
        'Capacity board does not render the quota-exhaustion reason on the exhausted provider'
      )
    }

    // The fail-closed guarantee itself, rendered on the board: exhausted
    // providers never silently degrade to "unlimited" and never switch to
    // a billable path. Asserting the CONTRACT text (not merely the absence
    // of strings) is the honest form of this check.
    const failClosedContract =
      body.includes('fail closed') &&
      (body.includes('never silently degrades to') ||
        body.includes('never switches to a billable path'))
    if (!failClosedContract) {
      throw new Error(
        'Capacity board does not render the FT2.0 fail-closed exhaustion contract (no unlimited degradation, no billable path)'
      )
    }

    logger.info('✅ Quota exhaustion posture rendered fail-closed (EXHAUSTED, quota-exhausted, no billable path)')
  }

  private async fetchPage(url: string): Promise<Response> {
    let lastError: unknown
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)
        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'text/html' },
          signal: controller.signal
        })
        clearTimeout(timeoutId)
        return response
      } catch (error) {
        lastError = error
        if (attempt < 3) {
          logger.warn(`Quota exhaustion probe attempt ${attempt} failed, retrying...`)
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
        }
      }
    }
    throw lastError
  }
}
