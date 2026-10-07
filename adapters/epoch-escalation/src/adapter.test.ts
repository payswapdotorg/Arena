/**
 * Mapping + authority tests (Work Order C019): trigger + posture → the
 * REAL ES1.0 EscalationRequest; authorization mismatch fails closed;
 * EPI1.0 async fields survive the mapping; Arena → Epoch delivery is a
 * read-only typed projection; write-back attempts fail closed.
 */

import { describe, expect, it } from 'vitest';
import {
  applyEscalationTransition,
  createEscalationRecord,
  createEscalationResult,
  isEscalationRequest,
  submitEscalationResult,
} from '@arena/escalation';
import type { EscalationRecord } from '@arena/escalation';
import {
  EPOCH_ESCALATION_ERROR_CODES,
  EpochEscalationError,
} from './errors.js';
import {
  attemptEpochAuthoritativeWrite,
  EPOCH_ESCALATION_AUTHORITY_BOUNDARY,
  checkEpochDeliveryAction,
} from './authority.js';
import { parseEpochIntegrationPosture } from './posture.js';
import { parseEpochEscalationTrigger } from './trigger.js';
import {
  buildEscalationRequest,
  epochDeliveryFromRecord,
  EpochEscalationAdapter,
  mapTriggerToCreateInput,
} from './adapter.js';
import { REFERENCE_POSTURE, validTrigger } from './test-support.js';

const POSTURE = parseEpochIntegrationPosture(REFERENCE_POSTURE);

describe('Epoch → Arena mapping', () => {
  it('maps the trigger onto a REAL validated EscalationRequest', async () => {
    const request = await buildEscalationRequest(parseEpochEscalationTrigger(validTrigger()), POSTURE);
    expect(isEscalationRequest(request)).toBe(true);
    expect(request.clientAppId).toBe('epoch-app');
    expect(request.tenantId).toBe('tenant-alpha');
    expect(request.capabilityNeed).toBe('boq-estimation.quantity-takeoff');
    expect([...request.escalationModes]).toEqual(['solve', 'unblock']);
    expect(request.idempotencyKey).toBe('epoch-idem-0001');
    expect(request.correlationId).toBe('epoch-corr-0001');
    expect(request.locale).toBe('en');
    // The posture supplied the session + privacy policy.
    expect(request.environmentSessionPolicy.sessionMode).toBe('bounded-replica');
    expect(request.privacyPolicy.pii).toBe('redact');
    // EPI1.0 artifact digests became ES1.0 context references.
    expect(request.contextReferences).toContainEqual({ kind: 'trajectory-ref', ref: 'epoch-traj-042' });
    expect(request.contextReferences).toContainEqual({ kind: 'uri', ref: 'epoch-env-block-c' });
    expect(request.contextReferences).toContainEqual({ kind: 'task-ref', ref: 'quantity-takeoff-block-c' });
    expect(request.sourceWorkflowRef).toBe('boq-accra-house-draft');
    expect(request.sourceRunRef).toBe('run-2026-10-07-042');
    expect(request.budget.amountMinorUnits).toBe(25_000);
  });

  it('preserves the deadline from the trigger (absolute instant)', async () => {
    const request = await buildEscalationRequest(parseEpochEscalationTrigger(validTrigger()), POSTURE);
    expect(request.deadline).toBe('2026-10-07T12:00:00.000Z');
    expect(request.createdAt).toBe('2026-10-07T10:00:00.000Z');
  });

  it('fails closed on cross-tenant authorization mismatch', () => {
    const trigger = parseEpochEscalationTrigger(
      validTrigger({ authorization: { clientAppId: 'other-app', tenantId: 'tenant-beta' } }),
    );
    expect(() => mapTriggerToCreateInput(trigger, POSTURE)).toThrowError(EpochEscalationError);
    try {
      mapTriggerToCreateInput(trigger, POSTURE);
    } catch (error) {
      expect((error as EpochEscalationError).code).toBe(
        EPOCH_ESCALATION_ERROR_CODES.AUTHORIZATION_MISMATCH,
      );
    }
  });

  it('rejects malformed wires BEFORE the domain constructor is reached (parser is strictly tighter)', async () => {
    // The trigger parser is deliberately tighter than the ES1.0 domain
    // constructor on every shared field, so malformed wires fail at the
    // adapter boundary with parser codes — the MAPPING_FAILED domain-
    // normalization path is defensive depth for future field additions.
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['non-integer budget', validTrigger({ budget: { amountMinorUnits: 12.5, currency: 'USD' } }), 'INVALID_TRIGGER'],
      ['single-segment capability need', validTrigger({ capabilityNeed: 'boq' }), 'INVALID_TRIGGER'],
      ['bad locale in preferredLocales', validTrigger({ preferredLocales: ['english'] }), 'INVALID_TRIGGER'],
      ['empty uncertainty notes', validTrigger({ uncertaintyNotes: '' }), 'INVALID_TRIGGER'],
    ];
    for (const [name, wire, expectedCode] of cases) {
      let error: EpochEscalationError | undefined;
      try {
        await buildEscalationRequest(parseEpochEscalationTrigger(wire), POSTURE);
      } catch (caught) {
        if (caught instanceof EpochEscalationError) error = caught;
        else throw caught;
      }
      expect(error?.code, name).toBe(EPOCH_ESCALATION_ERROR_CODES[expectedCode as keyof typeof EPOCH_ESCALATION_ERROR_CODES]);
    }
    // The defensive normalization code exists in the closed vocabulary.
    expect(EPOCH_ESCALATION_ERROR_CODES.MAPPING_FAILED).toBe('EPOCH_ESCALATION_MAPPING_FAILED');
  });

  it('the adapter facade maps raw wire triggers', async () => {
    const adapter = new EpochEscalationAdapter(POSTURE);
    const request = await adapter.buildEscalationRequestFromWire(validTrigger());
    expect(request.tenantId).toBe('tenant-alpha');
  });
});

describe('Arena → Epoch delivery projection', () => {
  async function drivenRecord(): Promise<EscalationRecord> {
    const request = await buildEscalationRequest(
      parseEpochEscalationTrigger(validTrigger()),
      POSTURE,
    );
    let record = createEscalationRecord(request, request.createdAt);
    record = applyEscalationTransition(record, 'triaged', { now: request.createdAt });
    record = applyEscalationTransition(record, 'matching', { now: request.createdAt });
    record = applyEscalationTransition(record, 'offered', {
      now: request.createdAt,
      expertRef: 'expert-kwame',
    });
    record = applyEscalationTransition(record, 'accepted', { now: request.createdAt });
    record = applyEscalationTransition(record, 'session_ready', {
      now: request.createdAt,
      sessionRef: 'session-block-c',
    });
    record = applyEscalationTransition(record, 'in_progress', { now: request.createdAt });
    const result = createEscalationResult({
      kind: 'unblock',
      producedAt: request.createdAt,
      summary: 'Block C foundation convention requires 450mm depth per local practice.',
      blockageRef: 'boq-accra-house-draft/block-c',
      resolution: { foundationDepthMm: 450, basis: 'local-convention-evidence' },
    });
    record = submitEscalationResult(record, result, { now: request.createdAt });
    record = applyEscalationTransition(record, 'validating', { now: request.createdAt });
    record = applyEscalationTransition(record, 'result_accepted', {
      now: request.createdAt,
      validationStatus: 'passed',
    });
    record = applyEscalationTransition(record, 'paid', {
      now: request.createdAt,
      cost: {
        amountMinorUnits: 25_000,
        currency: 'USD',
        arenaFeeMinorUnits: 3_750,
        expertPayoutStatus: 'paid',
      },
    });
    return record;
  }

  it('projects the typed result, validation status and cost fields', async () => {
    const record = await drivenRecord();
    const delivery = epochDeliveryFromRecord(record);
    expect(delivery.state).toBe('paid');
    expect(delivery.resultKind).toBe('unblock');
    expect(delivery.result?.kind).toBe('unblock');
    expect(delivery.validationStatus).toBe('passed');
    expect(delivery.cost?.arenaFeeMinorUnits).toBe(3_750);
    expect(delivery.expertRef).toBe('expert-kwame');
    expect(delivery.sessionRef).toBe('session-block-c');
    expect(
      delivery.refs.some((ref) => ref.kind === 'escalation-request-ref' && ref.ref === record.request.requestId),
    ).toBe(true);
    expect(delivery.refs.some((ref) => ref.kind === 'expert-session-ref' && ref.ref === 'session-block-c')).toBe(true);
    expect(delivery.refs.some((ref) => ref.kind === 'evidence-ref' && ref.ref === 'boq-accra-house-draft/block-c')).toBe(
      true,
    );
  });

  it('is deep-frozen — silent mutation attempts fail', async () => {
    const record = await drivenRecord();
    const delivery = epochDeliveryFromRecord(record) as unknown as Record<string, unknown>;
    expect(() => {
      delivery['state'] = 'closed';
    }).toThrowError(TypeError);
  });

  it('learning artifact refs surface ONLY when the request authorized reuse', async () => {
    const record = await drivenRecord();
    const delivery = epochDeliveryFromRecord(record);
    // The reference posture sets allowArtifactReuse: false.
    expect(delivery.learningArtifactRefs).toHaveLength(0);
  });

  it('binds the EPI1.0 job id back onto the delivery', async () => {
    const record = await drivenRecord();
    const adapter = new EpochEscalationAdapter(POSTURE);
    const delivery = adapter.deliveryFromRecord(record, 'epoch-job-2026-10-07-001');
    expect(delivery.epochJobId).toBe('epoch-job-2026-10-07-001');
  });

  it('fails closed on structurally invalid records', () => {
    expect(() => epochDeliveryFromRecord({ state: 'paid' } as unknown as EscalationRecord)).toThrowError(
      EpochEscalationError,
    );
  });
});

describe('the Epoch authority boundary (EPI1.0; lock rules 13-15, 36)', () => {
  it('declares the six clauses with the lock rule references', () => {
    expect(EPOCH_ESCALATION_AUTHORITY_BOUNDARY.clauses).toHaveLength(6);
    expect(EPOCH_ESCALATION_AUTHORITY_BOUNDARY.effectDirection).toBe('arena-to-epoch-read-only-projection');
  });

  it('every write-back attempt fails closed with the typed violation', () => {
    for (const store of ['world-model', 'action-gateway', 'constraint-engine', 'approved-baselines', 'delivery-state'] as const) {
      expect(() =>
        attemptEpochAuthoritativeWrite({
          attemptKind: 'epoch-authoritative-write-attempt',
          store,
        }),
      ).toThrowError(EpochEscalationError);
    }
    try {
      attemptEpochAuthoritativeWrite({
        attemptKind: 'epoch-authoritative-write-attempt',
        store: 'world-model',
      });
    } catch (error) {
      expect((error as EpochEscalationError).code).toBe(EPOCH_ESCALATION_ERROR_CODES.WRITEBACK_FORBIDDEN);
      expect((error as EpochEscalationError).category).toBe('authority-violation');
    }
  });

  it('arbitrary malformed write attempts fail closed too (fail-closed by default)', () => {
    expect(() => attemptEpochAuthoritativeWrite({ store: 'anything' })).toThrowError(EpochEscalationError);
    expect(() => attemptEpochAuthoritativeWrite('mutate-the-world-model')).toThrowError(EpochEscalationError);
  });

  it('only observe-delivery is a permitted delivery action', () => {
    expect(checkEpochDeliveryAction('observe-delivery').outcome).toBe('permitted');
    expect(checkEpochDeliveryAction('mutate-world-model').outcome).toBe('forbidden');
    expect(checkEpochDeliveryAction('execute-epoch-action').outcome).toBe('forbidden');
  });
});
