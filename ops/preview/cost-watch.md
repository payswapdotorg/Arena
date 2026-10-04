# Arena Public Preview - Cost/Quota Watch Harness

## Purpose

This deterministic watch harness projects the B015 provider quota catalog into visible capacity snapshots, providing operator visibility, fail-closed monitoring, and provider-neutral quota tracking.

## Overview

The cost watch system provides:
- Real-time capacity state monitoring
- Predictive quota exhaustion alerts
- Provider-neutral quota visualization
- Deterministic cost projections
- Fail-closed enforcement

## Architecture

### Provider-Neutral Types
```typescript
type ProviderType = 'database' | 'storage' | 'compute' | 'coordination'
type CapacityState = 'AVAILABLE' | 'DEGRADED' | 'EXHAUSTED' | 'DISABLED'
type QuotaUsage = {
  current: number
  limit: number
  percentage: number
  trend: 'increasing' | 'stable' | 'decreasing'
}
```

### Data Sources
- The B015 free-tier quota catalog (deploy/src/hosted/quotas.ts — the normative ceilings) projected deterministically by the watch harness; the product exposes no `/api/capacity` JSON endpoint (capacity state is rendered on the `/demo/operations` page)
- Provider adapter telemetry (via B002 adapters) at the launch gate
- Historical usage patterns (deterministic projections until the meter is wired)
- Predictive analytics

## Watch Harness

### CLI Interface

```bash
# Start continuous monitoring
pnpm run watch

# Monitor specific provider
pnpm run watch --provider database

# Export report
pnpm run watch --export report.json

# Check status without starting watch
pnpm run watch --status
```

### Configuration

```typescript
// cost-watch.config.ts
export interface WatchConfig {
  providers: ProviderType[]
  checkInterval: number // milliseconds
  alertThresholds: {
    warning: number // percentage
    critical: number
  }
  predictiveHours: number
  notifications: {
    email: string[]
    slack: string
  }
}
```

## Monitoring Features

### Real-time Dashboard
- **Current Capacity**: Visual gauge for each provider
- **Usage Trends**: Historical usage charts
- **Predictive Alerts**: When quota will be exhausted
- **Provider Health**: Color-coded status indicators

### Predictive Analytics
- **Exhaustion Timeline**: When each quota will be exhausted
- **Usage Patterns**: Daily/weekly usage trends
- **Seasonal Variations**: Predicted usage spikes
- **Recommendations**: Actions to prevent exhaustion

### Fail-Closed Enforcement
- **Automatic Degradation**: When approaching limits
- **Request Throttling**: Non-critical operations
- **User Notifications**: Clear capacity warnings
- **Emergency Procedures**: Pre-defined response plans

## Alert Levels

### Warning (70% Usage)
- **Color**: Yellow
- **Action**: Monitor closely, prepare response
- **Notification**: Email to on-call engineer
- **User Impact**: None

### Critical (85% Usage)
- **Color**: Orange  
- **Action**: Implement response procedures
- **Notification**: Slack + Email + PagerDuty
- **User Impact**: Minor feature limitations

### Emergency (95% Usage)
- **Color**: Red
- **Action**: Full emergency response
- **Notification**: Immediate escalation
- **User Impact**: Significant limitations

## Quota Catalog

### Database (Neon Free)
```typescript
{
  provider: 'database',
  name: 'Neon PostgreSQL',
  allowance: {
    cuHours: 100,
    storage: '0.5GB',
    transfer: '5GB'
  },
  current: {
    cuHours: 45,
    storage: '0.2GB',
    transfer: '2.1GB'
  },
  state: 'AVAILABLE',
  trend: 'increasing'
}
```

### Storage (Cloudflare R2)
```typescript
{
  provider: 'storage',
  name: 'Cloudflare R2',
  allowance: {
    storage: '10GB',
    operations: '1M',
    bandwidth: '10M'
  },
  current: {
    storage: '3.2GB',
    operations: '450K',
    bandwidth: '4.2M'
  },
  state: 'AVAILABLE',
  trend: 'stable'
}
```

### Compute (Vercel Hobby)
```typescript
{
  provider: 'compute',
  name: 'Vercel Functions',
  allowance: {
    timeout: '300s',
    concurrent: '50'
  },
  current: {
    timeout: '120s avg',
    concurrent: '12'
  },
  state: 'AVAILABLE',
  trend: 'stable'
}
```

### Coordination (Upstash Redis)
```typescript
{
  provider: 'coordination',
  name: 'Upstash Redis',
  allowance: {
    memory: '256MB',
    bandwidth: '10GB',
    commands: '500K'
  },
  current: {
    memory: '128MB',
    bandwidth: '5.2GB',
    commands: '250K'
  },
  state: 'AVAILABLE',
  trend: 'increasing'
}
```

## Response Procedures

### Automated Responses
- **Warning Level**: Log entry, increase monitoring frequency
- **Critical Level**: Enable request throttling, notify team
- **Emergency Level**: Implement full degradation mode

### Manual Actions
- **Review Usage**: Analyze usage patterns
- **Adjust Limits**: If possible within provider constraints
- **Implement Workarounds**: Reduce non-essential operations
- **Plan for Reset**: Coordinate with provider reset schedules

## Reporting

### Daily Reports
- Usage summary for each provider
- Trend analysis
- Predictive exhaustion timelines
- Recommendations

### Weekly Reports
- Usage patterns and trends
- Alert summary
- Response effectiveness
- Recommendations for optimization

### Monthly Reports
- Full quota utilization analysis
- Cost optimization opportunities
- Provider performance review
- Recommendations for future planning

## Integration Points

### With Deployment System
- Binds to the deploy workflow's deployment-root smoke-check posture (`GET /` → 2xx/3xx)
- Integrates with deployment workflow
- Provides input to rollback decisions

### With Acceptance Harness
- Feed capacity data to preview acceptance tests
- Validate fail-closed behavior
- Provide quota exhaustion test data

### With Monitoring Stack
- Export metrics to monitoring system
- Integrate with alerting systems
- Provide data for dashboards

## Development

### Testing
- Unit tests for quota calculations
- Integration tests for API endpoints
- End-to-end tests for watch harness
- Mock data for deterministic testing

### Configuration
- Environment variable support
- Configuration file validation
- Provider-specific settings
- Alert configuration

### Monitoring
- Log all quota checks
- Track response times
- Monitor alert effectiveness
- Document all incidents

## Success Criteria

### Operational
- [ ] Real-time visibility into all quota states
- [ ] Predictive alerts with > 90% accuracy
- [ ] Response time < 5 minutes for critical alerts
- [ ] Zero quota-related outages

### User Experience
- [ ] Clear capacity indicators in UI
- [ ] Proactive notifications about limits
- [ ] Graceful degradation when approaching limits
- [ ] Minimal impact during normal operation

### Technical
- [ ] 99.9% uptime for monitoring system
- [ ] Sub-second response times for capacity checks
- [ ] Scalable to handle multiple providers
- [ ] Deterministic and reproducible results

## Related Documentation

- [Free Tier Contract](../../spec/free-tier-contract.md)
- [Deployment Architecture](../../docs/deployment/free-tier-architecture.md)
- [Quota Exhaustion Playbook](quota-exhaustion-drill.md)
- [Acceptance Harness](../../deploy/preview/README.md)