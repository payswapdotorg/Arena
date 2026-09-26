#!/usr/bin/env node
/**
 * Arena contract generator (Work Order A001).
 *
 * This is the repo-wide "generated contracts" convention:
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id, repo-relative
 *     output path, builder). Future work orders plug their generators in by
 *     extending this manifest (or importing this script's helpers from their
 *     own generator) — the governance drift check (G9) picks them up
 *     automatically because it regenerates through this entry point.
 *   - Generated files are committed, deterministic (sorted keys, stable
 *     formatting) and carry a versioned SchemaRef $id.
 *   - `--check` regenerates into a temp directory and compares with the
 *     committed copies; any difference (missing/extra/changed) is drift and
 *     exits non-zero. This is wired into scripts/governance-check.py (G9).
 *
 * Contract locations: A001 demonstrates the convention inside
 * packages/protocol-core/contracts/. Later work orders place generated
 * contracts under contracts/<domain>/ at the repository root (per
 * spec/work-items.md owned surfaces) and register them here.
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

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Shared protocol constants (must match packages/protocol-core/src — parity is
// asserted by packages/protocol-core/src/contracts.parity.test.ts).
// ---------------------------------------------------------------------------

const SCHEMA_REF_PATTERN = '^arena:schema/[a-z][a-z0-9-]*/[a-z][a-z0-9-]*@\\d+\\.\\d+\\.\\d+$';
const IDENTIFIER_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const ENVELOPE_KINDS = ['command', 'event', 'query', 'response'];
const PROTOCOL_ERROR_CODES = [
  'PROTOCOL_CANONICALIZATION_FAILED',
  'PROTOCOL_ENVELOPE_TAMPERED',
  'PROTOCOL_INVALID_CORRELATION_ID',
  'PROTOCOL_INVALID_ENVELOPE',
  'PROTOCOL_INVALID_IDEMPOTENCY_KEY',
  'PROTOCOL_INVALID_JSON',
  'PROTOCOL_INVALID_SCHEMA_REF',
  'PROTOCOL_SCHEMA_MISMATCH',
  'PROTOCOL_UNCLASSIFIED_ERROR',
  'PROTOCOL_UNKNOWN_ERROR_CODE',
  'PROTOCOL_UNKNOWN_SCHEMA',
  'PROTOCOL_UNSUPPORTED_VERSION',
];
const PROTOCOL_ERROR_CATEGORIES = ['encoding', 'integrity', 'unknown', 'validation', 'versioning'];
const CORE_SCHEMA_VERSION = '1.0.0';
// Schema names within the 'protocol' namespace (must match
// packages/protocol-core/src/schema-ref.ts CORE_SCHEMAS keys).
const CORE_SCHEMA_NAMES = [
  'envelope',
  'protocol-error',
  'schema-ref',
  'schema-registry',
];

const ref = (name) => `arena:schema/protocol/${name}@${CORE_SCHEMA_VERSION}`;

// ---------------------------------------------------------------------------
// Contract manifest — extend this list to plug in new generators.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'protocol-core/envelope',
    output: 'packages/protocol-core/contracts/envelope.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('envelope'),
        title: 'Arena Envelope v1',
        description:
          'Stable wire envelope for Arena protocol messages. Canonical form is canonical JSON ' +
          '(object keys sorted, no insignificant whitespace); the envelope digest is sha256 over ' +
          'the canonical serialization. idempotencyKey MUST be non-null when kind is "command" ' +
          '(architecture-lock rule 17: long-running jobs are idempotent and correlation-addressable).',
        type: 'object',
        additionalProperties: false,
        required: [
          'v',
          'kind',
          'schema',
          'id',
          'correlationId',
          'idempotencyKey',
          'issuedAt',
          'payload',
        ],
        properties: {
          v: { const: 1, description: 'Envelope wire version.' },
          kind: { enum: ENVELOPE_KINDS, description: 'Message classification.' },
          schema: {
            type: 'string',
            pattern: SCHEMA_REF_PATTERN,
            description: 'SchemaRef of the payload schema, in string form.',
          },
          id: {
            type: 'string',
            pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
            description: 'Unique envelope instance id (UUIDv4).',
          },
          correlationId: {
            type: 'string',
            pattern: IDENTIFIER_PATTERN,
            description: 'Correlation identifier for the causal flow this message belongs to.',
          },
          idempotencyKey: {
            oneOf: [
              { type: 'null' },
              { type: 'string', pattern: IDENTIFIER_PATTERN },
            ],
            description: 'Idempotency key; required (non-null) for command messages.',
          },
          issuedAt: {
            type: 'string',
            format: 'date-time',
            description: 'RFC 3339 issuance timestamp.',
          },
          payload: { description: 'Message payload, addressed by the schema ref.' },
        },
      };
    },
  },
  {
    id: 'protocol-core/schema-ref',
    output: 'packages/protocol-core/contracts/schema-ref.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('schema-ref'),
        title: 'Arena SchemaRef v1',
        description:
          'Versioned addressing scheme for Arena schemas: arena:schema/<namespace>/<name>@<version>. ' +
          'Versions are exact major.minor.patch (no prerelease/build suffixes in core schemas).',
        type: 'string',
        pattern: SCHEMA_REF_PATTERN,
      };
    },
  },
  {
    id: 'protocol-core/protocol-error',
    output: 'packages/protocol-core/contracts/protocol-error.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('protocol-error'),
        title: 'Arena ProtocolError v1',
        description:
          'Structured, serializable form of the Arena protocol error taxonomy. Unknown codes are ' +
          'rejected when parsing (PROTOCOL_UNKNOWN_ERROR_CODE).',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: PROTOCOL_ERROR_CODES },
          category: { enum: PROTOCOL_ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object', description: 'Structured, JSON-serializable context.' },
          correlationId: { type: 'string', pattern: IDENTIFIER_PATTERN },
        },
      };
    },
  },
  {
    id: 'protocol-core/schema-registry',
    output: 'packages/protocol-core/contracts/schema-registry.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('schema-registry'),
        title: 'Arena core schema registry v1',
        description:
          'Enumerates the core protocol schemas defined by @arena/protocol-core. A SchemaRef ' +
          'matching this enum is a known core schema at the listed version; anything else is not.',
        type: 'string',
        enum: CORE_SCHEMA_NAMES.map((name) => ref(name)),
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
  const tempDir = join(tmpdir(), `arena-contracts-${process.pid}-${Date.now()}`);
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

    // Extra-file check is scoped to the committed contract directories (the
    // parent directories of declared outputs) — never the whole tree, so
    // running --check against the repository root is safe.
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
