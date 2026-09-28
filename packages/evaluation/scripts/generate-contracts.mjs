#!/usr/bin/env node
/**
 * Arena evaluation-protocol contract generator (Work Order A012).
 *
 * Follows the A001 generated-contracts convention
 * (scripts/generate-contracts.mjs) and the package-level convention
 * (packages/trajectory/scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id,
 *     repo-relative output path, builder). This generator owns the A012
 *     surfaces ONLY — it emits every schema for @arena/evaluation into
 *     contracts/evaluation/ at the repository root.
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
// (packages/evaluation/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const EVALUATION_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const SEED_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
const EVALUATION_VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const NEUTRAL_TEXT_PATTERN = '^[\\x20-\\x7E\\n\\t]{1,4096}$';
const SCHEMA_REF_NAMESPACE_PATTERN = '^[a-z][a-z0-9-]*$';
const SCHEMA_REF_VERSION_PATTERN = '^\\d+\\.\\d+\\.\\d+$';

const EVALUATOR_KINDS = [
  'deterministic-test',
  'model-based',
  'expert',
  'rubric',
  'simulation',
  'comparative',
  'adversarial',
];
const AGGREGATION_POLICIES = ['weighted-sum', 'pass-threshold', 'rubric-level'];
const AGGREGATE_OUTCOMES = ['meets-criteria', 'below-criteria'];

const EVALUATION_ERROR_CODES = [
  'EVALUATION_CRITERION_MISMATCH',
  'EVALUATION_DUPLICATE_CRITERION',
  'EVALUATION_IDEMPOTENCY_CONFLICT',
  'EVALUATION_IDENTITY_CONFLICT',
  'EVALUATION_INVALID_AGGREGATION',
  'EVALUATION_INVALID_CRITERIA',
  'EVALUATION_INVALID_DESCRIPTOR',
  'EVALUATION_INVALID_DIGEST',
  'EVALUATION_INVALID_IDENTITY',
  'EVALUATION_INVALID_INPUT_CONTRACT',
  'EVALUATION_INVALID_KIND',
  'EVALUATION_INVALID_PROVENANCE',
  'EVALUATION_INVALID_RECORD',
  'EVALUATION_INVALID_REPRODUCIBILITY',
  'EVALUATION_INVALID_SCHEMA_REF',
  'EVALUATION_INVALID_TIMESTAMP',
  'EVALUATION_INVALID_VERDICT',
  'EVALUATION_NOT_FOUND',
  'EVALUATION_TAMPERED',
  'EVALUATION_THRESHOLD_OUT_OF_RANGE',
  'EVALUATION_TIMESTAMP_REGRESSION',
  'EVALUATION_UNKNOWN_ERROR',
  'EVALUATION_UNSUPPORTED_RECORD_VERSION',
  'EVALUATION_VERSION_CONFLICT',
];
const ERROR_CATEGORIES = ['encoding', 'integrity', 'unknown', 'validation', 'versioning'];
const EVALUATION_SCHEMA_VERSION = '1.0.0';
const EVALUATION_SCHEMA_NAMES = [
  'evaluator-descriptor',
  'evaluation-criteria',
  'evaluation-error',
  'evaluation-record',
  'evaluation-recorded-event',
  'run-evaluation-command',
  'schema-registry',
];

const ref = (name) => `arena:schema/evaluation/${name}@${EVALUATION_SCHEMA_VERSION}`;

// ---------------------------------------------------------------------------
// Reusable schema fragments
// ---------------------------------------------------------------------------

const string = (pattern) => ({ type: 'string', pattern });
const digest = () => string(DIGEST_PATTERN);
const nullable = (schema) => ({ oneOf: [{ type: 'null' }, schema] });

const schemaRefDef = () => ({
  schemaRef: {
    additionalProperties: false,
    description:
      'Versioned SchemaRef (A001 core shape): arena:schema/<namespace>/<name>@<major.minor.patch>.',
    properties: {
      namespace: string(SCHEMA_REF_NAMESPACE_PATTERN),
      name: string(SCHEMA_REF_NAMESPACE_PATTERN),
      version: string(SCHEMA_REF_VERSION_PATTERN),
    },
    required: ['namespace', 'name', 'version'],
    type: 'object',
  },
});

const inputContractDef = () => ({
  inputContract: {
    additionalProperties: false,
    description:
      'The evaluator input contract: MANDATORY digest refs to the judged A005 CapabilityCase ' +
      'and A011 TrajectoryRecord (chain head), plus OPTIONAL A003 BodyVersion / A016 substrate ' +
      'digest pins (null when unbound). The referenced types are bound by digest, never redefined.',
    properties: {
      caseRef: digest(),
      trajectoryRef: digest(),
      bodyRef: nullable(digest()),
      substrateRef: nullable(digest()),
    },
    required: ['caseRef', 'trajectoryRef', 'bodyRef', 'substrateRef'],
    type: 'object',
  },
});

const reproducibilityDef = () => ({
  reproducibility: {
    additionalProperties: false,
    description:
      'Reproducibility characteristics (EV1.0): deterministic? seeded? requires-human? A ' +
      'deterministic evaluator cannot require human judgment.',
    properties: {
      deterministic: { type: 'boolean' },
      seeded: { type: 'boolean' },
      requiresHuman: { type: 'boolean' },
    },
    required: ['deterministic', 'seeded', 'requiresHuman'],
    type: 'object',
  },
});

const evaluatorProvenanceDef = () => ({
  evaluatorProvenance: {
    additionalProperties: false,
    description: 'Provenance of the evaluator declaration.',
    properties: {
      authoredBy: string(EVALUATION_ID_PATTERN),
      submittedAt: string(TIMESTAMP_PATTERN),
      notes: nullable(string(NEUTRAL_TEXT_PATTERN)),
    },
    required: ['authoredBy', 'submittedAt', 'notes'],
    type: 'object',
  },
});

const criterionEntryDef = () => ({
  criterionEntry: {
    additionalProperties: false,
    description:
      'One ordered criterion: id, strictly positive weight, explicit description, and a ' +
      'content-addressed target ref (the digest of the object the criterion judges).',
    properties: {
      criterionId: string(EVALUATION_ID_PATTERN),
      weight: {
        type: 'number',
        exclusiveMinimum: 0,
        description: 'Strictly positive finite weight (normalized by weighted-sum aggregation).',
      },
      description: string(NEUTRAL_TEXT_PATTERN),
      targetRef: digest(),
    },
    required: ['criterionId', 'weight', 'description', 'targetRef'],
    type: 'object',
  },
});

const thresholdsDef = () => ({
  thresholds: {
    additionalProperties: false,
    description:
      'The judgment bar of the aggregate: for weighted-sum/pass-threshold a fraction in (0, 1]; ' +
      'for rubric-level an integer level in [1, 5].',
    properties: {
      passAt: { type: 'number' },
    },
    required: ['passAt'],
    type: 'object',
  },
});

const criterionVerdictDef = () => ({
  criterionVerdict: {
    additionalProperties: false,
    description:
      'One per-criterion verdict: criterion id, score (domain per aggregation policy: [0,1] ' +
      'for weighted-sum, {0,1} for pass-threshold, integer [1,5] for rubric-level), optional ' +
      'judgment label, optional notes.',
    properties: {
      criterionId: string(EVALUATION_ID_PATTERN),
      score: { type: 'number' },
      judgment: nullable(string(NEUTRAL_TEXT_PATTERN)),
      notes: nullable(string(NEUTRAL_TEXT_PATTERN)),
    },
    required: ['criterionId', 'score', 'judgment', 'notes'],
    type: 'object',
  },
});

const aggregateOutcomeDef = () => ({
  aggregateOutcome: {
    additionalProperties: false,
    description:
      'The aggregate judgment: one score per the aggregation policy plus the outcome label ' +
      'against thresholds.passAt — a JUDGMENT, never an evidence claim (lock rule 7).',
    properties: {
      score: { type: 'number' },
      outcome: { enum: AGGREGATE_OUTCOMES },
    },
    required: ['score', 'outcome'],
    type: 'object',
  },
});

const recordProvenanceDef = () => ({
  recordProvenance: {
    additionalProperties: false,
    description: 'Provenance of one evaluation run.',
    properties: {
      executedBy: string(EVALUATION_ID_PATTERN),
      recordedAt: string(TIMESTAMP_PATTERN),
      notes: nullable(string(NEUTRAL_TEXT_PATTERN)),
    },
    required: ['executedBy', 'recordedAt', 'notes'],
    type: 'object',
  },
});

// ---------------------------------------------------------------------------
// Contract manifest — the A012 owned schema surface.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'evaluation-protocol/evaluator-descriptor',
    output: 'contracts/evaluation/evaluator-descriptor.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('evaluator-descriptor'),
        title: 'Arena EvaluatorDescriptor v1',
        description:
          'The content-addressed, versioned declaration of an evaluator: id, version, kind ' +
          '(the CLOSED EV1.0 enum — unknown kinds rejected), input contract (digest refs to the ' +
          'judged CapabilityCase + TrajectoryRecord plus optional body/substrate pins), criteria ' +
          'ref, output schema ref, reproducibility characteristics, confidence/limitations and ' +
          'provenance. Same descriptor ⇒ same digest; any change ⇒ a new version (the digest ' +
          'changes and same-id+version re-registration is a conflict). Deep-frozen, no mutation ' +
          'API.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'evaluatorId',
          'version',
          'kind',
          'inputs',
          'criteriaRef',
          'outputSchema',
          'reproducibility',
          'confidence',
          'limitations',
          'provenance',
          'digest',
        ],
        properties: {
          recordVersion: { const: 1, description: 'Wire version of the descriptor shape.' },
          evaluatorId: string(EVALUATION_ID_PATTERN),
          version: string(EVALUATION_VERSION_PATTERN),
          kind: { enum: EVALUATOR_KINDS },
          inputs: { $ref: '#/$defs/inputContract' },
          criteriaRef: digest(),
          outputSchema: { $ref: '#/$defs/schemaRef' },
          reproducibility: { $ref: '#/$defs/reproducibility' },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Calibrated confidence in the evaluator judgments, in [0, 1].',
          },
          limitations: string(NEUTRAL_TEXT_PATTERN),
          provenance: { $ref: '#/$defs/evaluatorProvenance' },
          digest: digest(),
        },
        $defs: {
          ...schemaRefDef(),
          ...inputContractDef(),
          ...reproducibilityDef(),
          ...evaluatorProvenanceDef(),
        },
      };
    },
  },
  {
    id: 'evaluation-protocol/evaluation-criteria',
    output: 'contracts/evaluation/evaluation-criteria.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('evaluation-criteria'),
        title: 'Arena EvaluationCriteria v1',
        description:
          'The explicit, versioned, content-addressed criteria object judgment runs against: ' +
          'ordered criterion entries (id, weight, description, target ref), a closed aggregation ' +
          'policy (weighted-sum | pass-threshold | rubric-level) and thresholds. Criterion ids ' +
          'are unique; same criteria ⇒ same digest; any content change ⇒ a different digest.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'criteriaId',
          'version',
          'entries',
          'aggregation',
          'thresholds',
          'digest',
        ],
        properties: {
          recordVersion: { const: 1, description: 'Wire version of the criteria shape.' },
          criteriaId: string(EVALUATION_ID_PATTERN),
          version: string(EVALUATION_VERSION_PATTERN),
          entries: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/criterionEntry' },
            description: 'Ordered criterion list; criterion ids unique within the object.',
          },
          aggregation: { enum: AGGREGATION_POLICIES },
          thresholds: { $ref: '#/$defs/thresholds' },
          digest: digest(),
        },
        $defs: {
          ...criterionEntryDef(),
          ...thresholdsDef(),
        },
      };
    },
  },
  {
    id: 'evaluation-protocol/evaluation-record',
    output: 'contracts/evaluation/evaluation-record.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('evaluation-record'),
        title: 'Arena EvaluationRecord v1',
        description:
          'The append-once result record of one evaluation run: evaluator descriptor digest, ' +
          'case ref, trajectory digest ref, criteria digest ref, seed, ONE verdict per criterion, ' +
          'the aggregate outcome computed purely per the aggregation policy (a JUDGMENT — never ' +
          'an evidence claim; lock rule 7), confidence, limitations, started/finished-at and ' +
          'provenance. Frozen on creation; pure replayable construction from inputs; identical ' +
          'inputs + identical seed ⇒ identical record digest (score stability under rerun).',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'evaluatorRef',
          'caseRef',
          'trajectoryRef',
          'criteriaRef',
          'seed',
          'verdicts',
          'aggregate',
          'confidence',
          'limitations',
          'startedAt',
          'finishedAt',
          'provenance',
          'digest',
        ],
        properties: {
          recordVersion: { const: 1, description: 'Wire version of the record shape.' },
          evaluatorRef: digest(),
          caseRef: digest(),
          trajectoryRef: digest(),
          criteriaRef: digest(),
          seed: nullable(string(SEED_PATTERN)),
          verdicts: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/criterionVerdict' },
            description: 'One verdict per criterion, in criteria order.',
          },
          aggregate: { $ref: '#/$defs/aggregateOutcome' },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Calibrated confidence in this specific result, in [0, 1].',
          },
          limitations: nullable(string(NEUTRAL_TEXT_PATTERN)),
          startedAt: string(TIMESTAMP_PATTERN),
          finishedAt: string(TIMESTAMP_PATTERN),
          provenance: { $ref: '#/$defs/recordProvenance' },
          digest: digest(),
        },
        $defs: {
          ...criterionVerdictDef(),
          ...aggregateOutcomeDef(),
          ...recordProvenanceDef(),
        },
      };
    },
  },
  {
    id: 'evaluation-protocol/evaluation-error',
    output: 'contracts/evaluation/evaluation-error.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('evaluation-error'),
        title: 'Arena EvaluationError v1',
        description:
          'Wire-safe structured form of an EvaluationError: closed EVALUATION_* code set, ' +
          'core category mapping, strictly validating parse (unknown codes rejected).',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: EVALUATION_ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object' },
          correlationId: string('^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
        },
      };
    },
  },
  {
    id: 'evaluation-protocol/run-evaluation-command',
    output: 'contracts/evaluation/run-evaluation-command.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('run-evaluation-command'),
        title: 'Arena run-evaluation-command v1',
        description:
          'Command envelope payload: run one evaluation. Carries the digest refs of the ' +
          'evaluator descriptor, the case, the trajectory and the run seed; the fabric resolves ' +
          'refs, runs the evaluator hook and emits evaluation-recorded-event. Commands carry a ' +
          'REQUIRED non-null idempotency key (architecture-lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['evaluatorRef', 'caseRef', 'trajectoryRef', 'seed'],
        properties: {
          evaluatorRef: digest(),
          caseRef: digest(),
          trajectoryRef: digest(),
          seed: nullable(string(SEED_PATTERN)),
        },
      };
    },
  },
  {
    id: 'evaluation-protocol/evaluation-recorded-event',
    output: 'contracts/evaluation/evaluation-recorded-event.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('evaluation-recorded-event'),
        title: 'Arena evaluation-recorded-event v1',
        description:
          "Event envelope payload: the fabric's authoritative result — the frozen, " +
          'content-addressed EvaluationRecord. The event carries the run command idempotency ' +
          'key when provided so event-stream replays are idempotency-addressable.',
        type: 'object',
        additionalProperties: false,
        required: ['record'],
        properties: {
          record: {
            $ref: `arena:schema/evaluation/evaluation-record@${EVALUATION_SCHEMA_VERSION}`,
          },
        },
      };
    },
  },
  {
    id: 'evaluation-protocol/schema-registry',
    output: 'contracts/evaluation/evaluation-schema-registry.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('schema-registry'),
        title: 'Arena evaluation-protocol schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/evaluation. A SchemaRef matching this enum ' +
          'is a known evaluation-protocol schema at the listed version; anything else is not.',
        type: 'string',
        enum: EVALUATION_SCHEMA_NAMES.map((name) => ref(name)),
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
  const tempDir = join(tmpdir(), `arena-evaluation-contracts-${process.pid}-${Date.now()}`);
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
