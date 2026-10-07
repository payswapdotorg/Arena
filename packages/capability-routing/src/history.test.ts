/**
 * Decision-history tests (Work Order C015): append-only supersession,
 * digest chain integrity, tenant scoping, tamper detection.
 */

import { describe, expect, it } from 'vitest';
import {
  RESOURCE_DECISION_RECORD_VERSION,
  appendResourceDecision,
  resourceDecisionHistoryHead,
  verifyResourceDecisionChain,
} from './history.js';
import { CapabilityRoutingError } from './errors.js';
import { matchResources } from './engine.js';
import { compileCrossResourceDemand } from './demand.js';
import {
  FIXTURE_EVALUATED_AT,
  buildFixtureGraph,
  fixtureArtifactCandidate,
  fixtureCrossDemandInput,
  fixtureToolCandidate,
} from './test-support.js';

const RECORDED_AT = '2026-10-07T12:01:00.000Z';
const RECORDED_AT_2 = '2026-10-07T12:05:00.000Z';
const DEMAND_ID = 'capr_demand_0001';

async function fixtureMatch(): Promise<{ match: Awaited<ReturnType<typeof matchResources>> }> {
  const input = fixtureCrossDemandInput({ escalationModes: ['TOOL_GAP'] });
  delete (input as { expert?: unknown }).expert;
  const graph = await buildFixtureGraph();
  const compilation = await compileCrossResourceDemand(
    { ...input, tool: { requiredToolIds: ['local-rate-database'] } },
    graph,
    { evaluatedAt: FIXTURE_EVALUATED_AT },
  );
  if (compilation.outcome !== 'compilable') throw new Error('fixture demand must compile');
  const match = await matchResources(
    compilation.profile,
    { tools: [fixtureToolCandidate()] },
    { requestId: 'capr_fixed0002', evaluatedAt: FIXTURE_EVALUATED_AT },
  );
  return { match };
}

describe('resource decision history', () => {
  it('appends superseding decisions in a digest chain', async () => {
    const { match } = await fixtureMatch();
    const first = await appendResourceDecision([], match, {
      demandId: DEMAND_ID,
      tenantId: 'tenant-a',
      recordedAt: RECORDED_AT,
    });
    expect(first.record.recordVersion).toBe(RESOURCE_DECISION_RECORD_VERSION);
    expect(first.record.sequence).toBe(1);
    expect(first.record.previousRecordDigest).toBeNull();
    expect(first.record.matchDigest).toBe(match.digest);
    expect(first.record.compositionRefs).toEqual([]);

    // A second run supersedes by APPEND — the first record stays immutable.
    const second = await appendResourceDecision(first.history, match, {
      demandId: DEMAND_ID,
      tenantId: 'tenant-a',
      recordedAt: RECORDED_AT_2,
    });
    expect(second.record.sequence).toBe(2);
    expect(second.record.previousRecordDigest).toBe(first.record.digest);
    expect(first.history).toHaveLength(1);
    expect(second.history).toHaveLength(2);
    expect(resourceDecisionHistoryHead(second.history)?.digest).toBe(second.record.digest);
    await expect(verifyResourceDecisionChain(second.history)).resolves.toBeUndefined();
  });

  it('records composition refs when a composition matched', async () => {
    const input = fixtureCrossDemandInput({ escalationModes: ['TOOL_GAP'] });
    delete (input as { expert?: unknown }).expert;
    const graph = await buildFixtureGraph();
    const compilation = await compileCrossResourceDemand(
      {
        ...input,
        tool: { requiredToolIds: ['local-rate-database'] },
        artifact: { artifactKinds: ['dataset'] },
      },
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    if (compilation.outcome !== 'compilable') throw new Error('fixture demand must compile');
    const match = await matchResources(
      compilation.profile,
      {
        tools: [fixtureToolCandidate()],
        artifacts: [fixtureArtifactCandidate({ offerId: 'offer-x', price: null })],
      },
      { requestId: 'capr_fixed0003', evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(match.outcome).toBe('matched');
    expect(match.composition).not.toBeNull();
    const { record } = await appendResourceDecision([], match, {
      demandId: DEMAND_ID,
      tenantId: 'tenant-a',
      recordedAt: RECORDED_AT,
    });
    expect(record.compositionRefs).toEqual(['tool:local-rate-database', 'artifact:offer-x']);
  });

  it('throws typed errors for invalid options and cross-tenant appends', async () => {
    const { match } = await fixtureMatch();
    await expect(
      appendResourceDecision([], match, {
        demandId: 'BAD ID',
        tenantId: 'tenant-a',
        recordedAt: RECORDED_AT,
      }),
    ).rejects.toBeInstanceOf(CapabilityRoutingError);
    await expect(
      appendResourceDecision([], match, {
        demandId: DEMAND_ID,
        tenantId: 'tenant-b',
        recordedAt: RECORDED_AT,
      }),
    ).rejects.toThrowError(/tenant-scoped/);
    await expect(
      appendResourceDecision([], match, {
        demandId: DEMAND_ID,
        tenantId: 'tenant-a',
        recordedAt: 'not-a-timestamp',
      }),
    ).rejects.toThrowError(/ms-precision UTC/);
    await expect(verifyResourceDecisionChain('nope' as never)).rejects.toBeInstanceOf(
      CapabilityRoutingError,
    );
  });

  it('detects chain tampering (typed TAMPERED)', async () => {
    const { match } = await fixtureMatch();
    const { history } = await appendResourceDecision([], match, {
      demandId: DEMAND_ID,
      tenantId: 'tenant-a',
      recordedAt: RECORDED_AT,
    });
    const tampered = [
      { ...(history[0] as unknown as Record<string, unknown>), matchOutcome: 'no-match' },
    ] as unknown as typeof history;
    await expect(verifyResourceDecisionChain(tampered)).rejects.toThrowError(/digest mismatch/);

    const broken = [
      { ...(history[0] as unknown as Record<string, unknown>), sequence: 7 },
    ] as unknown as typeof history;
    await expect(verifyResourceDecisionChain(broken)).rejects.toThrowError(/not contiguous/);
  });
});
