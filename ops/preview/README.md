# @arena/ops-preview

B019 Preview Operational Runbooks and Watch Harness

## Purpose

Provides launch-day on-call procedures, quota-exhaustion drills, rollback playbooks, public-demo incident management, and cost/quota monitoring with deterministic projections.

## Components

### Operational Runbooks
- **[Launch Day On-Call](launch-day-oncall.md)** - First-response procedures for public preview launch
- **[Quota Exhaustion Drill](quota-exhaustion-drill.md)** - Preview-specific quota management procedures
- **[Rollback Runbook](rollback.md)** - Safe preview rollback procedures
- **[Public Demo Incident](demo-incident.md)** - Demo-specific incident management
- **[Cost/Quota Watch](cost-watch.md)** - Monitoring harness and procedures

### Watch Harness
- Continuous capacity monitoring
- Predictive quota exhaustion alerts
- Provider-neutral quota visualization
- Deterministic cost projections

## Usage

### Running the Watch Harness

```bash
# Start continuous monitoring
pnpm run watch

# Monitor specific provider
pnpm run watch --provider database

# Export report
pnpm run watch --export report.json

# Check current status
pnpm run watch --status
```

### Configuration

The watch harness uses environment variables:

```bash
# Required — the TL fills this token at the gate (the live deployment URL
# is a TL-provided input, never hardcoded here)
ARENA_PREVIEW_URL=__ARENA_PREVIEW_URL__

# Optional (for notifications)
ALERT_EMAIL=ops@example.com
SLACK_WEBHOOK=https://hooks.slack.com/...
```

## Monitoring Features

### Real-time Dashboard
- **Current Capacity**: Visual gauge for each provider
- **Usage Trends**: Historical usage charts
- **Predictive Alerts**: When quota will be exhausted
- **Provider Health**: Color-coded status indicators

### Alert Levels
- **Warning (70%)**: Email notification, increased monitoring
- **Critical (85%)**: Slack + Email + PagerDuty
- **Emergency (95%)**: Immediate escalation

### Provider Support
- **Database**: Neon PostgreSQL (100 CU-hours, 0.5GB storage)
- **Storage**: Cloudflare R2 (10GB storage, 1M operations)
- **Compute**: Vercel Functions (50 concurrent, 300s timeout)
- **Coordination**: Upstash Redis (256MB, 500K commands)

## Integration

### With Deployment System
- Projects the B015 free-tier quota catalog (the product exposes no `/api/capacity` JSON endpoint; capacity state renders on the `/demo/operations` page)
- Integrates with deployment workflow
- Provides input to rollback decisions

### With Acceptance Harness
- Feeds capacity data to preview acceptance tests
- Validates fail-closed behavior
- Provides quota exhaustion test data

### With Monitoring Stack
- Exports metrics to monitoring system
- Integrates with alerting systems
- Provides data for dashboards

## House Patterns

Follows the same structure as sibling packages:
- TypeScript with strict type checking
- Vitest for testing with deterministic setup
- CLI interface for automation
- Provider-neutral types and contracts

## Development

```bash
# Type checking
pnpm run typecheck

# Linting
pnpm run lint

# Testing
pnpm run test

# Building
pnpm run build

# Start watch harness
pnpm run watch
```

## Related Documentation

- [Free Tier Contract](../../spec/free-tier-contract.md)
- [Deployment Architecture](../../docs/deployment/free-tier-architecture.md)
- [Acceptance Harness](../../deploy/preview/README.md)
- [Base Deployment Runbooks](../../deployment/README.md)