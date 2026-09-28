#!/usr/bin/env node
/**
 * Arena trajectory-protocol contract generator (Work Order A011).
 *
 * Follows the A001 generated-contracts convention
 * (scripts/generate-contracts.mjs) and the package-level convention
 * (packages/environment-protocol/scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id,
 *     repo-relative output path, builder). This generator owns the A011
 *     surfaces ONLY — it emits every schema for @arena/trajectory into
 *     contracts/trajectory/ at the repository root.
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
// (packages/trajectory/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const TRAJECTORY_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const SEED_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
const TASK_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const TASK_VERSION_PATTERN = '^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$';
const NAMESPACE_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const NAME_PATTERN = '^[a-z][a-z0-9-]{1,127}$';
const ENV_SEMVER_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const RUN_ID_PATTERN = '^[a-z][a-z0-9-]{1,62}\\/[a-z][a-z0-9-]{0,63}$|^[a-z][a-z0-9-]{0,63}$';
const ERROR_CODE_PATTERN = '^[A-Z][A-Z0-9_]{0,127}$';
const NEUTRAL_TEXT_PATTERN = '^[\\x20-\\x7E\\n\\t]{1,4096}$';

const ENTRY_KINDS = ['action', 'observation', 'checkpoint', 'error', 'completion'];
const OBSERVATION_CHANNELS = ['stdout', 'stderr', 'files', 'events', 'metrics', 'state-dump'];
const OUTCOMES = ['completed', 'failed', 'timed-out'];

const TRAJECTORY_ERROR_CODES = [
  'TRAJECTORY_ALREADY_COMPLETED',
  'TRAJECTORY_IDEMPOTENCY_CONFLICT',
  'TRAJECTORY_IDENTITY_CONFLICT',
  'TRAJECTORY_INVALID_DIGEST',
  'TRAJECTORY_INVALID_ENTRY',
  'TRAJECTORY_INVALID_HEADER',
  'TRAJECTORY_INVALID_IDENTITY',
  'TRAJECTORY_INVALID_PAYLOAD',
  'TRAJECTORY_INVALID_RECORD',
  'TRAJECTORY_INVALID_RUN_REF',
  'TRAJECTORY_INVALID_TIMESTAMP',
  'TRAJECTORY_NOT_FOUND',
  'TRAJECTORY_SEQUENCE_GAP',
  'TRAJECTORY_SEQUENCE_REGRESSION',
  'TRAJECTORY_TAMPERED',
  'TRAJECTORY_TIMESTAMP_REGRESSION',
  'TRAJECTORY_UNKNOWN_ERROR',
  'TRAJECTORY_UNSUPPORTED_RECORD_VERSION',
  'TRAJECTORY_VERSION_CONFLICT',
];
const ERROR_CATEGORIES = ['encoding', 'integrity', 'unknown', 'validation', 'versioning'];
const TRAJECTORY_SCHEMA_VERSION = '1.0.0';
const TRAJECTORY_SCHEMA_NAMES = [
  'append-trajectory-entry-command',
  'open-trajectory-command',
  'schema-registry',
  'trajectory-entry',
  'trajectory-entry-appended-event',
  'trajectory-error',
  'trajectory-header',
  'trajectory-opened-event',
  'trajectory-record',
  'trajectory-run-ref',
];

const ref = (name) => `arena:schema/trajectory/${name}@${TRAJECTORY_SCHEMA_VERSION}`;

// ---------------------------------------------------------------------------
// Reusable schema fragments
// ---------------------------------------------------------------------------

const string = (pattern) => ({ type: 'string', pattern });
const digest = () => string(DIGEST_PATTERN);
const nullable = (schema) => ({ oneOf: [{ type: 'null' }, schema] });
const positiveInteger = () => ({
  type: 'integer',
  minimum: 1,
  description: 'Strictly positive integer (sequences are 1-based).',
});

const taskVersionRefDef = () => ({
  taskVersionRef: {
    additionalProperties: false,
    description:
      'A009 TaskVersionRef shape (type-only reuse — the guard lives in @arena/trajectory).',
    properties: {
      taskId: string(TASK_ID_PATTERN),
      version: string(TASK_VERSION_PATTERN),
    },
    required: ['taskId', 'version'],
    type: 'object',
  },
});

const environmentVersionRefDef = () => ({
  environmentVersionRef: {
    additionalProperties: false,
    description: 'Content-addressed environment version (A009 shape, digest-pinned).',
    properties: {
      namespace: string(NAMESPACE_PATTERN),
      name: string(NAME_PATTERN),
      version: string(ENV_SEMVER_PATTERN),
      digest: digest(),
    },
    required: ['namespace', 'name', 'version', 'digest'],
    type: 'object',
  },
});

const trajectoryRunRefDef = () => ({
  trajectoryRunRef: {
    additionalProperties: false,
    description:
      'The run binding: the four input parts of the run evidence address (task version, ' +
      'environment version, run id, initial snapshot digest) plus the optional A010 RunRecord ' +
      'digest pin. The trajectory/evidence OUTPUT digests are bound downstream by the RunResult.',
    properties: {
      taskVersion: { $ref: '#/$defs/taskVersionRef' },
      environmentVersion: { $ref: '#/$defs/environmentVersionRef' },
      runId: string(RUN_ID_PATTERN),
      initialSnapshotDigest: digest(),
      runRecordDigest: nullable(digest()),
    },
    required: [
      'taskVersion',
      'environmentVersion',
      'runId',
      'initialSnapshotDigest',
      'runRecordDigest',
    ],
    type: 'object',
  },
});

const entryPayloadDefs = () => ({
  actionPayload: {
    additionalProperties: false,
    description: 'An action the agent took: action id + canonical JSON input.',
    properties: {
      actionId: string(TRAJECTORY_ID_PATTERN),
      input: {
        oneOf: [
          { type: 'null' },
          { type: 'object', description: 'Plain canonical-JSON object (arguments).' },
        ],
      },
    },
    required: ['actionId', 'input'],
    type: 'object',
  },
  observationPayload: {
    additionalProperties: false,
    description:
      'An observation the agent received (A009 observation-surface channel vocabulary).',
    properties: {
      observationId: string(TRAJECTORY_ID_PATTERN),
      channel: { enum: OBSERVATION_CHANNELS },
      content: string(NEUTRAL_TEXT_PATTERN),
    },
    required: ['observationId', 'channel', 'content'],
    type: 'object',
  },
  checkpointPayload: {
    additionalProperties: false,
    description: 'An environment checkpoint reached at this step (A010 digest refs).',
    properties: {
      checkpointId: string(TRAJECTORY_ID_PATTERN),
      snapshotDigest: digest(),
    },
    required: ['checkpointId', 'snapshotDigest'],
    type: 'object',
  },
  errorPayload: {
    additionalProperties: false,
    description: 'An error encountered mid-run (recoverable — the run may continue).',
    properties: {
      code: string(ERROR_CODE_PATTERN),
      message: string(NEUTRAL_TEXT_PATTERN),
    },
    required: ['code', 'message'],
    type: 'object',
  },
  completionPayload: {
    additionalProperties: false,
    description:
      'The terminal entry: outcome (A010 outcome vocabulary) + evidence output digests.',
    properties: {
      outcome: { enum: OUTCOMES },
      evidenceDigests: { type: 'array', items: digest() },
    },
    required: ['outcome', 'evidenceDigests'],
    type: 'object',
  },
});

// ---------------------------------------------------------------------------
// Contract manifest — the A011 owned schema surface.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'trajectory-protocol/trajectory-run-ref',
    output: 'contracts/trajectory/trajectory-run-ref.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('trajectory-run-ref'),
        title: 'Arena TrajectoryRunRef v1',
        description:
          'The run binding of a trajectory: the four RunAddress-shaped digest refs that exist ' +
          'before the run produces anything (task version, environment version, run id, initial ' +
          'snapshot digest), plus the optional A010 RunRecord digest pin. The trajectory digest ' +
          'and evidence digests are OUTPUTS bound downstream by the RunResult — binding them ' +
          'here would be circular.',
        type: 'object',
        additionalProperties: false,
        required: [
          'taskVersion',
          'environmentVersion',
          'runId',
          'initialSnapshotDigest',
          'runRecordDigest',
        ],
        properties: {
          taskVersion: { $ref: '#/$defs/taskVersionRef' },
          environmentVersion: { $ref: '#/$defs/environmentVersionRef' },
          runId: string(RUN_ID_PATTERN),
          initialSnapshotDigest: digest(),
          runRecordDigest: nullable(digest()),
        },
        $defs: { ...taskVersionRefDef(), ...environmentVersionRefDef() },
      };
    },
  },
  {
    id: 'trajectory-protocol/trajectory-header',
    output: 'contracts/trajectory/trajectory-header.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('trajectory-header'),
        title: 'Arena TrajectoryHeader v1',
        description:
          'The content-addressed declaration of a trajectory: trajectory id, run binding ' +
          '(four digest refs), agent/body ref (digest — a model is a cognitive substrate, NOT ' +
          'the durable identity), substrate ref (digest), started-at, seed. The digest is ' +
          'sha256 over the canonical JSON of the digest-free view; same header ⇒ same digest. ' +
          'Deep-frozen with no mutation API.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'trajectoryId',
          'run',
          'agentBodyRef',
          'substrateRef',
          'startedAt',
          'seed',
          'digest',
        ],
        properties: {
          recordVersion: { const: 1, description: 'Wire version of the header shape.' },
          trajectoryId: string(TRAJECTORY_ID_PATTERN),
          run: { $ref: '#/$defs/trajectoryRunRef' },
          agentBodyRef: digest(),
          substrateRef: digest(),
          startedAt: string(TIMESTAMP_PATTERN),
          seed: nullable(string(SEED_PATTERN)),
          digest: digest(),
        },
        $defs: {
          ...taskVersionRefDef(),
          ...environmentVersionRefDef(),
          ...trajectoryRunRefDef(),
        },
      };
    },
  },
  {
    id: 'trajectory-protocol/trajectory-entry',
    output: 'contracts/trajectory/trajectory-entry.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('trajectory-entry'),
        title: 'Arena TrajectoryEntry v1',
        description:
          'One append-only, ordered step of a trajectory. Sequences are 1-based and contiguous ' +
          '(gaps, duplicates and regressions rejected); occurred-at timestamps are monotonically ' +
          'non-decreasing; the stepDigest is the CHAINED digest over { sequence, kind, payload, ' +
          'occurredAt, prevDigest } — entry N commits to entry N-1, entry 1 anchors at the ' +
          'header digest. A completion entry freezes the trajectory.',
        type: 'object',
        additionalProperties: false,
        required: ['sequence', 'kind', 'payload', 'occurredAt', 'prevDigest', 'stepDigest'],
        properties: {
          sequence: positiveInteger(),
          kind: { enum: ENTRY_KINDS },
          payload: {
            description: 'Typed payload per kind (discriminated by `kind`).',
            type: 'object',
          },
          occurredAt: string(TIMESTAMP_PATTERN),
          prevDigest: digest(),
          stepDigest: digest(),
        },
        $defs: entryPayloadDefs(),
      };
    },
  },
  {
    id: 'trajectory-protocol/trajectory-record',
    output: 'contracts/trajectory/trajectory-record.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('trajectory-record'),
        title: 'Arena TrajectoryRecord v1',
        description:
          'Header + entries + chainHead: the frozen aggregate of a trajectory. The chainHead is ' +
          'the FINAL DIGEST OVER THE FULL CHAIN (the last entry stepDigest, or the header digest ' +
          'when empty) — the trajectory digest referenced by the run evidence address. ' +
          'Append-only; frozen at completion.',
        type: 'object',
        additionalProperties: false,
        required: ['header', 'entries', 'chainHead'],
        properties: {
          header: { $ref: `arena:schema/trajectory/trajectory-header@${TRAJECTORY_SCHEMA_VERSION}` },
          entries: {
            type: 'array',
            items: { $ref: `arena:schema/trajectory/trajectory-entry@${TRAJECTORY_SCHEMA_VERSION}` },
            description: 'Ordered entry stream, sequences 1..n contiguous.',
          },
          chainHead: digest(),
        },
      };
    },
  },
  {
    id: 'trajectory-protocol/trajectory-error',
    output: 'contracts/trajectory/trajectory-error.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('trajectory-error'),
        title: 'Arena TrajectoryError v1',
        description:
          'Wire-safe structured form of a TrajectoryError: closed TRAJECTORY_* code set, ' +
          'core category mapping, strictly validating parse (unknown codes rejected).',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: TRAJECTORY_ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object' },
          correlationId: string('^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
        },
      };
    },
  },
  {
    id: 'trajectory-protocol/open-trajectory-command',
    output: 'contracts/trajectory/open-trajectory-command.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('open-trajectory-command'),
        title: 'Arena open-trajectory-command v1',
        description:
          'Command envelope payload: open a trajectory against a validated header. Commands ' +
          'carry a REQUIRED non-null idempotency key (architecture-lock rule 17); the store ' +
          'treats (idempotency key, trajectory id) as the idempotent open address.',
        type: 'object',
        additionalProperties: false,
        required: ['header'],
        properties: {
          header: { $ref: `arena:schema/trajectory/trajectory-header@${TRAJECTORY_SCHEMA_VERSION}` },
        },
      };
    },
  },
  {
    id: 'trajectory-protocol/trajectory-opened-event',
    output: 'contracts/trajectory/trajectory-opened-event.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('trajectory-opened-event'),
        title: 'Arena trajectory-opened-event v1',
        description:
          'Event envelope payload emitted when a trajectory is opened (the store\'s ' +
          'authoritative, content-addressed header).',
        type: 'object',
        additionalProperties: false,
        required: ['header'],
        properties: {
          header: { $ref: `arena:schema/trajectory/trajectory-header@${TRAJECTORY_SCHEMA_VERSION}` },
        },
      };
    },
  },
  {
    id: 'trajectory-protocol/append-trajectory-entry-command',
    output: 'contracts/trajectory/append-trajectory-entry-command.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('append-trajectory-entry-command'),
        title: 'Arena append-trajectory-entry-command v1',
        description:
          'Command envelope payload: append one entry. Carries the DIGEST-FREE entry view — ' +
          'the store computes the chained stepDigest itself and never trusts caller-side ' +
          'digests. Commands carry a REQUIRED non-null idempotency key (lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['trajectoryId', 'sequence', 'kind', 'payload', 'occurredAt'],
        properties: {
          trajectoryId: string(TRAJECTORY_ID_PATTERN),
          sequence: positiveInteger(),
          kind: { enum: ENTRY_KINDS },
          payload: { type: 'object', description: 'Typed payload per kind.' },
          occurredAt: string(TIMESTAMP_PATTERN),
        },
      };
    },
  },
  {
    id: 'trajectory-protocol/trajectory-entry-appended-event',
    output: 'contracts/trajectory/trajectory-entry-appended-event.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('trajectory-entry-appended-event'),
        title: 'Arena trajectory-entry-appended-event v1',
        description:
          'Event envelope payload: the store\'s authoritative append result — the entry WITH ' +
          'its computed chained stepDigest plus the resulting chain head (the trajectory ' +
          'digest for run addressability).',
        type: 'object',
        additionalProperties: false,
        required: ['trajectoryId', 'entry', 'chainHead'],
        properties: {
          trajectoryId: string(TRAJECTORY_ID_PATTERN),
          entry: { $ref: `arena:schema/trajectory/trajectory-entry@${TRAJECTORY_SCHEMA_VERSION}` },
          chainHead: digest(),
        },
      };
    },
  },
  {
    id: 'trajectory-protocol/schema-registry',
    output: 'contracts/trajectory/trajectory-schema-registry.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('schema-registry'),
        title: 'Arena trajectory-protocol schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/trajectory. A SchemaRef matching this enum ' +
          'is a known trajectory-protocol schema at the listed version; anything else is not.',
        type: 'string',
        enum: TRAJECTORY_SCHEMA_NAMES.map((name) => ref(name)),
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
  const tempDir = join(tmpdir(), `arena-trajectory-contracts-${process.pid}-${Date.now()}`);
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
