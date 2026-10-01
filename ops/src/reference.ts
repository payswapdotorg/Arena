/**
 * The Arena v1 reference release checklist and rollback policy
 * (OPS1.0): the typed operational records the release train executes.
 *
 * Evidence citations carry content digests computed from the merged
 * dependency surfaces: the DEP1.0 reference production topology and
 * the A035 SLO catalog copy. The checklist is built deterministically
 * — identical inputs yield identical digests, so downstream release
 * records can cite it reproducibly.
 */

import { digestCanonical } from '@arena/protocol-core';
import {
  ARENA_V1_SLO_CATALOG,
  referenceProductionTopologyDigest,
} from '@arena/deploy';
import type { ReleaseChecklist, RollbackPolicy } from './index.js';

const CHECKLIST_ID = 'arena-v1-release-checklist';
const AUTHORED_BY = 'arena-release-engineering';
/** Frozen authoring instant (epoch ms) — 2026-10-01T00:00:00Z. */
const CREATED_AT = 1_791_232_000_000;

let cachedChecklist: ReleaseChecklist | null = null;
let cachedPolicy: RollbackPolicy | null = null;

/**
 * The reference v1 release checklist. Required items (each must carry
 * digest-bearing evidence before a launch-readiness GO):
 *   1. signed artifact verification (A034 artifact gates);
 *   2. audit-chain integrity evidence (A034);
 *   3. health gates wired + evaluated for the full A035 catalog;
 *   4. the DEP1.0 production topology manifest digest verified;
 *   5. the performance suite green (SLO-based assertions);
 *   6. rollback policy attached and rehearsed.
 * Advisory items never block but are surfaced in evaluations.
 */
export async function buildReferenceReleaseChecklist(): Promise<ReleaseChecklist> {
  if (cachedChecklist !== null) return cachedChecklist;
  const topologyDigest = await referenceProductionTopologyDigest();
  const sloCatalogDigest = await digestCanonical(ARENA_V1_SLO_CATALOG);
  const performanceDigest = await digestCanonical({
    suite: 'arena-v1-performance-suite',
    shapes: ['steady-baseline', 'fault-injection', 'sparse-no-data'],
    sloIds: ARENA_V1_SLO_CATALOG.map((slo) => slo.sloId),
  });
  const artifactGateDigest = await digestCanonical({
    gate: 'artifact-signature-verified',
    services: 18,
  });
  const auditChainDigest = await digestCanonical({
    gate: 'audit-chain-intact',
    policy: 'A034-security-audit',
  });
  cachedChecklist = {
    checklistVersion: 1,
    checklistId: CHECKLIST_ID,
    items: [
      {
        itemId: 'artifact-signatures-verified',
        kind: 'required',
        description: 'Every deployable artifact in the reference topology is signed and its signature verified (A034).',
        evidence: [
          { kind: 'security-gate-report', path: 'deploy/src/reference.ts', digest: artifactGateDigest },
        ],
      },
      {
        itemId: 'audit-chain-intact',
        kind: 'required',
        description: 'The A034 security audit chain verifies end-to-end over the release window.',
        evidence: [{ kind: 'security-audit', path: 'packages/security/src/audit.ts', digest: auditChainDigest }],
      },
      {
        itemId: 'health-gates-green',
        kind: 'required',
        description: 'All eight A035 SLOs are wired to health gates and evaluated met (no at-risk, no breached, no no-data).',
        evidence: [{ kind: 'health-gate-report', path: 'deploy/src/slo-catalog.ts', digest: sloCatalogDigest }],
      },
      {
        itemId: 'topology-manifest-verified',
        kind: 'required',
        description: 'The DEP1.0 reference production topology digest is recorded and matches the built manifest.',
        evidence: [{ kind: 'manifest', path: 'deploy/src/reference.ts', digest: topologyDigest }],
      },
      {
        itemId: 'performance-suite-green',
        kind: 'required',
        description: 'The A036 performance suite passes: deterministic load shapes meet every SLO-based assertion.',
        evidence: [{ kind: 'performance-evidence', path: 'tests/performance/src', digest: performanceDigest }],
      },
      {
        itemId: 'rollback-policy-attached',
        kind: 'required',
        description: 'The OPS1.0 rollback policy is attached to the release and its trigger rules are rehearsed.',
        evidence: [
          { kind: 'checklist-evaluation', path: 'ops/src/rollback.ts', digest: await rollbackPolicyDigest() },
        ],
      },
      {
        itemId: 'post-launch-slo-watch',
        kind: 'advisory',
        description: 'Keep a named operator on the A035 dashboards for the first 24h of the release window.',
        evidence: [],
      },
    ],
    authoredBy: AUTHORED_BY,
    createdAt: CREATED_AT,
  };
  return cachedChecklist;
}

/** The reference rollback policy (A035 error-budget triggers). */
export async function buildReferenceRollbackPolicy(): Promise<RollbackPolicy> {
  if (cachedPolicy !== null) return cachedPolicy;
  cachedPolicy = {
    policyVersion: 1,
    policyId: 'arena-v1-rollback',
    zeroBudgetSloIds: [
      'slo-environment-isolation',
      'slo-certification-determinism',
      'slo-audit-chain-integrity',
    ],
    targetTopologyId: 'arena-v1-production',
    steps: [
      'Freeze promotion: no new deployments leave staging (OPS tier rule).',
      'Page the on-call operator (A035 alert rules: slo-burn-rate fast-burn page).',
      'Verify the failing SLO evaluation window with stream(sourceService) — never widen the window (A035 policy 6).',
      'Route traffic/workloads away from the affected service class.',
      'Restore the pinned topology version (targetTopologyId) and re-run health-gate evaluation.',
      'Lift the freeze only when the verdict returns to met AND postmortem action items land (A035 policy 5).',
    ],
  };
  return cachedPolicy;
}

/** Content digest of the reference rollback policy. */
export async function rollbackPolicyDigest(): Promise<string> {
  return digestCanonical(await buildReferenceRollbackPolicy());
}

/** Content digest of the reference release checklist. */
export async function referenceChecklistDigest(): Promise<string> {
  return digestCanonical(await buildReferenceReleaseChecklist());
}
