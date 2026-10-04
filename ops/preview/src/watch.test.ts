import { describe, it, expect } from 'vitest'
import { resolveMonitorConfig } from './monitor/config.js'

describe('Watch CLI — resolveMonitorConfig', () => {
  it('should build the default config when no options are given', () => {
    const config = resolveMonitorConfig({})

    expect(config).toEqual({ interval: 30000 })
    // No optional key present with an explicit undefined value.
    expect('provider' in config).toBe(false)
    expect('configPath' in config).toBe(false)
  })

  it('should include provider and configPath only when they are provided', () => {
    const config = resolveMonitorConfig({
      provider: 'database',
      interval: '60000',
      config: './watch-config.json'
    })

    expect(config).toEqual({
      interval: 60000,
      provider: 'database',
      configPath: './watch-config.json'
    })
  })

  it('should accept every valid logical provider slot', () => {
    for (const provider of ['database', 'storage', 'compute', 'coordination'] as const) {
      const config = resolveMonitorConfig({ provider })
      expect(config.provider).toBe(provider)
    }
  })

  it('should fail closed on an invalid provider name (no silent coercion)', () => {
    expect(() => resolveMonitorConfig({ provider: 'neon' })).toThrow(
      'Invalid provider "neon"'
    )
    expect(() => resolveMonitorConfig({ provider: '' })).toThrow('Invalid provider ""')
  })

  it('should parse the interval with a deterministic default', () => {
    expect(resolveMonitorConfig({ interval: '5000' }).interval).toBe(5000)
    expect(resolveMonitorConfig({}).interval).toBe(30000)
  })
})
