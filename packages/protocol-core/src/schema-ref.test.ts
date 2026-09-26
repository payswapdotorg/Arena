import { describe, expect, it } from 'vitest';
import {
  CORE_SCHEMAS,
  coreSchemaRef,
  formatSchemaRef,
  isKnownCoreSchema,
  isSchemaRef,
  parseSchemaRef,
} from './schema-ref.js';
import { PROTOCOL_ERROR_CODES } from './protocol-error.js';
import { ProtocolError } from './protocol-error.js';

describe('SchemaRef (positive)', () => {
  it('formats and parses round-trip', () => {
    const ref = { namespace: 'protocol', name: 'envelope', version: '1.0.0' };
    const formatted = formatSchemaRef(ref);
    expect(formatted).toBe('arena:schema/protocol/envelope@1.0.0');
    expect(parseSchemaRef(formatted)).toEqual(ref);
  });

  it('accepts namespaced schemas beyond the core registry', () => {
    expect(parseSchemaRef('arena:schema/agent-body/body-version@2.13.0')).toEqual({
      namespace: 'agent-body',
      name: 'body-version',
      version: '2.13.0',
    });
  });

  it('resolves core schema refs at the registered versions', () => {
    expect(coreSchemaRef('protocol/envelope')).toEqual({
      namespace: 'protocol',
      name: 'envelope',
      version: '1.0.0',
    });
  });

  it('recognizes known core schemas', () => {
    expect(isKnownCoreSchema(coreSchemaRef('protocol/envelope'))).toBe(true);
    expect(isKnownCoreSchema(coreSchemaRef('protocol/schema-registry'))).toBe(true);
  });

  it('structural guard accepts valid refs and rejects junk', () => {
    expect(isSchemaRef({ namespace: 'protocol', name: 'envelope', version: '1.0.0' })).toBe(true);
    expect(isSchemaRef({ namespace: 'Protocol', name: 'envelope', version: '1.0.0' })).toBe(false);
    expect(isSchemaRef('arena:schema/protocol/envelope@1.0.0')).toBe(false);
    expect(isSchemaRef(null)).toBe(false);
  });

  it('registry lists the four core schemas', () => {
    expect(Object.keys(CORE_SCHEMAS).sort()).toEqual([
      'protocol/envelope',
      'protocol/protocol-error',
      'protocol/schema-ref',
      'protocol/schema-registry',
    ]);
  });
});

describe('SchemaRef (negative — malformed refs must fail)', () => {
  const expectInvalid = (value: string): void => {
    try {
      parseSchemaRef(value);
      expect.unreachable(`parseSchemaRef(${JSON.stringify(value)}) must throw`);
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolError);
      expect((error as ProtocolError).code).toBe(PROTOCOL_ERROR_CODES.INVALID_SCHEMA_REF);
    }
  };

  it('rejects incomplete versions', () => {
    expectInvalid('arena:schema/protocol/envelope@1.0');
    expectInvalid('arena:schema/protocol/envelope@1');
    expectInvalid('arena:schema/protocol/envelope');
  });

  it('rejects prerelease/build suffixes (core schemas are exact semver)', () => {
    expectInvalid('arena:schema/protocol/envelope@1.0.0-beta');
    expectInvalid('arena:schema/protocol/envelope@1.0.0+build');
  });

  it('rejects bad namespaces, names and prefixes', () => {
    expectInvalid('arena:schema/Protocol/envelope@1.0.0');
    expectInvalid('arena:schema/protocol/Envelope@1.0.0');
    expectInvalid('arena:schema/1protocol/envelope@1.0.0');
    expectInvalid('arena:schemas/protocol/envelope@1.0.0');
    expectInvalid('http://arena/schema/protocol/envelope@1.0.0');
    expectInvalid('');
  });

  it('rejects empty and slash-broken names', () => {
    expectInvalid('arena:schema//envelope@1.0.0');
    expectInvalid('arena:schema/protocol/@1.0.0');
  });
});

describe('core registry (negative — unknown versions must fail)', () => {
  it('rejects a known schema at an unknown version', () => {
    expect(isKnownCoreSchema({ namespace: 'protocol', name: 'envelope', version: '9.9.9' })).toBe(
      false,
    );
  });

  it('rejects an unknown schema name at a known version', () => {
    expect(isKnownCoreSchema({ namespace: 'protocol', name: 'nope', version: '1.0.0' })).toBe(
      false,
    );
  });

  it('rejects foreign namespaces', () => {
    expect(
      isKnownCoreSchema({ namespace: 'other', name: 'envelope', version: '1.0.0' }),
    ).toBe(false);
  });
});
