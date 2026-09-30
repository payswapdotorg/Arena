/**
 * The SE Repair Benchmark definition assembly (Work Order A030): the
 * published methodology, criteria-suite variants, the public
 * definition dataset and the citable BenchmarkDescriptor -- all built
 * through the merged dependency fabrics.
 */

import { createScoringMethodology } from '@arena/research';
import type { ScoringMethodology } from '@arena/research';
import { createResearchDataset } from '@arena/research';
import type { DatasetManifest } from '@arena/datasets';
import type { MaterialArtifact } from '@arena/artifact-protocol';
import { BENCH, CONTAMINATION_POLICY, KNOWN_LIMITATIONS } from './shared.js';

/** The primary (weighted-sum) scoring methodology of the benchmark. */
export async function seRepairMethodology(): Promise<ScoringMethodology> {
  return createScoringMethodology({
    methodologyId: BENCH.methodologyId,
    version: BENCH.methodologyVersion,
    aggregation: 'weighted-sum',
    passAt: 0.75,
    tieBreaking: 'digest-asc',
    knownLimitations: KNOWN_LIMITATIONS,
    contaminationPolicy: CONTAMINATION_POLICY,
    provenance: {
      authoredBy: 'arena-research',
      submittedAt: BENCH.t0,
      notes: 'A030 reference benchmark methodology over the A012 weighted-sum aggregation',
    },
  });
}

/** The secondary (rubric-level) methodology variant. */
export async function seRepairRubricMethodology(): Promise<ScoringMethodology> {
  return createScoringMethodology({
    methodologyId: BENCH.rubricMethodologyId,
    version: BENCH.methodologyVersion,
    aggregation: 'rubric-level',
    passAt: 4,
    tieBreaking: 'digest-asc',
    knownLimitations: KNOWN_LIMITATIONS,
    contaminationPolicy: CONTAMINATION_POLICY,
    provenance: {
      authoredBy: 'arena-research',
      submittedAt: BENCH.t0,
      notes: 'A030 rubric-level variant: minimum achieved level across criteria, bar at level 4',
    },
  });
}

/** The public benchmark-definition dataset (A014 packaging, public namespace). */
export async function seRepairDefinitionDataset(
  methodology: ScoringMethodology,
  rubricMethodology: ScoringMethodology,
): Promise<{ manifest: DatasetManifest; artifacts: readonly MaterialArtifact[] }> {
  const { manifest, artifacts } = await createResearchDataset({
    name: BENCH.datasetName,
    version: BENCH.datasetVersion,
    entries: [
      {
        role: 'eval',
        name: 'scoring-methodology-se-repair',
        version: BENCH.methodologyVersion,
        content: { methodology: methodologyViewOf(methodology) },
      },
      {
        role: 'eval',
        name: 'scoring-methodology-se-repair-rubric',
        version: BENCH.methodologyVersion,
        content: { methodology: methodologyViewOf(rubricMethodology) },
      },
      {
        role: 'input',
        name: 'scenario-se-repair-reference',
        version: '1.0.0',
        content: {
          scenario: 'the A028 reference repair scenario (failing test suite reproduced, repaired, verified)',
          body: 'software-engineer reference body v1.0.0 + v1.1.0',
          environment: 'software-engineer-sandbox',
          criteriaSuite: 'criteria-se-test-repair@1.0.0 (three weighted criteria, pass at 0.75)',
        },
      },
      {
        role: 'split',
        name: 'population-se-repair-v1',
        version: '1.0.0',
        content: { scenarioCount: 1, seedPolicy: 'fixed-seed', seed: BENCH.seed },
      },
    ],
    notes: 'A030 public benchmark definition dataset',
    createdAt: BENCH.t0,
    creatorId: 'arena-research',
  });
  return { manifest, artifacts };
}

function methodologyViewOf(methodology: ScoringMethodology): Record<string, unknown> {
  const { digest, ...view } = methodology;
  return { ...view, digest };
}

/** The public results dataset (A014 packaging of recorded result records). */
export async function seRepairResultsDataset(
  entries: readonly { digest: string; result: Record<string, unknown> }[],
): Promise<{ manifest: DatasetManifest; artifacts: readonly MaterialArtifact[] }> {
  if (entries.length === 0) {
    throw new Error('seRepairResultsDataset: at least one recorded result is required');
  }
  return createResearchDataset({
    name: BENCH.resultsDatasetName,
    version: BENCH.resultsDatasetVersion,
    entries: entries.map((entry, index) => ({
      role: 'output' as const,
      name: `result-se-repair-${String(index + 1).padStart(4, '0')}`,
      version: '1.0.0',
      content: { benchmarkResult: entry.result, benchmarkResultDigest: entry.digest },
    })),
    notes: 'A030 public benchmark results dataset (append-only; one entry per recorded run)',
    createdAt: BENCH.t3,
    creatorId: 'arena-research',
  });
}
