#!/usr/bin/env node

/**
 * B019 Preview Cost/Quota Watch Harness
 *
 * CLI entry for continuous capacity monitoring and quota management.
 * The monitor is a DETERMINISTIC projection harness over the B015
 * free-tier quota catalog (see src/monitor/capacity-monitor.ts) —
 * operator-visible, fail-closed, provider-neutral.
 */

import { program } from 'commander'
import { CapacityMonitor, isProviderType } from './monitor/capacity-monitor.js'
import type { ProviderType } from './monitor/capacity-monitor.js'
import { resolveMonitorConfig } from './monitor/config.js'
import { AlertManager } from './monitor/alert-manager.js'
import { ReportGenerator } from './monitor/report-generator.js'
import { logger } from './shared/logger.js'
import type { CapacityStatus } from './monitor/capacity-monitor.js'

program
  .name('cost-watch')
  .description('B019 Preview Cost/Quota Watch Harness')
  .version('1.0.0')

program
  .command('watch')
  .description('Start continuous capacity monitoring')
  .option('--provider <type>', 'Monitor specific provider (database|storage|compute|coordination)')
  .option('--interval <ms>', 'Check interval in milliseconds', '30000')
  .option('--export <path>', 'Export report to file')
  .option('--status', 'Check current status without starting watch')
  .option('--config <path>', 'Path to configuration file')
  .action(async (options: { provider?: string; interval?: string; export?: string; status?: boolean; config?: string }) => {
    try {
      logger.info('Starting cost/quota watch harness...')

      const monitorConfig = resolveMonitorConfig(options)

      const monitor = new CapacityMonitor(monitorConfig)
      const alertManager = new AlertManager({
        thresholds: {
          warning: 70,
          critical: 85,
          emergency: 95
        },
        providers: monitorConfig.provider !== undefined
          ? [monitorConfig.provider]
          : ['database', 'storage', 'compute', 'coordination'],
        checkInterval: monitorConfig.interval
      })

      let stopMonitoring: (() => void) | undefined

      const statusCallback = async (status: CapacityStatus) => {
        logger.info(`Capacity status: ${status.provider} - ${status.state}`)

        // Check for alerts
        const alerts = alertManager.checkCapacityStatus(status)
        alerts.forEach(alert => {
          logger.warn(`ALERT: ${alert.severity.toUpperCase()} - ${alert.message}`)
        })

        // Generate report if requested
        if (options.export) {
          const reportGenerator = new ReportGenerator()
          await reportGenerator.generate(status, options.export)
          logger.info(`Report exported to: ${options.export}`)
        }
      }

      if (options.status) {
        // Just check current status
        const status = await monitor.getCurrentCapacity()
        await statusCallback(status)
      } else {
        // Start continuous monitoring
        logger.info(`Starting continuous monitoring with ${monitorConfig.interval}ms interval`)
        stopMonitoring = await monitor.start(statusCallback)

        // Keep the process running
        process.on('SIGINT', () => {
          logger.info('Received SIGINT, stopping monitoring...')
          if (stopMonitoring) {
            stopMonitoring()
          }
          process.exit(0)
        })

        process.on('SIGTERM', () => {
          logger.info('Received SIGTERM, stopping monitoring...')
          if (stopMonitoring) {
            stopMonitoring()
          }
          process.exit(0)
        })

        // Run indefinitely
        await new Promise(() => {})
      }

    } catch (error) {
      logger.error('Watch harness failed:', error)
      process.exit(1)
    }
  })

program
  .command('check')
  .description('Check current capacity status')
  .option('--provider <type>', 'Check specific provider')
  .option('--export <path>', 'Export report to file')
  .action(async (options: { provider?: string; export?: string }) => {
    try {
      const monitor = new CapacityMonitor(resolveMonitorConfig(options))

      const status = await monitor.getCurrentCapacity()

      logger.info(`Current capacity status:`)
      logger.info(`Provider: ${status.provider}`)
      logger.info(`Name: ${status.name}`)
      logger.info(`State: ${status.state}`)
      logger.info(`Last check: ${status.lastCheck}`)

      status.usage.forEach((usage, index) => {
        logger.info(`Usage ${index + 1}: ${usage.current}/${usage.limit} (${usage.percentage}%) - ${usage.trend}`)
      })

      if (options.export) {
        const reportGenerator = new ReportGenerator()
        await reportGenerator.generate(status, options.export)
        logger.info(`Report exported to: ${options.export}`)
      }

    } catch (error) {
      logger.error('Capacity check failed:', error)
      process.exit(1)
    }
  })

program
  .command('project')
  .description('Project capacity usage')
  .option('--provider <type>', 'Project for specific provider')
  .option('--hours <number>', 'Hours to project', '24')
  .action(async (options: { provider?: string; hours?: string }) => {
    try {
      let provider: ProviderType = 'database'
      if (options.provider !== undefined) {
        if (!isProviderType(options.provider)) {
          throw new Error(
            `Invalid provider ${JSON.stringify(options.provider)} — expected one of: database, storage, compute, coordination`
          )
        }
        provider = options.provider
      }

      const monitor = new CapacityMonitor({ interval: 30000 })

      const projection = await monitor.projectCapacityUsage(
        provider,
        Number.parseInt(options.hours ?? '24', 10)
      )

      logger.info(`Capacity projection for ${provider}:`)
      logger.info(`Current usage: ${projection.current}%`)
      logger.info(`Projected usage in ${options.hours ?? '24'} hours: ${projection.projected}%`)
      logger.info(`Confidence: ${projection.confidence}%`)

    } catch (error) {
      logger.error('Capacity projection failed:', error)
      process.exit(1)
    }
  })

program.parse()
