/**
 * Experiment assembly (Work Order C022): a compilable ImprovementProgram
 * compiles to an A020 Experiment descriptor per the LE1.0 minimum field
 * list, executed through the A020 engine's public ports.
 *
 * The assembly maps EVERY LE1.0 minimum field from the program:
 * experiment id/version; target capability; baseline Body/Model/Runtime;
 * intervention artifacts with their EXPLICIT changed surfaces; the
 * pinned task population; evaluation + verification suite refs;
 * environment versions; outcome metrics; the uncertainty/statistical
 * method; protected capabilities (Q1.0 condition 4); provenance.
 *
 * The descriptor is built through @arena/learning's REAL
 * createExperimentDescriptor — never redefined here — so every A020
 * invariant (REAL A004 capability guard, REAL A009 task-version guard,
 * closed metric directions, surface explicitness) applies unchanged.
 * Assembly is DETERMINISTIC: same program ⇒ same descriptor.
 */

import { createExperimentDescriptor } from '@arena/learning';
import type { CreateExperimentDescriptorInput, ExperimentDescriptor } from '@arena/learning';
import { CAPABILITY_LEARNING_ERROR_CODES, CapabilityLearningError } from './errors.js';
import type { ImprovementProgram } from './program.js';
import { isImprovementProgram } from './program.js';

export interface AssembleExperimentOptions {
  /** The experiment id (deterministic given the program + this id). */
  readonly experimentId: string;
  readonly version?: string;
}

/**
 * Assemble the A020 CreateExperimentDescriptorInput of one program (pure
 * projection; the A020 constructor does the REAL validation).
 */
export function assembleExperimentDescriptorInput(
  program: ImprovementProgram,
  options: AssembleExperimentOptions,
): CreateExperimentDescriptorInput {
  if (!isImprovementProgram(program)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_PROGRAM, {
      message: 'experiment assembly requires a validated ImprovementProgram (use compilePrograms)',
    });
  }
  if (typeof options !== 'object' || options === null || typeof options.experimentId !== 'string' || options.experimentId.length === 0) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_EXPERIMENT, {
      message: 'experiment assembly requires a non-empty experimentId',
    });
  }
  return {
    experimentId: options.experimentId,
    version: options.version ?? '1.0.0',
    targetCapability: { ...program.targetCapability },
    baseline: { ...program.baseline },
    interventions: program.interventions.map((entry) => ({
      artifact: { ...entry.artifact },
      changedSurface: entry.changedSurface,
    })),
    taskPopulation: program.experimentPlan.taskPopulation.map((entry) => ({ ...entry })),
    evaluationSuiteRefs: [...(program.experimentPlan.evaluationSuiteRefs as readonly string[])],
    verificationSuiteRefs: [...(program.experimentPlan.verificationSuiteRefs as readonly string[])],
    environmentVersions: program.experimentPlan.environmentVersions.map((entry) => ({ ...entry })),
    outcomeMetrics: program.experimentPlan.outcomeMetrics.map((entry) => ({ ...entry })),
    uncertainty: { ...program.experimentPlan.uncertainty },
    protectedCapabilities: program.experimentPlan.protectedCapabilities.map((entry) => ({
      ref: { ...entry.ref },
      metricId: entry.metricId,
      direction: entry.direction,
    })),
    provenance: {
      authoredBy: program.provenance.compiledBy as string,
      submittedAt: '1970-01-01T00:00:00.000Z',
      notes: `capability-learning compiler program ${program.programId} (intervention class ${program.interventionClass})`,
    },
  };
}

/**
 * Assemble AND construct the A020 ExperimentDescriptor of one program
 * through @arena/learning's REAL constructor (deterministic; every A020
 * invariant applies). The engine-side provenance timestamp is pinned to
 * the epoch so the descriptor stays byte-deterministic given the
 * program — recorded time lives on the run record, not the declaration.
 */
export async function assembleProgramExperiment(
  program: ImprovementProgram,
  options: AssembleExperimentOptions,
): Promise<ExperimentDescriptor> {
  const input = assembleExperimentDescriptorInput(program, options);
  return createExperimentDescriptor(input);
}
