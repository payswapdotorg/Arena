/**
 * Routing decision history tests (Work Order C002) — append-only chains,
 * supersession by append, tenant scoping and tamper detection.
 */

import { describe, expect, it } from 'vitest';
import { appendRoutingDecision, routingDecisionHistoryHead, verifyRoutingDecisionChain } from './history.js';
import { routeEscalation } from './engine.js';
import { compileDemandProfile } from './demand-profile.js';
import {
  buildFixtureGraph,
  fixtureCandidateInput,
  fixtureDemandInput,
  fixtureNodeRef,
  qualificationInput,
  FIXTURE_EVALUATED_AT,
} from './test-support.js';
import { createRoutingCandidate } from './candidate.js';
import type { RoutingCandidate } from './candidate.js';

async function fixtureVerdict(requestId: string): Promise<{
  candidates: RoutingCandidate[];
  verdict: Awaited<ReturnType<typeof routeEscalation>>;
}> {
  const graph = await buildFixtureGraph();
  const result = await compileDemandProfile(fixtureDemandInput(), graph, {
    evaluatedAt: FIXTURE_EVALUATED_AT,
  });
  if (result.outcome !== 'compilable') throw new Error('compile failed');
  const skill = await fixtureNodeRef(graph, 'skill', 'boq-assumption-check');
  const sub = await fixtureNodeRef(graph, 'sub-capability', 'boq-verification');
  const cap = await fixtureNodeRef(graph, 'capability', 'quantity-surveying');
  const tool = await fixtureNodeRef(graph, 'tool', 'local-rate-database');
  const domain = await fixtureNodeRef(graph, 'domain', 'construction');
  const candidate = createRoutingCandidate(
    fixtureCandidateInput(graph, {
      qualifiedCapabilities: [qualificationInput(cap), qualificationInput(sub), qualificationInput(skill)],
      supportedToolRefs: [tool],
      domainRefs: [domain],
      historicalTaskDomainRefs: [domain],
    }),
  );
  const verdict = await routeEscalation(result.profile, [candidate], {
    requestId,
    evaluatedAt: FIXTURE_EVALUATED_AT,
  });
  return { candidates: [candidate], verdict };
}

describe('routing decision history — append-only supersession', () => {
  it('appends the first decision with a null previous digest', async () => {
    const { verdict } = await fixtureVerdict('esc_00000001');
    const { history, record } = await appendRoutingDecision([], verdict, {
      requestId: 'esc_00000001',
      tenantId: 'tenant-a',
      recordedAt: FIXTURE_EVALUATED_AT,
    });
    expect(record.sequence).toBe(1);
    expect(record.previousRecordDigest).toBeNull();
    expect(record.verdictDigest).toBe(verdict.digest);
    expect(record.verdictOutcome).toBe('matched');
    expect(record.expertRef).toBe('expert-001');
    expect(history).toHaveLength(1);
    expect(routingDecisionHistoryHead(history)?.digest).toBe(record.digest);
  });

  it('a later decision SUPERSEDES by appending — the earlier record stays immutable', async () => {
    const first = await fixtureVerdict('esc_00000002');
    const second = await fixtureVerdict('esc_00000002');
    const step1 = await appendRoutingDecision([], first.verdict, {
      requestId: 'esc_00000002',
      tenantId: 'tenant-a',
      recordedAt: '2026-10-07T12:01:00.000Z',
    });
    const step2 = await appendRoutingDecision(step1.history, second.verdict, {
      requestId: 'esc_00000002',
      tenantId: 'tenant-a',
      recordedAt: '2026-10-07T12:02:00.000Z',
    });
    expect(step2.history).toHaveLength(2);
    expect(step2.record.sequence).toBe(2);
    expect(step2.record.previousRecordDigest).toBe(step1.record.digest);
    // The ORIGINAL history is untouched (append-only).
    expect(step1.history).toHaveLength(1);
    await expect(verifyRoutingDecisionChain(step2.history)).resolves.toBeUndefined();
  });

  it('rejects a cross-tenant append (typed scope failure)', async () => {
    const { verdict } = await fixtureVerdict('esc_00000003');
    await expect(
      appendRoutingDecision([], verdict, {
        requestId: 'esc_00000003',
        tenantId: 'tenant-b',
        recordedAt: FIXTURE_EVALUATED_AT,
      }),
    ).rejects.toThrow(/tenant-scoped/);
  });

  it('rejects malformed request ids and timestamps', async () => {
    const { verdict } = await fixtureVerdict('esc_00000004');
    await expect(
      appendRoutingDecision([], verdict, {
        requestId: 'not-an-esc-id',
        tenantId: 'tenant-a',
        recordedAt: FIXTURE_EVALUATED_AT,
      }),
    ).rejects.toThrow(/requestId is invalid/);
    await expect(
      appendRoutingDecision([], verdict, {
        requestId: 'esc_00000004',
        tenantId: 'tenant-a',
        recordedAt: '2026-10-07',
      }),
    ).rejects.toThrow(/recordedAt/);
  });
});

describe('routing decision history — tamper detection', () => {
  it('detects a mutated record (digest mismatch)', async () => {
    const { verdict } = await fixtureVerdict('esc_00000005');
    const { history } = await appendRoutingDecision([], verdict, {
      requestId: 'esc_00000005',
      tenantId: 'tenant-a',
      recordedAt: FIXTURE_EVALUATED_AT,
    });
    const record = history[0];
    if (record === undefined) throw new Error('missing record');
    const tampered = { ...record, verdictOutcome: 'no-match' };
    await expect(verifyRoutingDecisionChain([tampered])).rejects.toThrow(/digest mismatch/);
  });

  it('detects a broken chain link', async () => {
    const first = await fixtureVerdict('esc_00000006');
    const second = await fixtureVerdict('esc_00000006');
    const step1 = await appendRoutingDecision([], first.verdict, {
      requestId: 'esc_00000006',
      tenantId: 'tenant-a',
      recordedAt: '2026-10-07T12:01:00.000Z',
    });
    const step2 = await appendRoutingDecision(step1.history, second.verdict, {
      requestId: 'esc_00000006',
      tenantId: 'tenant-a',
      recordedAt: '2026-10-07T12:02:00.000Z',
    });
    const broken = step2.history.map((record, index) =>
      index === 1 ? { ...record, previousRecordDigest: '0'.repeat(64) } : record,
    );
    await expect(verifyRoutingDecisionChain(broken)).rejects.toThrow(/breaks the chain/);
  });

  it('detects a sequence gap', async () => {
    const first = await fixtureVerdict('esc_00000007');
    const second = await fixtureVerdict('esc_00000007');
    const step1 = await appendRoutingDecision([], first.verdict, {
      requestId: 'esc_00000007',
      tenantId: 'tenant-a',
      recordedAt: '2026-10-07T12:01:00.000Z',
    });
    const step2 = await appendRoutingDecision(step1.history, second.verdict, {
      requestId: 'esc_00000007',
      tenantId: 'tenant-a',
      recordedAt: '2026-10-07T12:02:00.000Z',
    });
    const gapped = step2.history.map((record, index) =>
      index === 1 ? { ...record, sequence: 5 } : record,
    );
    await expect(verifyRoutingDecisionChain(gapped)).rejects.toThrow(/not contiguous/);
  });

  it('detects mixed tenants in one history', async () => {
    const first = await fixtureVerdict('esc_00000008');
    const second = await fixtureVerdict('esc_00000008');
    const step1 = await appendRoutingDecision([], first.verdict, {
      requestId: 'esc_00000008',
      tenantId: 'tenant-a',
      recordedAt: '2026-10-07T12:01:00.000Z',
    });
    const step2 = await appendRoutingDecision(step1.history, second.verdict, {
      requestId: 'esc_00000008',
      tenantId: 'tenant-a',
      recordedAt: '2026-10-07T12:02:00.000Z',
    });
    const mixed = step2.history.map((record, index) =>
      index === 1 ? { ...record, tenantId: 'tenant-b' } : record,
    );
    await expect(verifyRoutingDecisionChain(mixed)).rejects.toThrow(/mixes tenants/);
  });

  it('an empty history verifies cleanly; the head is null', async () => {
    await expect(verifyRoutingDecisionChain([])).resolves.toBeUndefined();
    expect(routingDecisionHistoryHead([])).toBeNull();
  });
});
