# Arena Public Preview - Public Demo Incident Playbook

## Purpose

This playbook provides procedures for managing incidents that specifically affect the public demo experience, ensuring visitors can still understand Arena's capabilities even when the hosted demo is degraded.

## Incident Classification

### Demo-Only Incidents
- Demo workspace inaccessible
- Demo cases failing to load
- Demo route execution errors
- UI issues specific to demo mode

### System-Wide Incidents Affecting Demo
- Health check failures
- Capacity exhaustion
- Authentication issues
- Performance degradation

## Detection and Response

### Automated Detection
- Monitor the real demo surfaces: `GET /demo`, `GET /demo/operations` (2xx) and the `POST /demo/reset` determinism contract (303 → `/demo`)
- Track demo completion rates
- Monitor demo route execution times
- Alert on demo-related error rates > 5%

### Manual Detection
- User feedback about demo issues
- Support ticket reports
- Manual testing during high-traffic periods
- Monitoring social media for mentions

## Response Procedures

### Step 1: Immediate Assessment

**Quick Triage**
- [ ] Confirm this is a demo-specific issue
- [ ] Check if system-wide services are healthy
- [ ] Assess user impact (how many visitors affected)
- [ ] Determine if fallback options are available

**Impact Assessment**
- **Low**: Minor UI glitches, cosmetic issues
- **Medium**: Demo partially functional, some steps fail
- **High**: Demo completely inaccessible
- **Critical**: System-wide failure affecting all functionality

### Step 2: Immediate Actions

**Communication**
- [ ] Update status page with demo-specific status
- [ ] Post in relevant communication channels
- [ ] Prepare user messaging if needed

**Technical Response**
- [ ] Check demo workspace accessibility
- [ ] Verify demo case loading
- [ ] Test demo route execution
- [ ] Review recent changes that might have affected demo

### Step 3: Fallback Procedures

**Option A: Static Demo Documentation**
- Deploy static demo documentation
- Provide screenshots and descriptions
- Link to video demonstrations
- Update status page with alternative access

**Option B: Local Demo Mode**
- Provide instructions for local demo setup
- Share download links for local installation
- Offer guided remote sessions
- Document temporary workaround

**Option C: Degraded Demo Mode**
- Simplified demo scenarios
- Skip complex environment runs
- Use pre-computed trajectories
- Show static results with explanations

### Step 4: Resolution

**Temporary Fix**
- [ ] Implement immediate workaround
- [ ] Monitor for effectiveness
- [ ] Document the fix for permanent resolution

**Permanent Fix**
- [ ] Deploy code changes if needed
- [ ] Test thoroughly with demo scenarios
- [ ] Monitor for regression
- [ ] Update documentation with lessons learned

## User Communication

### Status Templates

**Demo Issue Detected**
```
Status: DEMO ISSUES DETECTED
Issue: The hosted demo is currently experiencing problems.
Impact: Visitors may be unable to run the full demo experience.
Alternative: We recommend reviewing our demo documentation or trying again later.
ETA: [Estimated resolution time]
```

**Demo Restored**
```
Status: RESOLVED
Issue: Demo functionality has been restored.
Timeline: [Start time] - [End time]
What we fixed: [Brief description of resolution]
Thank you for your patience as we worked to resolve this issue.
```

### User Messaging

**For Affected Visitors**
```
Subject: Arena Demo Experience Update

We're currently experiencing technical difficulties with our interactive demo. 

What this means: The full demo experience may not be available at this time.
What you can do: 
- Review our demo documentation for an overview
- Watch recorded demo sessions
- Try again in a little while
- Contact us for a personalized demo

We apologize for the inconvenience and appreciate your understanding as we work to resolve this issue.

The Arena Team
```

## Recovery Procedures

### After Resolution
1. [ ] Verify all demo functionality is working
2. [ ] Run full demo route validation
3. [ ] Monitor for any residual issues
4. [ ] Update status page to "All Systems Operational"
5. [ ] Document the incident and resolution

### Continuous Monitoring
- [ ] Set up demo-specific health checks
- [ ] Monitor demo completion rates
- [ ] Track user feedback about demo experience
- [ ] Regular demo testing to ensure reliability

## Demo-Specific Monitoring

### Key Metrics
- **Demo Access Rate**: % of visitors who access demo workspace
- **Demo Completion Rate**: % who complete full demo route
- **Demo Error Rate**: Errors during demo execution
- **Demo Load Time**: Time to load demo cases and environments
- **User Feedback**: Sentiment analysis of demo experience

### Alert Thresholds
- **Demo Access Rate**: < 50% = P1
- **Demo Completion Rate**: < 30% = P1
- **Demo Error Rate**: > 10% = P1
- **Demo Load Time**: > 30 seconds = P2

## Training and Familiarization

### Required Reading
- [Launch Day On-Call](launch-day-oncall.md)
- [Base Incident Response](../../deployment/README.md)
- [Demo Documentation](../../docs/product-demo-script.md)

### Scenarios to Practice
1. Demo workspace inaccessible
2. Demo cases failing to load
3. Demo route execution errors
4. Performance issues during demo

### Success Criteria
- [ ] Detection time < 5 minutes
- [ ] Initial response < 15 minutes
- [ ] User communication within 30 minutes
- [ ] Resolution within 2 hours for P1 issues
- [ ] All incidents properly documented

## Post-Incident Review

### Analysis Areas
- Root cause of demo failure
- Effectiveness of response procedures
- User impact assessment
- Areas for improvement in demo reliability

### Documentation Updates
- Update demo monitoring procedures
- Enhance error handling in demo routes
- Improve user communication templates
- Update incident classification based on actual experience

### Continuous Improvement
- [ ] Conduct regular demo testing
- [ ] Monitor demo performance metrics
- [ ] Gather user feedback on demo experience
- [ ] Regular review of demo incident procedures

## Related Documentation

- [Product Demo Script](../../docs/product-demo-script.md)
- [Launch Day On-Call](launch-day-oncall.md)
- [Base Incident Response](../../deployment/README.md)
- [Health Check Procedures](launch-day-oncall.md)