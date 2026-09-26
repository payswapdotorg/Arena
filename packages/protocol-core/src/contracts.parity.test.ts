/**
 * Contract parity tests — bind the generated contracts
 * (packages/protocol-core/contracts/*.json, produced by
 * scripts/generate-contracts.mjs) to the TypeScript surface.
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and `pnpm governance` (G9 drift check) fails
 * when the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift.
 */

import { describe, expect, it } from 'vitest';
import envelopeSchema from '../contracts/envelope.v1.json' with { type: 'json' };
import protocolErrorSchema from '../contracts/protocol-error.v1.json' with { type: 'json' };
import schemaRefSchema from '../contracts/schema-ref.v1.json' with { type: 'json' };
import schemaRegistry from '../contracts/schema-registry.v1.json' with { type: 'json' };
import { IDENTIFIER_PATTERN_SOURCE } from './identifiers.js';
import { PROTOCOL_ERROR_CATEGORIES, PROTOCOL_ERROR_CODES } from './protocol-error.js';
import { CORE_SCHEMAS, SCHEMA_REF_PATTERN_SOURCE, coreSchemaRef, formatSchemaRef } from './schema-ref.js';
import { ENVELOPE_KINDS } from './envelope.js';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

describe('generated contract parity (positive)', () => {
  it('envelope schema fields match the Envelope wire shape', () => {
    expect(sorted(envelopeSchema.required as string[])).toEqual(
      sorted(['v', 'kind', 'schema', 'id', 'correlationId', 'idempotencyKey', 'issuedAt', 'payload']),
    );
    expect(sorted(Object.keys(envelopeSchema.properties))).toEqual(
      sorted(envelopeSchema.required as string[]),
    );
    expect(envelopeSchema.additionalProperties).toBe(false);
  });

  it('envelope kind enum matches ENVELOPE_KINDS', () => {
    expect(sorted(envelopeSchema.properties.kind.enum as string[])).toEqual(
      sorted([...ENVELOPE_KINDS]),
    );
  });

  it('envelope schema property mirrors the SchemaRef pattern', () => {
    expect(envelopeSchema.properties.schema.pattern).toBe(schemaRefSchema.pattern);
    expect(schemaRefSchema.pattern).toBe(SCHEMA_REF_PATTERN_SOURCE);
  });

  it('identifier patterns mirror the shared identifier charset', () => {
    expect(envelopeSchema.properties.correlationId.pattern).toBe(IDENTIFIER_PATTERN_SOURCE);
    const idempotency = envelopeSchema.properties.idempotencyKey.oneOf as { pattern?: string; type: string }[];
    expect(idempotency.some((variant) => variant.pattern === IDENTIFIER_PATTERN_SOURCE)).toBe(true);
  });

  it('protocol error schema enumerates exactly the TS taxonomy', () => {
    expect(sorted(protocolErrorSchema.properties.code.enum as string[])).toEqual(
      sorted(Object.values(PROTOCOL_ERROR_CODES)),
    );
    expect(sorted(protocolErrorSchema.properties.category.enum as string[])).toEqual(
      sorted([...PROTOCOL_ERROR_CATEGORIES]),
    );
  });

  it('schema registry enumerates exactly the core schemas', () => {
    const expected = sorted(Object.entries(CORE_SCHEMAS).map(([name, version]) => {
      const [namespace, schemaName] = name.split('/');
      return `arena:schema/${namespace}/${schemaName}@${version}`;
    }));
    expect(sorted(schemaRegistry.enum as string[])).toEqual(expected);
  });

  it('contract $ids are the formatted core schema refs', () => {
    expect(envelopeSchema.$id).toBe(formatSchemaRef(coreSchemaRef('protocol/envelope')));
    expect(schemaRefSchema.$id).toBe(formatSchemaRef(coreSchemaRef('protocol/schema-ref')));
    expect(protocolErrorSchema.$id).toBe(formatSchemaRef(coreSchemaRef('protocol/protocol-error')));
    expect(schemaRegistry.$id).toBe(formatSchemaRef(coreSchemaRef('protocol/schema-registry')));
  });

  it('contracts target JSON Schema draft 2020-12', () => {
    for (const schema of [envelopeSchema, protocolErrorSchema, schemaRefSchema, schemaRegistry]) {
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    }
  });
});

describe('generated contract parity (negative — drift must not pass silently)', () => {
  it('a hypothetical extra code in the taxonomy would not match the contract enum', () => {
    const hypothetical = sorted([...Object.values(PROTOCOL_ERROR_CODES), 'PROTOCOL_MADE_UP']);
    expect(hypothetical).not.toEqual(sorted(protocolErrorSchema.properties.code.enum as string[]));
  });

  it('a hypothetical unknown core schema would not match the registry enum', () => {
    const registry = schemaRegistry.enum as string[];
    expect(registry).not.toContain('arena:schema/protocol/does-not-exist@1.0.0');
  });

  it('envelope wire version 1 is the only const accepted by the contract', () => {
    expect(envelopeSchema.properties.v.const).toBe(1);
    expect(envelopeSchema.properties.v.const).not.toBe(2);
  });
});
