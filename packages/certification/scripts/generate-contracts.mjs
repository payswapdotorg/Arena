#!/usr/bin/env node
/**
 * Arena certification-protocol contract generator (Work Order A023).
 *
 * Follows the A001 generated-contracts convention
 * (scripts/generate-contracts.mjs) and the package-level convention
 * (packages/verification/scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id,
 *     repo-relative output path, builder). This generator owns the A023
 *     surfaces ONLY — it emits every schema for @arena/certification into
 *     contracts/certification/ at the repository root.
 *   - Generated files are committed, deterministic (sorted keys, 2-space
 *     indent, trailing newline) and carry a versioned SchemaRef $id.
 *   - `--check` regenerates into a temp directory and compares with the
 *     committed copies; any missing / extra / changed file is drift and
 *     exits non-zero. The drift suite (src/drift.test.ts) runs this check
 *     as part of `pnpm test`, the package script `contracts:check` runs it
 *     directly, and the governance G9 check auto-discovers this generator
 *     through its packages/.../generate-contracts.mjs glob.
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
// (packages/certification/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const CERTIFICATION_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const CERTIFICATION_VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const NEUTRAL_TEXT_PATTERN = '^[\\x20-\\x7E\\n\\t]{1,4096}$';
const SUITE_REVISION_PATTERN = '^[0-9a-f]{64}$';
const SCHEMA_REF_NAMESPACE_PATTERN = '^[a-z][a-z0-9-]*$';
const SCHEMA_REF_VERSION_PATTERN = '^\\d+\\.\\d+\\.\\d+$';
const CORRELATION_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

const COMPONENT_KINDS = ['evaluation', 'verification', 'compatibility'];
const CERTIFICATION_VERDICTS = ['pass', 'conditional-pass', 'fail', 'unknown'];
const COMPONENT_VERDICTS = ['pass', 'fail', 'unknown'];
const UNKNOWN_REASONS = ['unverifiable-component', 'suite-misconfiguration'];

const CERTIFICATION_ERROR_CODES = [
  'CERTIFICATION_COMPONENT_MISMATCH',
  'CERTIFICATION_DUPLICATE_COMPONENT',
  'CERTIFICATION_IDEMPOTENCY_CONFLICT',
  'CERTIFICATION_IDENTITY_CONFLICT',
  'CERTIFICATION_INVALID_COMPONENT_KIND',
  'CERTIFICATION_INVALID_COMPONENT_VERDICT',
  'CERTIFICATION_INVALID_DIGEST',
  'CERTIFICATION_INVALID_IDENTITY',
  'CERTIFICATION_INVALID_PROVENANCE',
  'CERTIFICATION_INVALID_RECORD',
  'CERTIFICATION_INVALID_REVISION',
  'CERTIFICATION_INVALID_SCHEMA_REF',
  'CERTIFICATION_INVALID_STATEMENT',
  'CERTIFICATION_INVALID_SUITE',
  'CERTIFICATION_INVALID_TEXT',
  'CERTIFICATION_INVALID_TIMESTAMP',
  'CERTIFICATION_INVALID_VERDICT',
  'CERTIFICATION_NOT_FOUND',
  'CERTIFICATION_SCOPE_VIOLATION',
  'CERTIFICATION_TAMPERED',
  'CERTIFICATION_TIMESTAMP_REGRESSION',
  'CERTIFICATION_UNKNOWN_ERROR',
  'CERTIFICATION_UNSUPPORTED_RECORD_VERSION',
  'CERTIFICATION_UNSUPPORTED_SCOPE',
  'CERTIFICATION_VERSION_CONFLICT',
];
const ERROR_CATEGORIES = ['encoding', 'integrity', 'unknown', 'validation', 'versioning'];
const CERTIFICATION_SCHEMA_VERSION = '1.0.0';
const CERTIFICATION_SCHEMA_NAMES = [
  'certification-suite',
  'certification-record',
  'certification-statement',
  'certification-verdict',
  'certification-error',
  'run-certification-command',
  'certification-recorded-event',
  'schema-registry',
];

const ref = (name) => `arena:schema/certification/${name}@${CERTIFICATION_SCHEMA_VERSION}`;

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

const suiteComponentRefsDef = () => ({
  suiteComponentRefs: {
    additionalProperties: false,
    description:
      'A typed list of component refs (one kind, zero or more digests) the suite composes.',
    properties: {
      kind: { enum: COMPONENT_KINDS },
      refs: {
        type: 'array',
        minItems: 1,
        items: digest(),
        description: 'sha256 content digests of the referenced sibling descriptors/records.',
      },
    },
    required: ['kind', 'refs'],
    type: 'object',
  },
});

const verdictSemanticsDef = () => ({
  verdictSemantics: {
    additionalProperties: false,
    description:
      'The declared meaning of each verdict for THIS suite (the design law: a suite declares what each verdict establishes). All four declarations are mandatory non-empty text.',
    properties: {
      pass: string(NEUTRAL_TEXT_PATTERN),
      'conditional-pass': string(NEUTRAL_TEXT_PATTERN),
      fail: string(NEUTRAL_TEXT_PATTERN),
      unknown: string(NEUTRAL_TEXT_PATTERN),
    },
    required: ['pass', 'conditional-pass', 'fail', 'unknown'],
    type: 'object',
  },
});

const suiteProvenanceDef = () => ({
  suiteProvenance: {
    additionalProperties: false,
    description: 'Provenance of the suite declaration.',
    properties: {
      authoredBy: string(CERTIFICATION_ID_PATTERN),
      submittedAt: string(TIMESTAMP_PATTERN),
      notes: nullable(string(NEUTRAL_TEXT_PATTERN)),
    },
    required: ['authoredBy', 'submittedAt', 'notes'],
    type: 'object',
  },
});

const componentVerdictEntryDef = () => ({
  componentVerdictEntry: {
    additionalProperties: false,
    description:
      'One component verdict within a certification run (a pass component MUST carry a constraints array; a fail/unknown component MUST carry null).',
    properties: {
      refKind: { enum: COMPONENT_KINDS },
      refDigest: digest(),
      verdict: { enum: COMPONENT_VERDICTS },
      constraints: nullable({
        type: 'array',
        items: string(NEUTRAL_TEXT_PATTERN),
      }),
      notes: nullable(string(NEUTRAL_TEXT_PATTERN)),
    },
    required: ['refKind', 'refDigest', 'verdict', 'constraints', 'notes'],
    type: 'object',
  },
});

const unknownCauseDef = () => ({
  unknownCause: {
    additionalProperties: false,
    description:
      "The structured WHY of an unknown verdict: a closed reason taxonomy member plus the deterministic detail listing the driving component refs. REQUIRED iff the verdict is unknown; MUST be null otherwise.",
    properties: {
      reason: { enum: UNKNOWN_REASONS },
      detail: string(NEUTRAL_TEXT_PATTERN),
    },
    required: ['reason', 'detail'],
    type: 'object',
  },
});

const recordProvenanceDef = () => ({
  recordProvenance: {
    additionalProperties: false,
    description: 'Provenance of one certification run.',
    properties: {
      executedBy: string(CERTIFICATION_ID_PATTERN),
      recordedAt: string(TIMESTAMP_PATTERN),
      notes: nullable(string(NEUTRAL_TEXT_PATTERN)),
    },
    required: ['executedBy', 'recordedAt', 'notes'],
    type: 'object',
  },
});

const certificationStatementDef = () => ({
  certificationStatement: {
    additionalProperties: false,
    description:
      'The SCOPED certification statement (the design law): Body×Substrate×Environment×RuntimeProfile×Suite+Rev×Verdict + rendered text + constraints. NEVER an unscoped professional claim.',
    properties: {
      bodyVersionRef: digest(),
      substrateRef: digest(),
      environmentRef: digest(),
      runtimeProfileRef: digest(),
      possessionRef: digest(),
      suiteRef: digest(),
      suiteRevision: string(SUITE_REVISION_PATTERN),
      verdict: { enum: CERTIFICATION_VERDICTS },
      statementText: string(NEUTRAL_TEXT_PATTERN),
      constraints: {
        type: 'array',
        items: string(NEUTRAL_TEXT_PATTERN),
        description: 'Declared constraints when verdict === conditional-pass; [] otherwise.',
      },
    },
    required: [
      'bodyVersionRef',
      'substrateRef',
      'environmentRef',
      'runtimeProfileRef',
      'possessionRef',
      'suiteRef',
      'suiteRevision',
      'verdict',
      'statementText',
      'constraints',
    ],
    type: 'object',
  },
});

// ---------------------------------------------------------------------------
// Contract manifest — the A023 owned schema surface.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'certification-protocol/certification-suite',
    output: 'contracts/certification/certification-suite.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('certification-suite'),
        title: 'Arena CertificationSuiteDescriptor v1',
        description:
          'The content-addressed, versioned declaration of a certification suite: id, version, ' +
          'title, scopeStatement, component refs (closed component-kind enum: evaluation | ' +
          'verification | compatibility), declared verdict semantics (all four mandatory), ' +
          'input/output schema refs and provenance. The suite digest IS the design-law ' +
          '"revision X" — same descriptor ⇒ same digest; ANY change ⇒ a different digest; ' +
          'a different digest under the same (suiteId, version) is an identity conflict.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'suiteId',
          'version',
          'title',
          'scopeStatement',
          'components',
          'verdictSemantics',
          'inputSchema',
          'outputSchema',
          'provenance',
          'digest',
        ],
        properties: {
          recordVersion: { const: 1, description: 'Wire version of the descriptor shape.' },
          suiteId: string(CERTIFICATION_ID_PATTERN),
          version: string(CERTIFICATION_VERSION_PATTERN),
          title: string(NEUTRAL_TEXT_PATTERN),
          scopeStatement: string(NEUTRAL_TEXT_PATTERN),
          components: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/suiteComponentRefs' },
            description:
              'Component lists (one per kind) the suite composes. At least one list MUST be present; each list MUST carry at least one ref.',
          },
          verdictSemantics: { $ref: '#/$defs/verdictSemantics' },
          inputSchema: { $ref: '#/$defs/schemaRef' },
          outputSchema: { $ref: '#/$defs/schemaRef' },
          provenance: { $ref: '#/$defs/suiteProvenance' },
          digest: digest(),
        },
        $defs: {
          ...schemaRefDef(),
          ...suiteComponentRefsDef(),
          ...verdictSemanticsDef(),
          ...suiteProvenanceDef(),
        },
      };
    },
  },
  {
    id: 'certification-protocol/certification-record',
    output: 'contracts/certification/certification-record.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('certification-record'),
        title: 'Arena CertificationRecord v1',
        description:
          'The append-once record of one certification run: suite descriptor digest, possession ' +
          'digest, the flattened scope refs (body/substrate/environment/runtime-profile — the ' +
          'design-law fields), the per-component summary (one closed-vocabulary verdict per ' +
          'declared suite ref), the DERIVED certification verdict (pass | conditional-pass | ' +
          'fail | unknown — computed purely from the component summary, never caller-supplied), ' +
          'the DERIVED structured unknown cause (required iff unknown), the DERIVED constraints ' +
          'list, the DERIVED scoped CertificationStatement (design-law form), correlation id + ' +
          'idempotency key, the COMPUTED input digest over {suiteRef, possessionRef, ' +
          'componentVerdicts}, timestamps and run provenance. Frozen on creation; pure ' +
          'replayable construction; identical inputs ⇒ identical record digest.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'suiteRef',
          'possessionRef',
          'bodyVersionRef',
          'substrateRef',
          'environmentRef',
          'runtimeProfileRef',
          'componentVerdicts',
          'verdict',
          'unknownCause',
          'constraints',
          'statement',
          'correlationId',
          'idempotencyKey',
          'inputDigest',
          'startedAt',
          'finishedAt',
          'provenance',
          'digest',
        ],
        properties: {
          recordVersion: { const: 1, description: 'Wire version of the record shape.' },
          suiteRef: digest(),
          possessionRef: digest(),
          bodyVersionRef: digest(),
          substrateRef: digest(),
          environmentRef: digest(),
          runtimeProfileRef: digest(),
          componentVerdicts: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/componentVerdictEntry' },
            description: 'One component verdict per declared suite ref, in suite declaration order.',
          },
          verdict: {
            enum: CERTIFICATION_VERDICTS,
            description: 'The derived verdict — a closed four-member vocabulary, never a quantitative value.',
          },
          unknownCause: nullable({ $ref: '#/$defs/unknownCause' }),
          constraints: {
            type: 'array',
            items: string(NEUTRAL_TEXT_PATTERN),
            description: 'Declared constraints when verdict === conditional-pass; [] otherwise.',
          },
          statement: { $ref: '#/$defs/certificationStatement' },
          correlationId: string(CORRELATION_PATTERN),
          idempotencyKey: string(CORRELATION_PATTERN),
          inputDigest: digest(),
          startedAt: string(TIMESTAMP_PATTERN),
          finishedAt: string(TIMESTAMP_PATTERN),
          provenance: { $ref: '#/$defs/recordProvenance' },
          digest: digest(),
        },
        $defs: {
          ...componentVerdictEntryDef(),
          ...unknownCauseDef(),
          ...certificationStatementDef(),
          ...recordProvenanceDef(),
        },
      };
    },
  },
  {
    id: 'certification-protocol/certification-statement',
    output: 'contracts/certification/certification-statement.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('certification-statement'),
        title: 'Arena CertificationStatement v1',
        description:
          'The SCOPED certification statement (the design law). Carries Body×Substrate×' +
          'Environment×RuntimeProfile×Suite+Rev×Verdict + rendered text + constraints. ' +
          'NEVER an unscoped professional claim.',
        additionalProperties: false,
        required: [
          'bodyVersionRef',
          'substrateRef',
          'environmentRef',
          'runtimeProfileRef',
          'possessionRef',
          'suiteRef',
          'suiteRevision',
          'verdict',
          'statementText',
          'constraints',
        ],
        type: 'object',
        properties: {
          bodyVersionRef: digest(),
          substrateRef: digest(),
          environmentRef: digest(),
          runtimeProfileRef: digest(),
          possessionRef: digest(),
          suiteRef: digest(),
          suiteRevision: string(SUITE_REVISION_PATTERN),
          verdict: { enum: CERTIFICATION_VERDICTS },
          statementText: string(NEUTRAL_TEXT_PATTERN),
          constraints: {
            type: 'array',
            items: string(NEUTRAL_TEXT_PATTERN),
          },
        },
      };
    },
  },
  {
    id: 'certification-protocol/certification-verdict',
    output: 'contracts/certification/certification-verdict.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('certification-verdict'),
        title: 'Arena certification-verdict v1',
        description:
          'The verdict semantics object: the declared meaning of pass / conditional-pass / ' +
          'fail / unknown for a specific suite (the design law: a suite declares what each ' +
          'verdict establishes). The verdict vocabulary itself is the closed enum pass | ' +
          'conditional-pass | fail | unknown — it has no quantitative members and cannot ' +
          'carry graded values.',
        allOf: [{ $ref: '#/$defs/verdictSemantics' }],
        $defs: {
          ...verdictSemanticsDef(),
        },
      };
    },
  },
  {
    id: 'certification-protocol/certification-error',
    output: 'contracts/certification/certification-error.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('certification-error'),
        title: 'Arena CertificationError v1',
        description:
          'Wire-safe structured form of a CertificationError: closed CERTIFICATION_* code set, ' +
          'core category mapping, strictly validating parse (unknown codes rejected).',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: CERTIFICATION_ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object' },
          correlationId: string(CORRELATION_PATTERN),
        },
      };
    },
  },
  {
    id: 'certification-protocol/run-certification-command',
    output: 'contracts/certification/run-certification-command.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('run-certification-command'),
        title: 'Arena run-certification-command v1',
        description:
          'Command envelope payload: run one certification. Carries the suite descriptor digest, ' +
          'the possession digest, the flattened scope refs (body/substrate/environment/runtime-' +
          'profile) and the per-component verdict summary; the engine resolves the suite, ' +
          'validates set-equality, derives the verdict/unknown cause/constraints/statement, ' +
          'and emits certification-recorded-event. Commands carry a REQUIRED non-null ' +
          'idempotency key (architecture-lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: [
          'suiteRef',
          'possessionRef',
          'bodyVersionRef',
          'substrateRef',
          'environmentRef',
          'runtimeProfileRef',
          'componentVerdicts',
        ],
        properties: {
          suiteRef: digest(),
          possessionRef: digest(),
          bodyVersionRef: digest(),
          substrateRef: digest(),
          environmentRef: digest(),
          runtimeProfileRef: digest(),
          componentVerdicts: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/componentVerdictEntry' },
          },
        },
        $defs: {
          ...componentVerdictEntryDef(),
        },
      };
    },
  },
  {
    id: 'certification-protocol/certification-recorded-event',
    output: 'contracts/certification/certification-recorded-event.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('certification-recorded-event'),
        title: 'Arena certification-recorded-event v1',
        description:
          "Event envelope payload: the engine's authoritative result — the frozen, " +
          'content-addressed CertificationRecord. The event carries the run command idempotency ' +
          'key when provided so event-stream replays are idempotency-addressable.',
        type: 'object',
        additionalProperties: false,
        required: ['record'],
        properties: {
          record: {
            $ref: `arena:schema/certification/certification-record@${CERTIFICATION_SCHEMA_VERSION}`,
          },
        },
      };
    },
  },
  {
    id: 'certification-protocol/schema-registry',
    output: 'contracts/certification/certification-schema-registry.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('schema-registry'),
        title: 'Arena certification-protocol schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/certification. A SchemaRef matching this enum ' +
          'is a known certification-protocol schema at the listed version; anything else is not.',
        type: 'string',
        enum: CERTIFICATION_SCHEMA_NAMES.map((name) => ref(name)),
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
  const tempDir = join(tmpdir(), `arena-certification-contracts-${process.pid}-${Date.now()}`);
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
      console.error(
        '[contracts] run: node scripts/generate-contracts.mjs   then commit the result',
      );
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
