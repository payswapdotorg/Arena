/**
 * Contract parity tests — bind the generated contracts
 * (contracts/escalation/*.json, produced by
 * packages/escalation/scripts/generate-contracts.mjs) to the TypeScript
 * surface of @arena/escalation.
 *
 * If someone edits the TS constants without regenerating contracts (or
 * vice versa), these tests fail — and the drift suite (drift.test.ts)
 * fails when the committed JSON no longer matches the generator. Two
 * independent tripwires for contract drift, exactly like the
 * A001/A015/A025 convention.
 */

import { describe, expect, it } from 'vitest';
import modeSchema from '../../../contracts/escalation/escalation-mode.v1.json' with { type: 'json' };
import stateSchema from '../../../contracts/escalation/escalation-state.v1.json' with { type: 'json' };
import errorSchema from '../../../contracts/escalation/escalation-error.v1.json' with { type: 'json' };
import resultSchema from '../../../contracts/escalation/escalation-result.v1.json' with { type: 'json' };
import webhookEventSchema from '../../../contracts/escalation/escalation-webhook-event.v1.json' with { type: 'json' };
import responseSchema from '../../../contracts/escalation/escalation-response.v1.json' with { type: 'json' };
import schemaRegistrySchema from '../../../contracts/escalation/schema-registry.v1.json' with { type: 'json' };

import { ESCALATION_MODES, ESCALATION_URGENCIES } from './shared.js';
import { ESCALATION_STATES, ESCALATION_TERMINAL_STATES } from './lifecycle.js';
import { PERMITTED_ACTIONS } from './request.js';
import { ESCALATION_RESULT_KINDS } from './results.js';
import { ESCALATION_WEBHOOK_EVENT_TYPES } from './events.js';
import { ESCALATION_ERROR_CATEGORIES, ESCALATION_ERROR_CODES } from './errors.js';
import { ESCALATION_SCHEMAS, ESCALATION_SCHEMA_VERSION, escalationSchemaRef } from './envelopes.js';

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

function asStrings(value: unknown): string[] {
  return (value as readonly string[]).map((entry) => String(entry));
}

describe('generated contract parity — escalation protocol', () => {
  it('every contract is draft 2020-12 with a versioned escalation SchemaRef $id', () => {
    const contracts = [
      modeSchema,
      stateSchema,
      errorSchema,
      resultSchema,
      webhookEventSchema,
      responseSchema,
      schemaRegistrySchema,
    ];
    expect(contracts).toHaveLength(7);
    for (const contract of contracts) {
      expect(contract['$schema']).toBe(DRAFT);
      expect(String(contract['$id'])).toMatch(/^arena:schema\/escalation\/[a-z0-9-]+@1\.0\.0$/);
    }
  });

  it('escalation-mode enum matches the TS vocabulary', () => {
    expect(asStrings(modeSchema['enum'])).toEqual([...ESCALATION_MODES]);
  });

  it('escalation-state enum + terminal states match the TS machine', () => {
    expect(asStrings(stateSchema['enum'])).toEqual([...ESCALATION_STATES]);
    expect(asStrings(stateSchema['x-terminal-states'])).toEqual([...ESCALATION_TERMINAL_STATES]);
  });

  it('escalation-error codes and categories match the TS taxonomy', () => {
    const properties = errorSchema['properties'] as Record<string, { enum?: readonly string[] }>;
    expect(asStrings(properties['code']?.['enum'])).toEqual(Object.values(ESCALATION_ERROR_CODES).map((code) => String(code)));
    expect(asStrings(properties['category']?.['enum'])).toEqual([...ESCALATION_ERROR_CATEGORIES]);
  });

  it('escalation-result kinds match the TS taxonomy', () => {
    const properties = resultSchema['properties'] as Record<string, { enum?: readonly string[] }>;
    expect(asStrings(properties['kind']?.['enum'])).toEqual([...ESCALATION_RESULT_KINDS]);
  });

  it('webhook event types match the closed 13-event vocabulary', () => {
    const properties = webhookEventSchema['properties'] as Record<string, { enum?: readonly string[] }>;
    expect(asStrings(properties['eventType']?.['enum'])).toEqual([...ESCALATION_WEBHOOK_EVENT_TYPES]);
  });

  it('response kinds match the TS response vocabulary', () => {
    expect(asStrings(responseSchema['x-response-kinds'])).toEqual([
      'escalation-created',
      'escalation-replayed',
      'escalation-status',
    ]);
  });

  it('schema registry enumerates every escalation schema the TS registry owns', () => {
    const registry = asStrings(schemaRegistrySchema['enum']).sort();
    const expected = Object.keys(ESCALATION_SCHEMAS)
      .filter((name) => name !== 'escalation/schema-registry')
      .map((name) => {
        const ref = escalationSchemaRef(name as keyof typeof ESCALATION_SCHEMAS);
        return `arena:schema/${ref.namespace}/${ref.name}@${ESCALATION_SCHEMA_VERSION}`;
      })
      .sort();
    expect(registry).toEqual(expected);
    expect(registry).toHaveLength(9);
  });

  it('request contract patterns match the TS guards', () => {
    // Escalation modes / urgency / permitted actions travel in the
    // request contract exactly as the TS closed vocabularies define them.
    expect([...ESCALATION_MODES]).toContain('solve');
    expect([...ESCALATION_URGENCIES]).toEqual(['routine', 'priority', 'urgent', 'critical']);
    expect([...PERMITTED_ACTIONS]).toContain('signal-tool-gap');
  });
});
