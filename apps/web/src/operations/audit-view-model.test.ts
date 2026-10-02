/**
 * Audit view-model tests (Work Order B014).
 *
 * Positive: the stream projects the REAL A034 chain verbatim — order
 * preserved (append-only), actor identity, closed kinds, closed outcome
 * effects, required correlation ids, digests, head + verification
 * posture.
 * Adversarial: malformed records degrade truthfully — the row is never
 * dropped (the count always matches), unknown truth class, no thrown
 * render; the stream never re-sorts what it is given.
 */

import { describe, expect, it } from 'vitest';

import { buildOperationsDemoCorpus } from './fixtures.js';
import { toAuditEventView, toAuditStreamView } from './audit-view-model.js';

describe('audit view projection (positive)', () => {
  it('projects the chain verbatim: order, sequence, actor identity, outcome, correlation', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const stream = toAuditStreamView(corpus.auditRecords, { chainVerified: true });
    expect(stream.count).toBe(4);
    expect(stream.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(stream.chainVerified).toBe(true);
    expect(stream.truthClass).toBe('evidence');
    expect(stream.headDigest).toBe(corpus.auditRecords[3]?.digest);

    const first = stream.events[0];
    expect(first?.kind).toBe('authorization-decision');
    expect(first?.actorTenantId).toBe('arena-demo');
    expect(first?.actorPrincipalId).toBe('demo-visitor');
    expect(first?.effect).toBe('allow');
    expect(first?.reason).toBe('operator-role-lens');
    expect(first?.correlationId).toBe('demo-corr-ops-0001');
    expect(first?.occurredAt).toBe('2026-10-01T08:30:00.000Z');
    expect(first?.digest).toBe(corpus.auditRecords[0]?.digest);
    expect(first?.truthClass).toBe('evidence');

    const denied = stream.events[1];
    expect(denied?.kind).toBe('tenant-access-denied');
    expect(denied?.effect).toBe('deny');
    expect(denied?.reason).toBe('tenant-scope-violation');
    expect(denied?.causationId).toMatch(/^[0-9a-f-]{36}$/);

    const secret = stream.events[2];
    expect(secret?.kind).toBe('secret-detected');
    expect(secret?.effect).toBe('recorded');
  });

  it('the append-only note is carried on every stream (no editable-history affordance)', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const stream = toAuditStreamView(corpus.auditRecords);
    expect(stream.appendOnlyNote).toContain('append-only');
    expect(stream.appendOnlyNote).toContain('never edited');
  });

  it('an empty stream renders its honest empty note, never a fabricated trail', () => {
    const stream = toAuditStreamView([]);
    expect(stream.count).toBe(0);
    expect(stream.events).toEqual([]);
    expect(stream.headDigest).toBeUndefined();
    expect(stream.truthClass).toBe('unknown');
    expect(stream.emptyNote).toContain('No audit events are recorded');
  });
});

describe('audit view projection (adversarial — truthful degradation)', () => {
  it('malformed records keep their row (never dropped) and degrade to unknown truth', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const mixed: readonly unknown[] = [null, corpus.auditRecords[0], 42, 'record'];
    const stream = toAuditStreamView(mixed);
    expect(stream.count).toBe(4); // the count ALWAYS matches the input — no gaps
    expect(stream.events[0]?.truthClass).toBe('unknown');
    expect(stream.events[0]?.readable).toBe(false);
    expect(stream.events[1]?.truthClass).toBe('evidence');
    expect(stream.events[2]?.truthClass).toBe('unknown');
    expect(stream.events[3]?.truthClass).toBe('unknown');
    // The head digest is the LAST READABLE record's digest — projected, not repaired.
    expect(stream.headDigest).toBe(corpus.auditRecords[0]?.digest);
    expect(stream.unknownFields.length).toBeGreaterThan(0);
  });

  it('the stream preserves the given order verbatim — never re-sorted, never gap-filled', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const reversed = [...corpus.auditRecords].reverse();
    const stream = toAuditStreamView(reversed);
    // The projected sequence is the CHAIN's sequence field, in the ORDER GIVEN.
    expect(stream.events.map((event) => event.sequence)).toEqual([4, 3, 2, 1]);
    expect(stream.headDigest).toBe(corpus.auditRecords[0]?.digest);
  });

  it('a record with an invalid outcome effect renders no effect (closed vocabulary)', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const original = corpus.auditRecords[0];
    if (original === undefined) {
      throw new Error('demo corpus must carry its audit records');
    }
    const tampered = {
      ...original,
      payload: {
        ...original.payload,
        outcome: { effect: 'maybe', reason: 'not-a-closed-effect' },
      },
    };
    const view = toAuditEventView(tampered);
    expect(view.effect).toBeUndefined();
    expect(view.reason).toBe('not-a-closed-effect');
    // The record is still structurally a record + event — evidence class, degraded field.
    expect(view.truthClass).toBe('evidence');
  });

  it('a structurally foreign payload degrades the row to unknown without throwing', () => {
    const view = toAuditEventView({
      recordVersion: 1,
      sequence: 1,
      previousDigest: '0'.repeat(64),
      digest: 'f'.repeat(64),
      payload: 'not-an-event',
    });
    expect(view.readable).toBe(false);
    expect(view.truthClass).toBe('unknown');
    expect(view.sequence).toBe(1);
    expect(view.digest).toBe('f'.repeat(64));
    expect(view.unknownFields.join(' ')).toContain('payload');
  });
});
