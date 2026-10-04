import { logger } from '../shared/logger.js'

/**
 * Provider capacity visibility probe (Gate B).
 *
 * REAL probe surfaces (verified against the live deployment):
 *
 * 1. `GET /operations` — the operator-reachable B014 operations route.
 *    For an anonymous visitor it renders the server-side session gate:
 *    sessions are validated server-side, fail closed, with no anonymous
 *    operations view. That IS the honest capacity posture of the hosted
 *    preview for unwired/unauthenticated visitors — an operator-reachable
 *    route that refuses to leak capacity state without authority.
 *
 * 2. `GET /demo/operations` — the deterministic demo operations surface
 *    (publicly visible, visibly labelled demo state). It renders the
 *    "Provider capacity (free tier)" board with the closed FT2.0
 *    vocabulary: AVAILABLE, DEGRADED, EXHAUSTED, DISABLED — unwired
 *    providers render DISABLED, fail closed.
 *
 * The product exposes no `/api/capacity` JSON endpoint (404 on the live
 * preview); the capacity state is a rendered page, so both probes are
 * page-level body assertions over the REAL routes.
 */
const FT2_CAPACITY_VOCABULARY = ['AVAILABLE', 'DEGRADED', 'EXHAUSTED', 'DISABLED'] as const

export class CapacityValidator {
  constructor(private previewUrl?: string) {}

  async validateCapacityState(): Promise<void> {
    if (!this.previewUrl) {
      logger.info('Capacity validation: SKIPPED (dry-run mode)')
      return
    }

    logger.info('Validating provider capacity state visibility...')

    // Probe 1: the operator-reachable /operations route exists and fails
    // closed for anonymous visitors (B004 session boundary, rendered).
    const operationsResponse = await this.fetchPage(`${this.previewUrl}/operations`)
    if (!operationsResponse.ok) {
      throw new Error(
        `Operations route returned ${operationsResponse.status}: ${operationsResponse.statusText}`
      )
    }
    const operationsBody = await operationsResponse.text()
    const failClosedGate =
      operationsBody.includes('fail closed') &&
      operationsBody.includes('authenticated')
    if (!failClosedGate) {
      throw new Error(
        'Operations route does not render the fail-closed authenticated-session gate (expected server-side session validation posture)'
      )
    }
    logger.info('✅ /operations reachable and fail-closed for anonymous visitors')

    // Probe 2: the public demo capacity board renders provider capacity
    // state with the closed FT2.0 vocabulary.
    const demoOpsResponse = await this.fetchPage(`${this.previewUrl}/demo/operations`)
    if (!demoOpsResponse.ok) {
      throw new Error(
        `Demo operations route returned ${demoOpsResponse.status}: ${demoOpsResponse.statusText}`
      )
    }
    const demoOpsBody = await demoOpsResponse.text()
    if (!demoOpsBody.includes('Provider capacity')) {
      throw new Error('Demo operations page does not render the provider capacity board')
    }
    if (!demoOpsBody.includes('free tier') && !demoOpsBody.includes('Free-tier capacity')) {
      throw new Error('Demo capacity board does not label the free-tier capacity contract')
    }

    // The closed posture vocabulary must be present — DISABLED (the
    // fail-closed unwired posture) is the floor state we can assert.
    const presentStates = FT2_CAPACITY_VOCABULARY.filter((state) =>
      demoOpsBody.includes(state)
    )
    if (!presentStates.includes('DISABLED')) {
      throw new Error(
        `Demo capacity board does not render the DISABLED (fail-closed) provider posture; states found: ${presentStates.join(', ') || 'none'}`
      )
    }
    logger.info(
      `✅ Capacity board renders closed FT2.0 vocabulary (found: ${presentStates.join(', ')})`
    )

    logger.info('✅ Capacity state validation passed')
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
          logger.warn(`Capacity validation attempt ${attempt} failed, retrying...`)
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
        }
      }
    }
    throw lastError
  }
}
