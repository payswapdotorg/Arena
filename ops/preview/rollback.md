# Arena Public Preview - Rollback Runbook

## Purpose

This runbook provides procedures for safely rolling back the public preview deployment while maintaining data integrity and minimizing user impact.

## Relationship to Base Playbook

This document extends the base rollback procedures and references the deployment workflow concurrency posture for preview-specific concerns.

## Rollback Triggers

### Immediate Rollback (P0)
- [ ] Health check failures persisting > 10 minutes
- [ ] Security vulnerabilities discovered
- [ ] Data corruption or loss
- [ ] Complete service unavailability

### Planned Rollback (P1)
- [ ] Critical bugs affecting core functionality
- [ ] Performance degradation > 50%
- [ ] User experience issues causing high bounce rates
- [ ] Capacity exhaustion with no recovery path

## Rollback Procedures

### Step 1: Assessment and Decision

**Incident Confirmation**
- [ ] Verify the issue is real and not a transient problem
- [ ] Check if this is a known issue with a workaround
- [ ] Assess user impact and severity
- [ ] Confirm rollback is the best option

**Decision Criteria**
- Issue severity (P0/P1)
- User impact level
- Recovery timeline estimate
- Data safety implications

### Step 2: Pre-Rollback Preparation

**Notification**
- [ ] Notify on-call engineer and Tech Lead
- [ ] Post rollback notice in status page
- [ ] Prepare user communication if needed

**Technical Preparation**
- [ ] Verify backup of current state (if available)
- [ ] Confirm rollback target version/deployment
- [ ] Check database migration compatibility
- [ ] Prepare rollback scripts and commands

### Step 3: Execution

**Deployment Workflow Concurrency**
- [ ] Ensure no other deployments are running
- [ ] Check deployment status in Vercel dashboard
- [ ] Verify preview URL is accessible before rollback

**Rollback Commands**
```bash
# Check current deployment
pnpm dlx vercel@62.1.0 ls --token $VERCEL_TOKEN

# Rollback to previous deployment
pnpm dlx vercel@62.1.0 rollback <DEPLOYMENT_ID> --token $VERCEL_TOKEN

# Verify rollback
pnpm dlx vercel@62.1.0 ls --token $VERCEL_TOKEN
```

**Health Verification**
- [ ] Monitor health checks after rollback
- [ ] Verify key endpoints are responding
- [ ] Check capacity states are normal
- [ ] Run basic demo route validation

### Step 4: Post-Rollback Actions

**User Communication**
- [ ] Update status page with rollback completion
- [ ] Notify users if significant downtime occurred
- [ ] Document the rollback in release notes

**Technical Verification**
- [ ] Run full preview acceptance suite
- [ ] Verify data integrity and consistency
- [ ] Check for any residual issues
- [ ] Monitor for any post-rollback problems

**Documentation**
- [ ] Record rollback timestamp and duration
- [ ] Document root cause and resolution
- [ ] Update rollback procedures based on learnings
- [ ] Archive rollback logs for analysis

## Rollback Targets

### Primary Target
- **Version**: Previous stable deployment
- **Environment**: Production alias (same as current preview)
- **Data**: Preserved, no rollback needed for Neon/R2/Upstash

### Fallback Target
- **Version**: Last known good deployment
- **Timeline**: May require additional verification steps
- **Risk**: Higher, requires thorough testing

## Data Considerations

### Preserved Data
- Neon PostgreSQL data (never rolled back)
- Cloudflare R2 artifacts (never rolled back)
- Upstash Redis coordination state (may be reset)

### Reset Data
- Demo workspace state (reset on rollback)
- User sessions (may need re-authentication)
- Cache state (automatically refreshed)

## Recovery Time Objectives

### Rollback Timeline
- **Detection**: < 5 minutes
- **Decision**: < 10 minutes
- **Execution**: < 15 minutes
- **Verification**: < 10 minutes
- **Total**: < 40 minutes

### Service Impact
- **Downtime**: Typically < 5 minutes
- **Data Loss**: None for persistent storage
- **User Impact**: Temporary, session may need restart

## Testing and Validation

### Post-Rollback Testing
- [ ] Health check verification
- [ ] Capacity state validation
- [ ] Demo route execution
- [ ] User authentication flow
- [ ] Database connectivity

### Regression Testing
- [ ] Run preview acceptance suite
- [ ] Verify all Gate B tests pass
- [ ] Check for any new issues introduced

## Communication Templates

### Status Update Template
```
Status: RESOLVED
Issue: [Brief description of issue]
Resolution: Rolled back to deployment [DEPLOYMENT_ID]
Timeline: [Start time] - [End time]
Impact: [Brief description of user impact]
Next Steps: [Any remaining actions]
```

### User Notification Template
```
Subject: Arena Preview Service Update

The Arena public preview experienced a temporary issue and has been restored to a previous stable version. 

What happened: [Brief non-technical explanation]
What we're doing: [Current status and next steps]
When: [Timeline information]

We apologize for any inconvenience and appreciate your patience as we work to improve the service.

Thank you,
The Arena Team
```

## Post-Incident Review

### Required Analysis
- Root cause of the issue requiring rollback
- Effectiveness of rollback procedures
- User impact assessment
- Areas for improvement in rollback process

### Documentation Updates
- Update rollback triggers and thresholds
- Refine procedures based on actual experience
- Enhance monitoring to detect issues earlier
- Improve communication templates

### Continuous Improvement
- [ ] Conduct quarterly rollback drills
- [ ] Update rollback scripts based on actual usage
- [ ] Enhance automated monitoring for early detection
- [ ] Maintain rollback documentation currency

## Related Documentation

- [Deployment Workflow](../../.github/workflows/deploy-preview.yml)
- [Health Check Procedures](launch-day-oncall.md)
- [Capacity Monitoring](cost-watch.md)
- [Base Rollback Procedures](../../deployment/rollback.md)