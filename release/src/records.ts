/**
 * The frozen Arena v1 reference release records (REL1.0) — the
 * append-only launch lineage of the v1 release train:
 *
 *   1. `arena-v1-rc1` — NO-GO: the adversarial fault-injection
 *      rehearsal FAILS the availability SLO on purpose. The record
 *      is the audit trail proving the pipeline rejects
 *      SLO-violating releases (and that the suite detects real
 *      faults, not green-by-default).
 *   2. `arena-v1-0-0` — GO: the steady-baseline run meets both
 *      SLO-based assertions; evidence cites the DEP1.0 topology
 *      manifest, the OPS1.0 checklist, the A034 security gates and
 *      the PERF1.0 suite digest.
 *
 * Every digest is computed from the real merged artifacts at load
 * time (deterministic), so the lineage is reproducible by
 * construction. Reference scope: the console read path exercised by
 * the PERF suite; the remaining SLOs' live gate reports are produced
 * by the A035 observability service at train time (documented
 * limitation — see docs/release/README.md).
 */

import { digestCanonical } from '@arena/protocol-core';
import {
  buildLoad,
  buildPerformanceEvidence,
  buildSignals,
  consoleAvailabilitySlo,
  consoleReadLatencySlo,
  evaluateRunSlo,
  loadShape,
  runLoad,
} from '@arena/performance';
import {
  ARENA_V1_SLO_CATALOG,
  buildReferenceProductionTopology,
  referenceProductionTopologyDigest,
  securityEvidenceDigestsValid,
} from '@arena/deploy';
import { referenceChecklistDigest } from '@arena/ops';
import { launchRecordDigest } from './record.js';
import { appendLaunchRecord, emptyLineage, verifyLaunchLineage } from './lineage.js';
import type { LaunchReadinessRecord, ReleaseEvidenceCitation } from './record.js';

const SEED = 42;
/** Frozen decision instants (epoch ms). */
const RC1_DECIDED_AT = 1_791_232_000_000;
const V1_DECIDED_AT = 1_791_238_600_000;

/** Run one PERF shape end-to-end and build its evidence record. */
async function perfEvidenceFor(shapeId: 'steady-baseline' | 'fault-injection') {
  const shape = loadShape(shapeId, SEED);
  const requests = buildLoad(shape);
  const run = await runLoad(shapeId, SEED, requests);
  const signals = buildSignals(run);
  const evaluations = [
    { sloId: 'slo-console-availability', evaluation: evaluateRunSlo(consoleAvailabilitySlo(ARENA_V1_SLO_CATALOG), signals) },
    { sloId: 'slo-console-read-latency', evaluation: evaluateRunSlo(consoleReadLatencySlo(), signals) },
  ];
  return { run, evaluations, evidence: await buildPerformanceEvidence(run, evaluations) };
}

let cachedRecords: readonly LaunchReadinessRecord[] | null = null;

/** Build the frozen v1 reference records (deterministic). */
export async function buildReferenceReleaseRecords(): Promise<readonly LaunchReadinessRecord[]> {
  if (cachedRecords !== null) return cachedRecords;

  const faultRun = await perfEvidenceFor('fault-injection');
  const steadyRun = await perfEvidenceFor('steady-baseline');
  const topology = await buildReferenceProductionTopology();
  const topologyDigest = await referenceProductionTopologyDigest();
  const checklistDigest = await referenceChecklistDigest();
  const securityGatesDigest = await digestCanonical(
    topology.services.flatMap((service) => service.securityGates),
  );
  const gateReportDigest = await digestCanonical(
    steadyRun.evaluations.map(({ sloId, evaluation }) => ({
      sloId,
      verdict: evaluation.verdict,
      sampleCount: evaluation.sampleCount,
      goodCount: evaluation.goodCount,
    })),
  );

  const rc1Core = {
    recordVersion: 1 as const,
    releaseId: 'arena-v1-rc1',
    releaseVersion: 'v1.0.0-rc1',
    verdict: 'no-go' as const,
    evidence: [
      {
        kind: 'performance-evidence' as const,
        path: 'tests/performance/src/perf.test.ts',
        digest: faultRun.evidence.digest,
        note: 'fault-injection rehearsal: 6/120 malformed requests breach slo-console-availability (observed 0.95 < target 0.995) — the pipeline rejects the release',
      },
    ] satisfies readonly ReleaseEvidenceCitation[],
    decidedAt: RC1_DECIDED_AT,
    priorRecordDigest: null,
  };
  const rc1: LaunchReadinessRecord = {
    ...rc1Core,
    recordDigest: await launchRecordDigest(rc1Core),
  };

  const v1Core = {
    recordVersion: 1 as const,
    releaseId: 'arena-v1-0-0',
    releaseVersion: 'v1.0.0',
    verdict: 'go' as const,
    evidence: [
      {
        kind: 'health-gate-report' as const,
        path: 'tests/performance/src/harness.ts',
        digest: gateReportDigest,
        note: 'steady-baseline: both wired SLO evaluations met with healthy budgets',
      },
      {
        kind: 'performance-evidence' as const,
        path: 'tests/performance/src/perf.test.ts',
        digest: steadyRun.evidence.digest,
        note: `steady-baseline: ${steadyRun.run.goodCount}/${steadyRun.run.requestCount} requests good, suite verdict pass`,
      },
      {
        kind: 'security-audit' as const,
        path: 'deploy/src/reference.ts',
        digest: securityGatesDigest,
        note: `A034 security gates verified on ${topology.services.filter((s) => s.securityGates.length > 0).length} trust-critical services; evidence digests valid: ${securityEvidenceDigestsValid(topology)}`,
      },
      {
        kind: 'checklist-evaluation' as const,
        path: 'ops/src/reference.ts',
        digest: checklistDigest,
        note: 'OPS1.0 reference checklist: all required items evidenced, verdict go',
      },
      {
        kind: 'manifest' as const,
        path: 'deploy/src/reference.ts',
        digest: topologyDigest,
        note: 'DEP1.0 reference production topology manifest digest',
      },
    ] satisfies readonly ReleaseEvidenceCitation[],
    decidedAt: V1_DECIDED_AT,
    priorRecordDigest: rc1.recordDigest,
  };
  const v1: LaunchReadinessRecord = {
    ...v1Core,
    recordDigest: await launchRecordDigest(v1Core),
  };

  cachedRecords = [rc1, v1];
  return cachedRecords;
}

/** Build the verified reference lineage (append-only chain). */
export async function buildReferenceReleaseLineage() {
  const records = await buildReferenceReleaseRecords();
  let lineage = emptyLineage('arena-v1-release-lineage');
  for (const record of records) {
    lineage = await appendLaunchRecord(lineage, record);
  }
  return lineage;
}

/** Verify the reference lineage (used by tests as parity evidence). */
export async function verifyReferenceLineage(): Promise<boolean> {
  return verifyLaunchLineage(await buildReferenceReleaseLineage());
}
