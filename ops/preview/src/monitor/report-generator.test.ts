import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ReportGenerator } from './report-generator.js'
import { CapacityMonitor } from './capacity-monitor.js'

describe('ReportGenerator', () => {
  it('should create report generator instance', () => {
    const generator = new ReportGenerator()
    expect(generator).toBeDefined()
  })

  it('should generate a json report', async () => {
    const generator = new ReportGenerator()
    const outDir = mkdtempSync(join(tmpdir(), 'arena-ops-report-'))
    try {
      const status = await new CapacityMonitor({ interval: 30000 }).getCurrentCapacity()
      const outputPath = join(outDir, 'capacity-report.json')

      await generator.generate(status, outputPath, { format: 'json' })

      expect(existsSync(outputPath)).toBe(true)
      const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Record<string, unknown>
      expect(report.status).toMatchObject({
        name: status.name,
        state: status.state
      })
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })

  it('should generate an html report', async () => {
    const generator = new ReportGenerator()
    const outDir = mkdtempSync(join(tmpdir(), 'arena-ops-report-'))
    try {
      const status = await new CapacityMonitor({ interval: 30000 }).getCurrentCapacity()
      const outputPath = join(outDir, 'capacity-report.html')

      await generator.generate(status, outputPath, { format: 'html' })

      const html = readFileSync(outputPath, 'utf8')
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain(status.provider)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })

  it('should generate a text report', async () => {
    const generator = new ReportGenerator()
    const outDir = mkdtempSync(join(tmpdir(), 'arena-ops-report-'))
    try {
      const status = await new CapacityMonitor({ interval: 30000 }).getCurrentCapacity()
      const outputPath = join(outDir, 'capacity-report.txt')

      await generator.generate(status, outputPath, { format: 'txt' })

      const text = readFileSync(outputPath, 'utf8')
      expect(text).toContain('CAPACITY REPORT')
      expect(text).toContain(`Provider: ${status.provider}`)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })
})
