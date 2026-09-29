#!/usr/bin/env node
/**
 * Arena learning-protocol contract generator (Work Order A020).
 *
 * Follows the A001 generated-contracts convention
 * (scripts/generate-contracts.mjs) and the package-level convention
 * (packages/trajectory/scripts/generate-contracts.mjs,
 * packages/evaluation/scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id,
 *     repo-relative output path, builder). This generator owns the
 *     A020 surfaces ONLY — it emits every schema for @arena/learning
 *     into contracts/learning/ at the repository root.
 *   - Generated files are committed, deterministic (sorted keys, 2-space
 *     indent, trailing newline) and carry a versioned SchemaRef $id.
 *   - `--check` regenerates into a temp directory and compares with the
 *     committed copies; any missing / extra / changed file is drift and
 *     exits non-zero. The drift suite (src/drift.test.ts) runs this check
 *     as part of `pnpm test`, the package script `contracts:check` runs it
 *     directly, and the governance G9 check auto-discovers this generator
 *     through its packages/.../generate-contracts.mjs glob (the root
 *     manifest itself needs no edit — the A002 merge generalized G9 to
 *     run every package-level generator).
 *   - The deterministic serializer is duplicated from the A001 generator
 *     (10 lines) instead of imported, because importing that module
 *     executes its CLI main() as an import side effect.
 *
 * Usage:
 *   node scripts/generate-contracts.mjs                    # regenerate in place
 *   node scripts/generate-contracts.mjs --output DIR       # write under DIR
 *   node scripts/generate-contracts.mjs --check [--against DIR]
 *   node scripts/generate-contracts.mjs --list
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// ---------------------------------------------------------------------------
// Shared protocol constants — MUST match the TypeScript surfaces
// (packages/learning/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const LEARNING_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const LEARNING_VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const NEUTRAL_TEXT_PATTERN = '^[\\x20-\\x7E\\n\\t]{1,4096}$';
const ARTIFACT_NAMESPACE_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const ARTIFACT_NAME_PATTERN = '^[a-z][a-z0-9-]{1,127}$';
const IDENTIFIER_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const TASK_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const TASK_VERSION_PATTERN = '^[0-9A-Za-z][0-9A-Za-z._:-]{0,63}$';

const INTERVENTION_SURFACES = [
  'skills',
  'procedures',
  'retrieval-knowledge',
  'tool-configuration',
  'memory-policy',
  'evaluator-verifier',
  'substrate',
  'model-specific-adaptation',
  'body-composition',
];
const METRIC_DIRECTIONS = ['higher-is-better', 'lower-is-better'];
const UNCERTAINTY_METHODS = ['none', 'analytic-variance', 'bootstrap', 'paired-permutation'];
const ATTRIBUTION_SOURCES = [
  'substrate',
  'body',
  'environment',
  'evaluator-change',
  'verifier-change',
  'sampling-measurement-variance',
];
const ATTRIBUTION_FINDING_STATUSES = [
  'declared-intervention',
  'detected-version-difference',
  'within-measurement-variance',
  'not-indicated',
];
const ATTRIBUTION_CONFOUNDS = ['evaluator-version-confound', 'verifier-version-confound'];
const CAPABILITY_LIFT_VERDICTS = [
  'lift-demonstrated',
  'not-demonstrated',
  'inconclusive-unless-controlled',
  'regression-detected',
];
const OBSERVED_OUTCOMES = ['improved', 'not-improved', 'regressed', 'inconclusive'];

const LEARNING_SCHEMA_VERSION = '1.0.0';
const LEARNING_SCHEMA_NAMES = [
  'experiment-descriptor',
  'intervention',
  'experiment-run-record',
  'attribution-result',
  'capability-lift-verdict',
  'calibration-record',
  'run-experiment-command',
  'experiment-completed-event',
  'schema-registry',
];

const ref = (name) => `arena:schema/learning/${name}@${LEARNING_SCHEMA_VERSION}`;

// ---------------------------------------------------------------------------
// Reusable schema fragments
// ---------------------------------------------------------------------------

const string = (pattern) => ({ type: 'string', pattern });
const digest = () => string(DIGEST_PATTERN);
const nullable = (schema) => ({ oneOf: [{ type: 'null' }, schema] });

const capabilityNodeRefDef = () => ({
  capabilityNodeRef: {
    additionalProperties: false,
    description:
      'A content-addressed reference to an A004 capability node (the REAL capability-graph shape): kind/id/version + digest.',
    properties: {
      kind: string('^[a-z][a-z0-9-]{0,63}$'),
      id: string('^[a-z][a-z0-9-]{0,63}$'),
      version: string(LEARNING_VERSION_PATTERN),
      digest: digest(),
    },
    required: ['kind', 'id', 'version', 'digest'],
    type: 'object',
  },
});

const artifactRefDef = () => ({
  artifactRef: {
    additionalProperties: false,
    description:
      'The A002-shaped artifact reference: namespace/name/version + content digest. The referenced object is bound BY DIGEST, never redefined here.',
    properties: {
      namespace: string(ARTIFACT_NAMESPACE_PATTERN),
      name: string(ARTIFACT_NAME_PATTERN),
      version: string(LEARNING_VERSION_PATTERN),
      digest: digest(),
    },
    required: ['namespace', 'name', 'version', 'digest'],
    type: 'object',
  },
});

const taskVersionRefDef = () => ({
  taskVersionRef: {
    additionalProperties: false,
    description:
      'The A009-shaped task/version ref (the same form A011 trajectory headers pin).',
    properties: {
      taskId: string(TASK_ID_PATTERN),
      version: string(TASK_VERSION_PATTERN),
    },
    required: ['taskId', 'version'],
    type: 'object',
  },
});

const metricDeclarationDef = () => ({
  metricDeclaration: {
    additionalProperties: false,
    description:
      'One declared outcome metric: id, description and a CLOSED direction (what "improves" means for Q1.0 condition 1).',
    properties: {
      metricId: string(LEARNING_ID_PATTERN),
      description: string(NEUTRAL_TEXT_PATTERN),
      direction: { enum: METRIC_DIRECTIONS },
    },
    required: ['metricId', 'description', 'direction'],
    type: 'object',
  },
});

const protectedCapabilityDef = () => ({
  protectedCapability: {
    additionalProperties: false,
    description:
      'One protected capability: the A004 node ref plus the metric id and direction with which regression is measured in both arms (Q1.0 condition 4).',
    properties: {
      ref: { $ref: '#/$defs/capabilityNodeRef' },
      metricId: string(LEARNING_ID_PATTERN),
      direction: { enum: METRIC_DIRECTIONS },
    },
    required: ['ref', 'metricId', 'direction'],
    type: 'object',
  },
});

const interventionArtifactDef = () => ({
  interventionArtifact: {
    additionalProperties: false,
    description:
      'One intervention artifact: a typed A002-shaped ref PLUS the EXPLICIT changed surface from the LE1.0 nine. An intervention with an undeclared (missing) or ambiguous (outside the closed vocabulary) changed surface is REJECTED.',
    properties: {
      artifact: { $ref: '#/$defs/artifactRef' },
      changedSurface: { enum: INTERVENTION_SURFACES },
    },
    required: ['artifact', 'changedSurface'],
    type: 'object',
  },
});

const metricMeasurementDef = () => ({
  metricMeasurement: {
    additionalProperties: false,
    description:
      'One measured outcome metric value for one arm, with the reported variance (null when unreported — Q1.0 condition 5 fails closed).',
    properties: {
      metricId: string(LEARNING_ID_PATTERN),
      value: { type: 'number' },
      variance: nullable({ type: 'number', minimum: 0 }),
    },
    required: ['metricId', 'value', 'variance'],
    type: 'object',
  },
});

const metricComparisonDef = () => ({
  metricComparison: {
    additionalProperties: false,
    description:
      'The computed comparison of one declared outcome metric between the arms: values, delta (intervention - baseline), and improved/regressed per the declared direction.',
    properties: {
      metricId: string(LEARNING_ID_PATTERN),
      direction: { enum: METRIC_DIRECTIONS },
      baselineValue: { type: 'number' },
      interventionValue: { type: 'number' },
      delta: { type: 'number' },
      improved: { type: 'boolean' },
      regressed: { type: 'boolean' },
    },
    required: [
      'metricId',
      'direction',
      'baselineValue',
      'interventionValue',
      'delta',
      'improved',
      'regressed',
    ],
    type: 'object',
  },
});

const protectedCapabilityCheckDef = () => ({
  protectedCapabilityCheck: {
    additionalProperties: false,
    description:
      'The computed regression check for one declared protected capability; measured=false when either arm did not supply the measurement (Q1.0 condition 4 then fails).',
    properties: {
      capabilityRef: digest(),
      metricId: string(LEARNING_ID_PATTERN),
      direction: { enum: METRIC_DIRECTIONS },
      baselineValue: nullable({ type: 'number' }),
      interventionValue: nullable({ type: 'number' }),
      delta: nullable({ type: 'number' }),
      regressed: { type: 'boolean' },
      measured: { type: 'boolean' },
    },
    required: [
      'capabilityRef',
      'metricId',
      'direction',
      'baselineValue',
      'interventionValue',
      'delta',
      'regressed',
      'measured',
    ],
    type: 'object',
  },
});

const uncertaintyReportDef = () => ({
  uncertaintyReportEntry: {
    additionalProperties: false,
    description:
      "One uncertainty report entry: both arms' reported variances per metric (null when unreported).",
    properties: {
      metricId: string(LEARNING_ID_PATTERN),
      baselineVariance: nullable({ type: 'number', minimum: 0 }),
      interventionVariance: nullable({ type: 'number', minimum: 0 }),
    },
    required: ['metricId', 'baselineVariance', 'interventionVariance'],
    type: 'object',
  },
});

const uncertaintyReportTopDef = () => ({
  uncertaintyReport: {
    additionalProperties: false,
    description:
      'The reported uncertainty of a run: the declared method plus per-metric variance values (Q1.0 condition 5).',
    properties: {
      method: { enum: UNCERTAINTY_METHODS },
      entries: { type: 'array', minItems: 1, items: { $ref: '#/$defs/uncertaintyReportEntry' } },
    },
    required: ['method', 'entries'],
    type: 'object',
  },
});

const attributionFindingDef = () => ({
  attributionFinding: {
    additionalProperties: false,
    description:
      'One attribution finding: a LE1.0 source, its closed status, and the deterministic basis.',
    properties: {
      source: { enum: ATTRIBUTION_SOURCES },
      status: { enum: ATTRIBUTION_FINDING_STATUSES },
      basis: string(NEUTRAL_TEXT_PATTERN),
    },
    required: ['source', 'status', 'basis'],
    type: 'object',
  },
});

const liftConditionsDef = () => ({
  liftConditions: {
    additionalProperties: false,
    description:
      'The five Q1.0 success conditions, each explicitly evaluated (never implied).',
    properties: {
      pinnedPopulationImprovement: { type: 'boolean' },
      survivesVerificationAudit: { type: 'boolean' },
      evaluatorVersionChangesAccounted: { type: 'boolean' },
      protectedCapabilityRegressionMeasured: { type: 'boolean' },
      uncertaintyReported: { type: 'boolean' },
    },
    required: [
      'pinnedPopulationImprovement',
      'survivesVerificationAudit',
      'evaluatorVersionChangesAccounted',
      'protectedCapabilityRegressionMeasured',
      'uncertaintyReported',
    ],
    type: 'object',
  },
});

const armRunRefsDef = () => ({
  armRunRefs: {
    additionalProperties: false,
    description:
      'The RUN references of one arm: A011 trajectory digests (chain heads), A012 evaluation-record digests, A013 verification-record digests.',
    properties: {
      trajectories: { type: 'array', minItems: 1, items: digest() },
      evaluations: { type: 'array', minItems: 1, items: digest() },
      verifications: { type: 'array', items: digest() },
    },
    required: ['trajectories', 'evaluations', 'verifications'],
    type: 'object',
  },
});

const runProvenanceDef = () => ({
  runProvenance: {
    additionalProperties: false,
    description: 'Provenance of one experiment run.',
    properties: {
      executedBy: string(LEARNING_ID_PATTERN),
      recordedAt: string(TIMESTAMP_PATTERN),
      notes: nullable(string(NEUTRAL_TEXT_PATTERN)),
    },
    required: ['executedBy', 'recordedAt', 'notes'],
    type: 'object',
  },
});

const descriptorProvenanceDef = () => ({
  descriptorProvenance: {
    additionalProperties: false,
    description: 'Provenance of the experiment declaration.',
    properties: {
      authoredBy: string(LEARNING_ID_PATTERN),
      submittedAt: string(TIMESTAMP_PATTERN),
      notes: nullable(string(NEUTRAL_TEXT_PATTERN)),
    },
    required: ['authoredBy', 'submittedAt', 'notes'],
    type: 'object',
  },
});

// ---------------------------------------------------------------------------
// Contract manifest — the A020 owned schema surface.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'learning-protocol/experiment-descriptor',
    output: 'contracts/learning/experiment-descriptor.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('experiment-descriptor'),
        title: 'Arena ExperimentDescriptor v1',
        description:
          'The content-addressed, versioned declaration of a learning experiment (LE1.0 Experiment): experiment id/version; target capability (A004-shaped ref); baseline Body/Model/Runtime digest pins; intervention artifacts with EXPLICIT changed surfaces from the LE1.0 nine (undeclared/ambiguous surfaces are rejected); pinned task population; A012 evaluation-suite digests; A013 verification-suite digests; environment versions; outcome metric declarations with closed directions; uncertainty/statistical method; protected capabilities (Q1.0 condition 4); provenance. Same descriptor ⇒ same digest; any change ⇒ a new version. Deep-frozen, no mutation API.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'experimentId',
          'version',
          'targetCapability',
          'baseline',
          'interventions',
          'taskPopulation',
          'evaluationSuiteRefs',
          'verificationSuiteRefs',
          'environmentVersions',
          'outcomeMetrics',
          'uncertainty',
          'protectedCapabilities',
          'provenance',
          'digest',
        ],
        properties: {
          recordVersion: { const: 1, description: 'Wire version of the descriptor shape.' },
          experimentId: string(LEARNING_ID_PATTERN),
          version: string(LEARNING_VERSION_PATTERN),
          targetCapability: { $ref: '#/$defs/capabilityNodeRef' },
          baseline: {
            additionalProperties: false,
            description:
              'The baseline composition (LE1.0 baseline Body/Model/Runtime): digest-addressed pins, each nullable when unbound.',
            properties: {
              bodyRef: nullable(digest()),
              substrateRef: nullable(digest()),
              runtimeRef: nullable(digest()),
            },
            required: ['bodyRef', 'substrateRef', 'runtimeRef'],
            type: 'object',
          },
          interventions: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/interventionArtifact' },
            description:
              'The intervention artifacts (≥1); artifact digests unique within the descriptor.',
          },
          taskPopulation: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/taskVersionRef' },
            description:
              'The pinned task population (Q1.0 condition 1: improvement is measured on a PINNED evaluation population).',
          },
          evaluationSuiteRefs: {
            type: 'array',
            minItems: 1,
            items: digest(),
            description: 'A012 EvaluationCriteria/EvaluatorDescriptor digests.',
          },
          verificationSuiteRefs: {
            type: 'array',
            minItems: 1,
            items: digest(),
            description: 'A013 VerifierDescriptor digests.',
          },
          environmentVersions: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/artifactRef' },
            description: 'The pinned content-addressed environment versions.',
          },
          outcomeMetrics: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/metricDeclaration' },
            description: 'The declared outcome metrics (ids unique).',
          },
          uncertainty: {
            additionalProperties: false,
            description:
              'The declared uncertainty/statistical method (LE1.0) — how variance is computed and reported.',
            properties: {
              method: { enum: UNCERTAINTY_METHODS },
              notes: nullable(string(NEUTRAL_TEXT_PATTERN)),
            },
            required: ['method', 'notes'],
            type: 'object',
          },
          protectedCapabilities: {
            type: 'array',
            items: { $ref: '#/$defs/protectedCapability' },
            description:
              'The protected capabilities whose regression the experiment must measure; declaring none prevents lift-demonstrated (Q1.0 condition 4 fails closed).',
          },
          provenance: { $ref: '#/$defs/descriptorProvenance' },
          digest: digest(),
        },
        $defs: {
          ...capabilityNodeRefDef(),
          ...artifactRefDef(),
          ...taskVersionRefDef(),
          ...metricDeclarationDef(),
          ...protectedCapabilityDef(),
          ...interventionArtifactDef(),
          ...descriptorProvenanceDef(),
        },
      };
    },
  },
  {
    id: 'learning-protocol/intervention',
    output: 'contracts/learning/intervention.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('intervention'),
        title: 'Arena InterventionArtifact v1',
        description:
          'One intervention artifact: a typed A002-shaped artifact ref (namespace/name/version + content digest) plus the EXPLICIT changed surface from the LE1.0 nine. "The changed surface must be explicit" — an intervention with an undeclared (missing) or ambiguous (outside the closed vocabulary) changed surface is REJECTED at descriptor construction.',
        type: 'object',
        additionalProperties: false,
        required: ['artifact', 'changedSurface'],
        properties: {
          artifact: { $ref: '#/$defs/artifactRef' },
          changedSurface: {
            enum: INTERVENTION_SURFACES,
            description:
              'The EXPLICIT LE1.0 surface this artifact changes (closed vocabulary of nine).',
          },
        },
        $defs: {
          ...artifactRefDef(),
        },
      };
    },
  },
  {
    id: 'learning-protocol/experiment-run-record',
    output: 'contracts/learning/experiment-run-record.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('experiment-run-record'),
        title: 'Arena ExperimentRunRecord v1',
        description:
          'The APPEND-ONCE result record of one learning experiment run: the experiment key (idempotency) + correlation id, the descriptor digest, both arms\' RUN references (A011 trajectory digests / A012 evaluation-record digests / A013 verification-record digests), the collected outcome metrics of both arms, the computed comparison, the reported uncertainty, the protected-capability regression checks, the ATTRIBUTION analysis and the capability-lift verdict. Immutable, content-addressed; historical evidence is append-only and never rewritten by learning (lock rule 6).',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'experimentKey',
          'correlationId',
          'descriptorRef',
          'baseline',
          'intervention',
          'baselineMetrics',
          'interventionMetrics',
          'comparison',
          'uncertainty',
          'protectedCapabilityChecks',
          'attribution',
          'verdict',
          'provenance',
          'digest',
        ],
        properties: {
          recordVersion: { const: 1, description: 'Wire version of the record shape.' },
          experimentKey: string(IDENTIFIER_PATTERN),
          correlationId: string(IDENTIFIER_PATTERN),
          descriptorRef: digest(),
          baseline: { $ref: '#/$defs/armRunRefs' },
          intervention: { $ref: '#/$defs/armRunRefs' },
          baselineMetrics: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/metricMeasurement' },
          },
          interventionMetrics: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/metricMeasurement' },
          },
          comparison: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/metricComparison' },
            description: 'The computed per-metric comparison (declared order).',
          },
          uncertainty: { $ref: '#/$defs/uncertaintyReport' },
          protectedCapabilityChecks: {
            type: 'array',
            items: { $ref: '#/$defs/protectedCapabilityCheck' },
          },
          attribution: { $ref: `arena:schema/learning/attribution-result@${LEARNING_SCHEMA_VERSION}` },
          verdict: { $ref: `arena:schema/learning/capability-lift-verdict@${LEARNING_SCHEMA_VERSION}` },
          provenance: { $ref: '#/$defs/runProvenance' },
          digest: digest(),
        },
        $defs: {
          ...armRunRefsDef(),
          ...metricMeasurementDef(),
          ...metricComparisonDef(),
          ...protectedCapabilityCheckDef(),
          ...uncertaintyReportDef(),
          ...uncertaintyReportTopDef(),
          ...runProvenanceDef(),
        },
      };
    },
  },
  {
    id: 'learning-protocol/attribution-result',
    output: 'contracts/learning/attribution-result.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('attribution-result'),
        title: 'Arena AttributionResult v1',
        description:
          'The structured attribution of one experiment run (LE1.0): one finding per the SIX distinguishable improvement sources (substrate | body | environment | evaluator-change | verifier-change | sampling-measurement-variance), classified from the DECLARED intervention surfaces + the evaluator/verifier version digests the arm records carry. KEY RULE: when the evaluator or verifier version digests differ between arms, the confounds array MUST carry evaluator-version-confound / verifier-version-confound and the capability-lift verdict MUST be inconclusive-unless-controlled — a changed evaluator score is not automatically a capability improvement.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'findings',
          'confounds',
          'evaluatorDigestsBaseline',
          'evaluatorDigestsIntervention',
          'verifierDigestsBaseline',
          'verifierDigestsIntervention',
          'basis',
        ],
        properties: {
          recordVersion: { const: 1, description: 'Wire version of the attribution shape.' },
          findings: {
            type: 'array',
            minItems: 6,
            maxItems: 6,
            items: { $ref: '#/$defs/attributionFinding' },
            description: 'One finding per LE1.0 source (all six, canonical order).',
          },
          confounds: {
            type: 'array',
            items: { enum: ATTRIBUTION_CONFOUNDS },
            description:
              'The surfaced measurement-validity confounds (empty when none). Never silently absorbed.',
          },
          evaluatorDigestsBaseline: { type: 'array', items: digest() },
          evaluatorDigestsIntervention: { type: 'array', items: digest() },
          verifierDigestsBaseline: { type: 'array', items: digest() },
          verifierDigestsIntervention: { type: 'array', items: digest() },
          basis: string(NEUTRAL_TEXT_PATTERN),
        },
        $defs: {
          ...attributionFindingDef(),
        },
      };
    },
  },
  {
    id: 'learning-protocol/capability-lift-verdict',
    output: 'contracts/learning/capability-lift-verdict.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('capability-lift-verdict'),
        title: 'Arena CapabilityLiftVerdict v1',
        description:
          'The Q1.0 five-condition verdict: lift-demonstrated ONLY when (1) the target capability improves on a pinned evaluation population, (2) the improvement survives a verification audit, (3) evaluator/version changes are accounted for, (4) regression on protected capabilities is measured, and (5) uncertainty/variance is reported where material. Otherwise not-demonstrated / inconclusive-unless-controlled / regression-detected. CLOSED VOCABULARY, NEVER A SCORE.',
        type: 'object',
        additionalProperties: false,
        required: ['recordVersion', 'verdict', 'conditions', 'basis'],
        properties: {
          recordVersion: { const: 1, description: 'Wire version of the verdict shape.' },
          verdict: { enum: CAPABILITY_LIFT_VERDICTS },
          conditions: { $ref: '#/$defs/liftConditions' },
          basis: string(NEUTRAL_TEXT_PATTERN),
        },
        $defs: {
          ...liftConditionsDef(),
        },
      };
    },
  },
  {
    id: 'learning-protocol/calibration-record',
    output: 'contracts/learning/calibration-record.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('calibration-record'),
        title: 'Arena CalibrationRecord v1',
        description:
          'The LE1.0 Calibration record: where later-observed outcomes exist, the predicted confidence/score is compared with the observed outcome and the APPLICABILITY CONTEXT is preserved (target capability ref, pinned task population, pinned environment versions — the context in which the prediction applies).',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'calibrationId',
          'experimentRef',
          'metricId',
          'predicted',
          'observed',
          'applicability',
          'observedAt',
          'provenance',
          'digest',
        ],
        properties: {
          recordVersion: { const: 1, description: 'Wire version of the calibration shape.' },
          calibrationId: string(LEARNING_ID_PATTERN),
          experimentRef: digest(),
          metricId: string(LEARNING_ID_PATTERN),
          predicted: {
            additionalProperties: false,
            description: 'The prediction: confidence in [0, 1] plus the predicted delta (null when none).',
            properties: {
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              delta: nullable({ type: 'number' }),
            },
            required: ['confidence', 'delta'],
            type: 'object',
          },
          observed: {
            additionalProperties: false,
            description:
              'The later-observed outcome: closed vocabulary (improved | not-improved | regressed | inconclusive) plus the observed delta (null when none).',
            properties: {
              outcome: { enum: OBSERVED_OUTCOMES },
              delta: nullable({ type: 'number' }),
            },
            required: ['outcome', 'delta'],
            type: 'object',
          },
          applicability: {
            additionalProperties: false,
            description:
              'The preserved applicability context: where the prediction applies (target capability, pinned task population, pinned environment versions).',
            properties: {
              targetCapability: { $ref: '#/$defs/capabilityNodeRef' },
              taskPopulation: {
                type: 'array',
                minItems: 1,
                items: { $ref: '#/$defs/taskVersionRef' },
              },
              environmentVersions: {
                type: 'array',
                minItems: 1,
                items: { $ref: '#/$defs/artifactRef' },
              },
            },
            required: ['targetCapability', 'taskPopulation', 'environmentVersions'],
            type: 'object',
          },
          observedAt: string(TIMESTAMP_PATTERN),
          provenance: {
            additionalProperties: false,
            description: 'Provenance of the calibration observation.',
            properties: {
              recordedBy: string(LEARNING_ID_PATTERN),
              recordedAt: string(TIMESTAMP_PATTERN),
              notes: nullable(string(NEUTRAL_TEXT_PATTERN)),
            },
            required: ['recordedBy', 'recordedAt', 'notes'],
            type: 'object',
          },
          digest: digest(),
        },
        $defs: {
          ...capabilityNodeRefDef(),
          ...taskVersionRefDef(),
          ...artifactRefDef(),
        },
      };
    },
  },
  {
    id: 'learning-protocol/run-experiment-command',
    output: 'contracts/learning/run-experiment-command.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('run-experiment-command'),
        title: 'Arena run-experiment-command v1',
        description:
          'Command envelope payload: run one learning experiment. Carries the digest ref of the ExperimentDescriptor and the experiment key (idempotency key); the engine resolves the descriptor, executes the pure comparison/attribution/verdict computation over the supplied arm records and emits experiment-completed-event. Commands carry a REQUIRED non-null idempotency key (architecture-lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['descriptorRef', 'experimentKey'],
        properties: {
          descriptorRef: digest(),
          experimentKey: string(IDENTIFIER_PATTERN),
        },
      };
    },
  },
  {
    id: 'learning-protocol/experiment-completed-event',
    output: 'contracts/learning/experiment-completed-event.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('experiment-completed-event'),
        title: 'Arena experiment-completed-event v1',
        description:
          "Event envelope payload: the engine's authoritative result — the frozen, content-addressed ExperimentRunRecord. The event carries the run command idempotency key when provided so event-stream replays are idempotency-addressable.",
        type: 'object',
        additionalProperties: false,
        required: ['record'],
        properties: {
          record: {
            $ref: `arena:schema/learning/experiment-run-record@${LEARNING_SCHEMA_VERSION}`,
          },
        },
      };
    },
  },
  {
    id: 'learning-protocol/schema-registry',
    output: 'contracts/learning/learning-schema-registry.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('schema-registry'),
        title: 'Arena learning-protocol schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/learning. A SchemaRef matching this enum is a known learning-protocol schema at the listed version; anything else is not.',
        type: 'string',
        enum: LEARNING_SCHEMA_NAMES.map((name) => ref(name)),
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Deterministic serialization
// ---------------------------------------------------------------------------

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortObjectKeys(value[key])]),
    );
  }
  return value;
}

export function serializeDeterministic(value) {
  return `${JSON.stringify(sortObjectKeys(value), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Output / check
// ---------------------------------------------------------------------------

function listFilesRecursive(dir, prefix = '') {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFilesRecursive(join(dir, entry.name), rel));
    else files.push(rel);
  }
  return files;
}

function writeContracts(outputDir) {
  for (const contract of CONTRACTS) {
    const target = join(outputDir, contract.output);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, serializeDeterministic(contract.build()), 'utf-8');
    console.log(`[contracts] wrote ${contract.output} (${contract.id})`);
  }
}

function checkContracts(againstDir) {
  const tempDir = join(tmpdir(), `arena-learning-contracts-${process.pid}-${Date.now()}`);
  try {
    writeContracts(tempDir);
    const generatedFiles = listFilesRecursive(tempDir);
    const drift = [];

    for (const rel of generatedFiles) {
      const againstPath = join(againstDir, rel);
      let committed;
      try {
        committed = readFileSync(againstPath, 'utf-8');
      } catch {
        drift.push(`missing generated contract: ${rel}`);
        continue;
      }
      const generated = readFileSync(join(tempDir, rel), 'utf-8');
      if (committed !== generated) drift.push(`drifted generated contract: ${rel}`);
    }

    // Extra-file check is scoped to the committed contract directory (never
    // the whole tree), so running --check against the repository root is safe.
    const contractDirs = [...new Set(CONTRACTS.map((c) => dirname(c.output)))];
    const generatedSet = new Set(generatedFiles);
    for (const contractDir of contractDirs) {
      const committedDir = join(againstDir, contractDir);
      if (!statSync(committedDir, { throwIfNoEntry: false })?.isDirectory()) continue;
      for (const rel of listFilesRecursive(committedDir, contractDir)) {
        if (!generatedSet.has(rel)) drift.push(`unexpected extra contract file: ${rel}`);
      }
    }

    if (drift.length > 0) {
      console.error(`[contracts] DRIFT DETECTED (${drift.length} problem(s)):`);
      for (const d of drift) console.error(`  - ${d}`);
      console.error('[contracts] run: node scripts/generate-contracts.mjs   then commit the result');
      return 1;
    }
    console.log(`[contracts] drift check clean (${generatedFiles.length} contract file(s) match)`);
    return 0;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const contract of CONTRACTS) {
      console.log(`${contract.id} -> ${contract.output}`);
    }
    process.exit(0);
  }
  if (args.includes('--check')) {
    const againstIndex = args.indexOf('--against');
    const againstDir =
      againstIndex !== -1 && args[againstIndex + 1]
        ? resolve(args[againstIndex + 1])
        : REPO_ROOT;
    process.exit(checkContracts(againstDir));
  }
  const outputIndex = args.indexOf('--output');
  if (outputIndex !== -1 && args[outputIndex + 1]) {
    writeContracts(resolve(args[outputIndex + 1]));
    process.exit(0);
  }
  if (args.length > 0) {
    console.error(`unknown arguments: ${args.join(' ')}`);
    process.exit(2);
  }
  writeContracts(REPO_ROOT);
  console.log('[contracts] regenerate committed with: git add <contract files>');
}

main();
