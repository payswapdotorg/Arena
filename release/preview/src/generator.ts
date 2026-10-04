#!/usr/bin/env node

/**
 * B019 Preview Evidence Generator
 *
 * CLI entry for generating the deterministic Gate-F evidence bundle.
 * The default bundle is the honest record SKELETON (every check's real
 * command + artifact reference, exitStatus = NOT_RUN sentinel → bundle
 * INCOMPLETE); launch-day results are filled through --input <json>.
 */

import { program } from 'commander'
import { EvidenceGenerator } from './evidence-generator.js'
import { logger } from './shared/logger.js'
import { readFileSync, existsSync } from 'fs'

program
  .name('evidence-generator')
  .description('B019 Preview Evidence Generator')
  .version('1.0.0')

program
  .command('generate')
  .description('Generate the Gate-F evidence bundle (pending skeleton by default)')
  .option('--output <path>', 'Output directory for evidence bundle', './evidence')
  .option('--preview-url <url>', 'Preview URL for deployment evidence')
  .option('--input <path>', 'JSON file of launch-day record inputs keyed by record id')
  .option('--timestamp <iso>', 'Fixed timestamp for byte-stable bundles')
  .option('--tech-lead <name>', 'Tech Lead name for attestation')
  .option('--verbose', 'Verbose logging')
  .action(async (options: {
    output?: string
    previewUrl?: string
    input?: string
    timestamp?: string
    techLead?: string
    verbose?: boolean
  }) => {
    try {
      logger.setVerbose(options.verbose || false)

      logger.info('Starting evidence generation...')

      // Load launch-day inputs (real exit statuses) when provided.
      let inputs: Record<string, { exitStatus?: number; artifactRef?: string; metadata?: Record<string, unknown> }> | undefined
      if (options.input !== undefined) {
        if (!existsSync(options.input)) {
          logger.error(`Input file not found: ${options.input}`)
          process.exit(1)
        }
        inputs = JSON.parse(readFileSync(options.input, 'utf8'))
      }

      // Build the config conditionally — no optional key present with an
      // explicit undefined value (exactOptionalPropertyTypes posture).
      const config: Parameters<EvidenceGenerator['generate']>[0] = {
        outputDir: options.output || './evidence'
      }
      if (options.previewUrl !== undefined) {
        config.previewUrl = options.previewUrl
      }
      if (options.timestamp !== undefined) {
        config.timestamp = options.timestamp
      }
      if (inputs !== undefined) {
        config.inputs = inputs
      }

      const generator = new EvidenceGenerator()
      const result = await generator.generate(config)

      logger.info('=== EVIDENCE GENERATION SUMMARY ===')
      logger.info(`Total records: ${result.bundle.summary.totalRecords}`)
      logger.info(`Passed records: ${result.bundle.summary.passedRecords}`)
      logger.info(`Failed records: ${result.bundle.summary.failedRecords}`)
      logger.info(`Pending records (NOT_RUN): ${result.bundle.summary.pendingRecords}`)
      logger.info(`Gate status: ${result.bundle.summary.gateStatus}`)
      logger.info(`Success rate: ${result.summary.successRate}`)

      if (options.techLead) {
        logger.info(`Tech Lead attestation: ${options.techLead}`)
      }

      if (result.bundle.summary.failedRecords > 0) {
        logger.error('❌ Evidence generation completed with FAILED records')
        process.exit(1)
      } else if (result.bundle.summary.pendingRecords > 0) {
        logger.info('⏳ Evidence bundle is INCOMPLETE (pending launch-day records)')
        logger.info(`Evidence bundle written to: ${result.outputPath}`)
        process.exit(0)
      } else {
        logger.info('✅ Evidence generation completed with all records green')
        logger.info(`Evidence bundle written to: ${result.outputPath}`)
        process.exit(0)
      }
    } catch (error) {
      logger.error('Evidence generation failed:', error)
      process.exit(1)
    }
  })

program
  .command('validate')
  .description('Validate an existing evidence bundle')
  .option('--bundle <path>', 'Path to evidence bundle file', './evidence/evidence-bundle.json')
  .option('--verbose', 'Verbose logging')
  .action(async (options: { bundle?: string; verbose?: boolean }) => {
    try {
      logger.setVerbose(options.verbose || false)

      const bundlePath = options.bundle || './evidence/evidence-bundle.json'

      if (!existsSync(bundlePath)) {
        logger.error(`Evidence bundle not found: ${bundlePath}`)
        process.exit(1)
      }

      const bundle = JSON.parse(readFileSync(bundlePath, 'utf8')) as Record<string, unknown>

      logger.info('=== EVIDENCE BUNDLE VALIDATION ===')
      logger.info(`Bundle ID: ${bundle.id}`)
      logger.info(`Generated: ${bundle.timestamp}`)
      logger.info(`Version: ${bundle.version}`)
      logger.info(`Preview URL: ${typeof bundle.previewUrl === 'string' ? bundle.previewUrl : 'N/A'}`)

      const summary = bundle.summary as Record<string, number> | undefined
      if (summary) {
        logger.info(`Total records: ${summary.totalRecords}`)
        logger.info(`Passed records: ${summary.passedRecords}`)
        logger.info(`Failed records: ${summary.failedRecords}`)
        logger.info(`Pending records: ${summary.pendingRecords ?? 0}`)
        logger.info(`Gate status: ${summary.gateStatus}`)
      }

      // Validate bundle structure
      const requiredFields = ['id', 'timestamp', 'version', 'records', 'summary']
      const missingFields = requiredFields.filter((field) => !bundle[field])

      if (missingFields.length > 0) {
        logger.error(`❌ Bundle validation failed: Missing fields: ${missingFields.join(', ')}`)
        process.exit(1)
      }

      // Validate record structure
      const records = bundle.records as Record<string, unknown>[]
      let validRecords = 0
      records.forEach((record, index) => {
        const recordRequiredFields = [
          'id', 'type', 'name', 'description', 'command', 'exitStatus',
          'artifactRef', 'reproducibility', 'timestamp', 'version'
        ]
        const missingRecordFields = recordRequiredFields.filter((field) => record[field] === undefined)

        if (missingRecordFields.length === 0) {
          validRecords++
        } else {
          logger.warn(`Record ${index + 1} (${String(record.id)}) missing fields: ${missingRecordFields.join(', ')}`)
        }
      })

      logger.info(`Valid records: ${validRecords}/${records.length}`)

      if (validRecords === records.length) {
        logger.info('✅ Evidence bundle validation passed')
        process.exit(0)
      } else {
        logger.error('❌ Evidence bundle validation failed')
        process.exit(1)
      }
    } catch (error) {
      logger.error('Evidence bundle validation failed:', error)
      process.exit(1)
    }
  })

program.parse()
