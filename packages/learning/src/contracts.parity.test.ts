/**
 * Contract parity tests - bind the generated contracts
 * (contracts/learning/*.json, produced by
 * packages/learning/scripts/generate-contracts.mjs) to the
 * TypeScript surface of @arena/learning.
 *
 * If someone edits the TS constants without regenerating contracts (or
 * vice versa), these tests fail - and the drift suite (drift.test.ts)
 * fails when the committed JSON no longer matches the generator. Two
 * independent tripwires for contract drift, exactly like the
 * A001/A009/A011/A012 convention.
 */

import { describe, expect, it } from 'vitest';
import experimentDescriptorSchema from '../../../contracts/learning/experiment-descriptor.v1.json' with { type: 'json' };
import interventionSchema from '../../../contracts/learning/intervention.v1.json' with { type: 'json' };
import runRecordSchema from '../../../contracts/learning/experiment-run-record.v1.json' with { type: 'json' };
import attributionSchema from '../../../contracts/learning/attribution-result.v1.json' with { type: 'json' };
import verdictSchema from '../../../contracts/learning/capability-lift-verdict.v1.json' with { type: 'json' };
import calibrationSchema from '../../../contracts/learning/calibration-record.v1.json' with { type: 'json' };
import runCommandSchema from '../../../contracts/learning/run-experiment-command.v1.json' with { type: 'json' };
import completedEventSchema from '../../../contracts/learning/experiment-completed-event.v1.json' with { type: 'json' };
import schemaRegistrySchema from '../../../contracts/learning/learning-schema-registry.v1.json' with { type: 'json' };

import {
  CONTENT_DIGEST_PATTERN_SOURCE,
  LEARNING_ID_PATTERN_SOURCE,
  LEARNING_TIMESTAMP_PATTERN_SOURCE,
  LEARNING_VERSION_PATTERN_SOURCE,
  NEUTRAL_TEXT_PATTERN_SOURCE,
  ARTIFACT_NAMESPACE_PATTERN_SOURCE,
  ARTIFACT_NAME_PATTERN_SOURCE,
} from './shared.js';
import {
  BASELINE_COMPOSITION_FIELDS,
  ENVIRONMENT_VERSION_REF_FIELDS,
  EXPERIMENT_DESCRIPTOR_FIELDS,
  EXPERIMENT_PROVENANCE_FIELDS,
  INTERVENTION_ARTIFACT_FIELDS,
  ARTIFACT_REF_FIELDS,
  OUTCOME_METRIC_DECLARATION_FIELDS,
  PROTECTED_CAPABILITY_DECLARATION_FIELDS,
  UNCERTAINTY_DECLARATION_FIELDS,
  METRIC_DIRECTIONS,
  UNCERTAINTY_METHODS,
} from './descriptor.js';
import {
  ARM_RUN_REFS_FIELDS,
  EXPERIMENT_RUN_RECORD_FIELDS,
  RUN_PROVENANCE_FIELDS,
} from './run-record.js';
import {
  METRIC_COMPARISON_FIELDS,
  METRIC_MEASUREMENT_FIELDS,
  PROTECTED_CAPABILITY_CHECK_FIELDS,
  UNCERTAINTY_REPORT_FIELDS,
  UNCERTAINTY_REPORT_ENTRY_FIELDS,
} from './comparison.js';
import {
  ATTRIBUTION_RESULT_FIELDS,
  ATTRIBUTION_FINDING_FIELDS,
} from './attribution.js';
import { ATTRIBUTION_CONFOUNDS, ATTRIBUTION_FINDING_STATUSES, ATTRIBUTION_SOURCES } from './attribution-source.js';
import { CAPABILITY_LIFT_VERDICTS, LIFT_CONDITION_FIELDS } from './verdict.js';
import { CALIBRATION_RECORD_FIELDS, OBSERVED_OUTCOMES } from './calibration.js';
import { INTERVENTION_SURFACES } from './intervention-surface.js';
import { LEARNING_SCHEMAS, LEARNING_SCHEMA_VERSION, learningSchemaRef } from './envelopes.js';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

describe('generated contract parity - learning-protocol', () => {
  it('every contract is draft 2020-12 with a versioned SchemaRef $id', () => {
    const contracts = [
      experimentDescriptorSchema,
      interventionSchema,
      runRecordSchema,
      attributionSchema,
      verdictSchema,
      calibrationSchema,
      runCommandSchema,
      completedEventSchema,
      schemaRegistrySchema,
    ];
    expect(contracts).toHaveLength(9);
    for (const contract of contracts) {
      expect(contract['$schema']).toBe(DRAFT);
      expect(String(contract['$id'])).toMatch(/^arena:schema\/learning\/[a-z0-9-]+@1\.0\.0$/);
    }
  });

  it('the experiment-descriptor contract mirrors the TS field list, surfaces and patterns', () => {
    expect(experimentDescriptorSchema.additionalProperties).toBe(false);
    expect(sorted(experimentDescriptorSchema.required as string[])).toEqual(
      sorted([...EXPERIMENT_DESCRIPTOR_FIELDS, 'digest']),
    );
    expect(experimentDescriptorSchema.properties.recordVersion.const).toBe(1);
    expect(experimentDescriptorSchema.properties.experimentId.pattern).toBe(LEARNING_ID_PATTERN_SOURCE);
    expect(experimentDescriptorSchema.properties.version.pattern).toBe(LEARNING_VERSION_PATTERN_SOURCE);
    expect(experimentDescriptorSchema.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    // baseline mirrors BASELINE_COMPOSITION_FIELDS
    expect(sorted(Object.keys(experimentDescriptorSchema.properties.baseline.properties))).toEqual(
      sorted([...BASELINE_COMPOSITION_FIELDS]),
    );
    // interventions mirror the closed surface vocabulary
    expect(experimentDescriptorSchema.properties.interventions.minItems).toBe(1);
    expect(experimentDescriptorSchema.$defs.interventionArtifact.properties.changedSurface.enum).toEqual([
      ...INTERVENTION_SURFACES,
    ]);
    expect(sorted(Object.keys(experimentDescriptorSchema.$defs.interventionArtifact.properties))).toEqual(
      sorted([...INTERVENTION_ARTIFACT_FIELDS]),
    );
    // artifact ref mirrors ARTIFACT_REF_FIELDS + patterns
    expect(sorted(Object.keys(experimentDescriptorSchema.$defs.artifactRef.properties))).toEqual(
      sorted([...ARTIFACT_REF_FIELDS]),
    );
    expect(experimentDescriptorSchema.$defs.artifactRef.properties.namespace.pattern).toBe(
      ARTIFACT_NAMESPACE_PATTERN_SOURCE,
    );
    expect(experimentDescriptorSchema.$defs.artifactRef.properties.name.pattern).toBe(
      ARTIFACT_NAME_PATTERN_SOURCE,
    );
    // task population mirrors the A009 shape
    expect(experimentDescriptorSchema.properties.taskPopulation.minItems).toBe(1);
    expect(sorted(Object.keys(experimentDescriptorSchema.$defs.taskVersionRef.properties))).toEqual(
      sorted(['taskId', 'version']),
    );
    // evaluation/verification suites are digest arrays
    expect(experimentDescriptorSchema.properties.evaluationSuiteRefs.items.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
    expect(experimentDescriptorSchema.properties.verificationSuiteRefs.items.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
    // environment versions mirror ENVIRONMENT_VERSION_REF_FIELDS
    expect(experimentDescriptorSchema.properties.environmentVersions.items.$ref).toBe(
      '#/$defs/artifactRef',
    );
    expect(sorted(ENVIRONMENT_VERSION_REF_FIELDS)).toEqual(sorted([...ARTIFACT_REF_FIELDS]));
    // outcome metrics mirror the declarations + closed directions
    expect(sorted(Object.keys(experimentDescriptorSchema.$defs.metricDeclaration.properties))).toEqual(
      sorted([...OUTCOME_METRIC_DECLARATION_FIELDS]),
    );
    expect(experimentDescriptorSchema.$defs.metricDeclaration.properties.direction.enum).toEqual([
      ...METRIC_DIRECTIONS,
    ]);
    // uncertainty mirrors the declarations + closed methods
    expect(sorted(Object.keys(experimentDescriptorSchema.properties.uncertainty.properties))).toEqual(
      sorted([...UNCERTAINTY_DECLARATION_FIELDS]),
    );
    expect(experimentDescriptorSchema.properties.uncertainty.properties.method.enum).toEqual([
      ...UNCERTAINTY_METHODS,
    ]);
    // protected capabilities mirror the declarations
    expect(sorted(Object.keys(experimentDescriptorSchema.$defs.protectedCapability.properties))).toEqual(
      sorted([...PROTECTED_CAPABILITY_DECLARATION_FIELDS]),
    );
    // provenance mirrors EXPERIMENT_PROVENANCE_FIELDS
    expect(sorted(Object.keys(experimentDescriptorSchema.$defs.descriptorProvenance.properties))).toEqual(
      sorted([...EXPERIMENT_PROVENANCE_FIELDS]),
    );
    expect(experimentDescriptorSchema.$defs.descriptorProvenance.properties.submittedAt.pattern).toBe(
      LEARNING_TIMESTAMP_PATTERN_SOURCE,
    );
    // the capability node ref mirrors the A004 shape
    expect(sorted(Object.keys(experimentDescriptorSchema.$defs.capabilityNodeRef.properties))).toEqual(
      sorted(['kind', 'id', 'version', 'digest']),
    );
  });

  it('the intervention contract mirrors the intervention artifact shape', () => {
    expect(interventionSchema.additionalProperties).toBe(false);
    expect(sorted(interventionSchema.required as string[])).toEqual(
      sorted([...INTERVENTION_ARTIFACT_FIELDS]),
    );
    expect(interventionSchema.properties.changedSurface.enum).toEqual([...INTERVENTION_SURFACES]);
  });

  it('the run-record contract mirrors the TS field lists and comparison shapes', () => {
    expect(runRecordSchema.additionalProperties).toBe(false);
    expect(sorted(runRecordSchema.required as string[])).toEqual(
      sorted([...EXPERIMENT_RUN_RECORD_FIELDS, 'digest']),
    );
    expect(runRecordSchema.properties.recordVersion.const).toBe(1);
    expect(runRecordSchema.properties.descriptorRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    // arm run refs mirror ARM_RUN_REFS_FIELDS
    expect(sorted(Object.keys(runRecordSchema.$defs.armRunRefs.properties))).toEqual(
      sorted([...ARM_RUN_REFS_FIELDS]),
    );
    expect(runRecordSchema.$defs.armRunRefs.properties.trajectories.items.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
    // metric measurements mirror METRIC_MEASUREMENT_FIELDS
    expect(sorted(Object.keys(runRecordSchema.$defs.metricMeasurement.properties))).toEqual(
      sorted([...METRIC_MEASUREMENT_FIELDS]),
    );
    // comparisons mirror METRIC_COMPARISON_FIELDS
    expect(sorted(Object.keys(runRecordSchema.$defs.metricComparison.properties))).toEqual(
      sorted([...METRIC_COMPARISON_FIELDS]),
    );
    // protected checks mirror PROTECTED_CAPABILITY_CHECK_FIELDS
    expect(sorted(Object.keys(runRecordSchema.$defs.protectedCapabilityCheck.properties))).toEqual(
      sorted([...PROTECTED_CAPABILITY_CHECK_FIELDS]),
    );
    // uncertainty mirrors the report + entry shapes
    expect(sorted(Object.keys(runRecordSchema.$defs.uncertaintyReport.properties))).toEqual(
      sorted([...UNCERTAINTY_REPORT_FIELDS]),
    );
    expect(sorted(Object.keys(runRecordSchema.$defs.uncertaintyReportEntry.properties))).toEqual(
      sorted([...UNCERTAINTY_REPORT_ENTRY_FIELDS]),
    );
    expect(runRecordSchema.$defs.uncertaintyReport.properties.method.enum).toEqual([
      ...UNCERTAINTY_METHODS,
    ]);
    // provenance mirrors RUN_PROVENANCE_FIELDS
    expect(sorted(Object.keys(runRecordSchema.$defs.runProvenance.properties))).toEqual(
      sorted([...RUN_PROVENANCE_FIELDS]),
    );
    // attribution/verdict are cross-referenced by versioned $ref
    expect(runRecordSchema.properties.attribution.$ref).toBe(
      `arena:schema/learning/attribution-result@${LEARNING_SCHEMA_VERSION}`,
    );
    expect(runRecordSchema.properties.verdict.$ref).toBe(
      `arena:schema/learning/capability-lift-verdict@${LEARNING_SCHEMA_VERSION}`,
    );
  });

  it('the attribution-result contract mirrors the six sources, statuses and confounds', () => {
    expect(attributionSchema.additionalProperties).toBe(false);
    expect(sorted(attributionSchema.required as string[])).toEqual(
      sorted([...ATTRIBUTION_RESULT_FIELDS]),
    );
    expect(attributionSchema.properties.findings.minItems).toBe(6);
    expect(attributionSchema.properties.findings.maxItems).toBe(6);
    expect(attributionSchema.$defs.attributionFinding.properties.source.enum).toEqual([
      ...ATTRIBUTION_SOURCES,
    ]);
    expect(attributionSchema.$defs.attributionFinding.properties.status.enum).toEqual([
      ...ATTRIBUTION_FINDING_STATUSES,
    ]);
    expect(attributionSchema.$defs.attributionFinding.properties.basis.pattern).toBe(
      NEUTRAL_TEXT_PATTERN_SOURCE,
    );
    expect(sorted(Object.keys(attributionSchema.$defs.attributionFinding.properties))).toEqual(
      sorted([...ATTRIBUTION_FINDING_FIELDS]),
    );
    expect(attributionSchema.properties.confounds.items.enum).toEqual([...ATTRIBUTION_CONFOUNDS]);
  });

  it('the capability-lift-verdict contract mirrors the closed vocabulary and five conditions', () => {
    expect(verdictSchema.additionalProperties).toBe(false);
    expect(sorted(verdictSchema.required as string[])).toEqual(
      sorted(['recordVersion', 'verdict', 'conditions', 'basis']),
    );
    expect(verdictSchema.properties.verdict.enum).toEqual([...CAPABILITY_LIFT_VERDICTS]);
    expect(sorted(Object.keys(verdictSchema.$defs.liftConditions.properties))).toEqual(
      sorted([...LIFT_CONDITION_FIELDS]),
    );
    expect(verdictSchema.properties.basis.pattern).toBe(NEUTRAL_TEXT_PATTERN_SOURCE);
  });

  it('the calibration-record contract mirrors the TS field list and outcome vocabulary', () => {
    expect(calibrationSchema.additionalProperties).toBe(false);
    expect(sorted(calibrationSchema.required as string[])).toEqual(
      sorted([...CALIBRATION_RECORD_FIELDS, 'digest']),
    );
    expect(calibrationSchema.properties.predicted.properties.confidence.minimum).toBe(0);
    expect(calibrationSchema.properties.predicted.properties.confidence.maximum).toBe(1);
    expect(calibrationSchema.properties.observed.properties.outcome.enum).toEqual([
      ...OBSERVED_OUTCOMES,
    ]);
    expect(calibrationSchema.properties.observedAt.pattern).toBe(LEARNING_TIMESTAMP_PATTERN_SOURCE);
    expect(
      sorted(Object.keys(calibrationSchema.properties.applicability.properties)),
    ).toEqual(sorted(['targetCapability', 'taskPopulation', 'environmentVersions']));
  });

  it('command / event contracts mirror the wire payloads', () => {
    expect(sorted(runCommandSchema.required as string[])).toEqual(
      sorted(['descriptorRef', 'experimentKey']),
    );
    expect(runCommandSchema.properties.descriptorRef.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(runCommandSchema.additionalProperties).toBe(false);
    expect(sorted(completedEventSchema.required as string[])).toEqual(sorted(['record']));
    expect(completedEventSchema.properties.record.$ref).toBe(
      `arena:schema/learning/experiment-run-record@${LEARNING_SCHEMA_VERSION}`,
    );
    expect(completedEventSchema.additionalProperties).toBe(false);
  });

  it('the schema registry enumerates exactly the TS registry', () => {
    const registered = Object.keys(LEARNING_SCHEMAS).map(
      (name) => learningSchemaRef(name as keyof typeof LEARNING_SCHEMAS),
    );
    expect(schemaRegistrySchema.enum).toHaveLength(registered.length);
    expect(sorted(schemaRegistrySchema.enum as string[])).toEqual(
      sorted(registered.map((r) => `arena:schema/${r.namespace}/${r.name}@${r.version}`)),
    );
  });
});
