import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { evidenceGenerator } from './generator.js'
import type { AcceptanceResults } from '../acceptance/preview-acceptance.js'

function acceptanceResultsFixture(): AcceptanceResults {
  return {
    total: 5,
    passed: 3,
    failed: 1,
    skipped: 1,
    tests: [
      { name: 'Health Readiness', status: 'passed', duration: 12 },
      { name: 'Provider Capacity Visibility', status: 'passed', duration: 34 },
      { name: 'Quota Exhaustion Fail-Closed', status: 'skipped', duration: 0 },
      { name: 'Hosted Demo Route Walk', status: 'passed', duration: 56 },
      {
        name: 'No Hidden Paid Fallback',
        status: 'failed',
        duration: 78,
        error: 'Demo operations page does not render the fail-closed posture'
      }
    ],
    startTime: '2026-10-04T12:00:00.000Z',
    endTime: '2026-10-04T12:00:02.000Z'
  }
}

describe('Evidence Generator', () => {
  it('should have evidence generator instance', () => {
    expect(evidenceGenerator).toBeDefined()
    expect(typeof evidenceGenerator.generate).toBe('function')
  })

  it('should generate evidence from acceptance results into a temp directory', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'arena-preview-evidence-'))
    try {
      const result = await evidenceGenerator.generate(acceptanceResultsFixture(), {
        outputDir,
        timestamp: '2026-10-04T12:00:02.000Z'
      })

      expect(result.path).toContain('preview-evidence.json')
      expect(existsSync(join(outputDir, 'preview-evidence.json'))).toBe(true)
      expect(existsSync(join(outputDir, 'summary.txt'))).toBe(true)

      const bundle = JSON.parse(
        readFileSync(join(outputDir, 'preview-evidence.json'), 'utf8')
      ) as Record<string, unknown>
      expect(bundle.metadata).toMatchObject({
        generatedAt: '2026-10-04T12:00:02.000Z',
        generator: '@arena/deploy-preview'
      })
      expect(bundle.summary).toMatchObject({
        total: 5,
        passed: 3,
        failed: 1,
        skipped: 1
      })
      // Gate B status reflects the failing probe honestly.
      expect((bundle.gates as Record<string, { status: string }>)['Gate B']?.status).toBe(
        'FAILED'
      )
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('should mark Gate B PASSED only when no probe failed', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'arena-preview-evidence-'))
    try {
      const results = acceptanceResultsFixture()
      results.failed = 0
      results.tests = results.tests.map((test) =>
        test.status === 'failed' ? { ...test, status: 'passed' as const } : test
      )

      const result = await evidenceGenerator.generate(results, {
        outputDir,
        timestamp: '2026-10-04T12:00:02.000Z'
      })

      const bundle = JSON.parse(
        readFileSync(join(outputDir, 'preview-evidence.json'), 'utf8')
      ) as Record<string, unknown>
      expect((bundle.gates as Record<string, { status: string }>)['Gate B']?.status).toBe(
        'PASSED'
      )
      expect(result.summary.total).toBe(5)
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })
})
