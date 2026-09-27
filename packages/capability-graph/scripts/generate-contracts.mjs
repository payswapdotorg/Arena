#!/usr/bin/env node
/**
 * Arena capability-graph contract generator (Work Order A004).
 *
 * Follows the A001/A002 generated-contracts convention
 * (scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id, repo-relative
 *     output path, builder). This generator owns the A004 surfaces ONLY — it
 *     emits every schema for @arena/capability-graph into
 *     contracts/capability/ at the repository root.
 *   - Generated files are committed, deterministic (sorted keys, 2-space
 *     indent, trailing newline) and carry a versioned SchemaRef $id.
 *   - `--check` regenerates into a temp directory and compares with the
 *     committed copies; any missing / extra / changed file is drift and exits
 *     non-zero. The drift suite (src/drift.test.ts) runs this check as part
 *     of `pnpm test`, the package script `contracts:check` runs it directly,
 *     and the repo-wide governance G9 entry point runs every package-level
 *     generator (packages/<pkg>/scripts/generate-contracts.mjs) with
 *     --check, so this generator is wired into governance without any root
 *     file edit.
 *   - The deterministic serializer is duplicated from the A001 generator
 *     (10 lines) instead of imported, because importing that module executes
 *     its CLI main() as an import side effect.
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
// Shared protocol constants — MUST match the TypeScript surface
// (packages/capability-graph/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const IDENTIFIER_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const SCHEMA_REF_PATTERN = '^arena:schema/[a-z][a-z0-9-]*/[a-z][a-z0-9-]*@\\d+\\.\\d+\\.\\d+$';

// capability-graph constants (packages/capability-graph/src)
const NODE_ID_PATTERN = '^[a-z][a-z0-9-]{0,127}$';
const NODE_VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const NODE_KINDS = [
  'domain',
  'capability',
  'sub-capability',
  'skill',
  'tool',
  'task-family',
  'evaluator',
  'verifier',
  'expert-competency',
  'observed-failure',
  'body-version',
];
const EDGE_KINDS = [
  'decomposes-into',
  'requires',
  'produces',
  'evaluates',
  'verifies',
  'observes-failure-of',
  'competent-in',
  'exercised-by',
  'extends-domain',
];
const DECOMPOSITION_CATEGORIES = [
  'declarative-knowledge',
  'procedural-skill',
  'tool-skill',
  'reasoning-decision-pattern',
  'verification-skill',
  'communication-escalation-behavior',
  'domain-method',
];
const CUSTOMER_DATA_POLICIES = ['none', 'derived', 'contains'];
const SEVERITIES = ['minor', 'moderate', 'major', 'critical'];
const CAPABILITY_ERROR_CODES = [
  'CAPABILITY_GRAPH_CYCLE_DETECTED',
  'CAPABILITY_GRAPH_IDENTITY_CONFLICT',
  'CAPABILITY_GRAPH_INVALID_DIGEST',
  'CAPABILITY_GRAPH_INVALID_EDGE',
  'CAPABILITY_GRAPH_INVALID_EDGE_KIND',
  'CAPABILITY_GRAPH_INVALID_ID',
  'CAPABILITY_GRAPH_INVALID_NODE',
  'CAPABILITY_GRAPH_INVALID_NODE_KIND',
  'CAPABILITY_GRAPH_INVALID_PACK',
  'CAPABILITY_GRAPH_INVALID_PAYLOAD',
  'CAPABILITY_GRAPH_INVALID_REF',
  'CAPABILITY_GRAPH_INVALID_SUPERSESSION',
  'CAPABILITY_GRAPH_INVALID_TIMESTAMP',
  'CAPABILITY_GRAPH_INVALID_VERSION',
  'CAPABILITY_GRAPH_NODE_NOT_FOUND',
  'CAPABILITY_GRAPH_PACK_OVERREACH',
  'CAPABILITY_GRAPH_TAMPERED',
  'CAPABILITY_GRAPH_UNKNOWN_ERROR',
  'CAPABILITY_GRAPH_UNSUPPORTED_RECORD_VERSION',
];
const ERROR_CATEGORIES = ['encoding', 'integrity', 'unknown', 'validation', 'versioning'];
const SKILL_PORT_NAME_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const PACK_ID_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const RECORD_VERSION = 1;
const CAPABILITY_SCHEMA_VERSION = '1.0.0';
const CAPABILITY_SCHEMA_NAMES = [
  'node-ref',
  'node',
  'edge',
  'graph',
  'domain-pack',
  'capability-error',
  'skill-payload',
  'observed-failure-payload',
  'node-payload',
  'edge-payload',
  'add-node-command',
  'add-edge-command',
  'supersede-node-command',
  'apply-domain-pack-command',
  'node-added-event',
  'edge-added-event',
  'domain-pack-applied-event',
  'schema-registry',
];

const cref = (name) => `arena:schema/capability/${name}@${CAPABILITY_SCHEMA_VERSION}`;

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

// Reusable $defs (inlined into each composite schema so every contract file
// is self-contained, exactly like the A001/A002 contracts).
const nodeRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id', 'version', 'digest'],
  properties: {
    kind: { enum: NODE_KINDS },
    id: { type: 'string', pattern: NODE_ID_PATTERN },
    version: { type: 'string', pattern: NODE_VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const artifactRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['namespace', 'name', 'version', 'digest'],
  properties: {
    namespace: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,62}$' },
    name: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,127}$' },
    version: { type: 'string', pattern: NODE_VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const provenanceRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['recordDigest'],
  properties: {
    recordDigest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const skillPortDef = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', pattern: SKILL_PORT_NAME_PATTERN },
    description: { type: 'string', minLength: 1 },
  },
};

const skillPayloadDef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'summary',
    'inputs',
    'outputs',
    'prerequisites',
    'evidence',
    'tests',
    'professionalLimitations',
    'customerData',
  ],
  properties: {
    title: { type: 'string', minLength: 1 },
    summary: { type: 'string', minLength: 1 },
    category: { enum: DECOMPOSITION_CATEGORIES },
    inputs: { type: 'array', items: skillPortDef },
    outputs: { type: 'array', items: skillPortDef },
    prerequisites: { type: 'array', items: { type: 'string', minLength: 1 } },
    evidence: { type: 'array', items: artifactRefDef },
    tests: { type: 'array', items: artifactRefDef },
    professionalLimitations: { type: 'array', items: { type: 'string', minLength: 1 } },
    customerData: { enum: CUSTOMER_DATA_POLICIES },
  },
};

const observedFailurePayloadDef = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'observedAt', 'severity'],
  properties: {
    title: { type: 'string', minLength: 1 },
    summary: { type: 'string', minLength: 1 },
    observedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
    severity: { enum: SEVERITIES },
  },
};

const nodePayloadDef = {
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: {
    title: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    category: { enum: DECOMPOSITION_CATEGORIES },
  },
};

const edgePayloadDef = {
  type: 'object',
  additionalProperties: false,
  properties: {
    note: { type: 'string', minLength: 1 },
  },
};

const nodeDef = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id', 'version', 'payloadSchema', 'payload', 'digest'],
  properties: {
    kind: { enum: NODE_KINDS },
    id: { type: 'string', pattern: NODE_ID_PATTERN },
    version: { type: 'string', pattern: NODE_VERSION_PATTERN },
    payloadSchema: { type: 'string', pattern: SCHEMA_REF_PATTERN },
    payload: {
      description: 'Kind-specific payload (skill / observed-failure / titled).',
    },
    provenance: provenanceRefDef,
    supersedes: { type: 'string', pattern: DIGEST_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const edgeDef = {
  type: 'object',
  additionalProperties: false,
  required: ['recordVersion', 'kind', 'source', 'target', 'payloadSchema', 'payload', 'provenance', 'digest'],
  properties: {
    recordVersion: { const: RECORD_VERSION },
    kind: { enum: EDGE_KINDS },
    source: nodeRefDef,
    target: nodeRefDef,
    payloadSchema: { type: 'string', pattern: SCHEMA_REF_PATTERN },
    payload: edgePayloadDef,
    provenance: provenanceRefDef,
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const skillDeclarationDef = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'version', 'payload', 'provenance'],
  properties: {
    id: { type: 'string', pattern: NODE_ID_PATTERN },
    version: { type: 'string', pattern: NODE_VERSION_PATTERN },
    payload: skillPayloadDef,
    provenance: provenanceRefDef,
    supersedes: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const evaluatorDeclarationDef = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'version', 'payload'],
  properties: {
    id: { type: 'string', pattern: NODE_ID_PATTERN },
    version: { type: 'string', pattern: NODE_VERSION_PATTERN },
    payload: nodePayloadDef,
    provenance: provenanceRefDef,
    supersedes: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const environmentExtensionDef = {
  type: 'object',
  additionalProperties: false,
  required: ['environmentId', 'version'],
  properties: {
    environmentId: { type: 'string', pattern: NODE_ID_PATTERN },
    version: { type: 'string', pattern: NODE_VERSION_PATTERN },
  },
};

const packEdgeDeclarationDef = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'source', 'target', 'provenance'],
  properties: {
    kind: { enum: EDGE_KINDS },
    source: nodeRefDef,
    target: nodeRefDef,
    payload: edgePayloadDef,
    provenance: provenanceRefDef,
  },
};

const domainPackDef = {
  type: 'object',
  additionalProperties: false,
  required: ['packId', 'version', 'targetDomain', 'declaration', 'provenance'],
  properties: {
    packId: { type: 'string', pattern: PACK_ID_PATTERN },
    version: { type: 'string', pattern: NODE_VERSION_PATTERN },
    targetDomain: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'id', 'version'],
      properties: {
        kind: { const: 'domain' },
        id: { type: 'string', pattern: NODE_ID_PATTERN },
        version: { type: 'string', pattern: NODE_VERSION_PATTERN },
      },
    },
    declaration: {
      type: 'object',
      additionalProperties: false,
      required: ['skills', 'evaluators', 'environments', 'edges'],
      properties: {
        skills: { type: 'array', items: { $ref: '#/$defs/skillDeclaration' } },
        evaluators: { type: 'array', items: { $ref: '#/$defs/evaluatorDeclaration' } },
        environments: { type: 'array', items: { $ref: '#/$defs/environmentExtension' } },
        edges: { type: 'array', items: { $ref: '#/$defs/packEdgeDeclaration' } },
      },
    },
    provenance: provenanceRefDef,
  },
};

// ---------------------------------------------------------------------------
// Contract manifest — the A004 owned generator set.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'capability-graph/node-ref',
    output: 'contracts/capability/node-ref.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('node-ref'),
        title: 'Arena CapabilityNodeRef v1',
        description:
          'A content-addressed reference to a capability-graph node: kind (one of the ' +
          'eleven §4 kinds), stable id, semver version and the sha256 digest of the ' +
          'referenced node version. The unit of graph edges and query results.',
        ...nodeRefDef,
      };
    },
  },
  {
    id: 'capability-graph/node-payload',
    output: 'contracts/capability/node-payload.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('node-payload'),
        title: 'Arena titled node payload v1',
        description:
          'Payload of the titled node kinds (domain, capability, sub-capability, tool, ' +
          'task-family, evaluator, verifier, expert-competency, body-version): a title, ' +
          'an optional description and an optional §3 decomposition category.',
        ...nodePayloadDef,
      };
    },
  },
  {
    id: 'capability-graph/skill-payload',
    output: 'contracts/capability/skill-payload.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('skill-payload'),
        title: 'Arena skill node payload v1',
        description:
          'The §3 skill shape: "A Skill is a versioned artifact with inputs, outputs, ' +
          'prerequisites, evidence, tests and provenance" — the six payload-side fields ' +
          'here, plus explicit safety metadata (architecture-lock rule 23): ' +
          'professionalLimitations (possibly empty — the point is explicitness) and ' +
          'customerData (none | derived | contains).',
        ...skillPayloadDef,
      };
    },
  },
  {
    id: 'capability-graph/observed-failure-payload',
    output: 'contracts/capability/observed-failure-payload.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('observed-failure-payload'),
        title: 'Arena observed-failure node payload v1',
        description:
          'Payload of observed-failure nodes: what was observed, when (UTC millisecond ' +
          'precision) and how severe (explicit severity metadata, lock rule 23). Observed ' +
          'failures feed Capability Cases (requirement R5) and learning (rule 6: ' +
          'historical evidence is append-only).',
        ...observedFailurePayloadDef,
      };
    },
  },
  {
    id: 'capability-graph/edge-payload',
    output: 'contracts/capability/edge-payload.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('edge-payload'),
        title: 'Arena capability edge payload v1',
        description:
          'Versioned plain-JSON payload of graph edges (addressed by the edge payloadSchema ' +
          'SchemaRef): an optional note.',
        ...edgePayloadDef,
      };
    },
  },
  {
    id: 'capability-graph/node',
    output: 'contracts/capability/node.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('node'),
        title: 'Arena CapabilityNode v1',
        description:
          'A versioned, digest-addressed node of the Capability Graph: kind (eleven ' +
          'closed kinds), stable id, semver version, a versioned payload-schema SchemaRef, ' +
          'the kind-specific payload, optional provenance (REQUIRED for skills), an ' +
          'optional supersedes digest (append-only supersession) and the sha256 digest ' +
          'over the canonical JSON of the digest-free view. Deep-frozen at creation; no ' +
          'mutation API exists (architecture-lock rules 6, 18).',
        ...nodeDef,
        $defs: {
          skillPayload: skillPayloadDef,
          observedFailurePayload: observedFailurePayloadDef,
          nodePayload: nodePayloadDef,
          artifactRef: artifactRefDef,
          provenanceRef: provenanceRefDef,
        },
      };
    },
  },
  {
    id: 'capability-graph/edge',
    output: 'contracts/capability/edge.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('edge'),
        title: 'Arena CapabilityEdge v1',
        description:
          'A typed, provenance-bearing relation between digest-addressed nodes: one of ' +
          'the nine closed edge kinds (decomposes-into, requires, produces, evaluates, ' +
          'verifies, observes-failure-of, competent-in, exercised-by, extends-domain) — ' +
          'unknown kinds are rejected — with source/target node refs constrained by the ' +
          'per-kind endpoint matrix, a versioned edge payload and a REQUIRED provenance ' +
          'reference on every edge (architecture-lock rule 18). The sha256 digest is over ' +
          'the canonical JSON of the digest-free view.',
        ...edgeDef,
        $defs: {
          nodeRef: nodeRefDef,
          edgePayload: edgePayloadDef,
          provenanceRef: provenanceRefDef,
        },
      };
    },
  },
  {
    id: 'capability-graph/graph',
    output: 'contracts/capability/graph.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('graph'),
        title: 'Arena CapabilityGraph v1',
        description:
          'The append-only, descriptive Capability Graph: every admitted node, edge and ' +
          'applied domain pack in append order. Descriptive and queryable — it does not ' +
          'replace object authority (architecture.md §4). Historical evidence is ' +
          'append-only and never rewritten (lock rule 6).',
        type: 'object',
        additionalProperties: false,
        required: ['nodes', 'edges', 'packs'],
        properties: {
          nodes: { type: 'array', items: { $ref: '#/$defs/node' } },
          edges: { type: 'array', items: { $ref: '#/$defs/edge' } },
          packs: { type: 'array', items: { $ref: '#/$defs/appliedDomainPack' } },
        },
        $defs: {
          node: nodeDef,
          edge: edgeDef,
          appliedDomainPack: {
            type: 'object',
            additionalProperties: false,
            required: ['recordVersion', 'pack', 'packDigest', 'appliedAt', 'declaredNodeKeys'],
            properties: {
              recordVersion: { const: RECORD_VERSION },
              pack: domainPackDef,
              packDigest: { type: 'string', pattern: DIGEST_PATTERN },
              appliedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
              declaredNodeKeys: { type: 'array', items: { type: 'string', minLength: 1 } },
            },
          },
        },
      };
    },
  },
  {
    id: 'capability-graph/domain-pack',
    output: 'contracts/capability/domain-pack.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('domain-pack'),
        title: 'Arena DomainPack v1',
        description:
          'A domain pack descriptor (id, version, target domain, declared extensions: ' +
          'skills / environments / evaluators, plus edges and provenance). Packs extend ' +
          'the graph APPEND-ONLY and can never supersede/rewrite nodes they do not own ' +
          '(CAPABILITY_GRAPH_PACK_OVERREACH) — new domains extend the Arena lifecycle, ' +
          'they do not fork it (architecture-lock rule 21; requirement R37). Environments ' +
          'are explicit versioned references owned by the environment protocol, never ' +
          'first-class graph nodes.',
        ...domainPackDef,
        $defs: {
          skillDeclaration: skillDeclarationDef,
          evaluatorDeclaration: evaluatorDeclarationDef,
          environmentExtension: environmentExtensionDef,
          packEdgeDeclaration: packEdgeDeclarationDef,
          skillPayload: skillPayloadDef,
          nodePayload: nodePayloadDef,
          edgePayload: edgePayloadDef,
          nodeRef: nodeRefDef,
          provenanceRef: provenanceRefDef,
          artifactRef: artifactRefDef,
        },
      };
    },
  },
  {
    id: 'capability-graph/capability-error',
    output: 'contracts/capability/capability-error.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('capability-error'),
        title: 'Arena CapabilityGraphError v1',
        description:
          'Structured, serializable form of the capability-graph error taxonomy. Unknown ' +
          'codes are rejected when parsing (CAPABILITY_GRAPH_UNKNOWN_ERROR). Core-level ' +
          'failures still travel as @arena/protocol-core ProtocolError structures.',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: CAPABILITY_ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object' },
          correlationId: { type: 'string', pattern: IDENTIFIER_PATTERN },
        },
      };
    },
  },
  {
    id: 'capability-graph/add-node-command',
    output: 'contracts/capability/add-node-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('add-node-command'),
        title: 'Arena add-node command payload v1',
        description:
          'Idempotency-keyed command payload appending a node to a capability graph. ' +
          'Travels inside Envelope<T>; the envelope idempotencyKey is REQUIRED non-null ' +
          'for commands (architecture-lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['node'],
        properties: {
          node: { $ref: '#/$defs/node' },
        },
        $defs: {
          node: nodeDef,
          skillPayload: skillPayloadDef,
          observedFailurePayload: observedFailurePayloadDef,
          nodePayload: nodePayloadDef,
          artifactRef: artifactRefDef,
          provenanceRef: provenanceRefDef,
        },
      };
    },
  },
  {
    id: 'capability-graph/add-edge-command',
    output: 'contracts/capability/add-edge-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('add-edge-command'),
        title: 'Arena add-edge command payload v1',
        description:
          'Idempotency-keyed command payload appending an edge to a capability graph ' +
          '(append-only — the graph is never rewritten, architecture-lock rule 6).',
        type: 'object',
        additionalProperties: false,
        required: ['edge'],
        properties: {
          edge: { $ref: '#/$defs/edge' },
        },
        $defs: {
          edge: edgeDef,
          nodeRef: nodeRefDef,
          edgePayload: edgePayloadDef,
          provenanceRef: provenanceRefDef,
        },
      };
    },
  },
  {
    id: 'capability-graph/supersede-node-command',
    output: 'contracts/capability/supersede-node-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('supersede-node-command'),
        title: 'Arena supersede-node command payload v1',
        description:
          'Idempotency-keyed command payload appending a NEW node version that ' +
          'supersedes an earlier version of the same logical node. The superseded node ' +
          'is never rewritten and stays addressable (append-only supersession, ' +
          'architecture-lock rule 6).',
        type: 'object',
        additionalProperties: false,
        required: ['node'],
        properties: {
          node: {
            description: 'A node whose supersedes field carries the superseded digest (REQUIRED here).',
            ...nodeDef,
            required: ['kind', 'id', 'version', 'payloadSchema', 'payload', 'supersedes', 'digest'],
          },
        },
        $defs: {
          skillPayload: skillPayloadDef,
          observedFailurePayload: observedFailurePayloadDef,
          nodePayload: nodePayloadDef,
          artifactRef: artifactRefDef,
          provenanceRef: provenanceRefDef,
        },
      };
    },
  },
  {
    id: 'capability-graph/apply-domain-pack-command',
    output: 'contracts/capability/apply-domain-pack-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('apply-domain-pack-command'),
        title: 'Arena apply-domain-pack command payload v1',
        description:
          'Idempotency-keyed command payload applying a domain pack to a capability ' +
          'graph. Packs only append; a pack attempting to supersede or rewrite a node it ' +
          'does not own is rejected (architecture-lock rule 21).',
        type: 'object',
        additionalProperties: false,
        required: ['pack'],
        properties: {
          pack: { $ref: '#/$defs/domainPack' },
        },
        $defs: {
          domainPack: domainPackDef,
          skillDeclaration: skillDeclarationDef,
          evaluatorDeclaration: evaluatorDeclarationDef,
          environmentExtension: environmentExtensionDef,
          packEdgeDeclaration: packEdgeDeclarationDef,
          skillPayload: skillPayloadDef,
          nodePayload: nodePayloadDef,
          edgePayload: edgePayloadDef,
          nodeRef: nodeRefDef,
          provenanceRef: provenanceRefDef,
          artifactRef: artifactRefDef,
        },
      };
    },
  },
  {
    id: 'capability-graph/node-added-event',
    output: 'contracts/capability/node-added-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('node-added-event'),
        title: 'Arena node-added event payload v1',
        description:
          'Event payload emitted when a node is appended to a capability graph. Travels ' +
          'inside Envelope<T> with a correlation id and canonical serialization.',
        type: 'object',
        additionalProperties: false,
        required: ['node'],
        properties: {
          node: { $ref: '#/$defs/node' },
        },
        $defs: {
          node: nodeDef,
          skillPayload: skillPayloadDef,
          observedFailurePayload: observedFailurePayloadDef,
          nodePayload: nodePayloadDef,
          artifactRef: artifactRefDef,
          provenanceRef: provenanceRefDef,
        },
      };
    },
  },
  {
    id: 'capability-graph/edge-added-event',
    output: 'contracts/capability/edge-added-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('edge-added-event'),
        title: 'Arena edge-added event payload v1',
        description:
          'Event payload emitted when an edge is appended to a capability graph. Travels ' +
          'inside Envelope<T> with a correlation id and canonical serialization.',
        type: 'object',
        additionalProperties: false,
        required: ['edge'],
        properties: {
          edge: { $ref: '#/$defs/edge' },
        },
        $defs: {
          edge: edgeDef,
          nodeRef: nodeRefDef,
          edgePayload: edgePayloadDef,
          provenanceRef: provenanceRefDef,
        },
      };
    },
  },
  {
    id: 'capability-graph/domain-pack-applied-event',
    output: 'contracts/capability/domain-pack-applied-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('domain-pack-applied-event'),
        title: 'Arena domain-pack-applied event payload v1',
        description:
          'Event payload emitted when a domain pack application is appended to the ' +
          'graph history: pack identity, content digest and the node keys the pack ' +
          'declared (the ownership proof for future supersessions).',
        type: 'object',
        additionalProperties: false,
        required: ['packId', 'packVersion', 'packDigest', 'declaredNodeKeys'],
        properties: {
          packId: { type: 'string', pattern: PACK_ID_PATTERN },
          packVersion: { type: 'string', pattern: NODE_VERSION_PATTERN },
          packDigest: { type: 'string', pattern: DIGEST_PATTERN },
          declaredNodeKeys: { type: 'array', items: { type: 'string', minLength: 1 } },
        },
      };
    },
  },
  {
    id: 'capability-graph/schema-registry',
    output: 'contracts/capability/capability-schema-registry.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('schema-registry'),
        title: 'Arena capability-graph schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/capability-graph. A SchemaRef matching ' +
          'this enum is a known capability-graph schema at the listed version; anything ' +
          'else is not.',
        type: 'string',
        enum: CAPABILITY_SCHEMA_NAMES.map((name) => cref(name)),
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Deterministic serialization (same algorithm as the A001 generator)
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
  const tempDir = join(tmpdir(), `arena-capability-contracts-${process.pid}-${Date.now()}`);
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

    // Extra-file check is scoped to this generator's output directory
    // (contracts/capability) — never the whole tree, so running --check
    // against the repository root is safe.
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
        '[contracts] run: node packages/capability-graph/scripts/generate-contracts.mjs   then commit the result',
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
  console.log('[contracts] regenerate committed with: git add contracts/capability');
}

main();
