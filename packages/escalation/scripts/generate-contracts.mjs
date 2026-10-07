#!/usr/bin/env node
/**
 * Arena escalation domain contract generator (Work Order C001).
 *
 * Follows the A001 generated-contracts convention
 * (scripts/generate-contracts.mjs) and the package-level convention
 * (packages/arena-sdk/scripts/generate-contracts.mjs — the A025 sibling):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id,
 *     repo-relative output path, builder). This generator owns the C001
 *     surfaces ONLY — it emits every schema for @arena/escalation into
 *     contracts/escalation/ at the repository root.
 *   - Generated files are committed, deterministic (sorted keys,
 *     2-space indent, trailing newline) and carry a versioned SchemaRef
 *     $id in the `escalation` namespace.
 *   - `--check` regenerates into a temp directory and compares with the
 *     committed copies; any missing / extra / changed file is drift and
 *     exits non-zero. The drift suite (src/drift.test.ts) runs this
 *     check as part of `pnpm test`, the package script
 *     `contracts:check` runs it directly, and the governance G9 check
 *     auto-discovers this generator through its
 *     packages/.../generate-contracts.mjs glob (the root manifest
 *     itself needs no edit — no root-surface modification required).
 *   - The deterministic serializer is duplicated from the A001
 *     generator (10 lines) instead of imported, because importing that
 *     module executes its CLI main() as an import side effect.
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
// Shared escalation constants — MUST match the TypeScript surfaces
// (packages/escalation/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = '1.0.0';
const IDENTIFIER_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const TENANT_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const CLIENT_APP_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const ESCALATION_ID_PATTERN = '^esc_[0-9a-f]{32}$';
const EVENT_ID_PATTERN = '^evt_[0-9a-f]{32}$';
const SOURCE_REF_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$';
const CAPABILITY_NEED_PATTERN = '^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*){0,31}$';
const CURRENCY_PATTERN = '^[A-Z]{3}$';
const LOCALE_PATTERN = '^[a-z]{2,3}(-[A-Z]{2})?$';
const TIMESTAMP_PATTERN = '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$';
const DIGEST_PATTERN = '^[0-9a-f]{64}$';

const ESCALATION_MODES = [
  'solve',
  'correct',
  'unblock',
  'review',
  'teach',
  'tool_gap',
  'knowledge',
  'evaluate',
];
const ESCALATION_URGENCIES = ['routine', 'priority', 'urgent', 'critical'];
const ESCALATION_STATES = [
  'created',
  'triaged',
  'matching',
  'offered',
  'accepted',
  'session_ready',
  'in_progress',
  'submitted',
  'validating',
  'result_accepted',
  'revision_required',
  'result_rejected',
  'paid',
  'learning_captured',
  'expert_replaced',
  'closed',
  'cancelled',
  'timed_out',
];
const ESCALATION_TERMINAL_STATES = ['closed', 'cancelled', 'timed_out'];
const PERMITTED_ACTIONS = [
  'read-context',
  'run-approved-tools',
  'propose-patch',
  'annotate-evidence',
  'ask-clarification',
  'signal-tool-gap',
];
const RESULT_KINDS = [
  'correction',
  'unblock',
  'answer',
  'decision',
  'solution',
  'review',
  'evidence-bundle',
  'knowledge-patch',
  'tool-gap-signal',
  'evaluation-verdict',
  'learning-artifact-ref',
];
const WEBHOOK_EVENT_TYPES = [
  'escalation.created',
  'escalation.matched',
  'escalation.accepted',
  'escalation.session.ready',
  'escalation.started',
  'escalation.progressed',
  'escalation.submitted',
  'escalation.validation.updated',
  'escalation.completed',
  'escalation.failed',
  'escalation.cancelled',
  'escalation.payment.updated',
  'escalation.learning.updated',
];
const ESCALATION_ERROR_CODES = [
  'ESCALATION_INVALID_REQUEST',
  'ESCALATION_INVALID_TENANT',
  'ESCALATION_INVALID_MODE',
  'ESCALATION_INVALID_RESULT',
  'ESCALATION_INVALID_EVENT',
  'ESCALATION_INVALID_STATE',
  'ESCALATION_INVALID_TRANSITION',
  'ESCALATION_TERMINAL_STATE',
  'ESCALATION_IDENTITY_CONFLICT',
  'ESCALATION_CROSS_TENANT_ACCESS',
  'ESCALATION_UNPERMITTED_ACTION',
  'ESCALATION_DEADLINE_PASSED',
  'ESCALATION_TAMPERED',
  'ESCALATION_SCHEMA_MISMATCH',
  'ESCALATION_UNSUPPORTED_VERSION',
  'ESCALATION_UNKNOWN_ERROR',
];
const ESCALATION_ERROR_CATEGORIES = [
  'validation',
  'state',
  'scope',
  'idempotency',
  'integrity',
  'versioning',
  'unknown',
];
const RESPONSE_KINDS = ['escalation-created', 'escalation-replayed', 'escalation-status'];

const ref = (name) => `arena:schema/escalation/${name}@${SCHEMA_VERSION}`;

// ---------------------------------------------------------------------------
// Contract manifest — the escalation schemas owned by @arena/escalation.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'escalation/escalation-mode',
    output: 'contracts/escalation/escalation-mode.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('escalation-mode'),
        title: 'Arena escalation mode v1',
        description:
          'The approved escalation modes (architecture-lock rule 27). A request carries one or ' +
          'more modes; mode changes happen only through explicit lifecycle transitions ' +
          '(spec/human-escalation-work-items.md).',
        type: 'string',
        enum: ESCALATION_MODES,
      };
    },
  },
  {
    id: 'escalation/escalation-state',
    output: 'contracts/escalation/escalation-state.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('escalation-state'),
        title: 'Arena escalation lifecycle state v1',
        description:
          'The durable escalation lifecycle (ES1.0): CREATED → TRIAGED → MATCHING → OFFERED → ' +
          'ACCEPTED → SESSION_READY → IN_PROGRESS → SUBMITTED → VALIDATING → ' +
          'ACCEPTED|REVISION_REQUIRED|REJECTED → PAID → LEARNING_CAPTURED → CLOSED, plus the ' +
          'EXPLICIT timed_out / cancelled / expert_replaced states. Terminal states are final.',
        type: 'string',
        enum: ESCALATION_STATES,
        'x-terminal-states': ESCALATION_TERMINAL_STATES,
      };
    },
  },
  {
    id: 'escalation/escalation-error',
    output: 'contracts/escalation/escalation-error.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('escalation-error'),
        title: 'Arena escalation error v1',
        description:
          'Structured, serializable form of the escalation error taxonomy. Unknown codes are ' +
          'rejected when parsing (fail-closed).',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: ESCALATION_ERROR_CODES },
          category: { enum: ESCALATION_ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object', description: 'Structured, JSON-serializable context.' },
          correlationId: { type: 'string', pattern: IDENTIFIER_PATTERN },
        },
      };
    },
  },
  {
    id: 'escalation/escalation-request',
    output: 'contracts/escalation/escalation-request.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('escalation-request'),
        title: 'Arena EscalationRequest v1 (ES1.0 primary object)',
        description:
          'The provider-neutral integration boundary object: any AI application escalates a ' +
          'capability boundary without understanding Arena internal domain topology. The digest ' +
          'is sha256 over the canonical JSON of the digest-free view.',
        type: 'object',
        additionalProperties: false,
        required: [
          'requestVersion',
          'requestId',
          'clientAppId',
          'tenantId',
          'sourceWorkflowRef',
          'sourceRunRef',
          'capabilityNeed',
          'escalationModes',
          'urgency',
          'createdAt',
          'deadline',
          'budget',
          'expertRequirements',
          'locale',
          'desiredOutputSchema',
          'contextReferences',
          'environmentSessionPolicy',
          'privacyPolicy',
          'permittedActions',
          'learningPermissions',
          'retentionPolicy',
          'idempotencyKey',
          'correlationId',
          'digest',
        ],
        properties: {
          requestVersion: { const: 1 },
          requestId: { type: 'string', pattern: ESCALATION_ID_PATTERN },
          clientAppId: { type: 'string', pattern: CLIENT_APP_PATTERN },
          tenantId: { type: 'string', pattern: TENANT_PATTERN },
          sourceWorkflowRef: { type: 'string', pattern: SOURCE_REF_PATTERN },
          sourceRunRef: { type: 'string', pattern: SOURCE_REF_PATTERN },
          taskRef: { type: 'string', pattern: SOURCE_REF_PATTERN },
          capabilityNeed: { type: 'string', pattern: CAPABILITY_NEED_PATTERN },
          escalationModes: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { enum: ESCALATION_MODES },
          },
          urgency: { enum: ESCALATION_URGENCIES },
          createdAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
          deadline: { type: 'string', pattern: TIMESTAMP_PATTERN },
          budget: {
            type: 'object',
            additionalProperties: false,
            required: ['amountMinorUnits', 'currency'],
            properties: {
              amountMinorUnits: { type: 'integer', minimum: 0 },
              currency: { type: 'string', pattern: CURRENCY_PATTERN },
            },
          },
          expertRequirements: {
            type: 'object',
            additionalProperties: false,
            required: ['requiredCapabilities'],
            properties: {
              requiredCapabilities: {
                type: 'array',
                minItems: 1,
                uniqueItems: true,
                items: { type: 'string', pattern: CAPABILITY_NEED_PATTERN },
              },
              preferredLocales: {
                type: 'array',
                items: { type: 'string', pattern: LOCALE_PATTERN },
              },
              jurisdictions: {
                type: 'array',
                items: { type: 'string', pattern: SOURCE_REF_PATTERN },
              },
            },
          },
          locale: { type: 'string', pattern: LOCALE_PATTERN },
          desiredOutputSchema: {
            type: 'object',
            description: 'Plain-JSON desired output schema (inline JSON-Schema-shaped object).',
          },
          contextReferences: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'ref'],
              properties: {
                kind: { enum: ['uri', 'artifact-ref', 'trajectory-ref', 'task-ref'] },
                ref: { type: 'string', pattern: SOURCE_REF_PATTERN },
              },
            },
          },
          environmentSessionPolicy: {
            type: 'object',
            additionalProperties: false,
            required: ['sessionMode', 'sanitization'],
            properties: {
              sessionMode: { enum: ['none', 'bounded-replica'] },
              sanitization: { enum: ['standard', 'strict'] },
            },
            description:
              'Bounded-replica policy (architecture-lock rule 28): the replica is never a write path to the host application live world.',
          },
          privacyPolicy: {
            type: 'object',
            additionalProperties: false,
            required: ['dataClassification', 'pii'],
            properties: {
              dataClassification: { enum: ['public', 'internal', 'confidential'] },
              pii: { enum: ['forbid', 'redact', 'allow'] },
            },
          },
          permittedActions: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { enum: PERMITTED_ACTIONS },
            description: 'The closed vocabulary of actions the expert is permitted to take.',
          },
          learningPermissions: {
            type: 'object',
            additionalProperties: false,
            required: [
              'allowKnowledgeCapture',
              'allowToolGapSignals',
              'allowArtifactReuse',
              'requireApproval',
            ],
            properties: {
              allowKnowledgeCapture: { type: 'boolean' },
              allowToolGapSignals: { type: 'boolean' },
              allowArtifactReuse: { type: 'boolean' },
              requireApproval: { type: 'boolean' },
            },
          },
          retentionPolicy: {
            type: 'object',
            additionalProperties: false,
            required: ['retentionMs', 'disposition'],
            properties: {
              retentionMs: { type: 'integer', minimum: 0 },
              disposition: { enum: ['retain', 'purge'] },
            },
          },
          idempotencyKey: { type: 'string', pattern: IDENTIFIER_PATTERN },
          correlationId: { type: 'string', pattern: IDENTIFIER_PATTERN },
          digest: { type: 'string', pattern: DIGEST_PATTERN },
        },
      };
    },
  },
  {
    id: 'escalation/escalation-result',
    output: 'contracts/escalation/escalation-result.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('escalation-result'),
        title: 'Arena escalation result taxonomy v1',
        description:
          'The closed 11-kind result taxonomy (ES1.0). Every kind carries kind-specific required ' +
          'fields enforced by the domain guards; an accepted result is operationally distinct ' +
          'from any reusable learning artifact (architecture-lock rule 31).',
        type: 'object',
        required: ['resultVersion', 'kind', 'producedAt', 'summary'],
        properties: {
          resultVersion: { const: 1 },
          kind: { enum: RESULT_KINDS },
          producedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
          summary: { type: 'string', minLength: 1, maxLength: 4096 },
          correctedRef: { type: 'string', pattern: SOURCE_REF_PATTERN },
          replacement: { description: 'Plain-JSON corrected payload (correction).' },
          blockageRef: { type: 'string', pattern: SOURCE_REF_PATTERN },
          resolution: { description: 'Plain-JSON resolution payload (unblock).' },
          payload: { description: 'Plain-JSON answer/solution payload.' },
          decision: { type: 'string' },
          rationale: { type: 'string' },
          optionsConsidered: { type: 'array', items: { type: 'string' } },
          verdict: {
            description: 'review: approved|changes-requested|rejected; evaluation-verdict: pass|fail|inconclusive.',
          },
          findings: { type: 'array', items: { type: 'string' } },
          evidenceRefs: { type: 'array', items: { type: 'string' } },
          statement: { type: 'string' },
          scope: { type: 'string' },
          missingToolId: { type: 'string', pattern: SOURCE_REF_PATTERN },
          subjectRef: { type: 'string', pattern: SOURCE_REF_PATTERN },
          artifactRef: { type: 'string', pattern: SOURCE_REF_PATTERN },
          provenance: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
        },
      };
    },
  },
  {
    id: 'escalation/escalation-webhook-event',
    output: 'contracts/escalation/escalation-webhook-event.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('escalation-webhook-event'),
        title: 'Arena escalation webhook event v1',
        description:
          'The closed 13-event minimum vocabulary (ES1.0). Delivery is durable, at-least-once; ' +
          'eventId IS the idempotent consumer key and (requestId, sequence) is the ordering key. ' +
          'The webhook stream is a projection of the canonical lifecycle — never a second ' +
          'semantic authority.',
        type: 'object',
        additionalProperties: false,
        required: [
          'eventVersion',
          'eventId',
          'eventType',
          'requestId',
          'tenantId',
          'correlationId',
          'sequence',
          'occurredAt',
          'state',
          'data',
        ],
        properties: {
          eventVersion: { const: 1 },
          eventId: { type: 'string', pattern: EVENT_ID_PATTERN },
          eventType: { enum: WEBHOOK_EVENT_TYPES },
          requestId: { type: 'string', pattern: ESCALATION_ID_PATTERN },
          tenantId: { type: 'string', pattern: TENANT_PATTERN },
          correlationId: { type: 'string', pattern: IDENTIFIER_PATTERN },
          sequence: { type: 'integer', minimum: 1 },
          occurredAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
          state: {
            oneOf: [{ type: 'null' }, { enum: ESCALATION_STATES }],
          },
          data: { description: 'Structured, kind-dependent plain-JSON data.' },
        },
      };
    },
  },
  {
    id: 'escalation/escalation-response',
    output: 'contracts/escalation/escalation-response.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('escalation-response'),
        title: 'Arena escalation API response v1',
        description:
          'The per-surface result vocabulary of the escalation API (ES1.0 response fields travel ' +
          'on the status view): created | replayed | status. Replays carry duplicate=true and the ' +
          'ORIGINAL request id (idempotency-key semantics).',
        type: 'object',
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['responseVersion', 'kind', 'requestId', 'correlationId', 'duplicate'],
            properties: {
              responseVersion: { const: 1 },
              kind: { enum: ['escalation-created', 'escalation-replayed'] },
              requestId: { type: 'string', pattern: ESCALATION_ID_PATTERN },
              correlationId: { type: 'string', pattern: IDENTIFIER_PATTERN },
              duplicate: { type: 'boolean' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['responseVersion', 'kind', 'record'],
            properties: {
              responseVersion: { const: 1 },
              kind: { enum: ['escalation-status'] },
              record: {
                type: 'object',
                description: 'The full EscalationRecord (request + state + append-only history + result/cost fields where applicable).',
              },
            },
          },
        ],
        'x-response-kinds': RESPONSE_KINDS,
      };
    },
  },
  {
    id: 'escalation/create-escalation-command',
    output: 'contracts/escalation/create-escalation-command.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('create-escalation-command'),
        title: 'Arena create-escalation-command v1',
        description:
          'The POST /v1/escalations wire form: a command envelope (REQUIRED non-null ' +
          'idempotency key — architecture-lock rule 17) whose payload is an EscalationRequest. ' +
          'Duplicate (tenant, idempotency key, correlation id) submissions REPLAY the original; ' +
          'conflicting key+body is a typed ESCALATION_IDENTITY_CONFLICT rejection.',
        type: 'object',
        required: ['requestVersion', 'requestId', 'tenantId', 'idempotencyKey', 'correlationId', 'digest'],
        properties: {
          requestVersion: { const: 1 },
          requestId: { type: 'string', pattern: ESCALATION_ID_PATTERN },
          clientAppId: { type: 'string', pattern: CLIENT_APP_PATTERN },
          tenantId: { type: 'string', pattern: TENANT_PATTERN },
          sourceWorkflowRef: { type: 'string', pattern: SOURCE_REF_PATTERN },
          sourceRunRef: { type: 'string', pattern: SOURCE_REF_PATTERN },
          taskRef: { type: 'string', pattern: SOURCE_REF_PATTERN },
          capabilityNeed: { type: 'string', pattern: CAPABILITY_NEED_PATTERN },
          escalationModes: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { enum: ESCALATION_MODES },
          },
          urgency: { enum: ESCALATION_URGENCIES },
          createdAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
          deadline: { type: 'string', pattern: TIMESTAMP_PATTERN },
          budget: { type: 'object' },
          expertRequirements: { type: 'object' },
          locale: { type: 'string', pattern: LOCALE_PATTERN },
          desiredOutputSchema: { type: 'object' },
          contextReferences: { type: 'array' },
          environmentSessionPolicy: { type: 'object' },
          privacyPolicy: { type: 'object' },
          permittedActions: { type: 'array', items: { enum: PERMITTED_ACTIONS } },
          learningPermissions: { type: 'object' },
          retentionPolicy: { type: 'object' },
          idempotencyKey: { type: 'string', pattern: IDENTIFIER_PATTERN },
          correlationId: { type: 'string', pattern: IDENTIFIER_PATTERN },
          digest: { type: 'string', pattern: DIGEST_PATTERN },
        },
        '$comment':
          'Full per-field constraints live in escalation-request.v1.json; this envelope-payload contract re-states the identity-critical fields and carries the rest opaquely.',
      };
    },
  },
  {
    id: 'escalation/get-escalation-status-query',
    output: 'contracts/escalation/get-escalation-status-query.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('get-escalation-status-query'),
        title: 'Arena get-escalation-status-query v1',
        description:
          'The GET /v1/escalations/{request_id} wire form: a query envelope (NULL idempotency ' +
          'key — reads are not commands; correlation-addressable). Idempotent status polling.',
        type: 'object',
        additionalProperties: false,
        required: ['queryVersion', 'requestId', 'tenantId'],
        properties: {
          queryVersion: { const: 1 },
          requestId: { type: 'string', pattern: ESCALATION_ID_PATTERN },
          tenantId: { type: 'string', pattern: TENANT_PATTERN },
        },
      };
    },
  },
  {
    id: 'escalation/schema-registry',
    output: 'contracts/escalation/schema-registry.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('schema-registry'),
        title: 'Arena escalation schema registry v1',
        description:
          'Enumerates the escalation-domain schemas owned by @arena/escalation. A SchemaRef ' +
          'matching this enum is a known escalation schema at the listed version; anything else is not.',
        type: 'string',
        enum: CONTRACTS.filter((c) => c.id !== 'escalation/schema-registry').map((c) =>
          ref(c.id.split('/')[1]),
        ),
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Deterministic serialization (duplicated from the A001 generator)
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
// Output / check (duplicated from the A001 generator)
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
  const tempDir = join(tmpdir(), `arena-escalation-contracts-${process.pid}-${Date.now()}`);
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

    // Extra-file check scoped to this generator's output directory only.
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
  console.log('[contracts] regenerate committed with: git add contracts/escalation');
}

main();
