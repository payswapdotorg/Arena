#!/usr/bin/env node
/**
 * Arena dataset-packaging contract generator (Work Order A014).
 *
 * Follows the A001 generated-contracts convention
 * (scripts/generate-contracts.mjs) and the package-level convention
 * (packages/evaluation/scripts/generate-contracts.mjs,
 * packages/verification/scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id,
 *     repo-relative output path, builder). This generator owns the A014
 *     dataset surfaces ONLY — it emits every schema for @arena/datasets
 *     into contracts/dataset/ at the repository root.
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
// (packages/datasets/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const ARTIFACT_NAMESPACE_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const ARTIFACT_NAME_PATTERN = '^[a-z][a-z0-9-]{1,127}$';
const ARTIFACT_VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';

// A014 dataset packaging vocabularies (packages/datasets/src/entry.ts).
const DATASET_ENTRY_ROLES = ['input', 'output', 'eval', 'split'];

// A002 provenance lineage relations (packages/provenance/src/record.ts) —
// reused verbatim, never redefined semantically; parity is asserted
// against the TS import in contracts.parity.test.ts.
const LINEAGE_RELATIONS = ['adapted-from', 'composed-of', 'derived-from', 'extracted-from'];

// A002 provenance verification kinds (packages/provenance/src/record.ts).
const VERIFICATION_KINDS = ['attestation', 'certification', 'evaluation', 'verification'];

// A002 rights policies (packages/artifact-protocol/src/rights.ts).
const COMMERCIAL_USE_POLICIES = ['allowed', 'requires-license', 'prohibited'];
const REDISTRIBUTION_POLICIES = ['allowed', 'tenant-only', 'prohibited'];
const CUSTOMER_DATA_POLICIES = ['none', 'derived', 'contains'];
const PRINCIPAL_TYPES = ['agent-body', 'expert', 'user', 'service', 'system'];
const PRINCIPAL_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const LICENSE_PATTERN = '^[A-Za-z0-9][A-Za-z0-9 .+()\\-]{0,63}$';

const DATASET_SCHEMA_VERSION = '1.0.0';
const DATASET_SCHEMA_NAMES = [
  'dataset-manifest',
  'dataset-bundle',
  'dataset-entry-role',
  'lineage-edge',
  'publication-ops',
  'schema-registry',
];

const ref = (name) => `arena:schema/dataset/${name}@${DATASET_SCHEMA_VERSION}`;

// ---------------------------------------------------------------------------
// Reusable schema fragments
// ---------------------------------------------------------------------------

const string = (pattern) => ({ type: 'string', pattern });
const digest = () => string(DIGEST_PATTERN);

const artifactIdentityDef = () => ({
  artifactIdentity: {
    additionalProperties: false,
    description:
      'A002 artifact identity (reused validator, never redefined): namespace/name/semver. ' +
      'The reserved `public` namespace is the global scope; every other namespace is a tenant scope.',
    properties: {
      namespace: string(ARTIFACT_NAMESPACE_PATTERN),
      name: string(ARTIFACT_NAME_PATTERN),
      version: string(ARTIFACT_VERSION_PATTERN),
    },
    required: ['namespace', 'name', 'version'],
    type: 'object',
  },
});

const artifactRefDef = () => ({
  artifactRef: {
    additionalProperties: false,
    description:
      'A002 artifact reference (reused validator, never redefined): namespace/name/version ' +
      'identity plus the sha256 content digest of the referenced material artifact.',
    properties: {
      namespace: string(ARTIFACT_NAMESPACE_PATTERN),
      name: string(ARTIFACT_NAME_PATTERN),
      version: string(ARTIFACT_VERSION_PATTERN),
      digest: digest(),
    },
    required: ['namespace', 'name', 'version', 'digest'],
    type: 'object',
  },
});

const principalRefDef = () => ({
  principalRef: {
    additionalProperties: false,
    description:
      'A002 tenant-scoped principal (reused validator): the source/creator of a dataset. ' +
      'Never a raw provider identity.',
    properties: {
      type: { enum: PRINCIPAL_TYPES },
      tenant: string(ARTIFACT_NAMESPACE_PATTERN),
      principalId: string(PRINCIPAL_ID_PATTERN),
    },
    required: ['type', 'tenant', 'principalId'],
    type: 'object',
  },
});

const rightsMetadataDef = () => ({
  rightsMetadata: {
    additionalProperties: false,
    description:
      'A002 rights metadata (reused validator, never redefined; architecture-lock rule 23): ' +
      'license, commercial use, redistribution and customer-data policies, plus optional ' +
      'professional limitations.',
    properties: {
      license: string(LICENSE_PATTERN),
      commercialUse: { enum: COMMERCIAL_USE_POLICIES },
      redistribution: { enum: REDISTRIBUTION_POLICIES },
      customerData: { enum: CUSTOMER_DATA_POLICIES },
      professionalLimitations: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
    },
    required: ['license', 'commercialUse', 'redistribution', 'customerData'],
    type: 'object',
  },
});

const lineageEdgeDef = () => ({
  lineageEdge: {
    additionalProperties: false,
    description:
      'One dataset lineage edge (docs/architecture.md §15): a content-addressed parent ' +
      'reference plus the A002 provenance lineage relation. The relation vocabulary is the ' +
      'closed @arena/provenance set, reused verbatim.',
    properties: {
      parent: { $ref: '#/$defs/artifactRef' },
      relation: { enum: LINEAGE_RELATIONS },
    },
    required: ['parent', 'relation'],
    type: 'object',
  },
});

const verificationRefDef = () => ({
  verificationRef: {
    additionalProperties: false,
    description:
      'A verification/evaluation evidence reference: kind `evaluation` carries A012 ' +
      'evaluation-record digests; kinds `verification`/`attestation` carry A013 ' +
      'verification-record digests. The kind vocabulary is the closed @arena/provenance set.',
    properties: {
      kind: { enum: VERIFICATION_KINDS },
      evidence: { $ref: '#/$defs/artifactRef' },
    },
    required: ['kind', 'evidence'],
    type: 'object',
  },
});

const datasetEntryDef = () => ({
  datasetEntry: {
    additionalProperties: false,
    description:
      'One declared dataset entry: a content-addressed A002 artifact reference plus its ' +
      'closed role in the dataset (input/output/eval/split).',
    properties: {
      role: { enum: DATASET_ENTRY_ROLES },
      artifact: { $ref: '#/$defs/artifactRef' },
    },
    required: ['role', 'artifact'],
    type: 'object',
  },
});

// ---------------------------------------------------------------------------
// The contract manifest — every schema owned by @arena/datasets
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'datasets/dataset-manifest',
    output: 'contracts/dataset/dataset-manifest.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('dataset-manifest'),
        title: 'Arena dataset manifest v1',
        description:
          'A versioned, content-addressed packaging of a DATASET (R14, R23): the dataset ' +
          'identity (A002 ArtifactIdentity), the declared entries (artifact refs by digest + ' +
          'role), dataset-level provenance per docs/architecture.md §15 (source/creator, ' +
          'timestamps, parent refs with lineage relations, mandatory rights metadata, ' +
          'verification/evaluation refs), the entries checksum (sha256 over the canonically ' +
          'sorted entry list) and the manifest digest (sha256 over the canonical digest-free ' +
          'view). Immutable and deep-frozen; tamper detection fails closed.',
        type: 'object',
        additionalProperties: false,
        required: [
          'manifestVersion',
          'identity',
          'entries',
          'provenance',
          'entriesChecksum',
          'digest',
        ],
        properties: {
          manifestVersion: { const: 1 },
          identity: { $ref: '#/$defs/artifactIdentity' },
          entries: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/datasetEntry' },
            description:
              'The declared entries (at least one). The same artifact may appear under ' +
              'multiple roles; each (role, artifact) pair is declared once.',
          },
          provenance: {
            type: 'object',
            additionalProperties: false,
            required: ['creator', 'createdAt', 'parents', 'rights', 'verification'],
            properties: {
              creator: { $ref: '#/$defs/principalRef' },
              createdAt: string(TIMESTAMP_PATTERN),
              parents: {
                type: 'array',
                items: { $ref: '#/$defs/lineageEdge' },
                description: 'Parent refs (parent datasets or artifacts), with relations.',
              },
              rights: { $ref: '#/$defs/rightsMetadata' },
              verification: {
                type: 'array',
                items: { $ref: '#/$defs/verificationRef' },
                description:
                  'Verification/evaluation evidence refs (A012 evaluation-record digests via ' +
                  'kind `evaluation`; A013 verification-record digests via kind ' +
                  '`verification`/`attestation`).',
              },
            },
          },
          entriesChecksum: digest(),
          digest: digest(),
        },
        $defs: {
          ...artifactIdentityDef(),
          ...artifactRefDef(),
          ...datasetEntryDef(),
          ...lineageEdgeDef(),
          ...principalRefDef(),
          ...rightsMetadataDef(),
          ...verificationRefDef(),
        },
      };
    },
  },
  {
    id: 'datasets/dataset-bundle',
    output: 'contracts/dataset/dataset-bundle.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('dataset-bundle'),
        title: 'Arena dataset bundle v1',
        description:
          'The resolution of a dataset manifest into a verifiable bundle: every declared ' +
          'entry was resolved through an A002 resolver and its digest verified; the manifest ' +
          'digest chain (manifest digest + entries checksum) was verified. The bundle digest ' +
          'is computed over the canonical view {bundleVersion, manifestDigest, sorted entry ' +
          'keys} — deterministic: the same manifest always resolves to the same bundle digest.',
        type: 'object',
        additionalProperties: false,
        required: ['bundleVersion', 'manifest', 'bundleDigest'],
        properties: {
          bundleVersion: { const: 1 },
          manifest: {
            $ref: `arena:schema/dataset/dataset-manifest@${DATASET_SCHEMA_VERSION}`,
          },
          bundleDigest: digest(),
        },
      };
    },
  },
  {
    id: 'datasets/dataset-entry-role',
    output: 'contracts/dataset/dataset-entry-role.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('dataset-entry-role'),
        title: 'Arena dataset entry-role vocabulary v1',
        description:
          'The closed vocabulary of dataset entry roles (packages/datasets/src/entry.ts): ' +
          'input (upstream artifact), output (produced/derived artifact), eval (A012 ' +
          'evaluation-record artifact), split (split/subset marker artifact).',
        type: 'string',
        enum: DATASET_ENTRY_ROLES,
      };
    },
  },
  {
    id: 'datasets/lineage-edge',
    output: 'contracts/dataset/lineage-edge.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('lineage-edge'),
        title: 'Arena dataset lineage edge v1',
        description:
          'One dataset-level lineage edge: a content-addressed parent reference (a parent ' +
          'dataset manifest or artifact) plus the lineage relation. The relation vocabulary ' +
          'is the closed A002 @arena/provenance set (LINEAGE_RELATIONS), reused verbatim.',
        type: 'object',
        additionalProperties: false,
        required: ['parent', 'relation'],
        properties: {
          parent: { $ref: '#/$defs/artifactRef' },
          relation: { enum: LINEAGE_RELATIONS },
        },
        $defs: {
          ...artifactRefDef(),
        },
      };
    },
  },
  {
    id: 'datasets/publication-ops',
    output: 'contracts/dataset/publication-ops.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('publication-ops'),
        title: 'Arena dataset publication operations v1',
        description:
          'The A014 PublicationService operations over the A002 PublicationLedger: publish ' +
          'an ingested dataset/artifact (explicit, immutable record — never silently changes ' +
          'tenant visibility) or retract a publication (appends a NEW record superseding the ' +
          'original). Listing operations are pure projections: listPublic (active records, ' +
          'optionally scoped by namespace) and listPrivate (stored artifacts of a namespace ' +
          'with no active publication — the tenant own view).',
        type: 'object',
        oneOf: [
          {
            additionalProperties: false,
            description:
              'Publish: requires the artifact to be ingested in the store; the publisher ' +
              'tenant must match the artifact namespace (or the reserved public namespace).',
            properties: {
              op: { const: 'publish' },
              artifact: { $ref: '#/$defs/artifactRef' },
              publisher: { $ref: '#/$defs/principalRef' },
              rights: { $ref: '#/$defs/rightsMetadata' },
              publishedAt: string(TIMESTAMP_PATTERN),
            },
            required: ['op', 'artifact', 'publisher', 'rights', 'publishedAt'],
            type: 'object',
          },
          {
            additionalProperties: false,
            description:
              'Retract: appends a NEW record whose supersedes field carries the original ' +
              'publication record digest; only publish records can be retracted, once.',
            properties: {
              op: { const: 'retract' },
              artifact: { $ref: '#/$defs/artifactRef' },
              publisher: { $ref: '#/$defs/principalRef' },
              supersedes: digest(),
              retractedAt: string(TIMESTAMP_PATTERN),
            },
            required: ['op', 'artifact', 'publisher', 'supersedes', 'retractedAt'],
            type: 'object',
          },
        ],
        $defs: {
          ...artifactRefDef(),
          ...principalRefDef(),
          ...rightsMetadataDef(),
        },
      };
    },
  },
  {
    id: 'datasets/schema-registry',
    output: 'contracts/dataset/dataset-schema-registry.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('schema-registry'),
        title: 'Arena dataset schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/datasets. A SchemaRef matching this enum ' +
          'is a known dataset schema at the listed version; anything else is not.',
        type: 'string',
        enum: DATASET_SCHEMA_NAMES.map((name) => ref(name)),
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
  const tempDir = join(tmpdir(), `arena-dataset-contracts-${process.pid}-${Date.now()}`);
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
}

main();
