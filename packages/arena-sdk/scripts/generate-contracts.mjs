#!/usr/bin/env node
/**
 * Arena public/private API contract generator (Work Order A025).
 *
 * Follows the A001 generated-contracts convention
 * (scripts/generate-contracts.mjs) and the package-level convention
 * (packages/certification/scripts/generate-contracts.mjs — the newest
 * full-triple sibling, A023):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id,
 *     repo-relative output path, builder). This generator owns the
 *     A025 surfaces ONLY — it emits every schema for
 *     @arena/arena-sdk into contracts/api/ at the repository root.
 *   - Generated files are committed, deterministic (sorted keys,
 *     2-space indent, trailing newline) and carry a versioned
 *     SchemaRef $id.
 *   - `--check` regenerates into a temp directory and compares with
 *     the committed copies; any missing / extra / changed file is
 *     drift and exits non-zero. The drift suite (src/drift.test.ts)
 *     runs this check as part of `pnpm test`, the package script
 *     `contracts:check` runs it directly, and the governance G9 check
 *     auto-discovers this generator through its
 *     packages/.../generate-contracts.mjs glob (the root manifest
 *     itself needs no edit).
 *   - The deterministic serializer is duplicated from the A001
 *     generator (10 lines) instead of imported, because importing
 *     that module executes its CLI main() as an import side effect.
 *
 * Domain-record payloads (ReleaseRecord, CertificationRecord,
 * CompatibilityRecord, CertificationSuite, BodyVersion,
 * ReleasePublicationRecord) are carried OPAQUELY by the API wire
 * contracts (`type: "object"`): their shapes are owned by their
 * domain packages' own contracts (A003/A022/A023), and the SDK layer
 * asserts structural parity through the owning packages' guards
 * instead of duplicating their schemas here.
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
// (packages/arena-sdk/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const TENANT_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const CORRELATION_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const BODY_NAME_PATTERN = '^[a-z][a-z0-9-]{1,127}$';
const NAMESPACE_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const SEMVER_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';

const QUERY_KINDS = [
  'get-body-version',
  'get-certification-record',
  'get-certification-suite',
  'get-compatibility-record',
  'get-release-publication',
  'get-release-record',
  'latest-compatibility-verdict',
  'list-body-registrations',
  'list-certification-records',
  'list-certification-suites',
  'list-certifications-by-suite',
  'list-compatibility-records',
  'list-release-records',
  'current-certification',
  'resolve-active-release',
  'resolve-release-status',
];
const LIFECYCLE_STATES = ['registered', 'superseded', 'retired', 'unknown'];
const VISIBILITIES = ['published', 'unpublished'];
const CHANNELS = ['development', 'candidate', 'stable'];

const ARENA_API_ERROR_CODES = [
  'ARENA_API_CORRELATION_MISMATCH',
  'ARENA_API_CROSS_TENANT_ACCESS',
  'ARENA_API_INVALID_CHANNEL',
  'ARENA_API_INVALID_DIGEST',
  'ARENA_API_INVALID_PARAMS',
  'ARENA_API_INVALID_QUERY',
  'ARENA_API_INVALID_QUERY_KIND',
  'ARENA_API_INVALID_RECORD',
  'ARENA_API_INVALID_RESPONSE',
  'ARENA_API_INVALID_SCHEMA_REF',
  'ARENA_API_INVALID_SCOPE',
  'ARENA_API_SCHEMA_MISMATCH',
  'ARENA_API_INVALID_TENANT',
  'ARENA_API_SCOPE_REQUIRED',
  'ARENA_API_TAMPERED',
  'ARENA_API_UNKNOWN_ERROR',
  'ARENA_API_UNSUPPORTED_VERSION',
];
const ERROR_CATEGORIES = ['integrity', 'scope', 'unknown', 'validation', 'versioning'];
const API_SCHEMA_VERSION = '1.0.0';
const API_SCHEMA_NAMES = [
  'api-error',
  'api-query-kind',
  'api-query-request',
  'api-query-response',
  'api-read-scope',
  'api-release-status',
  'schema-registry',
];

const ref = (name) => `arena:schema/api/${name}@${API_SCHEMA_VERSION}`;

// ---------------------------------------------------------------------------
// Reusable schema fragments
// ---------------------------------------------------------------------------

const string = (pattern) => ({ type: 'string', pattern });
const digest = () => string(DIGEST_PATTERN);

/** Per-kind query params defs (closed shapes; discriminant lives on the parent `kind`). */
const paramsDefs = () => {
  const defs = {};
  const def = (name, properties, description) => {
    defs[`${name}Params`] = {
      additionalProperties: false,
      description,
      properties,
      required: Object.keys(properties),
      type: 'object',
    };
  };
  // Closed empty shape: no properties allowed at all.
  const emptyDef = (name, description) => {
    defs[`${name}Params`] = {
      additionalProperties: false,
      description,
      maxProperties: 0,
      type: 'object',
    };
  };
  def(
    'get-release-record',
    { digest: digest() },
    'Parameters of get-release-record: the sha256 content digest of the release record.',
  );
  emptyDef('list-release-records', 'Parameters of list-release-records: the closed empty shape.');
  def(
    'list-body-registrations',
    { tenant: string(TENANT_PATTERN), name: string(BODY_NAME_PATTERN) },
    'Parameters of list-body-registrations: the body identity (A003 tenant + name).',
  );
  def(
    'resolve-active-release',
    { tenant: string(TENANT_PATTERN), name: string(BODY_NAME_PATTERN), channel: { enum: CHANNELS } },
    'Parameters of resolve-active-release: the body identity plus the A024 release channel.',
  );
  def(
    'resolve-release-status',
    { namespace: string(NAMESPACE_PATTERN), name: string(BODY_NAME_PATTERN), version: string(SEMVER_PATTERN) },
    'Parameters of resolve-release-status: the release artifact identity (A002/A024 ReleaseArtifactRef fields — release semver).',
  );
  def(
    'get-release-publication',
    { digest: digest() },
    'Parameters of get-release-publication: the sha256 digest of the publication record.',
  );
  def(
    'get-certification-record',
    { digest: digest() },
    'Parameters of get-certification-record: the sha256 digest of the certification record.',
  );
  emptyDef(
    'list-certification-records',
    'Parameters of list-certification-records: the closed empty shape.',
  );
  def(
    'list-certifications-by-suite',
    { suiteRef: digest() },
    'Parameters of list-certifications-by-suite: the suite digest ("revision X").',
  );
  def(
    'current-certification',
    { subject: { type: 'object', description: 'A023 CertificationSubject — the full five-component composition under test (owned by arena:schema/certification/*; carried opaquely).' } },
    'Parameters of current-certification: the composition under test.',
  );
  def(
    'get-certification-suite',
    { suiteRef: digest() },
    'Parameters of get-certification-suite: the suite digest.',
  );
  emptyDef('list-certification-suites', 'Parameters of list-certification-suites: the closed empty shape.');
  def(
    'get-compatibility-record',
    { digest: digest() },
    'Parameters of get-compatibility-record: the A022 recordDigest.',
  );
  emptyDef(
    'list-compatibility-records',
    'Parameters of list-compatibility-records: the closed empty shape.',
  );
  def(
    'latest-compatibility-verdict',
    { bodyVersionRef: { type: 'string', minLength: 1 }, substrateRef: { type: 'string', minLength: 1 } },
    'Parameters of latest-compatibility-verdict: the A022 string-form body-version and substrate addresses.',
  );
  def(
    'get-body-version',
    { digest: digest() },
    'Parameters of get-body-version: the sha256 content digest of the body version.',
  );
  return defs;
};

/** if/then conditional binding each query kind to its params def. */
const paramsConditionals = () =>
  QUERY_KINDS.map((kind) => ({
    if: { properties: { kind: { const: kind } }, required: ['kind'] },
    then: { properties: { params: { $ref: `#/$defs/${kind}Params` } } },
  }));

/** Per-kind result schemas (opaque domain records; closed per-kind vocabulary). */
const resultSchemaFor = (kind) => {
  const opaqueRecord = (owner) => ({
    type: 'object',
    description: `An opaque ${owner} payload — owned and schema'd by its domain package; validated structurally by the owning package's guard.`,
  });
  const opaqueList = (owner) => ({
    type: 'array',
    items: opaqueRecord(owner),
    description: `A list of opaque ${owner} payloads (append order).`,
  });
  switch (kind) {
    case 'get-release-record':
    case 'resolve-active-release':
      return {
        oneOf: [{ type: 'null' }, opaqueRecord('A024 ReleaseRecord')],
        description: 'The release record, or null when none is visible to the scope.',
      };
    case 'list-release-records':
    case 'list-body-registrations':
      return opaqueList('A024 ReleaseRecord');
    case 'get-release-publication':
      return {
        oneOf: [{ type: 'null' }, opaqueRecord('A024 ReleasePublicationRecord')],
        description: 'The publication record, or null when unknown to the scope.',
      };
    case 'resolve-release-status':
      return { $ref: '#/$defs/releaseStatus' };
    case 'get-certification-record':
    case 'current-certification':
      return {
        oneOf: [{ type: 'null' }, opaqueRecord('A023 CertificationRecord')],
        description:
          'The certification record (the derived scoped statement travels inside it), or null when none is visible.',
      };
    case 'list-certification-records':
    case 'list-certifications-by-suite':
      return opaqueList('A023 CertificationRecord');
    case 'get-certification-suite':
      return {
        oneOf: [{ type: 'null' }, opaqueRecord('A023 CertificationSuite')],
        description: 'The certification suite, or null when unknown.',
      };
    case 'list-certification-suites':
      return opaqueList('A023 CertificationSuite');
    case 'get-compatibility-record':
    case 'latest-compatibility-verdict':
      return {
        oneOf: [{ type: 'null' }, opaqueRecord('A022 CompatibilityRecord')],
        description: 'The compatibility record (verdict + reasons + details), or null.',
      };
    case 'list-compatibility-records':
      return opaqueList('A022 CompatibilityRecord');
    case 'get-body-version':
      return {
        oneOf: [{ type: 'null' }, opaqueRecord('A003 BodyVersion')],
        description: 'The body version, or null when not visible to the scope.',
      };
    default:
      throw new Error(`unknown query kind in generator: ${kind}`);
  }
};

// ---------------------------------------------------------------------------
// Contracts manifest
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'api-protocol/api-error',
    output: 'contracts/api/api-error.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('api-error'),
        title: 'Arena ArenaApiError v1',
        description:
          'Wire-safe structured form of an ArenaApiError: closed ARENA_API_* code set, ' +
          'category mapping, strictly validating parse (unknown codes rejected). The API ' +
          'layer adds the `scope` category for cross-tenant fail-closed reads.',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: ARENA_API_ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object' },
          correlationId: string(CORRELATION_PATTERN),
        },
      };
    },
  },
  {
    id: 'api-protocol/api-read-scope',
    output: 'contracts/api/api-read-scope.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('api-read-scope'),
        title: 'Arena api-read-scope v1',
        description:
          'The REQUIRED tenant scope every Arena API query executes under. The reserved ' +
          "namespace 'public' reads only records explicitly published for global " +
          'visibility; every other tenant sees its own records plus public ones — no ' +
          'silent cross-tenant reads (architecture-lock rule 11).',
        type: 'object',
        additionalProperties: false,
        required: ['tenant'],
        properties: {
          tenant: string(TENANT_PATTERN),
        },
      };
    },
  },
  {
    id: 'api-protocol/api-query-kind',
    output: 'contracts/api/api-query-kind.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('api-query-kind'),
        title: 'Arena api-query-kind v1',
        description:
          'The CLOSED query vocabulary of the Arena public/private API: the single ' +
          'enumeration of read/query paths over the platform core (registries, ' +
          'certification statements, release records, compatibility verdicts). Unknown ' +
          'kinds are rejected — never coerced.',
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: { enum: QUERY_KINDS },
        },
      };
    },
  },
  {
    id: 'api-protocol/api-query-request',
    output: 'contracts/api/api-query-request.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('api-query-request'),
        title: 'Arena api-query-request v1',
        description:
          'Query envelope payload (envelope kind "query"): one closed envelope over ' +
          'every Arena read path — the query kind, the per-kind params and the REQUIRED ' +
          'read scope. Queries are not commands: the envelope idempotency key is NULL ' +
          '(idempotency keys are REQUIRED on commands only — architecture-lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['requestVersion', 'kind', 'params', 'scope'],
        properties: {
          requestVersion: { const: 1 },
          kind: { enum: QUERY_KINDS },
          params: {
            description: 'Per-kind parameters (bound by kind through if/then conditionals).',
          },
          scope: { $ref: `arena:schema/api/api-read-scope@${API_SCHEMA_VERSION}` },
        },
        allOf: paramsConditionals(),
        $defs: paramsDefs(),
      };
    },
  },
  {
    id: 'api-protocol/api-query-response',
    output: 'contracts/api/api-query-response.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('api-query-response'),
        title: 'Arena api-query-response v1',
        description:
          'Response envelope payload (envelope kind "response"): the echoed query kind ' +
          'and the per-kind result (bound by kind through if/then conditionals). ' +
          'Domain-record payloads are carried OPAQUELY — owned by their domain ' +
          "packages' own contracts and validated structurally by the owning packages' " +
          'guards; the API layer never redefines a sibling record shape.',
        type: 'object',
        additionalProperties: false,
        required: ['responseVersion', 'kind', 'result'],
        properties: {
          responseVersion: { const: 1 },
          kind: { enum: QUERY_KINDS },
          result: {
            description: 'The per-kind result value (bound by kind through if/then conditionals).',
          },
        },
        allOf: QUERY_KINDS.map((kind) => ({
          if: { properties: { kind: { const: kind } }, required: ['kind'] },
          then: { properties: { result: resultSchemaFor(kind) } },
        })),
        $defs: {
          releaseStatus: {
            additionalProperties: false,
            description:
              'The compound release status projection (mirrors the A024 fabric ' +
              'projection vocabulary): lifecycle state + publication visibility.',
            properties: {
              state: { enum: LIFECYCLE_STATES },
              visibility: { enum: VISIBILITIES },
              registration: {
                oneOf: [
                  { type: 'null' },
                  { type: 'object', description: 'Opaque A024 ReleaseRecord payload.' },
                ],
              },
              publication: {
                oneOf: [
                  { type: 'null' },
                  { type: 'object', description: 'Opaque A024 ReleasePublicationRecord payload.' },
                ],
              },
            },
            required: ['state', 'visibility', 'registration', 'publication'],
            type: 'object',
          },
        },
      };
    },
  },
  {
    id: 'api-protocol/api-release-status',
    output: 'contracts/api/api-release-status.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('api-release-status'),
        title: 'Arena api-release-status v1',
        description:
          'The compound release status projection (mirrors the A024 services/body-registry ' +
          'ReleaseStatus vocabulary): the append-only lifecycle state of a release ' +
          'registration (registered | superseded | retired | unknown) plus its publication ' +
          'visibility (published | unpublished).',
        type: 'object',
        additionalProperties: false,
        required: ['state', 'visibility', 'registration', 'publication'],
        properties: {
          state: { enum: LIFECYCLE_STATES },
          visibility: { enum: VISIBILITIES },
          registration: {
            oneOf: [
              { type: 'null' },
              { type: 'object', description: 'Opaque A024 ReleaseRecord payload.' },
            ],
          },
          publication: {
            oneOf: [
              { type: 'null' },
              { type: 'object', description: 'Opaque A024 ReleasePublicationRecord payload.' },
            ],
          },
        },
      };
    },
  },
  {
    id: 'api-protocol/schema-registry',
    output: 'contracts/api/api-schema-registry.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('schema-registry'),
        title: 'Arena api-protocol schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/arena-sdk. A SchemaRef matching this ' +
          'enum is a known Arena-API schema at the listed version; anything else is not.',
        type: 'string',
        enum: API_SCHEMA_NAMES.map((name) => ref(name)),
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
  const tempDir = join(tmpdir(), `arena-api-contracts-${process.pid}-${Date.now()}`);
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
