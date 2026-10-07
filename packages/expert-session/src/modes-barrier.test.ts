/**
 * Mode-policy and privacy-barrier suites (Work Order C006; EES1.0
 * "Session modes" + "Privacy barrier").
 *
 * Adversarial minimums covered here:
 *   - unpermitted mode escalation (mode outside the derived allowance);
 *   - mode forbidding an action (typed UNPERMITTED_MODE);
 *   - session escape attempts: live-world refs, outside-capsule
 *     resources, cross-tenant resources, undeclared tools — all fail
 *     closed with ESCAPE_ATTEMPT;
 *   - barrier control violations: excluded tools, read-only writes,
 *     restricted exports, unallowlisted actions, expired access
 *     material — PRIVACY_VIOLATION;
 *   - composition fail-closed defaults (empty allowlist rejected).
 */

import { describe, expect, it } from 'vitest';
import {
  composePrivacyBarrier,
  checkResourceAccess,
  checkToolUse,
  checkExportAction,
  checkActionAllowlisted,
  checkCredentials,
  assertNoEscape,
  screenObservation,
  IDENTITY_FIELD_NAMES,
} from './barrier.js';
import {
  capabilitiesForMode,
  checkSessionAction,
  deriveSessionModes,
  assertModeAllowed,
  assertSessionActionAllowed,
  EXPERT_SESSION_MODES,
  SESSION_MODE_CAPABILITIES,
} from './modes.js';
import { ExpertSessionError, EXPERT_SESSION_ERROR_CODES } from './errors.js';
import {
  DEFAULT_ACTION_ALLOWLIST,
  EXPIRY,
  PAST,
  TENANT_A,
  TENANT_B,
  makeBarrierInput,
} from './test-support.js';

describe('session modes — the six EES1.0 modes', () => {
  it('exposes exactly the six EES1.0 modes', () => {
    expect([...EXPERT_SESSION_MODES]).toEqual([
      'observe',
      'correct',
      'unblock',
      'takeover',
      'teach',
      'review',
    ]);
  });

  it('gives every mode the observation floor and only Teach mandatory capture', () => {
    for (const mode of EXPERT_SESSION_MODES) {
      expect(capabilitiesForMode(mode).canObserve).toBe(true);
    }
    expect(SESSION_MODE_CAPABILITIES.teach.captureMandatory).toBe(true);
    expect(SESSION_MODE_CAPABILITIES.takeover.captureMandatory).toBe(false);
    expect(SESSION_MODE_CAPABILITIES.observe.canEditArtifacts).toBe(false);
    expect(SESSION_MODE_CAPABILITIES.observe.canRunTools).toBe(false);
    expect(SESSION_MODE_CAPABILITIES.observe.canSubmitResult).toBe(false);
    expect(SESSION_MODE_CAPABILITIES.correct.canEditArtifacts).toBe(true);
    expect(SESSION_MODE_CAPABILITIES.unblock.canSupplyInformation).toBe(true);
    expect(SESSION_MODE_CAPABILITIES.unblock.canEditArtifacts).toBe(false);
    expect(SESSION_MODE_CAPABILITIES.takeover.canRunTools).toBe(true);
    expect(SESSION_MODE_CAPABILITIES.review.canAnnotate).toBe(true);
    expect(SESSION_MODE_CAPABILITIES.review.canEditArtifacts).toBe(false);
  });

  it('derives allowed modes from the EscalationRequest escalationModes (observe always present)', () => {
    expect([...deriveSessionModes(['solve'])]).toEqual(['observe', 'takeover']);
    expect([...deriveSessionModes(['correct'])]).toEqual(['observe', 'correct']);
    expect([...deriveSessionModes(['unblock'])]).toEqual(['observe', 'unblock']);
    expect([...deriveSessionModes(['review'])]).toEqual(['observe', 'review']);
    expect([...deriveSessionModes(['teach'])]).toEqual(['observe', 'teach']);
    // Informational escalation modes grant observation only.
    expect([...deriveSessionModes(['tool_gap', 'knowledge', 'evaluate'])]).toEqual(['observe']);
  });

  it('fails closed on unknown escalation modes', () => {
    expect(() => deriveSessionModes(['solve', 'destroy-world'])).toThrowError(ExpertSessionError);
    try {
      deriveSessionModes(['nope']);
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.INVALID_MODE);
    }
  });

  it('ADVERSARIAL: unpermitted mode escalation is a typed failure', () => {
    const allowed = deriveSessionModes(['review']); // observe + review
    expect(() => assertModeAllowed('takeover', allowed)).toThrowError(ExpertSessionError);
    try {
      assertModeAllowed('takeover', allowed);
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.UNPERMITTED_MODE);
    }
  });

  it('mode/action verdicts are machine-readable (never a bare boolean)', () => {
    expect(checkSessionAction('observe', 'edit-artifact')).toEqual({
      allowed: false,
      reason: 'mode_forbids_action',
      mode: 'observe',
      action: 'edit-artifact',
    });
    expect(checkSessionAction('takeover', 'invoke-tool').allowed).toBe(true);
    expect(() => assertSessionActionAllowed('observe', 'invoke-tool')).toThrowError(ExpertSessionError);
    // Tool-gap signalling is always permitted (capability observation).
    expect(checkSessionAction('observe', 'signal-tool-gap').allowed).toBe(true);
  });
});

describe('privacy barrier — composition (fail-closed defaults)', () => {
  it('rejects an empty action allowlist (an empty allowlist admits nothing)', () => {
    expect(() => composePrivacyBarrier({ ...makeBarrierInput(), actionAllowlist: [] })).toThrowError(
      ExpertSessionError,
    );
  });

  it('requires an expiry for time-limited credentials', () => {
    const { credentialsExpiresAt: _drop, ...rest } = makeBarrierInput();
    expect(() => composePrivacyBarrier(rest)).toThrowError(ExpertSessionError);
  });

  it('defaults export restrictions ON and identity masking ON', () => {
    const barrier = composePrivacyBarrier({
      tenantId: TENANT_A,
      actionAllowlist: [...DEFAULT_ACTION_ALLOWLIST],
      credentialsExpiresAt: EXPIRY,
    });
    expect(barrier.restrictions).toEqual({ download: true, clipboard: true, screenshot: true });
    expect(barrier.identityMasking).toBe(true);
    expect(barrier.credentials.timeLimited).toBe(true);
  });
});

describe('privacy barrier — observation screening', () => {
  it('redacts declared fields, masks identities and redacts document refs', () => {
    const barrier = composePrivacyBarrier(makeBarrierInput());
    const screened = screenObservation(barrier, {
      step: 'awaiting-vendor-match',
      customerEmail: 'acme-buyer@example.com',
      accountNumber: '1234567890',
      customerName: 'Acme Buyer',
      attachment: 'docs/confidential-notes.md',
      nested: { customerEmail: 'x@example.com', keep: 'visible' },
      openItems: [{ invoice: 'INV-001', customerRef: 'cust-9' }],
    });
    expect(screened).toEqual({
      step: 'awaiting-vendor-match',
      customerEmail: '[REDACTED]',
      accountNumber: '[REDACTED]',
      customerName: 'masked-identity',
      attachment: '[REDACTED]',
      nested: { customerEmail: '[REDACTED]', keep: 'visible' },
      openItems: [{ invoice: 'INV-001', customerRef: 'masked-identity' }],
    });
    // The known identity field names are exactly the masking surface.
    expect(IDENTITY_FIELD_NAMES).toContain('customerRef');
  });

  it('never mutates the input observation', () => {
    const barrier = composePrivacyBarrier(makeBarrierInput());
    const input = { customerEmail: 'acme-buyer@example.com', keep: 'visible' };
    screenObservation(barrier, input);
    expect(input.customerEmail).toBe('acme-buyer@example.com');
  });
});

describe('privacy barrier — ADVERSARIAL escape attempts (fail closed)', () => {
  const barrier = composePrivacyBarrier(makeBarrierInput());
  const scope = {
    tenantId: TENANT_A,
    resources: [
      { ref: 'docs/vendor-catalog.md', readOnly: false },
      { ref: 'logs/agent-trace.jsonl', readOnly: true },
    ],
  };

  it('live-world refs are escape attempts', () => {
    const verdict = checkResourceAccess(barrier, scope, { resourceRef: 'live:prod-db/invoices', mode: 'read' });
    expect(verdict).toEqual({ allowed: false, reason: 'resource_outside_capsule' });
    expect(() => assertNoEscape(verdict)).toThrowError(ExpertSessionError);
    try {
      assertNoEscape(verdict);
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.ESCAPE_ATTEMPT);
    }
  });

  it('resources outside the capsule set are escape attempts', () => {
    const verdict = checkResourceAccess(barrier, scope, { resourceRef: 'etc/shadow', mode: 'read' });
    expect(verdict.reason).toBe('resource_outside_capsule');
    expect(() => assertNoEscape(verdict)).toThrowError(ExpertSessionError);
  });

  it('cross-tenant resources are escape attempts (tenant boundary)', () => {
    const otherTenantScope = { ...scope, tenantId: TENANT_B };
    const verdict = checkResourceAccess(barrier, otherTenantScope, {
      resourceRef: 'docs/vendor-catalog.md',
      mode: 'read',
    });
    expect(verdict.reason).toBe('cross_tenant_resource');
    try {
      assertNoEscape(verdict);
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.ESCAPE_ATTEMPT);
    }
  });

  it('write attempts on read-only resources are privacy violations', () => {
    const verdict = checkResourceAccess(barrier, scope, { resourceRef: 'logs/agent-trace.jsonl', mode: 'write' });
    expect(verdict.reason).toBe('resource_read_only');
    try {
      assertNoEscape(verdict);
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.PRIVACY_VIOLATION);
    }
  });

  it('tools outside the capsule are escape attempts; excluded tools are privacy violations', () => {
    const capsuleSurface = ['search-vendors', 'admin-console'];
    expect(checkToolUse(barrier, capsuleSurface, 'admin-console').reason).toBe('tool_excluded');
    expect(checkToolUse(barrier, ['search-vendors'], 'shell-exec').reason).toBe('tool_not_in_capsule');
    expect(checkToolUse(barrier, ['search-vendors'], 'search-vendors').reason).toBe('access_ok');
    expect(() => assertNoEscape(checkToolUse(barrier, ['search-vendors'], 'shell-exec'))).toThrowError(
      ExpertSessionError,
    );
  });

  it('restricted export channels and unallowlisted actions are denied', () => {
    expect(checkExportAction(barrier, 'download').reason).toBe('export_restricted');
    expect(checkExportAction(barrier, 'clipboard').reason).toBe('export_restricted');
    expect(checkExportAction(barrier, 'screenshot').reason).toBe('export_restricted');
    expect(checkActionAllowlisted(barrier, 'exfiltrate-data').reason).toBe('action_not_allowlisted');
    expect(checkActionAllowlisted(barrier, 'observe-state').reason).toBe('access_ok');
  });

  it('expired time-limited capsule access material is denied', () => {
    expect(checkCredentials(barrier, PAST).reason).toBe('credentials_expired');
    expect(checkCredentials(barrier, '2026-10-07T12:00:00.000Z').reason).toBe('access_ok');
    expect(checkCredentials(barrier, EXPIRY).reason).toBe('credentials_expired');
  });
});
