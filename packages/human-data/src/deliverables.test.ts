/**
 * Deliverable contract tests (Work Order C012) — derivation ONLY from
 * C009-ACCEPTED outputs, the four record kinds, the consent wall, tenant
 * isolation, the replay law (adversarial: a demonstration masquerading as
 * a live-world mutation), tamper detection, and deterministic provenance
 * addressing.
 */

import { describe, expect, it } from 'vitest';

import type { DeliverableRecord } from './index.js';
import {
  HUMAN_DATA_ERROR_CODES,
  assertDeliverableRightsGated,
  deriveDeliverable,
  isDeliverableRecord,
} from './index.js';
import { makeAdjudicationOutcome, makeCommission, makeReplayTrace, makeResult } from './test-support.js';

const NOW = Date.parse('2026-10-07T11:00:00.000Z');
const REQUEST_ID = 'esc_11111111111111111111111111111111';

async function deriveFor(
  overrides: {
    readonly verdict?: 'ACCEPTED' | 'REVISION_REQUIRED' | 'REJECTED' | 'NEEDS_MORE_EVIDENCE';
    readonly tenantId?: string;
    readonly consent?: { granted: boolean; statement: string };
    readonly kind?: string;
    readonly deliverableKind?: string;
    readonly demonstrationTrace?: unknown;
    readonly originalSnapshot?: unknown;
  } = {},
) {
  const commission = await makeCommission({
    commissionId: 'hd_22222222222222222222222222222222',
    ...(overrides.deliverableKind !== undefined
      ? {
          deliverableKind: overrides.deliverableKind,
          ...(overrides.deliverableKind === 'demonstrations'
            ? {
                escalationModes: ['solve'],
                environmentSessionPolicy: { sessionMode: 'bounded-replica' },
                datasetName: 'triage-demonstrations',
              }
            : {}),
          ...(overrides.deliverableKind === 'evaluation-cases'
            ? { datasetName: 'triage-evaluation-cases' }
            : {}),
          ...(overrides.deliverableKind === 'knowledge-artifacts'
            ? { datasetName: 'triage-knowledge' }
            : {}),
        }
      : {}),
  });
  const kind = overrides.kind ?? 'correction';
  return deriveDeliverable({
    commission,
    result: makeResult(kind),
    adjudication: makeAdjudicationOutcome({
      requestId: REQUEST_ID,
      ...(overrides.tenantId !== undefined ? { tenantId: overrides.tenantId } : {}),
      ...(overrides.verdict !== undefined ? { verdict: overrides.verdict } : {}),
    }),
    consent: overrides.consent ?? {
      granted: true,
      statement: 'Expert grants reuse rights for the demonstration/correction material.',
    },
    ...(overrides.demonstrationTrace !== undefined
      ? { demonstrationTrace: overrides.demonstrationTrace as never }
      : {}),
    ...(overrides.originalSnapshot !== undefined
      ? { originalSnapshot: overrides.originalSnapshot as never }
      : {}),
    now: NOW,
  });
}

describe('deriveDeliverable (ONLY from C009-ACCEPTED outputs)', () => {
  it('derives a rights-carrying, provenance-addressed correction pair', async () => {
    const record = await deriveFor({ originalSnapshot: { priority: 'P3' } });
    expect(record.recordKind).toBe('correction-pair');
    expect(record.tenantId).toBe('tenant-a');
    expect(record.consent.granted).toBe(true);
    expect(record.rights.license).toBe('CC-BY-4.0');
    expect(record.sourceProvenance.escalationRequestId).toBe(REQUEST_ID);
    expect(record.sourceProvenance.adjudicationVerdictId).toMatch(/^av_[0-9a-f]{32}$/);
    expect(record.sourceProvenance.resultKind).toBe('correction');
    expect(record.payload.evidenceRefs).toContain(`adjudication:${record.sourceProvenance.adjudicationVerdictId}`);
    if (record.payload.recordKind === 'correction-pair') {
      expect(record.payload.correctedRef).toBe('record:T-1001');
      expect(record.payload.before).toEqual({ priority: 'P3' });
      expect(record.payload.after).toEqual({ priority: 'P1', rationale: 'clinical keywords detected' });
    }
    expect(isDeliverableRecord(record)).toBe(true);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it('derives evaluation cases and scoped knowledge artifacts', async () => {
    const evaluation = await deriveFor({ deliverableKind: 'evaluation-cases', kind: 'evaluation-verdict' });
    expect(evaluation.recordKind).toBe('evaluation-case');
    if (evaluation.payload.recordKind === 'evaluation-case') {
      expect(evaluation.payload.verdict).toBe('pass');
      expect(evaluation.payload.subjectRef).toBe('subject:T-1002');
    }
    const knowledge = await deriveFor({ deliverableKind: 'knowledge-artifacts', kind: 'knowledge-patch' });
    expect(knowledge.recordKind).toBe('knowledge-artifact');
    if (knowledge.payload.recordKind === 'knowledge-artifact') {
      expect(knowledge.payload.scope).toBe('tenant-a/triage');
    }
  });

  it('derives a demonstration trajectory carrying the EES1.0 replay trace', async () => {
    const demonstration = await deriveFor({
      deliverableKind: 'demonstrations',
      kind: 'solution',
      demonstrationTrace: makeReplayTrace(),
    });
    expect(demonstration.recordKind).toBe('demonstration');
    if (demonstration.payload.recordKind === 'demonstration') {
      expect(demonstration.payload.trace.liveMutation).toBe(false);
      expect(demonstration.payload.trace.frames).toHaveLength(1);
      expect(demonstration.payload.trace.frames[0].state).toEqual({
        queueDepth: 3,
        oldestTicketMinutes: 42,
      });
      expect(demonstration.payload.trace.frames[0].action).toEqual({
        tool: 'triage-console',
        command: 'reclassify',
        expert: 'expert-1',
      });
      expect(demonstration.payload.trace.frames[0].consequence).toEqual({
        ticketId: 'T-1001',
        newPriority: 'P1',
      });
    }
  });

  it('derivation is deterministic (same source commission + result ⇒ same deliverable id + digest)', async () => {
    const first = await deriveFor();
    const second = await deriveFor();
    expect(second.deliverableId).toBe(first.deliverableId);
    expect(second.digest).toBe(first.digest);
  });

  it('THE VALIDATION GATE: a non-ACCEPTED verdict never becomes a deliverable', async () => {
    await expect(deriveFor({ verdict: 'REVISION_REQUIRED' })).rejects.toMatchObject({
      code: HUMAN_DATA_ERROR_CODES.VALIDATION_GATE,
    });
    await expect(deriveFor({ verdict: 'REJECTED' })).rejects.toMatchObject({
      code: HUMAN_DATA_ERROR_CODES.VALIDATION_GATE,
    });
    await expect(deriveFor({ verdict: 'NEEDS_MORE_EVIDENCE' })).rejects.toMatchObject({
      code: HUMAN_DATA_ERROR_CODES.VALIDATION_GATE,
    });
  });

  it('THE CONSENT WALL: a deliverable without GRANTED consent is rejected', async () => {
    await expect(
      deriveFor({ consent: { granted: false, statement: 'no reuse rights granted' } }),
    ).rejects.toMatchObject({ code: HUMAN_DATA_ERROR_CODES.CONSENT_WALL });
  });

  it('cross-tenant derivation is rejected (customer data never crosses tenants)', async () => {
    await expect(deriveFor({ tenantId: 'tenant-b' })).rejects.toMatchObject({
      code: HUMAN_DATA_ERROR_CODES.CROSS_TENANT,
    });
  });

  it('a result kind that does not match the commissioned kind is rejected', async () => {
    await expect(deriveFor({ kind: 'answer' })).rejects.toMatchObject({
      code: HUMAN_DATA_ERROR_CODES.INVALID_DELIVERABLE,
    });
  });

  it('THE REPLAY LAW: a demonstration without a trace is rejected', async () => {
    await expect(deriveFor({ deliverableKind: 'demonstrations', kind: 'solution' })).rejects.toMatchObject(
      { code: HUMAN_DATA_ERROR_CODES.REPLAY_LAW },
    );
  });

  it('ADVERSARIAL: a demonstration record masquerading as a live-world mutation is rejected', async () => {
    const mutatingTrace = { ...makeReplayTrace(), liveMutation: true };
    await expect(
      deriveFor({
        deliverableKind: 'demonstrations',
        kind: 'solution',
        demonstrationTrace: mutatingTrace,
      }),
    ).rejects.toMatchObject({ code: HUMAN_DATA_ERROR_CODES.REPLAY_LAW });
  });
});

describe('assertDeliverableRightsGated (the wall, re-enforced)', () => {
  it('admits a gated record for the owning tenant', async () => {
    const record = await deriveFor();
    await expect(assertDeliverableRightsGated(record, 'tenant-a')).resolves.toBe(record);
  });

  it('rejects a record for a different tenant', async () => {
    const record = await deriveFor();
    await expect(assertDeliverableRightsGated(record, 'tenant-b')).rejects.toMatchObject({
      code: HUMAN_DATA_ERROR_CODES.CROSS_TENANT,
    });
  });

  it('ADVERSARIAL: rights-metadata/payload tampering is detected (digest mismatch)', async () => {
    const record = await deriveFor();
    const tampered: DeliverableRecord = {
      ...record,
      rights: { ...record.rights, commercialUse: 'prohibited' },
    };
    await expect(assertDeliverableRightsGated(tampered, 'tenant-a')).rejects.toMatchObject({
      code: HUMAN_DATA_ERROR_CODES.TAMPERED,
    });
  });

  it('ADVERSARIAL: a forged digest over mutated content is rejected', async () => {
    const record = await deriveFor();
    const forged: DeliverableRecord = {
      ...record,
      digest: '0'.repeat(64),
    };
    await expect(assertDeliverableRightsGated(forged, 'tenant-a')).rejects.toMatchObject({
      code: HUMAN_DATA_ERROR_CODES.TAMPERED,
    });
  });

  it('rejects structurally invalid values', async () => {
    await expect(assertDeliverableRightsGated({ deliverableId: 'nope' }, 'tenant-a')).rejects.toMatchObject(
      { code: HUMAN_DATA_ERROR_CODES.INVALID_DELIVERABLE },
    );
  });
});
