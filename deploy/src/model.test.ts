/**
 * DEP1.0 model tests: positive validation + adversarial rejection.
 */

import { describe, expect, it } from 'vitest';
import { digestCanonical } from '@arena/protocol-core';
import { DEPLOYMENT_SCHEMA_VERSION, DEPLOY_ERROR_CODES, DeployError } from './shared.js';
import {
  isDeploymentTopology,
  isServiceDeployment,
  toDeploymentTopology,
} from './model.js';
import type { DeploymentTopology, ServiceDeployment } from './model.js';

const IMAGE_DIGEST = await digestCanonical({ artifact: 'api@arena-v1.0.0' });
const EVIDENCE_DIGEST = await digestCanonical({ signedEvidence: 'artifact-signature-verified' });

const BASE_SERVICE: ServiceDeployment = {
  serviceId: 'api',
  imageDigest: IMAGE_DIGEST,
  replicas: 3,
  resources: { cpuCores: 4, memoryMb: 8192, maxConcurrentRuns: 64 },
  healthGates: [{ gateId: 'gate-api-x', sloId: 'slo-console-availability', requiredVerdict: 'met', policy: 'fail-closed' }],
  securityGates: [{ gateId: 'sec-api-x', kind: 'artifact-signature-verified', evidenceDigest: EVIDENCE_DIGEST }],
};

function topologyFor(tier: DeploymentTopology['tier'], services: readonly ServiceDeployment[]): DeploymentTopology {
  return {
    topologyVersion: DEPLOYMENT_SCHEMA_VERSION,
    topologyId: 'topo-test',
    tier,
    services,
    authoredBy: 'arena-release-engineering',
    createdAt: 1_791_232_000_000,
  };
}

describe('DEP1.0 model — positive', () => {
  it('accepts a structurally valid topology (isDeploymentTopology)', () => {
    const topology = topologyFor('dev', [BASE_SERVICE]);
    expect(isDeploymentTopology(topology)).toBe(true);
    expect(isServiceDeployment(BASE_SERVICE)).toBe(true);
  });

  it('toDeploymentTopology returns the frozen record unchanged (identity)', () => {
    const topology = topologyFor('dev', [BASE_SERVICE]);
    expect(toDeploymentTopology(topology)).toBe(topology);
  });

  it('a dev-tier service with no health gate is legal (gates only forced in production)', () => {
    const ungated: ServiceDeployment = { ...BASE_SERVICE, healthGates: [] };
    expect(isDeploymentTopology(topologyFor('dev', [ungated]))).toBe(true);
  });
});

describe('DEP1.0 model — adversarial (fail-closed)', () => {
  it('rejects a topology with an unsigned (non-digest) image artifact', () => {
    const unsigned: ServiceDeployment = { ...BASE_SERVICE, imageDigest: 'not-a-digest' };
    expect(isServiceDeployment(unsigned)).toBe(false);
  });

  it('rejects a security gate with unverified (non-digest) evidence', () => {
    const unverified: ServiceDeployment = {
      ...BASE_SERVICE,
      securityGates: [{ gateId: 'sec-api-x', kind: 'audit-chain-intact', evidenceDigest: 'deadbeef' }],
    };
    expect(isServiceDeployment(unverified)).toBe(false);
  });

  it('rejects wrong schema version (version discipline)', () => {
    const bad = { ...topologyFor('dev', [BASE_SERVICE]), topologyVersion: 2 };
    expect(isDeploymentTopology(bad)).toBe(false);
  });

  it('rejects zero replicas and non-integer resources', () => {
    expect(isServiceDeployment({ ...BASE_SERVICE, replicas: 0 })).toBe(false);
    expect(
      isServiceDeployment({
        ...BASE_SERVICE,
        resources: { cpuCores: 1.5, memoryMb: 8192, maxConcurrentRuns: 1 },
      }),
    ).toBe(false);
  });

  it('rejects an unknown tier and an empty service graph', () => {
    expect(isDeploymentTopology(topologyFor('prod' as DeploymentTopology['tier'], [BASE_SERVICE]))).toBe(false);
    expect(isDeploymentTopology(topologyFor('dev', []))).toBe(false);
  });

  it('toDeploymentTopology rejects duplicate service ids (typed error)', () => {
    const duplicated = topologyFor('dev', [BASE_SERVICE, { ...BASE_SERVICE, healthGates: [] }]);
    expect(() => toDeploymentTopology(duplicated)).toThrow(DeployError);
    try {
      toDeploymentTopology(duplicated);
    } catch (error) {
      expect((error as DeployError).code).toBe(DEPLOY_ERROR_CODES.INVALID_TOPOLOGY);
    }
  });
});
