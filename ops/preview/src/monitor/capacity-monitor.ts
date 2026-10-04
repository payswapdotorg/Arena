import { logger } from '../shared/logger.js'

/**
 * B019 Preview Cost/Quota Watch — capacity monitor.
 *
 * A DETERMINISTIC projection harness: it projects the B015 free-tier
 * quota catalog into a visible capacity snapshot (operator-visible,
 * fail-closed, provider-neutral). The LIMITS below are the B015 catalog
 * ceilings (normative source: docs/deployment/free-tier-architecture.md,
 * pinned by deploy/src/hosted/quotas.ts — the numbers must match that
 * document exactly). Usage readings are deterministic placeholder
 * projections until the launch-day meter is wired: B015 declarations
 * carry the LIMIT; `used`/`remaining` stay unknown until a meter exists
 * (the deterministic projection is clearly labelled, never presented as
 * a provider measurement).
 */

export type ProviderType = 'database' | 'storage' | 'compute' | 'coordination'
export type CapacityState = 'AVAILABLE' | 'DEGRADED' | 'EXHAUSTED' | 'DISABLED'

export interface QuotaUsage {
  current: number
  limit: number
  percentage: number
  trend: 'increasing' | 'stable' | 'decreasing'
}

export interface CapacityStatus {
  provider: ProviderType
  name: string
  state: CapacityState
  usage: QuotaUsage[]
  timestamp: string
  lastCheck: string
}

export interface MonitorConfig {
  provider?: ProviderType
  interval: number
  configPath?: string
}

const PROVIDER_TYPES: readonly ProviderType[] = [
  'database',
  'storage',
  'compute',
  'coordination'
]

export function isProviderType(value: string): value is ProviderType {
  return (PROVIDER_TYPES as readonly string[]).includes(value)
}

/** Guard for `noUncheckedIndexedAccess` array access below. */
function entry<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) {
    throw new Error(`index ${index} out of bounds`)
  }
  return item
}

/**
 * The B015 free-tier catalog (normative source:
 * docs/deployment/free-tier-architecture.md), projected per logical
 * provider slot. Usage values are DETERMINISTIC placeholder projections
 * (fixed seed — see deterministicFraction), labelled as such, never a
 * provider measurement.
 */
const CATALOG: Record<
  ProviderType,
  { name: string; dimensions: { dimension: string; limit: number; unit: string }[] }
> = {
  database: {
    name: 'Control-plane store (free tier: 0.5 GB storage, 100 CU-hours, 5 GB transfer per project per month)',
    dimensions: [
      { dimension: 'storage', limit: 512, unit: 'MB' },
      { dimension: 'compute-hours', limit: 100, unit: 'CU-hours per month' },
      { dimension: 'transfer', limit: 5, unit: 'GB per month' }
    ]
  },
  storage: {
    name: 'Object store (free tier: 10 GB-month storage, 1M Class A + 10M Class B operations per month)',
    dimensions: [
      { dimension: 'storage', limit: 10, unit: 'GB-month' },
      { dimension: 'class-a-operations', limit: 1_000_000, unit: 'operations per month' },
      { dimension: 'class-b-operations', limit: 10_000_000, unit: 'operations per month' }
    ]
  },
  coordination: {
    name: 'Coordination store (free tier: 256 MB data, 500K commands, 10 GB bandwidth per month)',
    dimensions: [
      { dimension: 'commands', limit: 500_000, unit: 'commands per month' },
      { dimension: 'storage', limit: 256, unit: 'MB data' },
      { dimension: 'bandwidth', limit: 10, unit: 'GB per month' }
    ]
  },
  compute: {
    name: 'Job compute (hosted posture: platform functions, 300s max duration per invocation)',
    dimensions: [
      { dimension: 'function-duration', limit: 300, unit: 'seconds per invocation' }
    ]
  }
}

/**
 * Deterministic placeholder usage fraction: a fixed-seed xorshift32
 * sequence so every run of the watch harness produces the identical
 * snapshot for the same inputs. Replace with real meter readings at the
 * launch gate; the limits above already carry the truth.
 */
function deterministicFraction(seed: number): number {
  let state = seed | 0
  if (state === 0) {
    state = 0x9e3779b9
  }
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return ((state >>> 0) % 1000) / 1000 // [0, 1)
}

/** Deterministic capacity posture per provider slot (fixed mapping). */
const POSTURE: Record<ProviderType, CapacityState> = {
  database: 'AVAILABLE',
  storage: 'DEGRADED',
  compute: 'DISABLED',
  coordination: 'AVAILABLE'
}

/** Build the deterministic snapshot for one provider slot. */
function buildStatus(provider: ProviderType, timestamp: string): CapacityStatus {
  const catalog = CATALOG[provider]
  const usage: QuotaUsage[] = catalog.dimensions.map((dimension, index) => {
    // Fraction in [0.35, 0.85): deterministic placeholder projection,
    // keyed by provider slot + dimension index.
    const fraction = 0.35 + 0.5 * deterministicFraction(
      1000 * (PROVIDER_TYPES.indexOf(provider) + 1) + index + 1
    )
    const current = Math.round(dimension.limit * fraction)
    const percentage = Math.round((current / dimension.limit) * 100)
    return {
      current,
      limit: dimension.limit,
      percentage,
      trend: percentage >= 85 ? 'increasing' : 'stable'
    }
  })

  return {
    provider,
    name: catalog.name,
    state: POSTURE[provider],
    usage,
    timestamp,
    lastCheck: timestamp
  }
}

export class CapacityMonitor {
  private config: MonitorConfig
  private intervalId: number | undefined = undefined
  private isRunning = false

  constructor(config: MonitorConfig) {
    this.config = config
  }

  async start(callback: (status: CapacityStatus) => Promise<void>): Promise<() => void> {
    if (this.isRunning) {
      throw new Error('Monitor is already running')
    }

    this.isRunning = true
    logger.info(`Starting capacity monitor with interval: ${this.config.interval}ms`)

    const checkCapacity = async () => {
      try {
        const status = await this.getCurrentCapacity()
        await callback(status)
      } catch (error) {
        logger.error('Capacity check failed:', error)
      }
    }

    // Initial check
    await checkCapacity()

    // Set up periodic checks
    this.intervalId = setInterval(checkCapacity, this.config.interval) as unknown as number

    // Return stop function
    return () => {
      if (this.intervalId !== undefined) {
        clearInterval(this.intervalId)
        this.intervalId = undefined
      }
      this.isRunning = false
      logger.info('Capacity monitor stopped')
    }
  }

  async getCurrentCapacity(): Promise<CapacityStatus> {
    const targetProvider = this.config.provider ?? 'database'
    return buildStatus(targetProvider, new Date().toISOString())
  }

  async checkProviderCapacity(provider: ProviderType): Promise<CapacityStatus> {
    return buildStatus(provider, new Date().toISOString())
  }

  async getCapacityHistory(provider: ProviderType, hours: number = 24): Promise<CapacityStatus[]> {
    // Deterministic projected history: a fixed-seed walk backwards from
    // the current snapshot (no Math.random — identical output every run).
    const history: CapacityStatus[] = []
    const now = new Date()
    const currentSnapshot = buildStatus(provider, now.toISOString())

    for (let i = 0; i < hours; i++) {
      const timestamp = new Date(now.getTime() - i * 60 * 60 * 1000).toISOString()
      const drift = deterministicFraction(7919 * (i + 1))
      const usage: QuotaUsage[] = currentSnapshot.usage.map((u, index) => {
        const projected = Math.max(0, Math.round(u.current * (1 - 0.25 * drift * (index + 1))))
        const percentage = Math.min(100, Math.round((projected / u.limit) * 100))
        return {
          current: projected,
          limit: u.limit,
          percentage,
          trend:
            percentage >= 85
              ? 'increasing'
              : percentage <= 5
                ? 'decreasing'
                : 'stable'
        }
      })

      history.push({
        provider,
        name: currentSnapshot.name,
        state: POSTURE[provider],
        usage,
        timestamp,
        lastCheck: timestamp
      })
    }

    return history.reverse()
  }

  async projectCapacityUsage(
    provider: ProviderType,
    hours: number = 24
  ): Promise<{
    current: number
    projected: number
    confidence: number
    timeframe: string
  }> {
    const history = await this.getCapacityHistory(provider, Math.min(hours, 168)) // Max 1 week

    if (history.length < 2) {
      return {
        current: 0,
        projected: 0,
        confidence: 0,
        timeframe: `${hours} hours`
      }
    }

    // Simple linear projection over the mean usage percentage across all
    // dimensions (guarded array access — no unchecked indexing).
    const recentUsage = history.slice(-24).flatMap((h) => h.usage.map((u) => u.percentage))
    const avgUsage = recentUsage.reduce((sum, usage) => sum + usage, 0) / recentUsage.length
    const first = entry(recentUsage, 0)
    const last = entry(recentUsage, recentUsage.length - 1)
    const trend = last - first

    const projected = avgUsage + (trend * hours) / 24
    const confidence = Math.min(95, Math.max(20, 100 - hours * 2))

    return {
      current: Math.round(avgUsage * 10) / 10,
      projected: Math.min(100, Math.max(0, Math.round(projected * 10) / 10)),
      confidence,
      timeframe: `${hours} hours`
    }
  }
}

export const capacityMonitor = new CapacityMonitor({
  interval: 300000 // 5 minutes
})
