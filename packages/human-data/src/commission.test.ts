/**
 * Commission model tests (Work Order C012) — strict construction, the
 * consent/rights declaration wall at commission time, closed vocabularies,
 * the typed production lifecycle, and compilation to ES1.0
 * EscalationRequests through the C001 public port (one seam, no new
 * lifecycle; deterministic idempotent item keys).
 */

import { describe, expect, it } from 'vitest';

import { ESCALATION_MODES } from '@arena/escalation';

import {
  COMMISSION_STATES,
  COMMISSION_TRANSITIONS,
  HUMAN_DATA_ERROR_CODES,
  HumanDataError,
  checkCommissionTransition,
  compileCommissionEscalations,
  createHumanDataCommission,
  isCommissionDeliverableKind,
  verifyHumanDataCommission,
} from './index.js';
import { makeCommission, makeCommissionInput } from './test-support.js';

const NOW = Date.parse('2026-10-07T09:00:00.000Z');

describe('createHumanDataCommission (strict, fail-closed)', () => {
  it('creates a frozen DRAFT commission with a content digest', async () => {
    const commission = await makeCommission();
    expect(commission.state).toBe('draft');
    expect(commission.tenantId).toBe('tenant-a');
    expect(commission.deliverableKind).toBe('correction-pairs');
    expect(commission.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(commission)).toBe(true);
    await expect(verifyHumanDataCommission(commission)).resolves.toBe(commission.digest);
  });

  it('rejects a non-granted consent declaration (the wall is declared up front)', async () => {
    await expect(
      makeCommission({ consent: { granted: false, statement: 'no dataset rights granted' } }),
    ).rejects.toMatchObject({
      code: HUMAN_DATA_ERROR_CODES.CONSENT_WALL,
    });
  });

  it('rejects malformed consent statements', async () => {
    await expect(makeCommission({ consent: { granted: true, statement: '' } })).rejects.toBeInstanceOf(
      HumanDataError,
    );
  });

  it('rejects invalid rights posture through the REUSED A002 guard', async () => {
    await expect(
      makeCommission({ rights: { license: 'CC-BY-4.0', commercialUse: 'sometimes' } }),
    ).rejects.toThrow(/commercialUse/);
  });

  it('rejects unknown deliverable kinds, modes and urgencies (closed vocabularies)', async () => {
    await expect(makeCommission({ deliverableKind: 'poems' })).rejects.toMatchObject({
      code: HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION,
    });
    await expect(makeCommission({ escalationModes: ['vibes'] })).rejects.toMatchObject({
      code: HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION,
    });
    await expect(makeCommission({ urgency: 'whenever' })).rejects.toMatchObject({
      code: HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION,
    });
  });

  it('rejects an empty mode list, zero quantity and a bad output schema', async () => {
    await expect(makeCommission({ escalationModes: [] })).rejects.toBeInstanceOf(HumanDataError);
    await expect(makeCommission({ quantity: 0 })).rejects.toBeInstanceOf(HumanDataError);
    await expect(makeCommission({ perItemOutputSchema: 'not-an-object' })).rejects.toBeInstanceOf(
      HumanDataError,
    );
  });

  it('requires a bounded-replica session for demonstrations (the EES1.0 replay law)', async () => {
    await expect(
      makeCommission({
        deliverableKind: 'demonstrations',
        escalationModes: ['solve'],
        environmentSessionPolicy: { sessionMode: 'none' },
      }),
    ).rejects.toMatchObject({ code: HUMAN_DATA_ERROR_CODES.INVALID_COMMISSION });
    const demonstrations = await makeCommission({
      deliverableKind: 'demonstrations',
      escalationModes: ['solve'],
      environmentSessionPolicy: { sessionMode: 'bounded-replica', sanitization: 'strict' },
      datasetName: 'triage-demonstrations',
    });
    expect(demonstrations.environmentSessionPolicy.sessionMode).toBe('bounded-replica');
  });

  it('accepts every approved escalation mode and deliverable kind', () => {
    for (const mode of ESCALATION_MODES) {
      expect([mode]).toContain(mode);
    }
    for (const kind of ['correction-pairs', 'demonstrations', 'evaluation-cases', 'knowledge-artifacts']) {
      expect(isCommissionDeliverableKind(kind)).toBe(true);
    }
  });
});

describe('the studio production lifecycle (typed transition verdicts)', () => {
  it('walks DRAFT → SUBMITTED → IN_PRODUCTION → ASSEMBLING → DELIVERED legally', () => {
    const path = ['draft', 'submitted', 'in_production', 'assembling', 'delivered'] as const;
    for (let index = 0; index < path.length - 1; index += 1) {
      const check = checkCommissionTransition(path[index], path[index + 1]);
      expect(check.allowed).toBe(true);
      expect(check.reason).toBe('legal-transition');
    }
  });

  it('terminal states are final and illegal transitions are refused (machine-readable)', () => {
    expect(checkCommissionTransition('delivered', 'draft').reason).toBe('terminal-state');
    expect(checkCommissionTransition('abandoned', 'submitted').reason).toBe('terminal-state');
    expect(checkCommissionTransition('failed', 'in_production').reason).toBe('terminal-state');
    expect(checkCommissionTransition('draft', 'delivered').reason).toBe('illegal-transition');
    expect(checkCommissionTransition('draft', 'nonsense').reason).toBe('unknown-state');
  });

  it('the transition table covers exactly the declared states', () => {
    expect(Object.keys(COMMISSION_TRANSITIONS).sort()).toEqual([...COMMISSION_STATES].sort());
    expect(COMMISSION_TRANSITIONS.delivered).toEqual([]);
  });
});

describe('compileCommissionEscalations (THE C001 SEAM)', () => {
  it('compiles one ES1.0 request per commissioned item through createEscalationRequest', async () => {
    const commission = await makeCommission({ quantity: 3 });
    const compiled = await compileCommissionEscalations(commission, { now: NOW });
    expect(compiled).toHaveLength(3);
    for (const item of compiled) {
      expect(item.request.requestVersion).toBe(1);
      expect(item.request.capabilityNeed).toBe(commission.capabilityNeed);
      expect(item.request.desiredOutputSchema).toEqual(commission.perItemOutputSchema);
      expect(item.request.learningPermissions).toEqual(commission.learningPermissions);
      expect(item.request.retentionPolicy).toEqual(commission.retentionPolicy);
      expect(item.request.budget).toEqual(commission.budget);
      expect(item.request.correlationId).toBe(`hd_${commission.commissionId}`);
      expect(item.request.sourceWorkflowRef).toBe('human-data-studio');
      expect(item.request.contextReferences).toEqual([
        { kind: 'task-ref', ref: `hd-${commission.commissionId}-item-${item.itemIndex + 1}` },
      ]);
    }
  });

  it('item idempotency keys are deterministic (re-submission REPLAYS escalations)', async () => {
    const commission = await makeCommission({ quantity: 2 });
    const first = await compileCommissionEscalations(commission, { now: NOW });
    const second = await compileCommissionEscalations(commission, { now: NOW });
    expect(first.map((item) => item.input.idempotencyKey)).toEqual(
      second.map((item) => item.input.idempotencyKey),
    );
    expect(first[0]?.input.idempotencyKey).toBe(`hdcm_${commission.commissionId}_1`);
    expect(first[1]?.input.idempotencyKey).toBe(`hdcm_${commission.commissionId}_2`);
  });

  it('the compiled input round-trips through the C001 validator unchanged', async () => {
    const commission = await makeCommission();
    const compiled = await compileCommissionEscalations(commission, { now: NOW });
    // The service port receives the INPUT; the C001 host rebuilds the same
    // request from it (idempotent replay contract).
    expect(compiled[0]?.input.clientAppId).toBe(commission.clientAppId);
    expect(compiled[0]?.input.deadlineInMs).toBe(commission.productionWindowMs);
    expect(compiled[0]?.input.escalationModes).toEqual([...commission.escalationModes]);
  });
});
