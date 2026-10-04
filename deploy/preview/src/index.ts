#!/usr/bin/env node

/**
 * B019 Hosted Preview Acceptance Harness
 * 
 * CLI entry for preview acceptance testing and evidence generation.
 * 
 * Usage:
 *   # Dry-run mode (no ARENA_PREVIEW_URL)
 *   pnpm run run
 *   
 *   # Live mode (with ARENA_PREVIEW_URL — the TL-provided deployment URL)
 *   ARENA_PREVIEW_URL=__ARENA_PREVIEW_URL__ pnpm run run
 *   
 *   # Specific test suites
 *   ARENA_PREVIEW_URL=__ARENA_PREVIEW_URL__ pnpm run run -- --testNamePattern="Health"
 */

import { program } from 'commander'
import { previewAcceptanceSuite } from './acceptance/preview-acceptance.js'
import type { PreviewAcceptanceConfig } from './acceptance/preview-acceptance.js'
import { evidenceGenerator } from './evidence/generator.js'
import type { EvidenceConfig } from './evidence/generator.js'
import { logger } from './shared/logger.js'

program
  .name('preview-acceptance')
  .description('B019 Hosted Preview Acceptance Harness')
  .version('1.0.0')

program
  .command('run')
  .description('Run the complete preview acceptance suite')
  .option('--testNamePattern <pattern>', 'Run only tests matching the pattern')
  .option('--output <path>', 'Output directory for evidence artifacts', './evidence')
  .option('--verbose', 'Verbose logging')
  .action(async (options: { testNamePattern?: string; output?: string; verbose?: boolean }) => {
    try {
      logger.setVerbose(options.verbose || false)
      
      // Check environment
      const previewUrl = process.env.ARENA_PREVIEW_URL
      const isLiveMode = !!previewUrl
      
      logger.info(`Starting preview acceptance suite`)
      logger.info(`Mode: ${isLiveMode ? 'LIVE' : 'DRY-RUN'}`)
      logger.info(`URL: ${previewUrl || 'N/A (dry-run)'}`)
      
      // Run acceptance suite. Build the config conditionally so no
      // optional key is ever present with an explicit `undefined` value
      // (exactOptionalPropertyTypes posture).
      const suiteConfig: PreviewAcceptanceConfig = { isLiveMode }
      if (previewUrl !== undefined) {
        suiteConfig.previewUrl = previewUrl
      }
      if (options.testNamePattern !== undefined) {
        suiteConfig.testNamePattern = options.testNamePattern
      }
      const results = await previewAcceptanceSuite(suiteConfig)

      // Generate evidence (same conditional-construction discipline).
      const evidenceConfig: EvidenceConfig = {
        outputDir: options.output || './evidence',
        timestamp: new Date().toISOString()
      }
      if (previewUrl !== undefined) {
        evidenceConfig.previewUrl = previewUrl
      }
      const evidence = await evidenceGenerator.generate(results, evidenceConfig)
      
      // Output summary
      logger.info('=== ACCEPTANCE SUMMARY ===')
      logger.info(`Tests run: ${results.total}`)
      logger.info(`Passed: ${results.passed}`)
      logger.info(`Failed: ${results.failed}`)
      logger.info(`Skipped: ${results.skipped}`)
      
      if (results.failed > 0) {
        logger.error(`❌ Preview acceptance FAILED`)
        process.exit(1)
      } else {
        logger.info(`✅ Preview acceptance PASSED`)
        logger.info(`Evidence written to: ${evidence.path}`)
        process.exit(0)
      }
      
    } catch (error) {
      logger.error('Preview acceptance failed:', error)
      process.exit(1)
    }
  })

program.parse()