#!/usr/bin/env node
/**
 * Arena verification-protocol contract generator (Work Order A013).
 *
 * Follows the A001 generated-contracts convention
 * (scripts/generate-contracts.mjs) and the package-level convention
 * (packages/evaluation/scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id,
 *     repo-relative output path, builder). This generator owns the A013
 *     surfaces ONLY — it emits every schema for @arena/verification into
 *     contracts/verification/ at the repository root.
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
// (packages/verification/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const VERIFICATION_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const SEED_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
const VERIFICATION_VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const NEUTRAL_TEXT_PATTERN = '^[\\x20-\\x7E\\n\\t]{1,4096}$';
const SCHEMA_REF_NAMESPACE_PATTERN = '^[a-z][a-z0-9-]*$';
const SCHEMA_REF_VERSION_PATTERN = '^\\d+\\.\\d+\\.\\d+$';
// A002 artifact-protocol identity patterns (evidence refs reuse them verbatim).
const ARTIFACT_NAMESPACE_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const ARTIFACT_NAME_PATTERN = '^[a-z][a-z0-9-]{1,127}$';
const ARTIFACT_VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const CORRELATION_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

const VERIFIER_METHODS = [
  'unit_integration_test',
  'deterministic_formal_check',
  'constraint_check',
  'simulation',
  'measurement',
  'inspection',
  'expert_review',
  'evidence_provenance_validation',
];
const REPRODUCIBILITY_POLICIES = ['deterministic', 'seeded-stochastic', 'provider-dependent'];
const VERIFICATION_OUTCOMES = ['pass', 'fail', 'unknown'];
const EVIDENCE_SUPPORT_STATUSES = [
  'present-supported',
  'present-unsupported',
  'present-unverified',
  'present-indeterminate',
  'missing',
];
const UNKNOWN_REASONS = ['missing-evidence', 'unverifiable-provenance', 'method-limitation'];

const VERIFICATION_ERROR_CODES = [
  'VERIFICATION_DUPLICATE_REQUIREMENT',
  'VERIFICATION_EVIDENCE_MISMATCH',
  'VERIFICATION_IDEMPOTENCY_CONFLICT',
  'VERIFICATION_IDENTITY_CONFLICT',
  'VERIFICATION_INVALID_DESCRIPTOR',
  'VERIFICATION_INVALID_DIGEST',
  'VERIFICATION_INVALID_EVIDENCE',
  'VERIFICATION_INVALID_IDENTITY',
  'VERIFICATION_INVALID_METHOD',
  'VERIFICATION_INVALID_OUTCOME',
  'VERIFICATION_INVALID_PROVENANCE',
  'VERIFICATION_INVALID_RECORD',
  'VERIFICATION_INVALID_REPRODUCIBILITY',
  'VERIFICATION_INVALID_REQUIREMENT',
  'VERIFICATION_INVALID_SCHEMA_REF',
  'VERIFICATION_INVALID_TIMESTAMP',
  'VERIFICATION_NOT_FOUND',
  'VERIFICATION_REQUIREMENT_MISMATCH',
  'VERIFICATION_TAMPERED',
  'VERIFICATION_TIMESTAMP_REGRESSION',
  'VERIFICATION_UNKNOWN_ERROR',
  'VERIFICATION_UNSUPPORTED_RECORD_VERSION',
  'VERIFICATION_VERSION_CONFLICT',
];
const ERROR_CATEGORIES = ['encoding', 'integrity', 'unknown', 'validation', 'versioning'];
const VERIFICATION_SCHEMA_VERSION = '1.0.0';
const VERIFICATION_SCHEMA_NAMES = [
  'verifier-descriptor',
  'verification-error',
  'verification-outcome',
  'verification-record',
  'verification-recorded-event',
  'run-verification-command',
  'schema-registry',
];

const ref = (name) => `arena:schema/verification/${name}@${VERIFICATION_SCHEMA_VERSION}`;

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

const evidenceProvenanceDef = () => ({
  evidenceProvenance: {
    additionalProperties: false,
    description:
      'Provenance of one evidence artifact (R14): who produced it, when, with what notes.',
    properties: {
      producedBy: string(VERIFICATION_ID_PATTERN),
      producedAt: string(TIMESTAMP_PATTERN),
      notes: nullable(string(NEUTRAL_TEXT_PATTERN)),
    },
    required: ['producedBy', 'producedAt', 'notes'],
    type: 'object',
  },
});

const evidenceReferenceDef = () => ({
  evidenceReference: {
    additionalProperties: false,
    description:
      'A provenance-bearing, digest-addressed reference to one evidence artifact: the ' +
      'evidence kind the artifact claims to carry (open, charset-validated vocabulary), ' +
      'the A002 artifact reference, and the evidence provenance.',
    properties: {
      evidenceKind: string(VERIFICATION_ID_PATTERN),
      artifact: { $ref: '#/$defs/artifactRef' },
      provenance: { $ref: '#/$defs/evidenceProvenance' },
    },
    required: ['evidenceKind', 'artifact', 'provenance'],
    type: 'object',
  },
});

const evidenceRequirementDef = () => ({
  evidenceRequirement: {
    additionalProperties: false,
    description:
      'One clause of a verifier required-evidence declaration: the evidence kind demanded, ' +
      'the claim the evidence must support, and optional pins (exact artifact ref, required ' +
      'producing principal).',
    properties: {
      requirementId: string(VERIFICATION_ID_PATTERN),
      evidenceKind: string(VERIFICATION_ID_PATTERN),
      claim: string(NEUTRAL_TEXT_PATTERN),
      artifact: nullable({ $ref: '#/$defs/artifactRef' }),
      requiredProducer: nullable(string(VERIFICATION_ID_PATTERN)),
    },
    required: ['requirementId', 'evidenceKind', 'claim', 'artifact', 'requiredProducer'],
    type: 'object',
  },
});

const reproducibilityDef = () => ({
  reproducibility: {
    additionalProperties: false,
    description:
      'Reproducibility policy (EV1.0): deterministic | seeded-stochastic | provider-dependent, ' +
      'with the seed and parameters recorded when applicable. A deterministic verifier carries ' +
      'no seed; a seeded-stochastic verifier MUST record its seed.',
    properties: {
      policy: { enum: REPRODUCIBILITY_POLICIES },
      seed: nullable(string(SEED_PATTERN)),
      parameters: nullable(string(NEUTRAL_TEXT_PATTERN)),
    },
    required: ['policy', 'seed', 'parameters'],
    type: 'object',
  },
});

const verifierProvenanceDef = () => ({
  verifierProvenance: {
    additionalProperties: false,
    description: 'Provenance of the verifier declaration.',
    properties: {
      authoredBy: string(VERIFICATION_ID_PATTERN),
      submittedAt: string(TIMESTAMP_PATTERN),
      notes: nullable(string(NEUTRAL_TEXT_PATTERN)),
    },
    required: ['authoredBy', 'submittedAt', 'notes'],
    type: 'object',
  },
});

const outcomeSemanticsDef = () => ({
  outcomeSemantics: {
    additionalProperties: false,
    description:
      'The declared meaning of each outcome for THIS verifier (EV1.0: a verifier declares ' +
      'pass/fail/unknown semantics). All three declarations are mandatory non-empty text.',
    properties: {
      pass: string(NEUTRAL_TEXT_PATTERN),
      fail: string(NEUTRAL_TEXT_PATTERN),
      unknown: string(NEUTRAL_TEXT_PATTERN),
    },
    required: ['pass', 'fail', 'unknown'],
    type: 'object',
  },
});

const requirementSupportDef = () => ({
  requirementSupport: {
    additionalProperties: false,
    description:
      'One requirement support status: present-supported | present-unsupported | ' +
      'present-unverified | present-indeterminate | missing. A closed vocabulary with no ' +
      'quantitative members; missing requirements cannot name evidence, present statuses must.',
    properties: {
      requirementId: string(VERIFICATION_ID_PATTERN),
      status: { enum: EVIDENCE_SUPPORT_STATUSES },
      evidenceDigest: nullable(digest()),
      notes: nullable(string(NEUTRAL_TEXT_PATTERN)),
    },
    required: ['requirementId', 'status', 'evidenceDigest', 'notes'],
    type: 'object',
  },
});

const unknownCauseDef = () => ({
  unknownCause: {
    additionalProperties: false,
    description:
      "The structured WHY of an unknown outcome: a closed reason taxonomy member plus the " +
      'deterministic detail listing the driving requirement ids. REQUIRED iff the outcome is ' +
      'unknown; MUST be null otherwise.',
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
    description: 'Provenance of one verification run.',
    properties: {
      executedBy: string(VERIFICATION_ID_PATTERN),
      recordedAt: string(TIMESTAMP_PATTERN),
      notes: nullable(string(NEUTRAL_TEXT_PATTERN)),
    },
    required: ['executedBy', 'recordedAt', 'notes'],
    type: 'object',
  },
});

// ---------------------------------------------------------------------------
// Contract manifest — the A013 owned schema surface.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'verification-protocol/verifier-descriptor',
    output: 'contracts/verification/verifier-descriptor.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('verifier-descriptor'),
        title: 'Arena VerifierDescriptor v1',
        description:
          'The content-addressed, versioned declaration of a verifier: id, version, method ' +
          '(the CLOSED EV1.0 enum — unknown methods rejected), the required-evidence ' +
          'declaration (kind, claim, optional artifact pin, optional producer pin per ' +
          'requirement; unique ids; non-empty), the declared pass/fail/unknown semantics ' +
          '(all three mandatory), the reproducibility policy (deterministic | seeded-stochastic ' +
          '| provider-dependent, seed recorded when applicable), input/output schema refs and ' +
          'provenance. Same descriptor ⇒ same digest; any change ⇒ a new version (the digest ' +
          'changes and same-id+version re-registration is a conflict). Deep-frozen, no mutation ' +
          'API.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'verifierId',
          'version',
          'method',
          'requiredEvidence',
          'outcomeSemantics',
          'reproducibility',
          'inputSchema',
          'outputSchema',
          'provenance',
          'digest',
        ],
        properties: {
          recordVersion: { const: 1, description: 'Wire version of the descriptor shape.' },
          verifierId: string(VERIFICATION_ID_PATTERN),
          version: string(VERIFICATION_VERSION_PATTERN),
          method: { enum: VERIFIER_METHODS },
          requiredEvidence: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/evidenceRequirement' },
            description: 'The required-evidence declaration; requirement ids unique within it.',
          },
          outcomeSemantics: { $ref: '#/$defs/outcomeSemantics' },
          reproducibility: { $ref: '#/$defs/reproducibility' },
          inputSchema: { $ref: '#/$defs/schemaRef' },
          outputSchema: { $ref: '#/$defs/schemaRef' },
          provenance: { $ref: '#/$defs/verifierProvenance' },
          digest: digest(),
        },
        $defs: {
          ...schemaRefDef(),
          ...artifactRefDef(),
          ...evidenceRequirementDef(),
          ...outcomeSemanticsDef(),
          ...reproducibilityDef(),
          ...verifierProvenanceDef(),
        },
      };
    },
  },
  {
    id: 'verification-protocol/verification-record',
    output: 'contracts/verification/verification-record.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('verification-record'),
        title: 'Arena VerificationRecord v1',
        description:
          'The append-once record of one verification run: verifier descriptor digest, the ' +
          'evidence bundle (provenance-bearing, digest-addressed A002 artifact references), the ' +
          'evidence-support summary (one closed-vocabulary status per declared requirement), ' +
          'the DERIVED outcome (pass | fail | unknown — computed purely from the support ' +
          'summary, never caller-supplied, never numerical or graded — lock rule 7), the ' +
          'DERIVED structured unknown cause (required iff unknown), correlation id + ' +
          'idempotency key, the COMPUTED input digest over {verifierRef, evidence}, timestamps ' +
          'and run provenance. Frozen on creation; pure replayable construction; identical ' +
          'inputs ⇒ identical record digest.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'verifierRef',
          'evidence',
          'evidenceSupport',
          'outcome',
          'unknownCause',
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
          verifierRef: digest(),
          evidence: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/evidenceReference' },
            description: 'The run evidence bundle; extra evidence beyond the requirements is recorded for audit.',
          },
          evidenceSupport: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/requirementSupport' },
            description: 'One support entry per declared requirement, in descriptor order.',
          },
          outcome: {
            enum: VERIFICATION_OUTCOMES,
            description: 'The derived outcome — a closed three-member vocabulary, never a quantitative value.',
          },
          unknownCause: nullable({ $ref: '#/$defs/unknownCause' }),
          correlationId: string(CORRELATION_PATTERN),
          idempotencyKey: string(CORRELATION_PATTERN),
          inputDigest: digest(),
          startedAt: string(TIMESTAMP_PATTERN),
          finishedAt: string(TIMESTAMP_PATTERN),
          provenance: { $ref: '#/$defs/recordProvenance' },
          digest: digest(),
        },
        $defs: {
          ...artifactRefDef(),
          ...evidenceProvenanceDef(),
          ...evidenceReferenceDef(),
          ...requirementSupportDef(),
          ...unknownCauseDef(),
          ...recordProvenanceDef(),
        },
      };
    },
  },
  {
    id: 'verification-protocol/verification-outcome',
    output: 'contracts/verification/verification-outcome.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('verification-outcome'),
        title: 'Arena verification-outcome v1',
        description:
          'The outcome semantics object: the declared meaning of pass, fail and unknown for a ' +
          'specific verifier (EV1.0: "A verifier declares required evidence, method, ' +
          'pass/fail/unknown semantics and reproducibility policy"). The outcome vocabulary ' +
          'itself is the closed enum pass | fail | unknown — it has no quantitative members ' +
          'and cannot carry graded values (architecture-lock rule 7).',
        allOf: [
          { $ref: '#/$defs/outcomeSemantics' },
        ],
        $defs: {
          ...outcomeSemanticsDef(),
        },
      };
    },
  },
  {
    id: 'verification-protocol/verification-error',
    output: 'contracts/verification/verification-error.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('verification-error'),
        title: 'Arena VerificationError v1',
        description:
          'Wire-safe structured form of a VerificationError: closed VERIFICATION_* code set, ' +
          'core category mapping, strictly validating parse (unknown codes rejected).',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: VERIFICATION_ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object' },
          correlationId: string(CORRELATION_PATTERN),
        },
      };
    },
  },
  {
    id: 'verification-protocol/run-verification-command',
    output: 'contracts/verification/run-verification-command.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('run-verification-command'),
        title: 'Arena run-verification-command v1',
        description:
          'Command envelope payload: run one verification. Carries the digest ref of the ' +
          'verifier descriptor and the run evidence bundle; the fabric resolves and validates ' +
          'the evidence, runs the verifier hook, derives the outcome and emits ' +
          'verification-recorded-event. Commands carry a REQUIRED non-null idempotency key ' +
          '(architecture-lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['verifierRef', 'evidence'],
        properties: {
          verifierRef: digest(),
          evidence: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/evidenceReference' },
            description: 'The run evidence bundle.',
          },
        },
        $defs: {
          ...artifactRefDef(),
          ...evidenceProvenanceDef(),
          ...evidenceReferenceDef(),
        },
      };
    },
  },
  {
    id: 'verification-protocol/verification-recorded-event',
    output: 'contracts/verification/verification-recorded-event.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('verification-recorded-event'),
        title: 'Arena verification-recorded-event v1',
        description:
          "Event envelope payload: the fabric's authoritative result — the frozen, " +
          'content-addressed VerificationRecord. The event carries the run command idempotency ' +
          'key when provided so event-stream replays are idempotency-addressable.',
        type: 'object',
        additionalProperties: false,
        required: ['record'],
        properties: {
          record: {
            $ref: `arena:schema/verification/verification-record@${VERIFICATION_SCHEMA_VERSION}`,
          },
        },
      };
    },
  },
  {
    id: 'verification-protocol/schema-registry',
    output: 'contracts/verification/verification-schema-registry.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('schema-registry'),
        title: 'Arena verification-protocol schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/verification. A SchemaRef matching this enum ' +
          'is a known verification-protocol schema at the listed version; anything else is not.',
        type: 'string',
        enum: VERIFICATION_SCHEMA_NAMES.map((name) => ref(name)),
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
  const tempDir = join(tmpdir(), `arena-verification-contracts-${process.pid}-${Date.now()}`);
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
