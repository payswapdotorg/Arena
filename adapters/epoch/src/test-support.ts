/**
 * Internal test support for the epoch adapter suite (NOT exported from
 * the package index — mirrors the @arena/arena-sdk test-support
 * precedent). Deterministic fixtures + an in-process ArenaQueryHandler
 * wired through the REAL A025 loopback transport, so every adapter read
 * round-trips through genuine envelope construction and strict response
 * validation.
 */

import { createLoopbackTransport, ArenaApiClient } from '@arena/arena-sdk';
import type { ArenaQueryHandler, ApiQueryRequest, ApiQueryResponse } from '@arena/arena-sdk';

export const FIXED_CLOCK = (): string => '2026-01-15T09:30:00.000Z';

const HEX = (char: string): string => char.repeat(64);

export const DIGESTS = Object.freeze({
  targetCapability: HEX('a'),
  domain: HEX('b'),
  evidence: HEX('c'),
  competency: HEX('d'),
  environment: HEX('e'),
  evaluator: HEX('f'),
  verifier: '11'.repeat(32),
  bodyVersion: '22'.repeat(32),
  certification: '33'.repeat(32),
  compatibility: '44'.repeat(32),
});

/** A complete, valid EPI1.0 CapabilityDevelopmentRequest (raw form). */
export function buildEpochRequest(): Record<string, unknown> {
  return {
    requestVersion: 1,
    requestId: 'epoch-req-001',
    requestedAt: '2026-01-15T09:30:00.000Z',
    tenant: 'acme',
    idempotencyKey: 'epoch-key-001',
    correlationId: 'epoch-corr-001',
    causationId: 'epoch-cause-001',
    authorization: {
      authorizationVersion: 1,
      tenant: 'acme',
      principal: 'epoch-orchestrator',
      scopes: ['capability-development'],
    },
    targetReleaseChannel: 'development',
    caseSeed: {
      problemStatement: 'Structural load analysis failed on cantilever review cases',
      context: 'Epoch structural review workflow, EU-region deployment',
      desiredOutcome: 'Cantilever load analysis completes with verified results',
      targetCapability: {
        kind: 'capability',
        id: 'structural-load-analysis',
        version: '1.4.0',
        digest: DIGESTS.targetCapability,
      },
      domain: {
        kind: 'domain',
        id: 'structural-engineering',
        version: '2.0.0',
        digest: DIGESTS.domain,
      },
      observedFailure: {
        summary: 'Load analysis returned incorrect moment diagrams for cantilevers',
        observedAt: '2026-01-15T09:00:00.000Z',
        reproduction: 'Run cantilever review case C-114 through the workflow',
      },
      evidence: [
        {
          digest: DIGESTS.evidence,
          description: 'Failed trajectory record captured by the Epoch run',
        },
      ],
      unknowns: ['Whether the substrate or the body composition is the failure source'],
      priority: 'high',
      risk: 'moderate',
      expertRequirements: {
        competencies: [
          {
            kind: 'expert-competency',
            id: 'structural-analysis',
            version: '1.0.0',
            digest: DIGESTS.competency,
          },
        ],
      },
      environmentRequirements: {
        environments: [
          {
            namespace: 'arena',
            name: 'structural-sim',
            version: '1.0.0',
            digest: DIGESTS.environment,
          },
        ],
      },
      taskRequirements: {
        objectives: ['Reproduce the cantilever analysis failure'],
        successConditions: ['Moment diagram matches the reference solution'],
        evidenceCriteria: ['Verified trajectory evidence of a correct analysis'],
        difficulty: 'standard',
      },
      evaluationRequirements: {
        evaluators: [
          {
            kind: 'evaluator',
            id: 'structural-eval',
            version: '1.0.0',
            digest: DIGESTS.evaluator,
          },
        ],
        criteria: ['Correctness of moment diagrams on cantilever edge cases'],
      },
      verificationRequirements: {
        verifiers: [
          {
            kind: 'verifier',
            id: 'pe-verify',
            version: '1.0.0',
            digest: DIGESTS.verifier,
          },
        ],
        evidenceStandards: ['PE-verified structural evidence'],
      },
    },
    failedTrajectoryRefs: [
      { digest: DIGESTS.evidence, observedAt: '2026-01-15T09:00:00.000Z' },
    ],
    evaluationGaps: [
      {
        capability: 'structural-load-analysis',
        summary: 'Moment diagram evaluation misses cantilever edge cases',
        evidenceDigest: DIGESTS.evidence,
      },
    ],
    requirements: {
      capability: ['structural-load-analysis'],
      domain: ['structural-engineering'],
    },
  };
}

/**
 * An in-process Arena query handler answering every single-record query
 * with not-found (a VALUE, never an error) and every list query with the
 * empty list. Wired through the REAL createLoopbackTransport + a REAL
 * ArenaApiClient, so adapter reads exercise the full A025 envelope
 * discipline (query construction, correlation echo, strict response
 * parsing, deep-freeze).
 */
export function createLoopbackArenaClient(tenant: string): ArenaApiClient {
  const handler: ArenaQueryHandler = {
    async handleQueryRequest(payload: ApiQueryRequest): Promise<ApiQueryResponse> {
      if (payload.kind.startsWith('list-')) {
        return { responseVersion: 1, kind: payload.kind, result: [] };
      }
      return { responseVersion: 1, kind: payload.kind, result: null };
    },
  };
  return ArenaApiClient.forTenant(createLoopbackTransport(handler), tenant);
}

/** A valid EPI1.0 output ref (raw form). */
export function buildOutputRef(
  kind: string,
  digest: string,
  address: string,
): Record<string, unknown> {
  return { refVersion: 1, kind, digest, address };
}
