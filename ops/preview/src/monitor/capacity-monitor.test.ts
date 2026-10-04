import { describe, it, expect } from 'vitest'
import { CapacityMonitor } from './capacity-monitor.js'

describe('CapacityMonitor', () => {
  it('should create monitor instance', () => {
    const monitor = new CapacityMonitor({
      interval: 30000
    })

    expect(monitor).toBeDefined()
  })

  it('should get current capacity', async () => {
    const monitor = new CapacityMonitor({
      interval: 30000
    })

    const capacity = await monitor.getCurrentCapacity()

    expect(capacity).toBeDefined()
    expect(capacity.provider).toBeDefined()
    expect(capacity.state).toBeDefined()
    expect(Array.isArray(capacity.usage)).toBe(true)
    expect(capacity.usage.length).toBeGreaterThan(0)
  })

  it('should project the B015 free-tier catalog limits exactly', async () => {
    const monitor = new CapacityMonitor({ interval: 30000 })

    const database = await monitor.checkProviderCapacity('database')
    // Neon free tier (docs/deployment/free-tier-architecture.md):
    // 0.5 GB storage, 100 CU-hours, 5 GB transfer per project per month.
    expect(database.usage.map((u) => u.limit)).toEqual([512, 100, 5])

    const storage = await monitor.checkProviderCapacity('storage')
    // R2 free tier: 10 GB-month storage, 1M Class A + 10M Class B ops/month.
    expect(storage.usage.map((u) => u.limit)).toEqual([10, 1_000_000, 10_000_000])

    const coordination = await monitor.checkProviderCapacity('coordination')
    // Upstash free tier: 500K commands, 256 MB data, 10 GB bandwidth/month.
    expect(coordination.usage.map((u) => u.limit)).toEqual([500_000, 256, 10])

    const compute = await monitor.checkProviderCapacity('compute')
    // Hosted job compute posture: 300s max function duration per invocation.
    expect(compute.usage.map((u) => u.limit)).toEqual([300])
  })

  it('should render only the closed FT2.0 capacity vocabulary', async () => {
    const monitor = new CapacityMonitor({ interval: 30000 })
    const vocabulary = ['AVAILABLE', 'DEGRADED', 'EXHAUSTED', 'DISABLED'] as const

    for (const provider of ['database', 'storage', 'compute', 'coordination'] as const) {
      const capacity = await monitor.checkProviderCapacity(provider)
      expect(vocabulary).toContain(capacity.state)
    }
  })

  it('should be deterministic: identical snapshots for identical inputs', async () => {
    const first = new CapacityMonitor({ interval: 30000 })
    const second = new CapacityMonitor({ interval: 30000 })

    const a = await first.checkProviderCapacity('storage')
    const b = await second.checkProviderCapacity('storage')

    // Same fixed timestamp → byte-identical snapshot (deterministic
    // projection, no Math.random anywhere in the harness).
    expect({ ...b, timestamp: a.timestamp, lastCheck: a.lastCheck }).toEqual(a)

    // History usage series are time-independent (deterministic seeds).
    const historyA = await first.getCapacityHistory('database', 24)
    const historyB = await second.getCapacityHistory('database', 24)
    expect(historyB.map((h) => h.usage)).toEqual(historyA.map((h) => h.usage))

    const projectionA = await first.projectCapacityUsage('database', 24)
    const projectionB = await second.projectCapacityUsage('database', 24)
    expect(projectionB).toEqual(projectionA)
  })

  it('should check provider capacity', async () => {
    const monitor = new CapacityMonitor({
      interval: 30000
    })

    const capacity = await monitor.checkProviderCapacity('database')

    expect(capacity).toBeDefined()
    expect(capacity.provider).toBe('database')
  })

  it('should get capacity history', async () => {
    const monitor = new CapacityMonitor({
      interval: 30000
    })

    const history = await monitor.getCapacityHistory('database', 24)

    expect(Array.isArray(history)).toBe(true)
    expect(history.length).toBe(24)
    expect(history[0]?.provider).toBe('database')
  })

  it('should project capacity usage', async () => {
    const monitor = new CapacityMonitor({
      interval: 30000
    })

    const projection = await monitor.projectCapacityUsage('database', 24)

    expect(projection).toBeDefined()
    expect(typeof projection.current).toBe('number')
    expect(typeof projection.projected).toBe('number')
    expect(typeof projection.confidence).toBe('number')
    expect(projection.timeframe).toBe('24 hours')
  })
})
