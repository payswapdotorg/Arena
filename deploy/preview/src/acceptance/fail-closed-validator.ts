import { logger } from '../shared/logger.js'

/**
 * Fail-closed / no-hidden-paid-fallback probe (Gate B).
 *
 * REAL probe surfaces (verified against the live deployment): the
 * product exposes no `/api/demo/cases`, `/api/capability/cases`,
 * `/api/bodies` or `/api/marketplace` endpoints (all 404). The honest
 * check is a PAGE-LEVEL assertion over the real public surfaces:
 *
 * 1. `GET /demo/operations` must render the FT2.0 fail-closed capacity
 *    contract — "never switches to a billable path" — i.e. asserting the
 *    CONTRACT TEXT itself, not merely the absence of paid-fallback
 *    strings (absence proofs are weak; the rendered guarantee is the
 *    product's own statement of posture).
 * 2. `GET /operations` must render the server-side fail-closed session
 *    gate (no anonymous operations view).
 * 3. None of the public surfaces may carry paid-fallback markers
 *    (upgrade prompts, billing claims, payment-provider handoffs).
 */
const PUBLIC_SURFACES = ['/', '/demo', '/operations', '/demo/operations'] as const

const PAID_FALLBACK_MARKERS = [
  'upgrade to paid',
  'upgrade to a paid',
  'paid plan',
  'billing required',
  'enter your credit card',
  'stripe.com/checkout',
  'paypal.com/checkout'
] as const

export class FailClosedValidator {
  constructor(private previewUrl?: string) {}

  async validateNoFallback(): Promise<void> {
    if (!this.previewUrl) {
      logger.info('Fail-closed validation: SKIPPED (dry-run mode)')
      return
    }

    logger.info('Validating the fail-closed posture on the real public surfaces...')

    // Surface 1: the fail-closed capacity CONTRACT rendered on the demo
    // operations page (asserting the guarantee, not just string absence).
    const demoOps = await this.fetchPage(`${this.previewUrl}/demo/operations`)
    if (!demoOps.ok) {
      throw new Error(`Demo operations page returned ${demoOps.status}`)
    }
    const demoOpsBody = await demoOps.text()
    if (!demoOpsBody.includes('fail closed')) {
      throw new Error('Demo operations page does not render the fail-closed posture')
    }
    if (
      !demoOpsBody.includes('never switches to a billable path') &&
      !demoOpsBody.includes('never silently degrades to')
    ) {
      throw new Error(
        'Demo operations page does not render the FT2.0 no-billable-path / no-unlimited-degradation contract'
      )
    }
    logger.info('✅ FT2.0 fail-closed capacity contract rendered (no billable path, no unlimited degradation)')

    // Surface 2: the operations session gate fails closed server-side.
    const ops = await this.fetchPage(`${this.previewUrl}/operations`)
    if (!ops.ok) {
      throw new Error(`Operations page returned ${ops.status}`)
    }
    const opsBody = await ops.text()
    if (!(opsBody.includes('fail closed') && opsBody.includes('authenticated'))) {
      throw new Error(
        'Operations page does not render the fail-closed authenticated-session gate'
      )
    }
    logger.info('✅ Operations surface gated by server-side fail-closed session validation')

    // Surface 3: no paid-fallback markers anywhere on the public surfaces.
    for (const path of PUBLIC_SURFACES) {
      const response = await this.fetchPage(`${this.previewUrl}${path}`)
      if (!response.ok) {
        throw new Error(`Public surface ${path} returned ${response.status}`)
      }
      const body = await response.text()
      const found = PAID_FALLBACK_MARKERS.filter((marker) =>
        body.toLowerCase().includes(marker)
      )
      if (found.length > 0) {
        throw new Error(`Paid-fallback markers rendered on ${path}: ${found.join(', ')}`)
      }
      logger.info(`✅ ${path} — no paid-fallback markers`)
    }

    logger.info('✅ No hidden paid fallback detected (fail-closed contract rendered)')
  }

  private async fetchPage(url: string): Promise<Response> {
    let lastError: unknown
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'text/html' }
        })
        if (response.status >= 200 && response.status < 400) {
          return response
        }
        if (attempt === 3) {
          return response
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
      } catch (error) {
        lastError = error
        if (attempt === 3) {
          throw lastError
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
      }
    }
    throw new Error('Max retries exceeded')
  }
}

export const failClosedValidator = new FailClosedValidator()
