import type { CapacityStatus, ProviderType } from './capacity-monitor.js'
import { writeFileSync, mkdirSync, existsSync } from 'fs'

export interface ReportConfig {
  includeTrends: boolean
  includePredictions: boolean
  format: 'json' | 'html' | 'txt'
}

export class ReportGenerator {
  async generate(status: CapacityStatus, outputPath: string, _config?: Partial<ReportConfig>): Promise<void> {
    const finalConfig: ReportConfig = {
      includeTrends: true,
      includePredictions: true,
      format: 'json',
      ..._config
    }
    
    // Ensure output directory exists
    const outputDir = outputPath.includes('/') ? outputPath.substring(0, outputPath.lastIndexOf('/')) : '.'
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }
    
    switch (finalConfig.format) {
      case 'json':
        await this.generateJsonReport(status, outputPath, finalConfig)
        break
      case 'html':
        await this.generateHtmlReport(status, outputPath, finalConfig)
        break
      case 'txt':
        await this.generateTextReport(status, outputPath, finalConfig)
        break
    }
  }
  
  private async generateJsonReport(status: CapacityStatus, outputPath: string, config: ReportConfig): Promise<void> {
    const report = {
      metadata: {
        generatedAt: new Date().toISOString(),
        provider: status.provider,
        version: '1.0.0'
      },
      status: {
        name: status.name,
        state: status.state,
        lastCheck: status.lastCheck,
        usage: status.usage.map(usage => ({
          current: usage.current,
          limit: usage.limit,
          percentage: usage.percentage,
          trend: usage.trend
        }))
      },
      trends: config.includeTrends ? await this.getTrends(status.provider) : undefined,
      predictions: config.includePredictions ? await this.getPredictions(status.provider) : undefined,
      recommendations: this.generateRecommendations(status)
    }
    
    writeFileSync(outputPath, JSON.stringify(report, null, 2))
  }
  
  private async generateHtmlReport(status: CapacityStatus, outputPath: string, _config: ReportConfig): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Capacity Report - ${status.provider}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .status { margin: 20px 0; }
        .usage-bar { background: #e0e0e0; height: 20px; border-radius: 10px; overflow: hidden; }
        .usage-fill { background: #4CAF50; height: 100%; transition: width 0.3s; }
        .usage-fill.warning { background: #FF9800; }
        .usage-fill.critical { background: #F44336; }
        .recommendations { background: #f9f9f9; padding: 15px; border-radius: 5px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Capacity Report</h1>
        <p>Provider: ${status.provider}</p>
        <p>Generated: ${new Date().toISOString()}</p>
        <p>Status: ${status.state}</p>
    </div>
    
    <div class="status">
        <h2>Usage</h2>
        ${status.usage.map(usage => `
            <div>
                <p>Current: ${usage.current} / ${usage.limit} (${usage.percentage}%)</p>
                <div class="usage-bar">
                    <div class="usage-fill ${this.getUsageClass(usage.percentage)}" style="width: ${usage.percentage}%"></div>
                </div>
                <p>Trend: ${usage.trend}</p>
            </div>
        `).join('')}
    </div>
    
    <div class="recommendations">
        <h2>Recommendations</h2>
        <ul>
            ${this.generateRecommendations(status).map(rec => `<li>${rec}</li>`).join('')}
        </ul>
    </div>
</body>
</html>`
    
    writeFileSync(outputPath, html)
  }
  
  private async generateTextReport(status: CapacityStatus, outputPath: string, _config: ReportConfig): Promise<void> {
    const text = `
CAPACITY REPORT
===============

Provider: ${status.provider}
Name: ${status.name}
Status: ${status.state}
Generated: ${new Date().toISOString()}
Last Check: ${status.lastCheck}

USAGE:
${status.usage.map(usage => 
  `  Current: ${usage.current} / ${usage.limit} (${usage.percentage}%)
  Trend: ${usage.trend}`
).join('\n\n')}

RECOMMENDATIONS:
${this.generateRecommendations(status).map(rec => `- ${rec}`).join('\n')}
`
    
    writeFileSync(outputPath, text)
  }
  
  private getUsageClass(percentage: number): string {
    if (percentage >= 90) return 'critical'
    if (percentage >= 70) return 'warning'
    return ''
  }
  
  private async getTrends(provider: ProviderType): Promise<Record<string, unknown>> {
    // Mock trend data
    return {
      provider,
      timeframe: '24h',
      data: [
        { timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), usage: 65 },
        { timestamp: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString(), usage: 68 },
        { timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), usage: 72 },
        { timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), usage: 75 },
        { timestamp: new Date().toISOString(), usage: 78 }
      ],
      trend: 'increasing',
      projection: 'Expected to reach 85% in 12 hours'
    }
  }
  
  private async getPredictions(provider: ProviderType): Promise<Record<string, unknown>> {
    // Mock prediction data
    return {
      provider,
      predictions: [
        { timeframe: '6h', projectedUsage: 82, confidence: 85 },
        { timeframe: '12h', projectedUsage: 88, confidence: 75 },
        { timeframe: '24h', projectedUsage: 92, confidence: 65 }
      ],
      recommendations: [
        'Monitor usage closely over the next 24 hours',
        'Consider scaling resources if usage exceeds 90%',
        'Review long-term capacity planning'
      ]
    }
  }
  
  private generateRecommendations(status: CapacityStatus): string[] {
    const recommendations: string[] = []
    
    if (status.state === 'EXHAUSTED') {
      recommendations.push('CRITICAL: Provider capacity exhausted. Immediate action required.')
      recommendations.push('Consider upgrading to a higher tier or scaling resources.')
    } else if (status.state === 'DEGRADED') {
      recommendations.push('Provider performance degraded. Monitor closely.')
      recommendations.push('Consider scaling or optimizing resource usage.')
    }
    
    status.usage.forEach(usage => {
      if (usage.percentage >= 90) {
        recommendations.push(`WARNING: Usage at ${usage.percentage}% - consider scaling soon.`)
      } else if (usage.percentage >= 70) {
        recommendations.push(`NOTICE: Usage at ${usage.percentage}% - monitor for growth.`)
      }
      
      if (usage.trend === 'increasing') {
        recommendations.push(`Usage is increasing - plan for capacity expansion.`)
      }
    })
    
    if (recommendations.length === 0) {
      recommendations.push('Usage is within normal parameters. Continue monitoring.')
    }
    
    return recommendations
  }
}

export const reportGenerator = new ReportGenerator()