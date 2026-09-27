/**
 * Contract parity tests (Work Order A004, gate 8) — bind the generated
 * contracts (contracts/capability/*.json, produced by
 * packages/capability-graph/scripts/generate-contracts.mjs) to the
 * TypeScript surface of @arena/capability-graph.
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and the drift suite (drift.test.ts) fails when
 * the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift, exactly like the A001/A002 convention.
 */

import { describe, expect, it } from 'vitest';
import addNodeCommandSchema from '../../../contracts/capability/add-node-command.v1.json' with { type: 'json' };
import addEdgeCommandSchema from '../../../contracts/capability/add-edge-command.v1.json' with { type: 'json' };
import applyDomainPackCommandSchema from '../../../contracts/capability/apply-domain-pack-command.v1.json' with { type: 'json' };
import supersedeNodeCommandSchema from '../../../contracts/capability/supersede-node-command.v1.json' with { type: 'json' };
import capabilityErrorSchema from '../../../contracts/capability/capability-error.v1.json' with { type: 'json' };
import domainPackAppliedEventSchema from '../../../contracts/capability/domain-pack-applied-event.v1.json' with { type: 'json' };
import domainPackSchema from '../../../contracts/capability/domain-pack.v1.json' with { type: 'json' };
import edgeAddedEventSchema from '../../../contracts/capability/edge-added-event.v1.json' with { type: 'json' };
import edgePayloadSchema from '../../../contracts/capability/edge-payload.v1.json' with { type: 'json' };
import edgeSchema from '../../../contracts/capability/edge.v1.json' with { type: 'json' };
import graphSchema from '../../../contracts/capability/graph.v1.json' with { type: 'json' };
import nodeAddedEventSchema from '../../../contracts/capability/node-added-event.v1.json' with { type: 'json' };
import nodePayloadSchema from '../../../contracts/capability/node-payload.v1.json' with { type: 'json' };
import nodeRefSchema from '../../../contracts/capability/node-ref.v1.json' with { type: 'json' };
import nodeSchema from '../../../contracts/capability/node.v1.json' with { type: 'json' };
import observedFailurePayloadSchema from '../../../contracts/capability/observed-failure-payload.v1.json' with { type: 'json' };
import registrySchema from '../../../contracts/capability/capability-schema-registry.v1.json' with { type: 'json' };
import skillPayloadSchema from '../../../contracts/capability/skill-payload.v1.json' with { type: 'json' };
import {
  CAPABILITY_GRAPH_ERROR_CATEGORIES,
  CAPABILITY_GRAPH_ERROR_CODES,
} from './errors.js';
import {
  CAPABILITY_EDGE_KINDS,
  EDGE_ENDPOINTS,
} from './edges.js';
import {
  CAPABILITY_NODE_ADDRESS_PATTERN_SOURCE,
  CAPABILITY_NODE_ID_PATTERN_SOURCE,
  CAPABILITY_NODE_KINDS,
  CAPABILITY_NODE_VERSION_PATTERN_SOURCE,
} from './identifiers.js';
import {
  CAPABILITY_DECOMPOSITION_CATEGORIES,
  CUSTOMER_DATA_POLICIES,
  OBSERVED_FAILURE_SEVERITIES,
  SKILL_IO_PORT_NAME_PATTERN_SOURCE,
} from './payload.js';
import {
  CAPABILITY_TIMESTAMP_PATTERN_SOURCE,
} from './timestamp.js';
import {
  ARTIFACT_NAME_PATTERN_SOURCE,
  ARTIFACT_NAMESPACE_PATTERN_SOURCE,
  CONTENT_DIGEST_PATTERN_SOURCE,
} from './shared.js';
import { DOMAIN_PACK_ID_PATTERN_SOURCE } from './domain-pack.js';
import { CAPABILITY_RECORD_VERSION, payloadSchemaForNodeKind } from './nodes.js';
import { CAPABILITY_SCHEMAS, capabilitySchemaRef } from './envelopes.js';
import { formatSchemaRef } from '@arena/protocol-core';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

// JSON imports are structurally typed; index access needs the right shapes.
type JsonSchema = {
  $schema: string;
  $id: string;
  type?: string;
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, { pattern?: string; enum?: string[]; const?: number }>;
  enum?: string[];
  pattern?: string;
};

const nodeRefJson = nodeRefSchema as unknown as JsonSchema;
const edgeJson = edgeSchema as unknown as JsonSchema;
const errorJson = capabilityErrorSchema as unknown as JsonSchema;
const registryJson = registrySchema as unknown as JsonSchema;

describe('generated contract parity — capability-graph (positive)', () => {
  it('node-ref schema enumerates exactly the eleven TS node kinds and patterns', () => {
    const kinds = nodeRefJson.properties?.kind?.enum ?? [];
    expect(sorted(kinds)).toEqual(sorted([...CAPABILITY_NODE_KINDS]));
    expect(nodeRefJson.properties?.id?.pattern).toBe(CAPABILITY_NODE_ID_PATTERN_SOURCE);
    expect(nodeRefJson.properties?.version?.pattern).toBe(CAPABILITY_NODE_VERSION_PATTERN_SOURCE);
    expect(nodeRefJson.properties?.digest?.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(sorted(nodeRefJson.required ?? [])).toEqual(
      sorted(['kind', 'id', 'version', 'digest']),
    );
    expect(nodeRefJson.additionalProperties).toBe(false);
  });

  it('edge schema enumerates exactly the nine TS edge kinds and requires provenance', () => {
    const kinds = edgeJson.properties?.kind?.enum ?? [];
    expect(sorted(kinds)).toEqual(sorted([...CAPABILITY_EDGE_KINDS]));
    expect(sorted(edgeJson.required ?? [])).toEqual(
      sorted([
        'recordVersion',
        'kind',
        'source',
        'target',
        'payloadSchema',
        'payload',
        'provenance',
        'digest',
      ]),
    );
    expect(edgeJson.properties?.recordVersion?.const).toBe(CAPABILITY_RECORD_VERSION);
    expect(edgeJson.properties?.digest?.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
  });

  it('node schema mirrors the node wire shape and per-kind payload schemas', () => {
    expect(sorted((nodeSchema as unknown as JsonSchema).required ?? [])).toEqual(
      sorted(['kind', 'id', 'version', 'payloadSchema', 'payload', 'digest']),
    );
    // the three payload schemas are exactly the ones payloadSchemaForNodeKind emits
    expect(formatSchemaRef(payloadSchemaForNodeKind('skill'))).toBe(
      'arena:schema/capability/skill-payload@1.0.0',
    );
    expect(formatSchemaRef(payloadSchemaForNodeKind('observed-failure'))).toBe(
      'arena:schema/capability/observed-failure-payload@1.0.0',
    );
    expect(formatSchemaRef(payloadSchemaForNodeKind('domain'))).toBe(
      'arena:schema/capability/node-payload@1.0.0',
    );
    expect(skillPayloadSchema.$id).toBe('arena:schema/capability/skill-payload@1.0.0');
    expect(observedFailurePayloadSchema.$id).toBe(
      'arena:schema/capability/observed-failure-payload@1.0.0',
    );
    expect(nodePayloadSchema.$id).toBe('arena:schema/capability/node-payload@1.0.0');
  });

  it('skill payload schema mirrors the §3 skill shape + lock rule 23 metadata', () => {
    const json = skillPayloadSchema as unknown as JsonSchema;
    expect(sorted(json.required ?? [])).toEqual(
      sorted([
        'title',
        'summary',
        'inputs',
        'outputs',
        'prerequisites',
        'evidence',
        'tests',
        'professionalLimitations',
        'customerData',
      ]),
    );
    expect(sorted(json.properties?.category?.enum ?? [])).toEqual(
      sorted([...CAPABILITY_DECOMPOSITION_CATEGORIES]),
    );
    expect(sorted(json.properties?.customerData?.enum ?? [])).toEqual(
      sorted([...CUSTOMER_DATA_POLICIES]),
    );
    expect(json.additionalProperties).toBe(false);
  });

  it('observed-failure payload mirrors severities and the timestamp pattern', () => {
    const json = observedFailurePayloadSchema as unknown as JsonSchema;
    expect(sorted(json.properties?.severity?.enum ?? [])).toEqual(
      sorted([...OBSERVED_FAILURE_SEVERITIES]),
    );
    expect(json.properties?.observedAt?.pattern).toBe(CAPABILITY_TIMESTAMP_PATTERN_SOURCE);
    expect(sorted(json.required ?? [])).toEqual(
      sorted(['title', 'summary', 'observedAt', 'severity']),
    );
  });

  it('node payload and edge payload schemas match the TS patterns', () => {
    const json = nodePayloadSchema as unknown as JsonSchema;
    expect(sorted(json.required ?? [])).toEqual(sorted(['title']));
    expect(sorted(json.properties?.category?.enum ?? [])).toEqual(
      sorted([...CAPABILITY_DECOMPOSITION_CATEGORIES]),
    );
    const edgePayloadJson = edgePayloadSchema as unknown as JsonSchema;
    expect(edgePayloadJson.additionalProperties).toBe(false);
    expect(edgePayloadJson.required).toBeUndefined(); // the payload is fully optional
  });

  it('domain-pack schema mirrors the pack descriptor (gate 9)', () => {
    const json = domainPackSchema as unknown as JsonSchema;
    expect(json.properties?.packId?.pattern).toBe(DOMAIN_PACK_ID_PATTERN_SOURCE);
    expect(sorted(json.required ?? [])).toEqual(
      sorted(['packId', 'version', 'targetDomain', 'declaration', 'provenance']),
    );
    const declaration = (
      (domainPackSchema as unknown as {
        properties: { declaration: { properties: Record<string, { items?: { $ref?: string } }> } };
      }).properties.declaration.properties
    );
    expect(declaration.skills?.items?.$ref).toBe('#/$defs/skillDeclaration');
    expect(declaration.evaluators?.items?.$ref).toBe('#/$defs/evaluatorDeclaration');
    expect(declaration.environments?.items?.$ref).toBe('#/$defs/environmentExtension');
    expect(declaration.edges?.items?.$ref).toBe('#/$defs/packEdgeDeclaration');
  });

  it('graph schema is the append-only {nodes, edges, packs} wire form', () => {
    const json = graphSchema as unknown as JsonSchema;
    expect(json.type).toBe('object');
    expect(sorted(json.required ?? [])).toEqual(sorted(['nodes', 'edges', 'packs']));
    expect(json.additionalProperties).toBe(false);
  });

  it('capability-error schema enumerates exactly the TS taxonomy', () => {
    expect(sorted(errorJson.properties?.code?.enum ?? [])).toEqual(
      sorted(Object.values(CAPABILITY_GRAPH_ERROR_CODES)),
    );
    expect(sorted(errorJson.properties?.category?.enum ?? [])).toEqual(
      sorted([...CAPABILITY_GRAPH_ERROR_CATEGORIES]),
    );
    expect(errorJson.additionalProperties).toBe(false);
  });

  it('command and event payload schemas require their full payload shapes', () => {
    expect(
      sorted((addNodeCommandSchema as unknown as JsonSchema).required ?? []),
    ).toEqual(sorted(['node']));
    expect(
      sorted((addEdgeCommandSchema as unknown as JsonSchema).required ?? []),
    ).toEqual(sorted(['edge']));
    expect(
      sorted((supersedeNodeCommandSchema as unknown as JsonSchema).required ?? []),
    ).toEqual(sorted(['node']));
    expect(
      sorted((applyDomainPackCommandSchema as unknown as JsonSchema).required ?? []),
    ).toEqual(sorted(['pack']));
    expect(
      sorted((nodeAddedEventSchema as unknown as JsonSchema).required ?? []),
    ).toEqual(sorted(['node']));
    expect(
      sorted((edgeAddedEventSchema as unknown as JsonSchema).required ?? []),
    ).toEqual(sorted(['edge']));
    expect(
      sorted((domainPackAppliedEventSchema as unknown as JsonSchema).required ?? []),
    ).toEqual(sorted(['packId', 'packVersion', 'packDigest', 'declaredNodeKeys']));
    expect(
      (domainPackAppliedEventSchema as unknown as JsonSchema).properties?.packDigest?.pattern,
    ).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
  });

  it('supersede-node command requires the supersedes field on the node', () => {
    const nodeProp = (supersedeNodeCommandSchema as unknown as {
      properties: { node: { required: string[] } };
    }).properties.node.required;
    expect(nodeProp).toContain('supersedes');
  });

  it('schema registry enumerates exactly the capability-graph schemas', () => {
    const expected = sorted(
      Object.keys(CAPABILITY_SCHEMAS).map(
        (name) =>
          `arena:schema/${name.replace('/', '/')}@${(CAPABILITY_SCHEMAS as Record<string, string>)[name]}`,
      ),
    );
    expect(sorted(registryJson.enum ?? [])).toEqual(expected);
  });

  it('contract $ids are the formatted capability schema refs', () => {
    expect(nodeRefSchema.$id).toBe('arena:schema/capability/node-ref@1.0.0');
    expect(edgeSchema.$id).toBe('arena:schema/capability/edge@1.0.0');
    expect(capabilityErrorSchema.$id).toBe('arena:schema/capability/capability-error@1.0.0');
    expect(registrySchema.$id).toBe('arena:schema/capability/schema-registry@1.0.0');
    // Spot-check via the formatter for every registry entry.
    for (const name of Object.keys(CAPABILITY_SCHEMAS)) {
      expect(capabilitySchemaRef(name as keyof typeof CAPABILITY_SCHEMAS).namespace).toBe(
        'capability',
      );
    }
  });

  it('endpoint matrix in TS covers every contract edge kind', () => {
    const contractKinds = edgeJson.properties?.kind?.enum ?? [];
    for (const kind of contractKinds) {
      expect(Object.keys(EDGE_ENDPOINTS)).toContain(kind);
    }
    // a sample of the matrix itself
    expect(EDGE_ENDPOINTS['requires']).toEqual({
      source: ['skill'],
      target: ['skill', 'tool'],
    });
  });

  it('contracts target JSON Schema draft 2020-12', () => {
    const schemas = [
      addNodeCommandSchema,
      addEdgeCommandSchema,
      applyDomainPackCommandSchema,
      supersedeNodeCommandSchema,
      capabilityErrorSchema,
      domainPackAppliedEventSchema,
      domainPackSchema,
      edgeAddedEventSchema,
      edgePayloadSchema,
      edgeSchema,
      graphSchema,
      nodeAddedEventSchema,
      nodePayloadSchema,
      nodeRefSchema,
      nodeSchema,
      observedFailurePayloadSchema,
      registrySchema,
      skillPayloadSchema,
    ];
    for (const schema of schemas) {
      expect(schema.$schema).toBe(DRAFT);
    }
  });

  it('the address pattern source matches the contracts-adjacent identifier patterns', () => {
    // shared views keep the A002-compatible artifact reference charset
    const artifactRefDef = (
      skillPayloadSchema as unknown as {
        properties: { evidence: { items: { properties: Record<string, { pattern?: string }> } } };
      }
    ).properties.evidence.items.properties;
    expect(artifactRefDef.namespace?.pattern).toBe(ARTIFACT_NAMESPACE_PATTERN_SOURCE);
    expect(artifactRefDef.name?.pattern).toBe(ARTIFACT_NAME_PATTERN_SOURCE);
    expect(artifactRefDef.digest?.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(CAPABILITY_NODE_ADDRESS_PATTERN_SOURCE.startsWith('^arena:capnode/')).toBe(true);
    expect((nodeSchema as unknown as JsonSchema).properties?.payloadSchema?.pattern).toBe(
      '^arena:schema/[a-z][a-z0-9-]*/[a-z][a-z0-9-]*@\\d+\\.\\d+\\.\\d+$',
    );
  });

  it('skill IO port pattern matches the skill payload contract', () => {
    const portProps = (
      skillPayloadSchema as unknown as {
        properties: { inputs: { items: { properties: Record<string, { pattern?: string }> } } };
      }
    ).properties.inputs.items.properties;
    expect(portProps.name?.pattern).toBe(SKILL_IO_PORT_NAME_PATTERN_SOURCE);
  });
});

describe('generated contract parity — capability-graph (negative — drift must not pass silently)', () => {
  it('a hypothetical extra node kind would not match the contract enum', () => {
    const hypothetical = sorted([...CAPABILITY_NODE_KINDS, 'model']);
    expect(hypothetical).not.toEqual(sorted(nodeRefJson.properties?.kind?.enum ?? []));
  });

  it('a hypothetical extra edge kind would not match the contract enum', () => {
    const hypothetical = sorted([...CAPABILITY_EDGE_KINDS, 'is-a']);
    expect(hypothetical).not.toEqual(sorted(edgeJson.properties?.kind?.enum ?? []));
  });

  it('a hypothetical extra error code would not match the contract enum', () => {
    const hypothetical = sorted([...Object.values(CAPABILITY_GRAPH_ERROR_CODES), 'CAPABILITY_GRAPH_MADE_UP']);
    expect(hypothetical).not.toEqual(sorted(errorJson.properties?.code?.enum ?? []));
  });

  it('a hypothetical unknown capability schema would not match the registry enum', () => {
    const registry = registryJson.enum ?? [];
    expect(registry).not.toContain('arena:schema/capability/does-not-exist@1.0.0');
    expect(registry).not.toContain('arena:schema/artifacts/material-artifact@1.0.0');
  });

  it('edge record version 1 is the only const accepted by the contract', () => {
    expect(edgeJson.properties?.recordVersion?.const).toBe(1);
    expect(edgeJson.properties?.recordVersion?.const).not.toBe(2);
  });
});
