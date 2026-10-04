/**
 * Pure CLI-option resolution for the watch harness (unit-tested in
 * watch.test.ts through this module — the CLI entry itself stays a thin
 * commander wrapper and is never imported by tests).
 */

import { isProviderType } from './capacity-monitor.js'
import type { MonitorConfig, ProviderType } from './capacity-monitor.js'

/**
 * Resolve CLI options into a MonitorConfig. Pure and unit-tested:
 * - the `provider` key is only present when a VALID logical provider slot
 *   was named (invalid values fail closed with a thrown error — never a
 *   silently-coerced cast);
 * - no optional key is ever present with an explicit `undefined` value
 *   (exactOptionalPropertyTypes posture).
 */
export function resolveMonitorConfig(options: {
  provider?: string
  interval?: string
  config?: string
}): MonitorConfig {
  let provider: ProviderType | undefined
  if (options.provider !== undefined) {
    if (!isProviderType(options.provider)) {
      throw new Error(
        `Invalid provider ${JSON.stringify(options.provider)} — expected one of: database, storage, compute, coordination`
      )
    }
    provider = options.provider
  }

  const config: MonitorConfig = {
    interval: Number.parseInt(options.interval ?? '30000', 10)
  }
  if (provider !== undefined) {
    config.provider = provider
  }
  if (options.config !== undefined) {
    config.configPath = options.config
  }
  return config
}
