import { describe, it, expect } from 'vitest'
import { EvidenceGenerator } from './evidence-generator.js'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const FIXED_TIMESTAMP = '2026-10-04T12:00:00.000Z'

describe('Evidence Generator CLI surface (generator class)', () => {
  it('should expose the generate command surface', () => {
    const generator = new EvidenceGenerator()
    expect(generator).toBeDefined()
    expect(typeof generator.generate).toBe('function')
  })

  it('should write the evidence bundle and a deterministic id', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'arena-release-evidence-'))
    try {
      const generator = new EvidenceGenerator()
      const result = await generator.generate({
        outputDir,
        timestamp: FIXED_TIMESTAMP
      })

      expect(result.outputPath).toContain('evidence-bundle.json')
      const bundle = JSON.parse(
        readFileSync(join(outputDir, 'evidence-bundle.json'), 'utf8')
      ) as { id: string; timestamp: string }
      // Deterministic bundle id derived from the fixed timestamp.
      expect(bundle.id).toBe(`evidence-gate-f-${FIXED_TIMESTAMP.replace(/[:.]/g, '-')}`)
      expect(bundle.timestamp).toBe(FIXED_TIMESTAMP)
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })
})
