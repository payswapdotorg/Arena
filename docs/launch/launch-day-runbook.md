# Arena Public Preview - Launch Day Runbook

## Overview

This runbook provides the Tech Lead with a structured approach to executing the launch gate, from deployment through final checklist sign-off.

## Timeline

### Pre-Launch (T-4 hours)
- [ ] **Verify Dependencies**
  - Confirm B015, B017, B018 are all merged and deployed
  - Check deployment automation is working
  - Verify all prerequisite gates are passed

- [ ] **Prepare Environment**
  - Inject live credentials (following ops/deployment/provider-setup.md)
  - Update Vercel project settings
  - Configure monitoring and alerting
  - Prepare status page messaging

- [ ] **Final Review**
  - Review all launch documentation
  - Conduct dry-run of acceptance suite
  - Verify rollback procedures are ready
  - Confirm on-call coverage

### Launch Window (T+0 to T+2 hours)
- [ ] **Deploy Preview**
  - Trigger deployment workflow
  - Monitor deployment progress
  - Verify deployment URL is accessible
  - Check health endpoints

- [ ] **Run Acceptance Battery**
  - Execute preview acceptance suite
  - Verify all Gate B tests pass
  - Generate evidence bundle
  - Document any issues

- [ ] **Final Checklist Verification**
  - Complete Gate A-F checklist
  - Update documentation with live URL
  - Record evidence artifacts
  - Prepare final sign-off

### Post-Launch (T+2 to T+24 hours)
- [ ] **Monitor Performance**
  - Track capacity usage
  - Monitor error rates
  - Check user feedback
  - Verify all systems stable

- [ ] **Documentation Finalization**
  - Update launch checklist with final status
  - Document any issues encountered
  - Prepare launch announcement
  - Archive evidence bundle

## Detailed Procedures

### Step 1: Deployment Execution

**Trigger Deployment**
```bash
# Push to main to trigger deploy-preview workflow
git push origin main

# Monitor deployment progress
gh run list --limit 3 --workflow deploy-preview
```

**Verify Deployment**

> URL note: `__ARENA_PREVIEW_URL__` below is the TL-provided hosted preview
> URL, recorded at the gate (the live deployment at the closure of this
> runbook's work order is `https://arena-preview-five.vercel.app`).

```bash
# Check deployment URL
curl -I __ARENA_PREVIEW_URL__

# Verify deployment health (the product exposes no /api/health endpoint —
# the deployment ROOT is the health signal, same semantics as the deploy
# workflow's smoke-check step: 2xx/3xx on GET /)
curl -sS -o /dev/null -w '%{http_code}\n' __ARENA_PREVIEW_URL__/
```

**Update Documentation**
- Record the live preview URL in release docs
- Update status page with deployment information
- Configure monitoring alerts

### Step 2: Acceptance Testing

**Run Preview Acceptance Suite**
```bash
# Set the preview URL (TL-provided at the gate)
export ARENA_PREVIEW_URL=__ARENA_PREVIEW_URL__

# Run full acceptance suite
cd deploy/preview
pnpm run run -- --output ../evidence/launch-$(date +%Y%m%d)

# Run specific tests if needed
pnpm run run -- --testNamePattern="Health"
```

**Verify Results**
- All tests should pass
- Evidence bundle should be generated
- No hidden paid fallback detected
- Demo route should execute successfully

### Step 3: Checklist Finalization

**Gate A - Local Install/Use**
- [ ] Fresh machine installation works (from B016)
- [ ] Demo script executes correctly
- [ ] No hidden dependencies

**Gate B - Hosted Preview** ⭐ *Primary Focus*
- [ ] ✅ Vercel deployment live and accessible
- [ ] ✅ Health/readiness endpoints responding
- [ ] ✅ Provider capacity state visible
- [ ] ✅ Free-tier exhaustion fail-closed
- [ ] ✅ No hidden paid fallback
- [ ] ✅ Hosted demo route works

**Gate C - UX**
- [ ] Role-aware interface functional
- [ ] Multi-role switching works
- [ ] All role projections visible
- [ ] Mobile responsive
- [ ] Accessibility compliant

**Gate D - Operational Conformance**
- [ ] UI claims map to canonical objects
- [ ] Role context ≠ authorization
- [ ] No client-only mutations
- [ ] Correlation metadata preserved

**Gate E - Product E2E**
- [ ] Full lifecycle works (B017 validation)
- [ ] Role-switch regression passes
- [ ] Hosted/local parity verified

**Gate F - Release Evidence**
- [ ] CI green
- [ ] Product E2E green (B017)
- [ ] Accessibility audit green (B018)
- [ ] Performance budget green (B018)
- [ ] Security regression green
- [ ] Free-tier quota tests green
- [ ] Fresh-machine evidence attached

### Step 4: Evidence Management

**Generate Evidence Bundle**
```bash
# Comprehensive evidence generation
cd deploy/preview
pnpm run run -- --output ../release/preview/evidence/$(date +%Y%m%d)

# Verify evidence structure
ls -la ../release/preview/evidence/$(date +%Y%m%d)/
```

**Evidence Requirements**
- Preview acceptance test results
- Health check verifications
- Capacity state snapshots
- Demo execution logs
- Performance metrics
- Accessibility audit results
- Security scan results

**Documentation Updates**
- Update `docs/launch-checklist.md` with final status
- Record evidence artifact locations
- Update `release/preview/` with final records
- Prepare launch announcement

## Communication

### Stakeholder Notifications

**Development Team**
- Deployment status updates
- Test results and issues
- Final go/no-go decision

**Operations Team**
- On-call rotation activation
- Monitoring configuration
- Incident response procedures

**User Community**
- Preview availability announcement
- Usage guidelines and limitations
- Support channels

### Status Updates

**Template - Deployment Started**
```
Status: DEPLOYMENT IN PROGRESS
Timeline: [Start time]
What's happening: Arena public preview deployment is underway
Next update: [ETA for completion]
```

**Template - Testing Complete**
```
Status: TESTING COMPLETE
Timeline: [Start] - [End]
Results: [X/X tests passed]
Issues: [List any issues found]
Next step: [Final checklist verification]
```

**Template - Launch Ready**
```
Status: READY FOR LAUNCH
Timeline: [Full timeline summary]
Verification: All gates passed
Evidence: [Link to evidence bundle]
Next: [Final sign-off and announcement]
```

## Risk Management

### High-Risk Areas
1. **Deployment Failure**
   - Mitigation: Verify prerequisites, rollback procedures ready
   - Response: Execute rollback, investigate root cause

2. **Acceptance Test Failure**
   - Mitigation: Dry-run testing, clear rollback criteria
   - Response: Fix issues, re-run tests, document changes

3. **Capacity Issues**
   - Mitigation: Monitor usage, implement throttling
   - Response: Enable degraded mode, communicate limitations

4. **Security Issues**
   - Mitigation: Pre-deployment security scan
   - Response: Immediate rollback, security team engagement

### Contingency Plans

**Rollback Trigger**
- Health check failures > 10 minutes
- Critical security vulnerabilities
- Data integrity issues
- User experience failures

**Communication Plan**
- Internal: Immediate escalation to Tech Lead
- External: Status page updates, user notifications
- Documentation: Incident documentation and lessons learned

## Success Criteria

### Technical Success
- [ ] All Gate A-F checklist items verified
- [ ] Evidence bundle generated and archived
- [ ] No critical incidents during launch
- [ ] Systems stable for 24+ hours

### Operational Success
- [ ] On-call procedures followed correctly
- [ ] Response times meet SLAs
- [ ] Documentation updated accurately
- [ ] Monitoring configured properly

### User Experience Success
- [ ] Preview accessible without issues
- [ ] Demo experience works as expected
- [ ] Clear communication of limitations
- [ ] Positive user feedback

## Post-Launch Activities

### Day 1
- [ ] Monitor all systems
- [ ] Check user feedback
- [ ] Verify performance metrics
- [ ] Document any issues

### Day 3
- [ ] Review usage patterns
- [ ] Analyze performance data
- [ ] Gather user feedback
- [ ] Update documentation based on learnings

### Week 1
- [ ] Complete post-mortem review
- [ ] Update procedures based on experience
- [ ] Plan for next phase
- [ ] Archive launch materials

## Related Documentation

- [Launch Checklist](../launch-checklist.md)
- [Preview Acceptance Harness](../../deploy/preview/README.md)
- [Operational Runbooks](../../ops/preview/README.md)
- [Release Evidence Records](../../release/preview/README.md)
- [Product Demo Script](../product-demo-script.md)

---

*This runbook is executed by the Tech Lead to ensure the public preview launch is successful and meets all quality gates.*