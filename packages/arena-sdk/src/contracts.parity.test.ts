/**
 * Contract parity tests — bind the generated contracts
 * (contracts/api/*.json, produced by
 * packages/arena-sdk/scripts/generate-contracts.mjs) to the
 * TypeScript surface of @arena/arena-sdk.
 *
 * If someone edits the TS constants without regenerating contracts (or
 * vice versa), these tests fail — and the drift suite (drift.test.ts)
 * fails when the committed JSON no longer matches the generator. Two
 * independent tripwires for contract drift, exactly like the
 * A001/A023 convention.
 */

import { describe, expect, it } from 'vitest';
import errorSchema from '../../../contracts/api/api-error.v1.json' with { type: 'json' };
import readScopeSchema from '../../../contracts/api/api-read-scope.v1.json' with { type: 'json' };
import queryKindSchema from '../../../contracts/api/api-query-kind.v1.json' with { type: 'json' };
import queryRequestSchema from '../../../contracts/api/api-query-request.v1.json' with { type: 'json' };
import queryResponseSchema from '../../../contracts/api/api-query-response.v1.json' with { type: 'json' };
import releaseStatusSchema from '../../../contracts/api/api-release-status.v1.json' with { type: 'json' };
import schemaRegistrySchema from '../../../contracts/api/api-schema-registry.v1.json' with { type: 'json' };

import {
  ARENA_API_TENANT_PATTERN_SOURCE,
  CONTENT_DIGEST_PATTERN_SOURCE,
} from './shared.js';
import {
  API_QUERY_KINDS,
  API_QUERY_PARAMS_FIELDS,
  API_QUERY_REQUEST_FIELDS,
  API_QUERY_RESPONSE_FIELDS,
  API_RELEASE_LIFECYCLE_STATES,
  API_RELEASE_VISIBILITIES,
  API_RELEASE_STATUS_FIELDS,
} from './queries.js';
import { ARENA_API_ERROR_CATEGORIES, ARENA_API_ERROR_CODES } from './errors.js';
import { API_SCHEMAS, API_SCHEMA_VERSION, apiSchemaRef } from './envelopes.js';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

describe('generated contract parity — arena api protocol', () => {
  it('every contract is draft 2020-12 with a versioned SchemaRef $id', () => {
    const contracts = [
      errorSchema,
      readScopeSchema,
      queryKindSchema,
      queryRequestSchema,
      queryResponseSchema,
      releaseStatusSchema,
      schemaRegistrySchema,
    ];
    expect(contracts).toHaveLength(7);
    for (const contract of contracts) {
      expect(contract['$schema']).toBe(DRAFT);
      expect(String(contract['$id'])).toMatch(/^arena:schema\/api\/[a-z0-9-]+@1\.0\.0$/);
    }
  });

  it('the api-error contract mirrors the closed error taxonomy', () => {
    expect(errorSchema.additionalProperties).toBe(false);
    expect(sorted(errorSchema.properties.code.enum as string[])).toEqual(
      sorted([...Object.values(ARENA_API_ERROR_CODES)]),
    );
    expect(sorted(errorSchema.properties.category.enum as string[])).toEqual(
      sorted([...ARENA_API_ERROR_CATEGORIES]),
    );
    expect(errorSchema.properties.message.minLength).toBe(1);
    expect(sorted(errorSchema.required as string[])).toEqual([
      'category',
      'code',
      'message',
    ]);
  });

  it('the api-read-scope contract mirrors the TS scope shape and tenant pattern', () => {
    expect(readScopeSchema.additionalProperties).toBe(false);
    expect(readScopeSchema.required).toEqual(['tenant']);
    expect(readScopeSchema.properties.tenant.pattern).toBe(ARENA_API_TENANT_PATTERN_SOURCE);
  });

  it('the api-query-kind contract mirrors the closed query vocabulary', () => {
    expect(queryKindSchema.additionalProperties).toBe(false);
    expect(sorted(queryKindSchema.properties.kind.enum as string[])).toEqual(
      sorted([...API_QUERY_KINDS]),
    );
    expect(queryKindSchema.properties.kind.enum).toHaveLength(16);
    expect(queryKindSchema.required).toEqual(['kind']);
  });

  it('the api-query-request contract mirrors the request payload and per-kind params', () => {
    expect(queryRequestSchema.additionalProperties).toBe(false);
    expect(sorted(queryRequestSchema.required as string[])).toEqual(
      sorted([...API_QUERY_REQUEST_FIELDS]),
    );
    expect(queryRequestSchema.properties.requestVersion.const).toBe(1);
    expect(sorted(queryRequestSchema.properties.kind.enum as string[])).toEqual(
      sorted([...API_QUERY_KINDS]),
    );
    expect(queryRequestSchema.properties.scope.$ref).toBe(
      `arena:schema/api/api-read-scope@${API_SCHEMA_VERSION}`,
    );
    // per-kind params defs mirror API_QUERY_PARAMS_FIELDS (closed shapes)
    for (const kind of API_QUERY_KINDS) {
      const def = (queryRequestSchema.$defs as Record<string, { required?: string[] }>)[
        `${kind}Params`
      ]!;
      expect(def).toBeDefined();
      expect(sorted(def.required ?? [])).toEqual(sorted([...API_QUERY_PARAMS_FIELDS[kind]]));
    }
    // digest params carry the digest pattern
    expect(queryRequestSchema.$defs['get-release-recordParams']!.properties.digest.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
    // channel params carry the A024 channel vocabulary
    expect(
      queryRequestSchema.$defs['resolve-active-releaseParams']!.properties.channel.enum,
    ).toEqual(['development', 'candidate', 'stable']);
    // the request binds each kind to its params through if/then conditionals
    expect(queryRequestSchema.allOf).toHaveLength(API_QUERY_KINDS.length);
  });

  it('the api-query-response contract mirrors the response payload and per-kind results', () => {
    expect(queryResponseSchema.additionalProperties).toBe(false);
    expect(sorted(queryResponseSchema.required as string[])).toEqual(
      sorted([...API_QUERY_RESPONSE_FIELDS]),
    );
    expect(queryResponseSchema.properties.responseVersion.const).toBe(1);
    expect(sorted(queryResponseSchema.properties.kind.enum as string[])).toEqual(
      sorted([...API_QUERY_KINDS]),
    );
    expect(queryResponseSchema.allOf).toHaveLength(API_QUERY_KINDS.length);
    // single-record results are null-or-opaque-record
    expect(queryResponseSchema.properties.result).toBeDefined();
  });

  it('the api-release-status contract mirrors the compound projection vocabulary', () => {
    expect(releaseStatusSchema.additionalProperties).toBe(false);
    expect(sorted(releaseStatusSchema.required as string[])).toEqual(
      sorted([...API_RELEASE_STATUS_FIELDS]),
    );
    expect(releaseStatusSchema.properties.state.enum).toEqual([...API_RELEASE_LIFECYCLE_STATES]);
    expect(releaseStatusSchema.properties.visibility.enum).toEqual([...API_RELEASE_VISIBILITIES]);
  });

  it('the schema-registry contract mirrors the owned schema set', () => {
    const registry = apiSchemaRef('api/schema-registry');
    expect(registry).toEqual({ namespace: 'api', name: 'schema-registry', version: '1.0.0' });
    expect(sorted(schemaRegistrySchema.enum as string[])).toEqual(
      Object.keys(API_SCHEMAS)
        .map((name) => `arena:schema/api/${name.split('/')[1]}@1.0.0`)
        .sort(),
    );
    expect(schemaRegistrySchema.enum).toHaveLength(7);
  });
});
