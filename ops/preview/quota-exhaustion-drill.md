# Arena Public Preview - Quota Exhaustion Drill

## Purpose

This drill extends the base quota exhaustion playbook with preview-specific procedures for managing free-tier capacity limits during the public preview period.

## Relationship to Base Playbook

This document extends [`ops/deployment/quota-exhaustion-playbook.md`](../../deployment/quota-exhaustion-playbook.md) and references it for core procedures. This document covers preview-specific concerns.

## Preview Quota Context

### Provider Allowances (Current as of Launch)
- **Neon Free**: 100 CU-hours/month, 0.5GB storage, 5GB transfer
- **Cloudflare R2**: 10GB storage, 1M operations, 10M bandwidth
- **Upstash Redis**: 256MB data, 10GB bandwidth, 500K commands
- **Vercel Hobby**: 300-second function timeout

### Warning Thresholds
- **Database**: 80% of CU-hours used
- **Storage**: 80% of capacity used  
- **Compute**: 50 concurrent requests
- **Coordination**: 200K Redis commands remaining

## Drill Procedures

### Step 1: Detection and Assessment

**Automated Alerts**
- Monitor the capacity board rendered at `GET /demo/operations` (the product exposes no `/api/capacity` JSON endpoint — capacity state is a rendered page)
- Alert when any provider reaches `DEGRADED` status
- Email notifications when usage exceeds 70% of allowance

**Manual Checks**
- Daily review of capacity dashboard
- Pre-emptive checks before demo events
- Monitoring during high-traffic periods

**Assessment Questions**
1. Which provider is exhausted?
2. Is this temporary or permanent?
3. What impact does this have on user experience?
4. Can we degrade gracefully?

### Step 2: Immediate Actions

**Short-term Mitigation (Hours)**
- [ ] Reduce demo complexity to lower resource usage
- [ ] Implement request rate limiting on non-critical operations
- [ ] Cache responses aggressively where possible
- [ ] Monitor for cascading failures

**Communication**
- [ ] Update status page with current capacity state
- [ ] Notify on-call engineer of the situation
- [ ] Document the event in the capacity log

### Step 3: Preview-Specific Response

**Demo Mode Adjustments**
- [ ] Switch to lightweight demo scenarios
- [ ] Disable expensive operations (e.g., complex environment runs)
- [ ] Implement queueing for demo requests
- [ ] Show clear capacity warnings to users

**User Communication**
- **Banner**: "Preview experiencing capacity constraints. Some features may be limited."
- **API Responses**: Include `capacity_warnings` array in responses
- **Documentation**: Update demo instructions with current limitations

### Step 4: Resolution Options

**Option A: Wait for Reset (Free Tier)**
- **Timeline**: 24-48 hours (depending on provider)
- **Pros**: No cost, automatic reset
- **Cons**: Users experience degraded service
- **When**: For minor, temporary exhaustion

**Option B: Degraded Service Mode**
- **Timeline**: Immediate
- **Actions**: 
  - Disable non-essential features
  - Implement request throttling
  - Show clear capacity indicators
- **Pros**: Maintains core functionality
- **Cons**: Reduced feature availability

**Option C: Emergency Scale (If Approved)**
- **Timeline**: 2-4 hours
- **Actions**: 
  - Provision additional resources (if budget allows)
  - Implement temporary paid tier
- **Pros**: Maintains full service
- **Cons**: Incurs cost, requires approval

## Recovery Procedures

### After Quota Reset
1. [ ] Verify all capacity states return to `AVAILABLE`
2. [ ] Gradually restore normal service levels
3. [ ] Monitor for any residual issues
4. [ ] Update capacity dashboard
5. [ ] Document the incident and recovery

### Continuous Monitoring
- [ ] Set up automated capacity checks every 15 minutes
- [ ] Configure alerts at 70%, 80%, 90% usage levels
- [ ] Maintain capacity usage history for trend analysis
- [ ] Update thresholds based on actual usage patterns

## Training and Familiarization

### Required Reading
- [Base Quota Exhaustion Playbook](../../deployment/quota-exhaustion-playbook.md)
- [Capacity API Documentation](../../deploy/src/hosted/quotas.ts)
- [Fail-Closed Validation](../../deploy/preview/src/acceptance/fail-closed-validator.ts)

### Drill Scenarios
1. **Database Exhaustion**: Simulate 100% CU-hour usage
2. **Storage Exhaustion**: Simulate 10GB R2 capacity limit
3. **Compute Exhaustion**: Simulate 50 concurrent requests
4. **Coordination Exhaustion**: Simulate Redis command limit

### Success Criteria
- [ ] Response time < 15 minutes from detection
- [ ] User communication within 30 minutes
- [ ] Service degradation is controlled and predictable
- [ ] Full recovery within quota reset window
- [ ] All incidents are properly documented

## Post-Incident Review

### Required Documentation
- Root cause analysis
- Response effectiveness evaluation
- User impact assessment
- Recommendations for improvements

### Continuous Improvement
- [ ] Update warning thresholds based on actual usage
- [ ] Refine automated response procedures
- [ ] Enhance user communication templates
- [ ] Conduct quarterly drills to maintain readiness