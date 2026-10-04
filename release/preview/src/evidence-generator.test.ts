import { describe, it, expect } from 'vitest'
import { EvidenceGenerator } from './evidence-generator.js'
import { EXIT_STATUS_NOT_RUN } from './records.js'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const FIXED_TIMESTAMP = '2026-10-04T12:00:00.000Z'

describe('EvidenceGenerator — honest pending skeleton (default)', () => {
  it('should generate the Gate-F record skeleton with every record pending', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'arena-release-evidence-'))
    try {
      const generator = new EvidenceGenerator()
      const result = await generator.generate({
        outputDir,
        timestamp: FIXED_TIMESTAMP
      })

      // All eight Gate-F record kinds are present.
      expect(result.bundle.records.map((r) => r.type)).toEqual([
        'ci', 'product-e2e', 'accessibility', 'performance',
        'security', 'quota', 'deployment', 'installation'
      ])

      // Honesty: no record claims a result it does not have.
      for (const record of result.bundle.records) {
        expect(record.exitStatus).toBe(EXIT_STATUS_NOT_RUN)
      }

      // The bundle is INCOMPLETE by construction while records are pending.
      expect(result.bundle.summary.gateStatus).toBe('INCOMPLETE')
      expect(result.bundle.summary.pendingRecords).toBe(8)
      expect(result.bundle.summary.passedRecords).toBe(0)
      expect(result.bundle.summary.failedRecords).toBe(0)
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('should be byte-stable: identical inputs produce identical bundles', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'arena-release-evidence-'))
    const dirB = mkdtempSync(join(tmpdir(), 'arena-release-evidence-'))
    try {
      const generator = new EvidenceGenerator()
      await generator.generate({ outputDir: dirA, timestamp: FIXED_TIMESTAMP })
      await generator.generate({ outputDir: dirB, timestamp: FIXED_TIMESTAMP })

      const bytesA = readFileSync(join(dirA, 'evidence-bundle.json'))
      const bytesB = readFileSync(join(dirB, 'evidence-bundle.json'))
      expect(bytesA.equals(bytesB)).toBe(true)
    } finally {
      rmSync(dirA, { recursive: true, force: true })
      rmSync(dirB, { recursive: true, force: true })
    }
  })
})

describe('EvidenceGenerator — launch-day inputs', () => {
  it('should mark the bundle PASSED only when every record ran green', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'arena-release-evidence-'))
    try {
      const generator = new EvidenceGenerator()
      const result = await generator.generate({
        outputDir,
        timestamp: FIXED_TIMESTAMP,
        inputs: Object.fromEntries(
          ['ci-001', 'e2e-001', 'a11y-001', 'perf-001', 'sec-001', 'quota-001', 'deploy-001', 'install-001'].map(
            (id) => [id, { exitStatus: 0 }]
          )
        )
      })

      expect(result.bundle.summary.gateStatus).toBe('PASSED')
      expect(result.bundle.summary.passedRecords).toBe(8)
      expect(result.bundle.summary.pendingRecords).toBe(0)
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('should mark the bundle FAILED when any record ran red', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'arena-release-evidence-'))
    try {
      const generator = new EvidenceGenerator()
      const result = await generator.generate({
        outputDir,
        timestamp: FIXED_TIMESTAMP,
        inputs: {
          'ci-001': { exitStatus: 0 },
          'deploy-001': { exitStatus: 1 }
        }
      })

      expect(result.bundle.summary.gateStatus).toBe('FAILED')
      expect(result.bundle.summary.failedRecords).toBe(1)
      // Unfilled records stay pending (never silently passed).
      expect(result.bundle.summary.pendingRecords).toBe(6)
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })
})
