/**
 * Health-gate resolution and evaluation (DEP1.0, wired to A035).
 *
 * Rules (fail-closed, mirroring A035 semantics):
 *   - every health gate's `sloId` MUST resolve in the SLO catalog —
 *     unknown ids are wiring errors and REJECT the topology;
 *   - the gate's owning service MUST match the SLO's service;
 *   - in `production` tier, every service MUST declare at least one
 *     health gate — a service without a gate fails closed
 *     (DEP_MISSING_HEALTH_GATE);
 *   - evaluation: a gate PASSES only when the A035 SLO verdict equals
 *     the gate's `requiredVerdict` ('met'). 'no-data' NEVER passes —
 *     missing telemetry is an incident, not a pass (A035 policy 3);
 *   - 'fail-open' gates are recorded but do not block; production
 *     reference topologies never use them (asserted by tests).
 */

import type { SloDefinition, SloEvaluation, SloVerdict } from '@arena/observability';
import { isSloVerdict } from '@arena/observability';
import {
  DEPLOY_ERROR_CODES,
  DeployError,
  isDigestHex,
} from './shared.js';
import type { DeploymentTopology, HealthGate } from './model.js';

/** The result of resolving + evaluating one health gate. */
export interface HealthGateEvaluation {
  readonly gateId: string;
  readonly sloId: string;
  readonly serviceId: string;
  readonly requiredVerdict: 'met';
  readonly observedVerdict: SloVerdict;
  readonly passed: boolean;
}

/**
 * Validate a topology's health gates against the SLO catalog.
 * Throws fail-closed on unknown sloId, service mismatch, or a
 * production service with no gate at all.
 */
export function resolveHealthGates(
  topology: DeploymentTopology,
  catalog: readonly SloDefinition[],
): readonly { gate: HealthGate; slo: SloDefinition; serviceId: string }[] {
  const resolved: { gate: HealthGate; slo: SloDefinition; serviceId: string }[] = [];
  for (const service of topology.services) {
    for (const gate of service.healthGates) {
      const slo = catalog.find((candidate) => candidate.sloId === gate.sloId);
      if (slo === undefined) {
        throw new DeployError(
          DEPLOY_ERROR_CODES.UNKNOWN_SLO,
          `health gate "${gate.gateId}" references unknown sloId "${gate.sloId}"`,
        );
      }
      if (slo.service !== service.serviceId) {
        throw new DeployError(
          DEPLOY_ERROR_CODES.SLO_SERVICE_MISMATCH,
          `health gate "${gate.gateId}" on service "${service.serviceId}" references SLO "${gate.sloId}" owned by "${slo.service}"`,
        );
      }
      resolved.push({ gate, slo, serviceId: service.serviceId });
    }
  }
  if (topology.tier === 'production') {
    // Production fail-closed coverage rule: EVERY catalog SLO must be
    // wired by exactly one gate — an unwired SLO is a missing health
    // gate, not a pass (mirrors A035 no-data policy).
    const wired = new Set(resolved.map((entry) => entry.gate.sloId));
    const missing = catalog.filter((slo) => !wired.has(slo.sloId)).map((slo) => slo.sloId);
    if (missing.length > 0) {
      throw new DeployError(
        DEPLOY_ERROR_CODES.MISSING_HEALTH_GATE,
        `production topology does not wire health gates for: ${missing.join(', ')}`,
      );
    }
  }
  return resolved;
}

/**
 * Evaluate every health gate of a topology from A035 SLO evaluations.
 * Gates whose SLO has no evaluation in the input FAIL CLOSED
 * (no-data), matching A035 policy: missing telemetry is never a pass.
 */
export function evaluateHealthGates(
  topology: DeploymentTopology,
  sloEvaluations: readonly SloEvaluation[],
): readonly HealthGateEvaluation[] {
  const bySlo = new Map<string, SloEvaluation>();
  for (const evaluation of sloEvaluations) {
    if (!isSloVerdict(evaluation.verdict)) {
      throw new DeployError(
        DEPLOY_ERROR_CODES.GATE_FAILED,
        `malformed SLO evaluation for "${evaluation.sloId}"`,
      );
    }
    bySlo.set(evaluation.sloId, evaluation);
  }
  const results: HealthGateEvaluation[] = [];
  for (const service of topology.services) {
    for (const gate of service.healthGates) {
      const evaluation = bySlo.get(gate.sloId);
      const observed: SloVerdict = evaluation === undefined ? 'no-data' : evaluation.verdict;
      const verdictOk = observed === gate.requiredVerdict;
      // no-data is NEVER a pass, even if a caller flips requiredVerdict.
      const noDataFail = observed === 'no-data' || evaluation === undefined;
      results.push({
        gateId: gate.gateId,
        sloId: gate.sloId,
        serviceId: service.serviceId,
        requiredVerdict: gate.requiredVerdict,
        observedVerdict: observed,
        passed: verdictOk && !noDataFail,
      });
    }
  }
  return results;
}

/** Roll-up: a topology is deployable iff every fail-closed gate passed. */
export function allHealthGatesPassed(
  topology: DeploymentTopology,
  evaluations: readonly HealthGateEvaluation[],
): boolean {
  const gateIds = new Set(
    topology.services.flatMap((service) =>
      service.healthGates.filter((gate) => gate.policy === 'fail-closed').map((gate) => gate.gateId),
    ),
  );
  return evaluations
    .filter((evaluation) => gateIds.has(evaluation.gateId))
    .every((evaluation) => evaluation.passed);
}

/** Minimal digest-citation check for security evidence (A034 wiring). */
export function securityEvidenceDigestsValid(topology: DeploymentTopology): boolean {
  return topology.services.every((service) =>
    service.securityGates.every((gate) => isDigestHex(gate.evidenceDigest)),
  );
}
