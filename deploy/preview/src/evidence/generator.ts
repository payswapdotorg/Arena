import type { AcceptanceResults } from '../acceptance/preview-acceptance.js'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { logger } from '../shared/logger.js'

export interface EvidenceConfig {
  outputDir: string
  timestamp: string
  previewUrl?: string | undefined
}

export class EvidenceGenerator {
  async generate(results: AcceptanceResults, config: EvidenceConfig): Promise<{ path: string; summary: Record<string, unknown> }> {
    logger.info('Generating evidence bundle...')
    
    // Ensure output directory exists
    if (!existsSync(config.outputDir)) {
      mkdirSync(config.outputDir, { recursive: true })
    }
    
    // Create evidence record
    const evidence = {
      metadata: {
        generatedAt: config.timestamp,
        version: '1.0.0',
        previewUrl: config.previewUrl,
        generator: '@arena/deploy-preview'
      },
      summary: {
        total: results.total,
        passed: results.passed,
        failed: results.failed,
        skipped: results.skipped,
        successRate: results.total > 0 ? (results.passed / results.total * 100).toFixed(2) + '%' : 'N/A'
      },
      tests: results.tests.map(test => ({
        name: test.name,
        status: test.status,
        duration: test.duration,
        error: test.error,
        details: test.details
      })),
      gates: {
        'Gate B': {
          status: results.failed === 0 ? 'PASSED' : 'FAILED',
          tests: results.tests.filter(t => t.name.includes('Health') || 
                                        t.name.includes('Capacity') || 
                                        t.name.includes('Quota') || 
                                        t.name.includes('Demo') || 
                                        t.name.includes('Fail-Closed')),
          checklistItems: [
            'Vercel production deployment is live',
            'Health/readiness checks are live',
            'Provider capacity state is visible',
            'Free-tier exhaustion is fail-closed',
            'No hidden paid fallback exists'
          ]
        }
      }, 
      recommendations: results.failed > 0 ? 
        ['Address failed tests before launch'] : 
        ['Ready for launch gate verification']
    }
    
    // Write evidence files
    const evidencePath = join(config.outputDir, 'preview-evidence.json')
    const summaryPath = join(config.outputDir, 'summary.txt')
    
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
    
    // Create human-readable summary
    const summary = `
=== B019 Preview Acceptance Evidence ===
Generated: ${config.timestamp}
Preview URL: ${config.previewUrl || 'N/A (dry-run)'}

SUMMARY:
- Tests Run: ${results.total}
- Passed: ${results.passed}
- Failed: ${results.failed}
- Skipped: ${results.skipped}
- Success Rate: ${evidence.summary.successRate}

GATE B STATUS: ${evidence.gates['Gate B'].status}

FAILED TESTS:
${results.failed > 0 ? results.tests.filter(t => t.status === 'failed').map(t => `- ${t.name}: ${t.error}`).join('\n') : 'None'}

RECOMMENDATIONS:
${evidence.recommendations.join('\n')}

Full evidence: ${evidencePath}
    `
    
    writeFileSync(summaryPath, summary)
    
    logger.info(`Evidence generated: ${evidencePath}`)
    logger.info(`Summary written: ${summaryPath}`)
    
    return {
      path: evidencePath,
      summary: evidence.summary
    }
  }
}

export const evidenceGenerator = new EvidenceGenerator()