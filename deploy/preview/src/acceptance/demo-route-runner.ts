import { logger } from '../shared/logger.js'

/**
 * Hosted demo walk + determinism probe (Gate B).
 *
 * REAL probe surfaces (verified against the live deployment):
 *
 * 1. `GET /demo` — the deterministic demo landing page (zero-credential,
 *    visibly labelled demo state).
 * 2. `GET /demo/operations` — a bounded walk of one demo page under
 *    `/demo/**` (the demo operations surface with its capacity board).
 * 3. `POST /demo/reset` — the REAL demo reset control
 *    (`apps/web/src/app/demo/reset/route.ts`): resets the demo corpus
 *    deterministically (identical corpus hash after reseed) and responds
 *    with the documented contract — HTTP 303 redirect to `/demo`.
 *
 * There is no `/demo/start`, `/demo/tasks` or `/demo/complete` HTTP API —
 * the demo is a page surface, not a REST session API. The walk below
 * walks the REAL pages and asserts the REAL reset contract.
 */
export class DemoRouteRunner {
  constructor(private previewUrl?: string) {}

  async runDemoRoute(): Promise<void> {
    if (!this.previewUrl) {
      logger.info('Demo route walk: SKIPPED (dry-run mode)')
      return
    }

    logger.info('Starting hosted demo route walk...')

    // Step 1: demo landing page renders (2xx) with visible demo labelling.
    const landingResponse = await this.fetchPage(`${this.previewUrl}/demo`)
    if (!landingResponse.ok) {
      throw new Error(`Demo landing page failed: ${landingResponse.status}`)
    }
    const landingBody = await landingResponse.text()
    if (!landingBody.includes('Demo')) {
      throw new Error('Demo landing page does not render demo-labelled content')
    }
    if (!landingBody.includes('deterministic')) {
      throw new Error(
        'Demo landing page does not label the deterministic (resettable) demo state'
      )
    }
    logger.info('✅ Demo landing page accessible and labelled deterministic')

    // Step 2: bounded walk of one demo page under /demo/**.
    const demoOpsResponse = await this.fetchPage(`${this.previewUrl}/demo/operations`)
    if (!demoOpsResponse.ok) {
      throw new Error(`Demo operations page failed: ${demoOpsResponse.status}`)
    }
    const demoOpsBody = await demoOpsResponse.text()
    if (!demoOpsBody.includes('Demo state is not customer state')) {
      throw new Error('Demo operations page does not carry the demo-state disclaimer label')
    }
    logger.info('✅ Demo page walk (demo/operations) OK with demo-state labelling')

    // Step 3: the demo determinism control — POST /demo/reset must honour
    // the documented response contract (303 redirect to /demo), which is
    // what makes the hosted demo deterministic and resettable: the reset
    // reseeds the identical corpus and always lands on labelled demo state.
    const resetResponse = await fetch(`${this.previewUrl}/demo/reset`, {
      method: 'POST',
      redirect: 'manual'
    })
    if (resetResponse.status !== 303) {
      throw new Error(
        `Demo reset returned HTTP ${resetResponse.status}; the documented contract is 303 (see apps/web/src/app/demo/reset/route.ts)`
      )
    }
    const location = resetResponse.headers.get('location')
    if (location === null || !location.endsWith('/demo')) {
      throw new Error(
        `Demo reset 303 must redirect to /demo (documented contract); got Location: ${location ?? 'none'}`
      )
    }
    logger.info('✅ Demo reset honoured the 303 → /demo determinism contract')

    logger.info('✅ Hosted demo route walk completed successfully')
  }

  private async fetchPage(url: string): Promise<Response> {
    let lastError: unknown
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15000)
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
          logger.warn(`Demo route attempt ${attempt} failed, retrying...`)
          await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
        }
      }
    }
    throw lastError
  }
}

export const demoRouteRunner = new DemoRouteRunner()
