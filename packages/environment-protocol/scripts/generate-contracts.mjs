#!/usr/bin/env node
/**
 * Arena environment-protocol contract generator (Work Order A009).
 *
 * Follows the A001 generated-contracts convention
 * (scripts/generate-contracts.mjs) and the A002 package-level convention
 * (packages/artifact-protocol/scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id,
 *     repo-relative output path, builder). This generator owns the A009
 *     surfaces ONLY — it emits every schema for
 *     @arena/environment-protocol into contracts/environment/ at the
 *     repository root.
 *   - Generated files are committed, deterministic (sorted keys, 2-space
 *     indent, trailing newline) and carry a versioned SchemaRef $id.
 *   - `--check` regenerates into a temp directory and compares with the
 *     committed copies; any missing / extra / changed file is drift and
 *     exits non-zero. The drift suite (src/drift.test.ts) runs this check
 *     as part of `pnpm test`, the package script `contracts:check` runs it
 *     directly, and the governance G9 check auto-discovers this generator
 *     through its packages/.../generate-contracts.mjs glob (the
 *     root manifest itself needs no edit — the A002 merge generalized G9
 *     to run every package-level generator).
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
// (packages/environment-protocol/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const NAMESPACE_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const NAME_PATTERN = '^[a-z][a-z0-9-]{1,127}$';
const VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const ENVIRONMENT_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const MOUNT_PATH_PATTERN = '^/(?:[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*)?$';
const HOSTNAME_PATTERN =
  '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$';
const NEUTRAL_TEXT_PATTERN = '^[\\x20-\\x7E\\n\\t]{1,512}$';
const TASK_VERSION_PATTERN = '^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$';
const SCHEMA_REF_PATTERN = '^arena:schema/[a-z][a-z0-9-]*/[a-z][a-z0-9-]*@\\d+\\.\\d+\\.\\d+$';
const IDENTIFIER_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

const IMAGE_KINDS = ['content-addressed-image', 'derived-image'];
const SNAPSHOT_SUPPORT_MODES = ['supported', 'not-supported'];
const REPRODUCIBILITY_MODES = ['deterministic', 'nondeterministic'];
const RESEED_POLICIES = ['forbidden', 'declared-only'];
const OBSERVATION_CHANNELS = ['stdout', 'stderr', 'files', 'events', 'metrics', 'state-dump'];
const EGRESS_PROTOCOLS = ['tcp', 'udp', 'http', 'https'];
const MOUNT_ACCESS_MODES = ['read-only', 'read-write'];
const MOUNT_SOURCES = ['initial-state', 'ephemeral', 'workspace', 'evidence'];
const FILESYSTEM_WRITE_MODES = ['read-only', 'declared-mounts-only'];
const SECRET_INJECTION_MECHANISMS = ['environment-binding', 'file-mount', 'stream'];
const DEADLINE_BEHAVIORS = ['hard-stop', 'grace-then-stop'];
const RESET_MODES = ['recreate', 'restore-snapshot', 'reset-to-checkpoint'];
const RESET_CLEANUPS = ['destroy', 'retain-evidence'];
const CHECKPOINT_TRIGGERS = ['manual', 'scheduled', 'on-phase'];
const EVIDENCE_OUTPUT_KINDS = [
  'trajectory',
  'artifacts',
  'logs',
  'metrics',
  'observations',
  'environment-state',
];
const EVIDENCE_ADDRESSING_POLICIES = ['content-addressed', 'append-only-ledger'];
const HOOK_PHASES = ['pre-run', 'post-run', 'on-evidence', 'on-completion'];
const HOOK_ROLES = ['evaluator', 'verifier'];
const WORKLOAD_TRUST_LEVELS = ['trusted', 'untrusted'];

const ENVIRONMENT_ERROR_CODES = [
  'ENVIRONMENT_CREDENTIAL_REJECTED',
  'ENVIRONMENT_INVALID_ACTION_SURFACE',
  'ENVIRONMENT_INVALID_CHECKPOINT_SEMANTICS',
  'ENVIRONMENT_INVALID_DEFINITION',
  'ENVIRONMENT_INVALID_DIGEST',
  'ENVIRONMENT_INVALID_EVALUATION_HOOKS',
  'ENVIRONMENT_INVALID_EVIDENCE_OUTPUTS',
  'ENVIRONMENT_INVALID_FILESYSTEM_POLICY',
  'ENVIRONMENT_INVALID_IDENTITY',
  'ENVIRONMENT_INVALID_IMAGE',
  'ENVIRONMENT_INVALID_NETWORK_POLICY',
  'ENVIRONMENT_INVALID_OBSERVATION_SURFACE',
  'ENVIRONMENT_INVALID_REPRODUCIBILITY',
  'ENVIRONMENT_INVALID_RESOURCE_LIMITS',
  'ENVIRONMENT_INVALID_RESET_SEMANTICS',
  'ENVIRONMENT_INVALID_RUN_ADDRESS',
  'ENVIRONMENT_INVALID_SEED_POLICY',
  'ENVIRONMENT_INVALID_SECRET_POLICY',
  'ENVIRONMENT_INVALID_SNAPSHOT',
  'ENVIRONMENT_INVALID_TIME_LIMITS',
  'ENVIRONMENT_INVALID_WORKLOAD',
  'ENVIRONMENT_LEAST_PRIVILEGE_VIOLATION',
  'ENVIRONMENT_RUNTIME_LEAKAGE',
  'ENVIRONMENT_TAMPERED',
  'ENVIRONMENT_UNKNOWN_ERROR',
  'ENVIRONMENT_UNSUPPORTED_RECORD_VERSION',
  'ENVIRONMENT_VERSION_CONFLICT',
];
const ERROR_CATEGORIES = ['encoding', 'integrity', 'unknown', 'validation', 'versioning'];
const ENVIRONMENT_SCHEMA_VERSION = '1.0.0';
const ENVIRONMENT_SCHEMA_NAMES = [
  'action-surface',
  'admit-workload-command',
  'checkpoint-semantics',
  'environment-definition',
  'environment-error',
  'environment-image',
  'environment-registered-event',
  'environment-version-ref',
  'evaluation-hooks',
  'evidence-outputs',
  'filesystem-policy',
  'network-policy',
  'observation-surface',
  'register-environment-command',
  'reproducibility-profile',
  'reset-semantics',
  'resource-limits',
  'run-address',
  'schema-registry',
  'secret-policy',
  'seed-policy',
  'state-snapshot',
  'task-version-ref',
  'time-limits',
  'workload-admitted-event',
  'workload-declaration',
];

const ref = (name) => `arena:schema/environment/${name}@${ENVIRONMENT_SCHEMA_VERSION}`;

// ---------------------------------------------------------------------------
// Reusable schema fragments
// ---------------------------------------------------------------------------

const string = (pattern) => ({ type: 'string', pattern });
const nullable = (schema) => ({ oneOf: [{ type: 'null' }, schema] });
const positiveInteger = () => ({
  type: 'integer',
  minimum: 1,
  description: 'Strictly positive integer (a bound that does not bound is not a bound).',
});

const stateSnapshotDef = () => ({
  stateSnapshot: {
    additionalProperties: false,
    properties: {
      snapshotId: { ...string(ENVIRONMENT_ID_PATTERN), description: 'Neutral snapshot identifier.' },
      digest: { ...string(DIGEST_PATTERN), description: 'sha256 content digest of the snapshot.' },
    },
    required: ['snapshotId', 'digest'],
    type: 'object',
  },
});

const environmentVersionRefDef = () => ({
  environmentVersionRef: {
    additionalProperties: false,
    description: 'Content-addressed reference to a registered environment version.',
    properties: {
      namespace: string(NAMESPACE_PATTERN),
      name: string(NAME_PATTERN),
      version: string(VERSION_PATTERN),
      digest: string(DIGEST_PATTERN),
    },
    required: ['namespace', 'name', 'version', 'digest'],
    type: 'object',
  },
});

const checkpointRefDef = () => ({
  checkpointRef: {
    additionalProperties: false,
    description: 'Content-addressed reference to a checkpoint.',
    properties: {
      checkpointId: string(ENVIRONMENT_ID_PATTERN),
      digest: string(DIGEST_PATTERN),
    },
    required: ['checkpointId', 'digest'],
    type: 'object',
  },
});

// ---------------------------------------------------------------------------
// Contract manifest — the A009 owned schema surface.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'environment-protocol/environment-definition',
    output: 'contracts/environment/environment-definition.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('environment-definition'),
        title: 'Arena EnvironmentDefinition v1',
        description:
          'The versioned, content-addressed declaration of an executable world (spec ENV1.0). ' +
          'Carries ALL fifteen declare fields: identity (id/version), image/build digest, initial ' +
          'state snapshot, seed policy, action/tool surface, observation surface, resource limits, ' +
          'network policy, filesystem policy, secret policy, time limits, reset semantics, checkpoint ' +
          'semantics, evidence outputs and evaluator/verifier hooks. The digest is sha256 over the ' +
          'canonical JSON of the digest-free view; the object is deep-frozen with no mutation API.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'identity',
          'version',
          'image',
          'initialState',
          'seedPolicy',
          'actionSurface',
          'observationSurface',
          'resourceLimits',
          'networkPolicy',
          'filesystemPolicy',
          'secretPolicy',
          'timeLimits',
          'resetSemantics',
          'checkpointSemantics',
          'evidenceOutputs',
          'evaluationHooks',
          'digest',
        ],
        properties: {
          recordVersion: { const: 1, description: 'Wire version of the definition record.' },
          identity: {
            type: 'object',
            additionalProperties: false,
            description: 'Stable environment identity (tenant namespace + name).',
            properties: {
              namespace: string(NAMESPACE_PATTERN),
              name: string(NAME_PATTERN),
            },
            required: ['namespace', 'name'],
          },
          version: string(VERSION_PATTERN),
          image: { $ref: '#/$defs/environmentImage' },
          initialState: { $ref: '#/$defs/initialState' },
          seedPolicy: { $ref: '#/$defs/seedPolicy' },
          actionSurface: { $ref: '#/$defs/actionSurface' },
          observationSurface: { $ref: '#/$defs/observationSurface' },
          resourceLimits: { $ref: '#/$defs/resourceLimits' },
          networkPolicy: { $ref: '#/$defs/networkPolicy' },
          filesystemPolicy: { $ref: '#/$defs/filesystemPolicy' },
          secretPolicy: { $ref: '#/$defs/secretPolicy' },
          timeLimits: { $ref: '#/$defs/timeLimits' },
          resetSemantics: { $ref: '#/$defs/resetSemantics' },
          checkpointSemantics: { $ref: '#/$defs/checkpointSemantics' },
          evidenceOutputs: { $ref: '#/$defs/evidenceOutputs' },
          evaluationHooks: { $ref: '#/$defs/evaluationHooks' },
          digest: string(DIGEST_PATTERN),
        },
        $defs: {
          environmentImage: {
            additionalProperties: false,
            description: 'Image/build digest declaration — runtime-neutral, digest-addressed.',
            properties: {
              imageKind: { enum: IMAGE_KINDS },
              digest: string(DIGEST_PATTERN),
              buildDigest: nullable(string(DIGEST_PATTERN)),
            },
            required: ['imageKind', 'digest', 'buildDigest'],
            type: 'object',
          },
          initialState: {
            additionalProperties: false,
            description: 'Initial state snapshot (ref + digest) plus the snapshot support flag.',
            properties: {
              snapshot: { $ref: '#/$defs/stateSnapshotRef' },
              snapshotSupport: { enum: SNAPSHOT_SUPPORT_MODES },
            },
            required: ['snapshot', 'snapshotSupport'],
            type: 'object',
          },
          stateSnapshotRef: {
            additionalProperties: false,
            properties: {
              snapshotId: string(ENVIRONMENT_ID_PATTERN),
              digest: string(DIGEST_PATTERN),
            },
            required: ['snapshotId', 'digest'],
            type: 'object',
          },
          seedPolicy: {
            additionalProperties: false,
            description:
              'Seed policy with the embedded reproducibility profile. Deterministic worlds are ' +
              'seed-free; nondeterministic worlds must capture seed, versions, external inputs and ' +
              'timing/context metadata.',
            properties: {
              reproducibility: { $ref: '#/$defs/reproducibilityProfile' },
              seed: nullable(string(NEUTRAL_TEXT_PATTERN)),
              seedAlgorithm: nullable(string(ENVIRONMENT_ID_PATTERN)),
              reseedPolicy: { enum: RESEED_POLICIES },
              note: nullable(string(NEUTRAL_TEXT_PATTERN)),
            },
            required: ['reproducibility', 'seed', 'seedAlgorithm', 'reseedPolicy', 'note'],
            type: 'object',
          },
          reproducibilityProfile: {
            additionalProperties: false,
            properties: {
              mode: { enum: REPRODUCIBILITY_MODES },
              capture: { oneOf: [{ type: 'null' }, { $ref: '#/$defs/nondeterminismCapture' }] },
              note: nullable(string(NEUTRAL_TEXT_PATTERN)),
            },
            required: ['mode', 'capture', 'note'],
            type: 'object',
          },
          nondeterminismCapture: {
            additionalProperties: false,
            description:
              'The four capture groups required for nondeterminism (spec ENV1.0 Reproducibility).',
            properties: {
              seed: string(NEUTRAL_TEXT_PATTERN),
              versions: string(NEUTRAL_TEXT_PATTERN),
              externalInputs: string(NEUTRAL_TEXT_PATTERN),
              timingContext: string(NEUTRAL_TEXT_PATTERN),
            },
            required: ['seed', 'versions', 'externalInputs', 'timingContext'],
            type: 'object',
          },
          actionSurface: {
            additionalProperties: false,
            properties: {
              actions: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    actionId: string(ENVIRONMENT_ID_PATTERN),
                    description: nullable(string(NEUTRAL_TEXT_PATTERN)),
                  },
                  required: ['actionId', 'description'],
                },
              },
              tools: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    toolId: string(ENVIRONMENT_ID_PATTERN),
                    description: nullable(string(NEUTRAL_TEXT_PATTERN)),
                  },
                  required: ['toolId', 'description'],
                },
              },
            },
            required: ['actions', 'tools'],
            type: 'object',
          },
          observationSurface: {
            additionalProperties: false,
            properties: {
              observations: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    observationId: string(ENVIRONMENT_ID_PATTERN),
                    channel: { enum: OBSERVATION_CHANNELS },
                    description: nullable(string(NEUTRAL_TEXT_PATTERN)),
                  },
                  required: ['observationId', 'channel', 'description'],
                },
              },
            },
            required: ['observations'],
            type: 'object',
          },
          resourceLimits: {
            additionalProperties: false,
            description: 'Bounded CPU, memory and wall-clock time (zero/negative rejected).',
            properties: {
              cpuMillis: positiveInteger(),
              memoryMiB: positiveInteger(),
              wallClockSeconds: positiveInteger(),
            },
            required: ['cpuMillis', 'memoryMiB', 'wallClockSeconds'],
            type: 'object',
          },
          networkPolicy: {
            additionalProperties: false,
            description: 'Default-deny egress; only explicit allows.',
            properties: {
              egress: { const: 'default-deny' },
              allows: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    host: string(HOSTNAME_PATTERN),
                    port: { type: 'integer', minimum: 1, maximum: 65535 },
                    protocol: { enum: EGRESS_PROTOCOLS },
                  },
                  required: ['host', 'port', 'protocol'],
                },
              },
            },
            required: ['egress', 'allows'],
            type: 'object',
          },
          filesystemPolicy: {
            additionalProperties: false,
            description: 'Explicit mounts only; there is no blanket write mode.',
            properties: {
              writeMode: { enum: FILESYSTEM_WRITE_MODES },
              mounts: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    mountPath: string(MOUNT_PATH_PATTERN),
                    access: { enum: MOUNT_ACCESS_MODES },
                    source: { enum: MOUNT_SOURCES },
                  },
                  required: ['mountPath', 'access', 'source'],
                },
              },
            },
            required: ['writeMode', 'mounts'],
            type: 'object',
          },
          secretPolicy: {
            additionalProperties: false,
            description:
              'Secret isolation. Injection points carry references only — secret material never ' +
              'enters canonical objects.',
            properties: {
              isolation: { const: 'isolation-boundary' },
              injectionPoints: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    secretId: string(ENVIRONMENT_ID_PATTERN),
                    mountPath: string(MOUNT_PATH_PATTERN),
                    mechanism: { enum: SECRET_INJECTION_MECHANISMS },
                  },
                  required: ['secretId', 'mountPath', 'mechanism'],
                },
              },
            },
            required: ['isolation', 'injectionPoints'],
            type: 'object',
          },
          timeLimits: {
            additionalProperties: false,
            properties: {
              startupSeconds: positiveInteger(),
              cleanupGraceSeconds: positiveInteger(),
              deadlineBehavior: { enum: DEADLINE_BEHAVIORS },
            },
            required: ['startupSeconds', 'cleanupGraceSeconds', 'deadlineBehavior'],
            type: 'object',
          },
          resetSemantics: {
            additionalProperties: false,
            properties: {
              mode: { enum: RESET_MODES },
              checkpoint: { oneOf: [{ type: 'null' }, { $ref: '#/$defs/checkpointRef' }] },
              cleanup: { enum: RESET_CLEANUPS },
            },
            required: ['mode', 'checkpoint', 'cleanup'],
            type: 'object',
          },
          checkpointRef: checkpointRefDef().checkpointRef,
          checkpointSemantics: {
            additionalProperties: false,
            properties: {
              supported: { type: 'boolean' },
              triggers: { type: 'array', items: { enum: CHECKPOINT_TRIGGERS } },
              retention: nullable(positiveInteger()),
            },
            required: ['supported', 'triggers', 'retention'],
            type: 'object',
          },
          evidenceOutputs: {
            additionalProperties: false,
            properties: {
              outputs: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    outputId: string(ENVIRONMENT_ID_PATTERN),
                    kind: { enum: EVIDENCE_OUTPUT_KINDS },
                    addressing: { enum: EVIDENCE_ADDRESSING_POLICIES },
                    description: nullable(string(NEUTRAL_TEXT_PATTERN)),
                  },
                  required: ['outputId', 'kind', 'addressing', 'description'],
                },
              },
            },
            required: ['outputs'],
            type: 'object',
          },
          evaluationHooks: {
            additionalProperties: false,
            properties: {
              evaluators: { type: 'array', minItems: 1, items: { $ref: '#/$defs/hookDeclaration' } },
              verifiers: { type: 'array', minItems: 1, items: { $ref: '#/$defs/hookDeclaration' } },
            },
            required: ['evaluators', 'verifiers'],
            type: 'object',
          },
          hookDeclaration: {
            additionalProperties: false,
            properties: {
              hookId: string(ENVIRONMENT_ID_PATTERN),
              role: { enum: HOOK_ROLES },
              phase: { enum: HOOK_PHASES },
              invocationSchema: string(SCHEMA_REF_PATTERN),
              description: nullable(string(NEUTRAL_TEXT_PATTERN)),
            },
            required: ['hookId', 'role', 'phase', 'invocationSchema', 'description'],
            type: 'object',
          },
        },
      };
    },
  },
  {
    id: 'environment-protocol/environment-version-ref',
    output: 'contracts/environment/environment-version-ref.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('environment-version-ref'),
        title: 'Arena environment version ref v1',
        description:
          'Content-addressed reference to a registered environment version: identity + version + digest.',
        type: 'object',
        additionalProperties: false,
        required: ['namespace', 'name', 'version', 'digest'],
        properties: {
          namespace: string(NAMESPACE_PATTERN),
          name: string(NAME_PATTERN),
          version: string(VERSION_PATTERN),
          digest: string(DIGEST_PATTERN),
        },
      };
    },
  },
  {
    id: 'environment-protocol/environment-image',
    output: 'contracts/environment/environment-image.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('environment-image'),
        title: 'Arena environment image v1',
        description:
          'Image/build digest declaration. The executable substrate is addressed exclusively ' +
          'through content digests — the protocol is runtime-neutral.',
        type: 'object',
        additionalProperties: false,
        required: ['imageKind', 'digest', 'buildDigest'],
        properties: {
          imageKind: { enum: IMAGE_KINDS },
          digest: string(DIGEST_PATTERN),
          buildDigest: nullable(string(DIGEST_PATTERN)),
        },
      };
    },
  },
  {
    id: 'environment-protocol/state-snapshot',
    output: 'contracts/environment/state-snapshot.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('state-snapshot'),
        title: 'Arena environment initial state v1',
        description:
          'The initial state snapshot declaration: a content-addressed snapshot reference plus the ' +
          'snapshot support flag (checkpoint semantics and snapshot-restore resets require it).',
        type: 'object',
        additionalProperties: false,
        required: ['snapshot', 'snapshotSupport'],
        properties: {
          snapshot: { $ref: '#/$defs/stateSnapshot' },
          snapshotSupport: { enum: SNAPSHOT_SUPPORT_MODES },
        },
        $defs: stateSnapshotDef(),
      };
    },
  },
  {
    id: 'environment-protocol/seed-policy',
    output: 'contracts/environment/seed-policy.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('seed-policy'),
        title: 'Arena environment seed policy v1',
        description:
          'How randomness enters the world: the embedded reproducibility profile, the declared seed ' +
          '(null iff unseeded; forbidden for deterministic worlds), its derivation algorithm and the ' +
          'reseeding bound.',
        type: 'object',
        additionalProperties: false,
        required: ['reproducibility', 'seed', 'seedAlgorithm', 'reseedPolicy', 'note'],
        properties: {
          reproducibility: { $ref: '#/$defs/reproducibilityProfile' },
          seed: nullable(string(NEUTRAL_TEXT_PATTERN)),
          seedAlgorithm: nullable(string(ENVIRONMENT_ID_PATTERN)),
          reseedPolicy: { enum: RESEED_POLICIES },
          note: nullable(string(NEUTRAL_TEXT_PATTERN)),
        },
        $defs: {
          reproducibilityProfile: {
            additionalProperties: false,
            properties: {
              mode: { enum: REPRODUCIBILITY_MODES },
              capture: { oneOf: [{ type: 'null' }, { $ref: '#/$defs/nondeterminismCapture' }] },
              note: nullable(string(NEUTRAL_TEXT_PATTERN)),
            },
            required: ['mode', 'capture', 'note'],
            type: 'object',
          },
          nondeterminismCapture: {
            additionalProperties: false,
            properties: {
              seed: string(NEUTRAL_TEXT_PATTERN),
              versions: string(NEUTRAL_TEXT_PATTERN),
              externalInputs: string(NEUTRAL_TEXT_PATTERN),
              timingContext: string(NEUTRAL_TEXT_PATTERN),
            },
            required: ['seed', 'versions', 'externalInputs', 'timingContext'],
            type: 'object',
          },
        },
      };
    },
  },
  {
    id: 'environment-protocol/reproducibility-profile',
    output: 'contracts/environment/reproducibility-profile.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('reproducibility-profile'),
        title: 'Arena reproducibility profile v1',
        description:
          'Deterministic preferred. Nondeterminism MUST capture seed, versions, external inputs and ' +
          'relevant timing/context metadata (spec ENV1.0 Reproducibility).',
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'capture', 'note'],
        properties: {
          mode: { enum: REPRODUCIBILITY_MODES },
          capture: { oneOf: [{ type: 'null' }, { $ref: '#/$defs/nondeterminismCapture' }] },
          note: nullable(string(NEUTRAL_TEXT_PATTERN)),
        },
        $defs: {
          nondeterminismCapture: {
            additionalProperties: false,
            properties: {
              seed: string(NEUTRAL_TEXT_PATTERN),
              versions: string(NEUTRAL_TEXT_PATTERN),
              externalInputs: string(NEUTRAL_TEXT_PATTERN),
              timingContext: string(NEUTRAL_TEXT_PATTERN),
            },
            required: ['seed', 'versions', 'externalInputs', 'timingContext'],
            type: 'object',
          },
        },
      };
    },
  },
  {
    id: 'environment-protocol/action-surface',
    output: 'contracts/environment/action-surface.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('action-surface'),
        title: 'Arena action/tool surface v1',
        description:
          'The closed set of typed actions a workload may perform plus the tools it may invoke ' +
          '(declared by neutral identifier; at least one action required).',
        type: 'object',
        additionalProperties: false,
        required: ['actions', 'tools'],
        properties: {
          actions: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['actionId', 'description'],
              properties: {
                actionId: string(ENVIRONMENT_ID_PATTERN),
                description: nullable(string(NEUTRAL_TEXT_PATTERN)),
              },
            },
          },
          tools: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['toolId', 'description'],
              properties: {
                toolId: string(ENVIRONMENT_ID_PATTERN),
                description: nullable(string(NEUTRAL_TEXT_PATTERN)),
              },
            },
          },
        },
      };
    },
  },
  {
    id: 'environment-protocol/observation-surface',
    output: 'contracts/environment/observation-surface.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('observation-surface'),
        title: 'Arena observation surface v1',
        description:
          'The closed set of observation channels the environment emits (at least one required).',
        type: 'object',
        additionalProperties: false,
        required: ['observations'],
        properties: {
          observations: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['observationId', 'channel', 'description'],
              properties: {
                observationId: string(ENVIRONMENT_ID_PATTERN),
                channel: { enum: OBSERVATION_CHANNELS },
                description: nullable(string(NEUTRAL_TEXT_PATTERN)),
              },
            },
          },
        },
      };
    },
  },
  {
    id: 'environment-protocol/resource-limits',
    output: 'contracts/environment/resource-limits.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('resource-limits'),
        title: 'Arena resource limits v1',
        description:
          'Bounded CPU, memory and wall-clock time. Zero, negative or non-integer values are ' +
          'rejected — a bound that does not bound is not a bound (architecture-lock rule 8).',
        type: 'object',
        additionalProperties: false,
        required: ['cpuMillis', 'memoryMiB', 'wallClockSeconds'],
        properties: {
          cpuMillis: positiveInteger(),
          memoryMiB: positiveInteger(),
          wallClockSeconds: positiveInteger(),
        },
      };
    },
  },
  {
    id: 'environment-protocol/network-policy',
    output: 'contracts/environment/network-policy.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('network-policy'),
        title: 'Arena network policy v1',
        description:
          'Default-deny egress. Egress is possible only through explicit allows; an allow-all ' +
          'mode does not exist in the closed vocabulary.',
        type: 'object',
        additionalProperties: false,
        required: ['egress', 'allows'],
        properties: {
          egress: { const: 'default-deny' },
          allows: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['host', 'port', 'protocol'],
              properties: {
                host: string(HOSTNAME_PATTERN),
                port: { type: 'integer', minimum: 1, maximum: 65535 },
                protocol: { enum: EGRESS_PROTOCOLS },
              },
            },
          },
        },
      };
    },
  },
  {
    id: 'environment-protocol/filesystem-policy',
    output: 'contracts/environment/filesystem-policy.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('filesystem-policy'),
        title: 'Arena filesystem policy v1',
        description:
          'Explicit mounts only — there is no blanket write mode. Writing is possible only on ' +
          'individually declared read-write mounts.',
        type: 'object',
        additionalProperties: false,
        required: ['writeMode', 'mounts'],
        properties: {
          writeMode: { enum: FILESYSTEM_WRITE_MODES },
          mounts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['mountPath', 'access', 'source'],
              properties: {
                mountPath: string(MOUNT_PATH_PATTERN),
                access: { enum: MOUNT_ACCESS_MODES },
                source: { enum: MOUNT_SOURCES },
              },
            },
          },
        },
      };
    },
  },
  {
    id: 'environment-protocol/secret-policy',
    output: 'contracts/environment/secret-policy.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('secret-policy'),
        title: 'Arena secret policy v1',
        description:
          'Secret isolation. Secrets are referenced by neutral id and injected at declared points ' +
          '(path + mechanism). Secret VALUES never enter canonical objects — value-carrying field ' +
          'names are rejected by the runtime guard (spec ENV1.0 Isolation).',
        type: 'object',
        additionalProperties: false,
        required: ['isolation', 'injectionPoints'],
        properties: {
          isolation: { const: 'isolation-boundary' },
          injectionPoints: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['secretId', 'mountPath', 'mechanism'],
              properties: {
                secretId: string(ENVIRONMENT_ID_PATTERN),
                mountPath: string(MOUNT_PATH_PATTERN),
                mechanism: { enum: SECRET_INJECTION_MECHANISMS },
              },
            },
          },
        },
      };
    },
  },
  {
    id: 'environment-protocol/time-limits',
    output: 'contracts/environment/time-limits.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('time-limits'),
        title: 'Arena time limits v1',
        description:
          'The finer-grained time policy: startup budget, cleanup/grace budget (which must fit ' +
          'inside the run wall clock) and the deadline behavior.',
        type: 'object',
        additionalProperties: false,
        required: ['startupSeconds', 'cleanupGraceSeconds', 'deadlineBehavior'],
        properties: {
          startupSeconds: positiveInteger(),
          cleanupGraceSeconds: positiveInteger(),
          deadlineBehavior: { enum: DEADLINE_BEHAVIORS },
        },
      };
    },
  },
  {
    id: 'environment-protocol/reset-semantics',
    output: 'contracts/environment/reset-semantics.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('reset-semantics'),
        title: 'Arena reset semantics v1',
        description:
          'How a run world is reset. Mode reset-to-checkpoint requires a valid checkpoint ref; ' +
          'the snapshot modes require the initial state snapshot support flag.',
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'checkpoint', 'cleanup'],
        properties: {
          mode: { enum: RESET_MODES },
          checkpoint: { oneOf: [{ type: 'null' }, { $ref: '#/$defs/checkpointRef' }] },
          cleanup: { enum: RESET_CLEANUPS },
        },
        $defs: checkpointRefDef(),
      };
    },
  },
  {
    id: 'environment-protocol/checkpoint-semantics',
    output: 'contracts/environment/checkpoint-semantics.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('checkpoint-semantics'),
        title: 'Arena checkpoint semantics v1',
        description:
          'Whether checkpointing is supported, its closed trigger set and its bounded retention. ' +
          'Support requires the initial state snapshot support flag.',
        type: 'object',
        additionalProperties: false,
        required: ['supported', 'triggers', 'retention'],
        properties: {
          supported: { type: 'boolean' },
          triggers: { type: 'array', items: { enum: CHECKPOINT_TRIGGERS } },
          retention: nullable(positiveInteger()),
        },
      };
    },
  },
  {
    id: 'environment-protocol/evidence-outputs',
    output: 'contracts/environment/evidence-outputs.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('evidence-outputs'),
        title: 'Arena evidence outputs v1',
        description:
          'The closed set of evidence kinds a run produces, each with its digest addressing ' +
          'policy (spec ENV1.0 Evidence).',
        type: 'object',
        additionalProperties: false,
        required: ['outputs'],
        properties: {
          outputs: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['outputId', 'kind', 'addressing', 'description'],
              properties: {
                outputId: string(ENVIRONMENT_ID_PATTERN),
                kind: { enum: EVIDENCE_OUTPUT_KINDS },
                addressing: { enum: EVIDENCE_ADDRESSING_POLICIES },
                description: nullable(string(NEUTRAL_TEXT_PATTERN)),
              },
            },
          },
        },
      };
    },
  },
  {
    id: 'environment-protocol/evaluation-hooks',
    output: 'contracts/environment/evaluation-hooks.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('evaluation-hooks'),
        title: 'Arena evaluation hooks v1',
        description:
          'Evaluator and verifier hooks bound to the environment — at least one of each required ' +
          '(evaluation and verification are first-class Arena pillars).',
        type: 'object',
        additionalProperties: false,
        required: ['evaluators', 'verifiers'],
        properties: {
          evaluators: { type: 'array', minItems: 1, items: { $ref: '#/$defs/hookDeclaration' } },
          verifiers: { type: 'array', minItems: 1, items: { $ref: '#/$defs/hookDeclaration' } },
        },
        $defs: {
          hookDeclaration: {
            additionalProperties: false,
            properties: {
              hookId: string(ENVIRONMENT_ID_PATTERN),
              role: { enum: HOOK_ROLES },
              phase: { enum: HOOK_PHASES },
              invocationSchema: string(SCHEMA_REF_PATTERN),
              description: nullable(string(NEUTRAL_TEXT_PATTERN)),
            },
            required: ['hookId', 'role', 'phase', 'invocationSchema', 'description'],
            type: 'object',
          },
        },
      };
    },
  },
  {
    id: 'environment-protocol/run-address',
    output: 'contracts/environment/run-address.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('run-address'),
        title: 'Arena run address v1',
        description:
          'Evidence addressability: every run is addressable by task version, environment version ' +
          '(content-addressed), run id, initial snapshot digest, trajectory digest and evidence ' +
          'digests — all required, or construction fails (spec ENV1.0 Evidence).',
        type: 'object',
        additionalProperties: false,
        required: [
          'taskVersion',
          'environmentVersion',
          'runId',
          'initialSnapshotDigest',
          'trajectoryDigest',
          'evidenceDigests',
        ],
        properties: {
          taskVersion: { $ref: '#/$defs/taskVersionRef' },
          environmentVersion: { $ref: '#/$defs/environmentVersionRef' },
          runId: string(ENVIRONMENT_ID_PATTERN),
          initialSnapshotDigest: string(DIGEST_PATTERN),
          trajectoryDigest: string(DIGEST_PATTERN),
          evidenceDigests: {
            type: 'array',
            minItems: 1,
            items: string(DIGEST_PATTERN),
          },
        },
        $defs: {
          ...environmentVersionRefDef(),
          taskVersionRef: {
            additionalProperties: false,
            description: 'Versioned task reference (task-spec owns the full surface).',
            properties: {
              taskId: string(ENVIRONMENT_ID_PATTERN),
              version: string(TASK_VERSION_PATTERN),
            },
            required: ['taskId', 'version'],
            type: 'object',
          },
        },
      };
    },
  },
  {
    id: 'environment-protocol/task-version-ref',
    output: 'contracts/environment/task-version-ref.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('task-version-ref'),
        title: 'Arena task version ref v1',
        description:
          'Minimal versioned task reference (id + version); the task-spec protocol owns the full task surface.',
        type: 'object',
        additionalProperties: false,
        required: ['taskId', 'version'],
        properties: {
          taskId: string(ENVIRONMENT_ID_PATTERN),
          version: string(TASK_VERSION_PATTERN),
        },
      };
    },
  },
  {
    id: 'environment-protocol/workload-declaration',
    output: 'contracts/environment/workload-declaration.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('workload-declaration'),
        title: 'Arena workload declaration v1',
        description:
          'What runs inside an environment: trust classification and requirements (references and ' +
          'quotas only). An untrusted workload requiring more than the environment declares is ' +
          'rejected by the least-privilege admission check.',
        type: 'object',
        additionalProperties: false,
        required: ['trust', 'requirements'],
        properties: {
          trust: { enum: WORKLOAD_TRUST_LEVELS },
          requirements: {
            type: 'object',
            additionalProperties: false,
            required: [
              'networkHosts',
              'writePaths',
              'secretIds',
              'minCpuMillis',
              'minMemoryMiB',
              'minWallClockSeconds',
            ],
            properties: {
              networkHosts: { type: 'array', items: string(HOSTNAME_PATTERN) },
              writePaths: { type: 'array', items: string(MOUNT_PATH_PATTERN) },
              secretIds: { type: 'array', items: string(ENVIRONMENT_ID_PATTERN) },
              minCpuMillis: positiveInteger(),
              minMemoryMiB: positiveInteger(),
              minWallClockSeconds: positiveInteger(),
            },
          },
        },
      };
    },
  },
  {
    id: 'environment-protocol/environment-error',
    output: 'contracts/environment/environment-error.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('environment-error'),
        title: 'Arena EnvironmentError v1',
        description:
          'Structured, serializable form of the environment protocol error taxonomy. Unknown codes ' +
          'are rejected when parsing (ENVIRONMENT_UNKNOWN_ERROR). Core-level failures still travel ' +
          'as @arena/protocol-core ProtocolError structures.',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: ENVIRONMENT_ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object', description: 'Structured, JSON-serializable context.' },
          correlationId: { type: 'string', pattern: IDENTIFIER_PATTERN },
        },
      };
    },
  },
  {
    id: 'environment-protocol/register-environment-command',
    output: 'contracts/environment/register-environment-command.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('register-environment-command'),
        title: 'Arena register-environment command payload v1',
        description:
          'Command payload for registering a versioned, content-addressed environment definition. ' +
          'Travels inside Envelope<T> with a REQUIRED non-null idempotency key ' +
          '(architecture-lock rule 17); registry-style dedup applies on the runner side.',
        type: 'object',
        additionalProperties: false,
        required: ['environment'],
        properties: {
          environment: { $ref: `arena:schema/environment/environment-definition@${ENVIRONMENT_SCHEMA_VERSION}` },
        },
      };
    },
  },
  {
    id: 'environment-protocol/environment-registered-event',
    output: 'contracts/environment/environment-registered-event.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('environment-registered-event'),
        title: 'Arena environment-registered event payload v1',
        description:
          'Event payload emitted when an environment version is registered: the content-addressed ' +
          'environment version ref.',
        type: 'object',
        additionalProperties: false,
        required: ['environment'],
        properties: {
          environment: { $ref: `arena:schema/environment/environment-version-ref@${ENVIRONMENT_SCHEMA_VERSION}` },
        },
      };
    },
  },
  {
    id: 'environment-protocol/admit-workload-command',
    output: 'contracts/environment/admit-workload-command.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('admit-workload-command'),
        title: 'Arena admit-workload command payload v1',
        description:
          'Command payload for admitting a workload declaration against a registered environment ' +
          'version. Travels inside Envelope<T> with a REQUIRED non-null idempotency key; the runner ' +
          'performs the least-privilege check before admission.',
        type: 'object',
        additionalProperties: false,
        required: ['environment', 'workload'],
        properties: {
          environment: { $ref: `arena:schema/environment/environment-version-ref@${ENVIRONMENT_SCHEMA_VERSION}` },
          workload: { $ref: `arena:schema/environment/workload-declaration@${ENVIRONMENT_SCHEMA_VERSION}` },
        },
      };
    },
  },
  {
    id: 'environment-protocol/workload-admitted-event',
    output: 'contracts/environment/workload-admitted-event.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('workload-admitted-event'),
        title: 'Arena workload-admitted event payload v1',
        description:
          'Event payload emitted when a workload declaration is admitted into an environment ' +
          'version (after the least-privilege check).',
        type: 'object',
        additionalProperties: false,
        required: ['environment', 'workload'],
        properties: {
          environment: { $ref: `arena:schema/environment/environment-version-ref@${ENVIRONMENT_SCHEMA_VERSION}` },
          workload: { $ref: `arena:schema/environment/workload-declaration@${ENVIRONMENT_SCHEMA_VERSION}` },
        },
      };
    },
  },
  {
    id: 'environment-protocol/schema-registry',
    output: 'contracts/environment/environment-schema-registry.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('schema-registry'),
        title: 'Arena environment-protocol schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/environment-protocol. A SchemaRef matching this ' +
          'enum is a known environment-protocol schema at the listed version; anything else is not.',
        type: 'string',
        enum: ENVIRONMENT_SCHEMA_NAMES.map((name) => ref(name)),
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
  const tempDir = join(tmpdir(), `arena-environment-contracts-${process.pid}-${Date.now()}`);
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
