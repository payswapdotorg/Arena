import { logger } from '../shared/logger.js'
import type { CapacityStatus, ProviderType } from './capacity-monitor.js'

export type AlertSeverity = 'warning' | 'critical' | 'emergency'

export interface Alert {
  id: string
  provider: ProviderType
  severity: AlertSeverity
  message: string
  timestamp: string
  resolved: boolean
  metadata?: Record<string, unknown>
}

export interface AlertConfig {
  thresholds: {
    warning: number
    critical: number
    emergency: number
  }
  providers: ProviderType[]
  checkInterval: number
}

export class AlertManager {
  private alerts: Map<string, Alert> = new Map()
  private config: AlertConfig
  
  constructor(config: AlertConfig) {
    this.config = config
  }
  
  createAlert(
    provider: ProviderType,
    severity: AlertSeverity,
    message: string,
    metadata?: Record<string, unknown>
  ): Alert {
    // Build the alert conditionally so `metadata` is only present when it
    // is defined (exactOptionalPropertyTypes posture).
    const alert: Alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      provider,
      severity,
      message,
      timestamp: new Date().toISOString(),
      resolved: false,
      ...(metadata !== undefined ? { metadata } : {})
    }
    
    this.alerts.set(alert.id, alert)
    logger.warn(`Alert created: ${alert.id} - ${message}`)
    
    return alert
  }
  
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId)
    if (alert && !alert.resolved) {
      alert.resolved = true
      alert.timestamp = new Date().toISOString()
      logger.info(`Alert resolved: ${alertId}`)
      return true
    }
    return false
  }
  
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values()).filter(alert => !alert.resolved)
  }
  
  getAlertsByProvider(provider: ProviderType): Alert[] {
    return Array.from(this.alerts.values()).filter(alert => alert.provider === provider)
  }
  
  getAlertsBySeverity(severity: AlertSeverity): Alert[] {
    return Array.from(this.alerts.values()).filter(alert => alert.severity === severity)
  }
  
  checkCapacityStatus(status: CapacityStatus): Alert[] {
    const alerts: Alert[] = []
    
    // Check if usage exceeds thresholds
    for (const usage of status.usage) {
      if (usage.percentage >= this.config.thresholds.emergency) {
        const alert = this.createAlert(
          status.provider,
          'emergency',
          `Emergency capacity threshold exceeded: ${usage.percentage}% used`,
          { usage, capacityState: status.state }
        )
        alerts.push(alert)
      } else if (usage.percentage >= this.config.thresholds.critical) {
        const alert = this.createAlert(
          status.provider,
          'critical',
          `Critical capacity threshold exceeded: ${usage.percentage}% used`,
          { usage, capacityState: status.state }
        )
        alerts.push(alert)
      } else if (usage.percentage >= this.config.thresholds.warning) {
        const alert = this.createAlert(
          status.provider,
          'warning',
          `Warning capacity threshold approaching: ${usage.percentage}% used`,
          { usage, capacityState: status.state }
        )
        alerts.push(alert)
      }
    }
    
    // Check for degraded or exhausted states
    if (status.state === 'EXHAUSTED') {
      const alert = this.createAlert(
        status.provider,
        'critical',
        `Provider capacity exhausted: ${status.state}`,
        { capacityState: status.state }
      )
      alerts.push(alert)
    } else if (status.state === 'DEGRADED') {
      const alert = this.createAlert(
        status.provider,
        'warning',
        `Provider capacity degraded: ${status.state}`,
        { capacityState: status.state }
      )
      alerts.push(alert)
    }
    
    return alerts
  }
  
  generateAlertReport(): {
    totalAlerts: number
    activeAlerts: number
    resolvedAlerts: number
    alertsByProvider: Record<ProviderType, number>
    alertsBySeverity: Record<AlertSeverity, number>
  } {
    const allAlerts = Array.from(this.alerts.values())
    const activeAlerts = allAlerts.filter(a => !a.resolved)
    const resolvedAlerts = allAlerts.filter(a => a.resolved)
    
    const alertsByProvider: Record<ProviderType, number> = {
      database: 0,
      storage: 0,
      compute: 0,
      coordination: 0
    }
    
    const alertsBySeverity: Record<AlertSeverity, number> = {
      warning: 0,
      critical: 0,
      emergency: 0
    }
    
    activeAlerts.forEach(alert => {
      alertsByProvider[alert.provider]++
      alertsBySeverity[alert.severity]++
    })
    
    return {
      totalAlerts: allAlerts.length,
      activeAlerts: activeAlerts.length,
      resolvedAlerts: resolvedAlerts.length,
      alertsByProvider,
      alertsBySeverity
    }
  }
}

export const alertManager = new AlertManager({
  thresholds: {
    warning: 70,
    critical: 85,
    emergency: 95
  },
  providers: ['database', 'storage', 'compute', 'coordination'],
  checkInterval: 60000 // 1 minute
})