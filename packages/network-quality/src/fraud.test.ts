/**
 * Fraud control tests (Work Order C020): duplicate-payout attempts,
 * payout velocity anomalies, expert impersonation and the enforcement
 * case machine (explicit transitions, append-only audit history).
 */

import { describe, expect, it } from 'vitest';
import {
  detectDuplicatePayoutAttempts,
  detectPayoutVelocityAnomalies,
  detectExpertImpersonation,
  openEnforcementCase,
  transitionEnforcementCase,
  verifyEnforcementCaseDigest,
  silentlyDropEnforcementTarget,
  DEFAULT_FRAUD_CONTROL_POLICY,
  NETWORK_QUALITY_ERROR_CODES,
} from './index.js';

const AT = '2026-10-01T00:00:00.000Z';
const DETECTED_AT = '2026-10-05T00:00:00.000Z';

function h(char: string, n = 32): string {
  return char.repeat(n);
}
function eventId(char: string, n: number): string {
  return `cevt_${h(char, 24)}${String(n).padStart(8, '0')}`;
}
function opKey(char: string, n: number): string {
  return `payop_${h(char, 24)}${String(n).padStart(8, '0')}`;
}
function at(hours: number): string {
  return new Date(Date.parse(AT) + hours * 3600 * 1000).toISOString();
}

describe('detectDuplicatePayoutAttempts', () => {
  it('flags two distinct release operations auditing the same request', async () => {
    const findings = await detectDuplicatePayoutAttempts({
      events: [
        {
          eventId: eventId('a', 1),
          kind: 'payment.release.recorded',
          requestId: 'req-1',
          tenantId: 'tenant-1',
          expertRef: 'expert-1',
          operationKey: opKey('a', 1),
          sequence: 5,
          occurredAt: at(1),
          ledgerStateAfter: 'released',
        },
        {
          eventId: eventId('b', 2),
          kind: 'payment.release.recorded',
          requestId: 'req-1',
          tenantId: 'tenant-1',
          expertRef: 'expert-1',
          operationKey: opKey('b', 2),
          sequence: 9,
          occurredAt: at(2),
          ledgerStateAfter: 'released',
        },
      ],
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.kind).toBe('duplicate-payout-attempt');
    expect(finding?.severity).toBe('critical');
    expect(finding?.reasons[0]?.code).toBe('duplicate-payout-operations');
    expect(finding?.evidence.map((entry) => entry.surface)).toEqual(['payments', 'payments']);
    expect(finding?.proposals[0]?.enforcementAction).toBe('HOLD');
  });

  it('emits no finding for one release per request', async () => {
    const findings = await detectDuplicatePayoutAttempts({
      events: [
        {
          eventId: eventId('c', 3),
          kind: 'payment.release.recorded',
          requestId: 'req-2',
          tenantId: 'tenant-1',
          expertRef: 'expert-1',
          operationKey: opKey('c', 3),
          sequence: 5,
          occurredAt: at(1),
          ledgerStateAfter: 'released',
        },
      ],
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(0);
  });
});

describe('detectPayoutVelocityAnomalies', () => {
  it('flags payout frequency beyond the window ceiling', async () => {
    const events = Array.from({ length: 9 }, (_, index) => ({
      eventId: eventId('d', index),
      kind: 'payment.release.recorded',
      requestId: `req-${index}`,
      tenantId: 'tenant-1',
      expertRef: 'expert-2',
      operationKey: opKey('d', index),
      sequence: index + 1,
      occurredAt: at(index),
      ledgerStateAfter: 'released',
    }));
    const findings = await detectPayoutVelocityAnomalies({
      events,
      policy: { ...DEFAULT_FRAUD_CONTROL_POLICY },
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.kind).toBe('payout-velocity-anomaly');
    expect(finding?.reasons[0]?.code).toBe('payout-velocity-beyond-ceiling');
    expect(finding?.proposals[0]?.enforcementAction).toBe('INVESTIGATE');
  });
});

describe('detectExpertImpersonation', () => {
  it('flags credential mismatches as critical with a SUSPEND proposal', async () => {
    const findings = await detectExpertImpersonation({
      signals: [
        {
          expertRef: 'expert-3',
          tenant: 'tenant-1',
          credentialStatus: 'mismatch',
          attributionMismatches: 0,
          observedAt: AT,
          signalDigest: 'f'.repeat(64),
        },
      ],
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.kind).toBe('expert-impersonation');
    expect(finding?.severity).toBe('critical');
    expect(finding?.reasons[0]?.code).toBe('credential-mismatch');
    expect(finding?.proposals[0]?.enforcementAction).toBe('SUSPEND');
    expect(finding?.evidence[0]?.surface).toBe('expert-registry');
  });

  it('flags attribution mismatches alone as high', async () => {
    const findings = await detectExpertImpersonation({
      signals: [
        {
          expertRef: 'expert-4',
          tenant: 'tenant-1',
          credentialStatus: 'verified',
          attributionMismatches: 3,
          observedAt: AT,
          signalDigest: '1'.repeat(64),
        },
      ],
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('high');
    expect(findings[0]?.reasons[0]?.code).toBe('attribution-mismatch');
  });

  it('verified clean signals emit no finding', async () => {
    const findings = await detectExpertImpersonation({
      signals: [
        {
          expertRef: 'expert-5',
          tenant: 'tenant-1',
          credentialStatus: 'verified',
          attributionMismatches: 0,
          observedAt: AT,
          signalDigest: '2'.repeat(64),
        },
      ],
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(0);
  });
});

describe('the enforcement case machine', () => {
  it('opens at ACTION_PROPOSED from findings and walks to CLOSED with append-only audit', async () => {
    const theCase = await openEnforcementCase({
      caseId: 'nq-case-001',
      tenant: 'tenant-1',
      subjectParty: 'expert-3',
      sourceFindingDigests: ['a'.repeat(64)],
      proposedAction: 'SUSPEND',
      actorParty: 'operator-1',
      at: AT,
      reason: 'expert impersonation finding',
    });
    expect(theCase.state).toBe('ACTION_PROPOSED');
    expect(theCase.action).toBe('SUSPEND');
    expect(theCase.auditHistory).toHaveLength(1);
    const active = await transitionEnforcementCase({
      case: theCase,
      to: 'ACTION_ACTIVE',
      actorParty: 'operator-1',
      at: at(1),
      reason: 'suspension active',
    });
    expect(active.state).toBe('ACTION_ACTIVE');
    expect(active.auditHistory).toHaveLength(2);
    const released = await transitionEnforcementCase({
      case: active,
      to: 'ACTION_RELEASED',
      actorParty: 'operator-2',
      at: at(2),
      reason: 'identity re-verified',
    });
    const closed = await transitionEnforcementCase({
      case: released,
      to: 'CLOSED',
      actorParty: 'operator-2',
      at: at(3),
      reason: 'case closed after release',
    });
    expect(closed.state).toBe('CLOSED');
    expect(closed.auditHistory).toHaveLength(4);
    await expect(verifyEnforcementCaseDigest(closed)).resolves.toBe(true);
  });

  it('illegal transitions fail closed', async () => {
    const theCase = await openEnforcementCase({
      caseId: 'nq-case-002',
      tenant: 'tenant-1',
      subjectParty: 'expert-1',
      sourceFindingDigests: ['b'.repeat(64)],
      proposedAction: 'HOLD',
      actorParty: 'operator-1',
      at: AT,
      reason: 'duplicate payout finding',
    });
    await expect(
      transitionEnforcementCase({
        case: theCase,
        to: 'ACTION_RELEASED',
        actorParty: 'operator-1',
        at: at(1),
        reason: 'skip',
      }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION });
  });

  it('opening without source findings fails closed', async () => {
    await expect(
      openEnforcementCase({
        caseId: 'nq-case-003',
        tenant: 'tenant-1',
        subjectParty: 'expert-1',
        sourceFindingDigests: [],
        proposedAction: 'HOLD',
        actorParty: 'operator-1',
        at: AT,
        reason: 'no findings',
      }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD });
  });

  it('silentlyDropEnforcementTarget has no happy path (no silent drops)', () => {
    expect(() => silentlyDropEnforcementTarget()).toThrowError(
      expect.objectContaining({
        code: NETWORK_QUALITY_ERROR_CODES.SILENT_ADJUSTMENT_REJECTED,
      }),
    );
  });
});
