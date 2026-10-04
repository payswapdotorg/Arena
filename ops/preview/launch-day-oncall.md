# Arena Public Preview - Launch Day On-Call Runbook

## Purpose

This runbook provides the on-call engineer with a structured approach to managing the public preview launch and responding to incidents during the critical launch window.

## Timeline

### Pre-Launch (T-2 hours)
- [ ] Review [Rollback Runbook](rollback.md)
- [ ] Verify [Quota Exhaustion Playbook](quota-exhaustion.md) procedures
- [ ] Check deployment health status
- [ ] Confirm all Gate B tests are passing
- [ ] Validate backup procedures are documented

### Launch Window (T+0 to T+4 hours)
- [ ] Monitor deployment health continuously
- [ ] Respond to any health check failures within 5 minutes
- [ ] Address capacity warnings immediately
- [ ] Document all incidents and responses
- [ ] Escalate to Tech Lead if issues persist > 15 minutes

### Post-Launch (T+4 to T+24 hours)
- [ ] Review performance metrics
- [ ] Check for any capacity state changes
- [ ] Monitor for quota exhaustion events
- [ ] Document any operational learnings

## Incident Response Levels

### P0 - Critical (Immediate Action Required)
- **Triggers**: Health check failures, service unavailability, security incidents
- **Response Time**: < 5 minutes
- **Escalation**: Tech Lead immediately

### P1 - High (Urgent Attention)
- **Triggers**: Capacity degradation, repeated quota warnings, demo failures
- **Response Time**: < 15 minutes  
- **Escalation**: On-call lead

### P2 - Medium (Monitor and Respond)
- **Triggers**: Performance degradation, minor UI issues
- **Response Time**: < 30 minutes
- **Escalation**: Document for post-mortem

## Monitoring Dashboard

### Key Metrics to Watch
- **Deployment health**: `GET /` on the preview URL - must return 2xx/3xx (the product exposes no `/api/health` endpoint; the deployment root is the health signal, per the deploy workflow's smoke-check step)
- **Capacity States**: rendered on `GET /demo/operations` (the provider capacity board: AVAILABLE / DEGRADED / EXHAUSTED / DISABLED); `GET /operations` must keep rendering the fail-closed authenticated-session gate
- **Request Rates**: Monitor for unusual spikes
- **Error Rates**: Should be < 1%

### Alert Thresholds
- **Health Check Failures**: 3 consecutive failures = P0
- **Capacity Degradation**: Any provider = `DEGRADED` = P1
- **Quota Warnings**: > 50% capacity used = P2
- **Error Rate Spike**: > 5% for 5 minutes = P1

## Communication Protocol

### Incident Channels
- **Slack**: `#arena-alerts` - Critical incidents
- **Email**: `arena-oncall@example.com` - Escalation notifications
- **PagerDuty**: On-call rotation for P0/P1 incidents

### Status Updates
- **Initial Acknowledgment**: Within 2 minutes
- **Status Updates**: Every 15 minutes until resolved
- **Resolution**: Full incident report within 1 hour

## Checklists

### Before Responding to Incident
- [ ] Verify the incident is real (not a false positive)
- [ ] Check if this is a known issue
- [ ] Review recent deployment history
- [ ] Check related system dependencies

### Initial Response
- [ ] Acknowledge incident in alert channel
- [ ] Begin diagnostic investigation
- [ ] Document initial findings
- [ ] Notify stakeholders if impact is widespread

### Resolution
- [ ] Verify the fix is working
- [ ] Monitor for 15 minutes post-resolution
- [ ] Document root cause and resolution steps
- [ ] Update runbooks if needed
- [ ] Conduct post-mortem if severity >= P1

## Escalation Path

1. **On-call Engineer** - First response
2. **On-call Lead** - If issue persists > 15 minutes
3. **Tech Lead** - If issue persists > 30 minutes or is P0
4. **Engineering Manager** - If business impact is severe

## Documentation References

- [Rollback Runbook](rollback.md)
- [Quota Exhaustion Playbook](quota-exhaustion.md)
- [Public Demo Incident Playbook](demo-incident.md)
- [Cost/Quota Watch](cost-watch.md)