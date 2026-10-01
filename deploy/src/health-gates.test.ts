/**
 * DEP1.0 health-gate tests: resolution + evaluation, positive and
 * adversarial (the fail-closed wiring to A035 SLOs).
 */

import { describe, expect, it } from 'vitest';
import type { SloEvaluation } from '@arena/observability';
import { toObservabilityTimestamp, toTelemetryId } from '@arena/observability';
import { DEPLOY_ERROR_CODES, DeployError } from './shared.js';
import {
  evaluateHealthGates,
  resolveHealthGates,
  allHealthGatesPassed,
} from './health-gates.js';
import { ARENA_V1_SLO_CATALOG } from './slo-catalog.js';
import { buildReferenceProductionTopology } from './reference.js';
import type { DeploymentTopology, HealthGate } from './model.js';

function minimalTopology(healthGates: readonly HealthGate[]): DeploymentTopology {
  return {
    topologyVersion: 1,
    topologyId: 'topo-gates',
    tier: 'production',
    services: [
      {
        serviceId: 'console',
        imageDigest: 'b'.repeat(64),
        replicas: 2,
        resources: { cpuCores: 2, memoryMb: 4096, maxConcurrentRuns: 8 },
        healthGates,
        securityGates: [],
      },
    ],
    authoredBy: 'arena-release-engineering',
    createdAt: 1_791_232_000_000,
  };
}

function evaluationFor(sloId: string, verdict: SloEvaluation['verdict']): SloEvaluation {
  return {
    sloId: toTelemetryId(sloId),
    windowStart: toObservabilityTimestamp(0),
    windowEnd: toObservabilityTimestamp(3_600_000),
    sampleCount: 120,
    goodCount: 120,
    badCount: 0,
    achievedRatio: 1,
    targetRatio: 0.995,
    errorBudget: {
      allowedBadRatio: 0.005,
      observedBadRatio: 0,
      consumedRatio: 0,
      remainingRatio: 1,
      exhausted: false,
    },
    verdict,
  };
}

describe('health-gate resolution — positive', () => {
  it('resolves every reference gate against the A035 catalog', async () => {
    const topology = await buildReferenceProductionTopology();
    const resolved = resolveHealthGates(topology, ARENA_V1_SLO_CATALOG);
    expect(resolved.length).toBe(8); // every A035 SLO wired exactly once
    for (const entry of resolved) {
      expect(entry.slo.service).toBe(entry.serviceId);
    }
  });
});

describe('health-gate resolution — adversarial (fail-closed)', () => {
  it('rejects a gate wired to an unknown SLO id', () => {
    const topology = minimalTopology([
      { gateId: 'gate-console-x', sloId: 'slo-does-not-exist', requiredVerdict: 'met', policy: 'fail-closed' },
    ]);
    expect(() => resolveHealthGates(topology, ARENA_V1_SLO_CATALOG)).toThrow(DeployError);
    try {
      resolveHealthGates(topology, ARENA_V1_SLO_CATALOG);
    } catch (error) {
      expect((error as DeployError).code).toBe(DEPLOY_ERROR_CODES.UNKNOWN_SLO);
    }
  });

  it('rejects a gate whose service does not own the SLO (mis-wiring)', () => {
    const topology = minimalTopology([
      { gateId: 'gate-console-x', sloId: 'slo-job-completion', requiredVerdict: 'met', policy: 'fail-closed' },
    ]);
    try {
      resolveHealthGates(topology, ARENA_V1_SLO_CATALOG);
      expect.unreachable('mis-wired gate must throw');
    } catch (error) {
      expect((error as DeployError).code).toBe(DEPLOY_ERROR_CODES.SLO_SERVICE_MISMATCH);
    }
  });

  it('rejects a production service with NO health gate (missing-gate fail-closed)', () => {
    const topology = minimalTopology([]);
    try {
      resolveHealthGates(topology, ARENA_V1_SLO_CATALOG);
      expect.unreachable('gateless production service must throw');
    } catch (error) {
      expect((error as DeployError).code).toBe(DEPLOY_ERROR_CODES.MISSING_HEALTH_GATE);
    }
  });
});

describe('health-gate evaluation — positive + adversarial', () => {
  const gate = [{ gateId: 'gate-console-availability', sloId: 'slo-console-availability', requiredVerdict: 'met' as const, policy: 'fail-closed' as const }];
  const topology = minimalTopology(gate);

  it('passes when the A035 verdict is met', () => {
    const evaluations = evaluateHealthGates(topology, [evaluationFor('slo-console-availability', 'met')]);
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]?.passed).toBe(true);
    expect(allHealthGatesPassed(topology, evaluations)).toBe(true);
  });

  it('fails closed when the SLO verdict is breached (SLO-violating release rejected)', () => {
    const evaluations = evaluateHealthGates(topology, [evaluationFor('slo-console-availability', 'breached')]);
    expect(evaluations[0]?.passed).toBe(false);
    expect(allHealthGatesPassed(topology, evaluations)).toBe(false);
  });

  it('fails closed when the SLO verdict is at-risk (budget burn blocks promotion)', () => {
    const evaluations = evaluateHealthGates(topology, [evaluationFor('slo-console-availability', 'at-risk')]);
    expect(evaluations[0]?.passed).toBe(false);
  });

  it('fails closed on no-data: missing telemetry is an incident, not a pass (A035 policy 3)', () => {
    const evaluations = evaluateHealthGates(topology, []);
    expect(evaluations[0]?.observedVerdict).toBe('no-data');
    expect(evaluations[0]?.passed).toBe(false);
  });
});
