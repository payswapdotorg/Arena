import { describe, it, expect } from 'vitest'
import { AlertManager } from './alert-manager.js'

describe('AlertManager', () => {
  it('should create alerts', () => {
    const alertManager = new AlertManager({
      thresholds: { warning: 70, critical: 85, emergency: 95 },
      providers: ['database', 'storage'],
      checkInterval: 60000
    })

    const alert = alertManager.createAlert('database', 'warning', 'Test alert')
    
    expect(alert.id).toBeDefined()
    expect(alert.provider).toBe('database')
    expect(alert.severity).toBe('warning')
    expect(alert.message).toBe('Test alert')
    expect(alert.resolved).toBe(false)
  })

  it('should resolve alerts', () => {
    const alertManager = new AlertManager({
      thresholds: { warning: 70, critical: 85, emergency: 95 },
      providers: ['database', 'storage'],
      checkInterval: 60000
    })

    const alert = alertManager.createAlert('database', 'warning', 'Test alert')
    const result = alertManager.resolveAlert(alert.id)
    
    expect(result).toBe(true)
    expect(alert.resolved).toBe(true)
  })

  it('should get active alerts', () => {
    const alertManager = new AlertManager({
      thresholds: { warning: 70, critical: 85, emergency: 95 },
      providers: ['database', 'storage'],
      checkInterval: 60000
    })

    alertManager.createAlert('database', 'warning', 'Test alert 1')
    alertManager.createAlert('storage', 'critical', 'Test alert 2')
    
    const activeAlerts = alertManager.getActiveAlerts()
    expect(activeAlerts.length).toBe(2)
  })
})