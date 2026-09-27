/**
 * Contract parity tests — bind the generated contracts
 * (contracts/events/*.json, produced by
 * packages/job-protocol/scripts/generate-contracts.mjs) to the TypeScript
 * surface of @arena/job-protocol.
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and the drift suite (drift.test.ts) fails when
 * the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift, exactly like the A001/A002 convention.
 */

import { describe, expect, it } from 'vitest';
import auditRecordSchema from '../../../contracts/events/audit-record.v1.json' with { type: 'json' };
import jobDefinitionSchema from '../../../contracts/events/job-definition.v1.json' with { type: 'json' };
import jobErrorSchema from '../../../contracts/events/job-error.v1.json' with { type: 'json' };
import jobRecordSchema from '../../../contracts/events/job-record.v1.json' with { type: 'json' };
import mutationAuditedSchema from '../../../contracts/events/mutation-audited-event.v1.json' with { type: 'json' };
import registrySchema from '../../../contracts/events/schema-registry.v1.json' with { type: 'json' };
import submitCommandSchema from '../../../contracts/events/submit-job-command.v1.json' with { type: 'json' };
import jobCancelledSchema from '../../../contracts/events/job-cancelled-event.v1.json' with { type: 'json' };
import jobCompletedSchema from '../../../contracts/events/job-completed-event.v1.json' with { type: 'json' };
import jobFailedSchema from '../../../contracts/events/job-failed-event.v1.json' with { type: 'json' };
import jobProgressedSchema from '../../../contracts/events/job-progressed-event.v1.json' with { type: 'json' };
import jobRetriedSchema from '../../../contracts/events/job-retried-event.v1.json' with { type: 'json' };
import jobStartedSchema from '../../../contracts/events/job-started-event.v1.json' with { type: 'json' };
import jobSubmittedSchema from '../../../contracts/events/job-submitted-event.v1.json' with { type: 'json' };
import { JOB_ERROR_CATEGORIES, JOB_ERROR_CODES } from './errors.js';
import {
  CORRELATION_ADDRESS_PATTERN_SOURCE,
  JOB_ATTEMPT_OUTCOMES,
  JOB_FAILURE_KINDS,
  JOB_PRIORITY_CLASSES,
  JOB_STATES,
  JOB_TERMINAL_STATES,
  MUTATION_NAME_PATTERN_SOURCE,
  NEUTRAL_ID_PATTERN_SOURCE,
  PRINCIPAL_TYPES,
} from './shared.js';
import { JOB_EVENT_KINDS } from './events.js';
import { JOB_SCHEMAS, jobSchemaRef } from './envelopes.js';
import { JOB_DEFINITION_VERSION } from './definition.js';
import { JOB_RECORD_VERSION } from './record.js';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

describe('generated contract parity — job-protocol (positive)', () => {
  it('the job definition schema mirrors the definition wire shape', () => {
    expect(sorted(jobDefinitionSchema.required as string[])).toEqual(
      sorted([
        'definitionVersion',
        'kind',
        'inputSchema',
        'correlationAddress',
        'idempotency',
        'timeout',
        'retry',
        'priority',
        'resourceHints',
        'digest',
      ]),
    );
    expect(jobDefinitionSchema.additionalProperties).toBe(false);
    expect(jobDefinitionSchema.properties.definitionVersion.const).toBe(JOB_DEFINITION_VERSION);
    expect(jobDefinitionSchema.properties.correlationAddress.pattern).toBe(
      CORRELATION_ADDRESS_PATTERN_SOURCE,
    );
    expect(jobDefinitionSchema.properties.idempotency.properties.scope.pattern).toBe(
      NEUTRAL_ID_PATTERN_SOURCE,
    );
    expect(jobDefinitionSchema.properties.priority.enum).toEqual([
      ...JOB_PRIORITY_CLASSES,
    ]);
    expect(jobDefinitionSchema.$defs.jobKind.properties.namespace.pattern).toBe(
      '^[a-z][a-z0-9-]{1,62}$',
    );
    expect(jobDefinitionSchema.properties.inputSchema.pattern).toBe(
      '^arena:schema/[a-z][a-z0-9-]*/[a-z][a-z0-9-]*@\\d+\\.\\d+\\.\\d+$',
    );
  });

  it('the job record schema mirrors the record wire shape', () => {
    expect(jobRecordSchema.properties.recordVersion.const).toBe(JOB_RECORD_VERSION);
    expect(jobRecordSchema.properties.status.enum).toEqual([...JOB_STATES]);
    expect(jobRecordSchema.properties.failure.properties.kind.enum).toEqual([
      ...JOB_FAILURE_KINDS,
    ]);
    expect(jobRecordSchema.properties.failure.properties.errorClass.pattern).toBe(
      NEUTRAL_ID_PATTERN_SOURCE,
    );
    expect(jobRecordSchema.$defs.jobAttempt.properties.outcome.enum).toEqual([
      ...JOB_ATTEMPT_OUTCOMES,
    ]);
    expect(jobRecordSchema.additionalProperties).toBe(false);
    // events reference exactly the 7 lifecycle event schemas
    expect(
      (jobRecordSchema.properties.events.items.oneOf as { $ref: string }[]).map(
        (entry) => entry.$ref,
      ),
    ).toEqual([
      'job-submitted-event.v1.json',
      'job-started-event.v1.json',
      'job-progressed-event.v1.json',
      'job-retried-event.v1.json',
      'job-completed-event.v1.json',
      'job-failed-event.v1.json',
      'job-cancelled-event.v1.json',
    ]);
  });

  it('the job error schema enumerates exactly the TS taxonomy', () => {
    expect(sorted(jobErrorSchema.properties.code.enum as string[])).toEqual(
      sorted(Object.values(JOB_ERROR_CODES)),
    );
    expect(sorted(jobErrorSchema.properties.category.enum as string[])).toEqual(
      sorted([...JOB_ERROR_CATEGORIES]),
    );
    expect(jobErrorSchema.additionalProperties).toBe(false);
  });

  it('every event schema pins its kind const and the shared common fields', () => {
    const eventSchemas: [string, Record<string, unknown>, string][] = [
      ['job-submitted', jobSubmittedSchema, 'job-submitted-event'],
      ['job-started', jobStartedSchema, 'job-started-event'],
      ['job-progressed', jobProgressedSchema, 'job-progressed-event'],
      ['job-retried', jobRetriedSchema, 'job-retried-event'],
      ['job-completed', jobCompletedSchema, 'job-completed-event'],
      ['job-failed', jobFailedSchema, 'job-failed-event'],
      ['job-cancelled', jobCancelledSchema, 'job-cancelled-event'],
      ['mutation-audited', mutationAuditedSchema, 'mutation-audited-event'],
    ];
    for (const [kind, schema, name] of eventSchemas) {
      expect((schema as { properties: Record<string, { const?: string }> }).properties['kind']?.const).toBe(kind);
      expect(schema.additionalProperties).toBe(false);
      expect(schema.$id).toBe(`arena:schema/events/${name}@1.0.0`);
      expect(
        (schema as { properties: Record<string, unknown> }).properties.eventVersion,
      ).toEqual({ const: 1 });
      expect(sorted((schema as { required: string[] }).required)).toContain('sequence');
      expect(sorted((schema as { required: string[] }).required)).toContain('jobId');
    }
    // lifecycle kinds are exactly the 7 + audit
    expect(sorted([...JOB_EVENT_KINDS])).toEqual(
      sorted([
        'job-submitted',
        'job-started',
        'job-progressed',
        'job-retried',
        'job-completed',
        'job-failed',
        'job-cancelled',
        'mutation-audited',
      ]),
    );
  });

  it('the mutation-audited schema mirrors the audit payload contract (R28)', () => {
    expect(
      sorted(mutationAuditedSchema.required as string[]),
    ).toEqual(
      sorted([
        'eventVersion',
        'sequence',
        'occurredAt',
        'jobId',
        'kind',
        'mutation',
        'actor',
        'correlationId',
        'envelopeId',
      ]),
    );
    expect(mutationAuditedSchema.properties.mutation.pattern).toBe(MUTATION_NAME_PATTERN_SOURCE);
    expect(sorted(mutationAuditedSchema.$defs.principal.properties.type.enum as string[])).toEqual(
      sorted([...PRINCIPAL_TYPES]),
    );
    expect(mutationAuditedSchema.properties.envelopeId.pattern).toBe(
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    );
  });

  it('the audit record schema chains digests over the audit payload', () => {
    expect(sorted(auditRecordSchema.required as string[])).toEqual(
      sorted(['sequence', 'previousDigest', 'payload', 'digest']),
    );
    expect(auditRecordSchema.properties.payload.$ref).toBe('mutation-audited-event.v1.json');
    expect(auditRecordSchema.properties.digest.pattern).toBe('^[0-9a-f]{64}$');
    expect(auditRecordSchema.properties.previousDigest.pattern).toBe('^[0-9a-f]{64}$');
  });

  it('the submit-job command schema requires definition + input', () => {
    expect(sorted(submitCommandSchema.required as string[])).toEqual(
      sorted(['definition', 'input']),
    );
    expect(submitCommandSchema.properties.definition.$ref).toBe('job-definition.v1.json');
  });

  it('the schema registry enumerates exactly the job-protocol schemas', () => {
    const expected = sorted(
      Object.keys(JOB_SCHEMAS).map(
        (name) =>
          `arena:schema/${name.replace('events/', 'events/')}@${(JOB_SCHEMAS as Record<string, string>)[name]}`,
      ),
    );
    expect(sorted(registrySchema.enum as string[])).toEqual(expected);
    expect(registrySchema.enum).toHaveLength(14);
  });

  it('contract $ids are the formatted job schema refs', () => {
    expect(jobDefinitionSchema.$id).toBe('arena:schema/events/job-definition@1.0.0');
    expect(jobRecordSchema.$id).toBe('arena:schema/events/job-record@1.0.0');
    expect(jobErrorSchema.$id).toBe('arena:schema/events/job-error@1.0.0');
    expect(auditRecordSchema.$id).toBe('arena:schema/events/audit-record@1.0.0');
    expect(submitCommandSchema.$id).toBe('arena:schema/events/submit-job-command@1.0.0');
    // spot-check via the formatter for every registry entry
    expect(jobSchemaRef('events/job-definition').namespace).toBe('events');
    expect(jobSchemaRef('events/mutation-audited-event').name).toBe('mutation-audited-event');
  });

  it('contracts target JSON Schema draft 2020-12', () => {
    const schemas = [
      jobDefinitionSchema,
      jobRecordSchema,
      jobErrorSchema,
      jobSubmittedSchema,
      jobStartedSchema,
      jobProgressedSchema,
      jobRetriedSchema,
      jobCompletedSchema,
      jobFailedSchema,
      jobCancelledSchema,
      mutationAuditedSchema,
      auditRecordSchema,
      submitCommandSchema,
      registrySchema,
    ];
    for (const schema of schemas) {
      expect(schema.$schema).toBe(DRAFT);
    }
  });
});

describe('generated contract parity — job-protocol (negative — drift must not pass silently)', () => {
  it('a hypothetical extra state would not match the contract enum', () => {
    const hypothetical = sorted([...JOB_STATES, 'waiting']);
    expect(hypothetical).not.toEqual([...jobRecordSchema.properties.status.enum]);
  });

  it('a hypothetical extra error code would not match the contract enum', () => {
    const hypothetical = sorted([...Object.values(JOB_ERROR_CODES), 'JOB_MADE_UP']);
    expect(hypothetical).not.toEqual(sorted(jobErrorSchema.properties.code.enum as string[]));
  });

  it('a hypothetical unknown events schema would not match the registry enum', () => {
    const registry = registrySchema.enum as string[];
    expect(registry).not.toContain('arena:schema/events/does-not-exist@1.0.0');
    expect(registry).not.toContain('arena:schema/artifacts/material-artifact@1.0.0');
  });

  it('terminal states are a strict subset of states; the contract keeps them distinct', () => {
    expect(sorted([...JOB_TERMINAL_STATES])).toEqual(sorted(['succeeded', 'failed', 'cancelled']));
    for (const terminal of JOB_TERMINAL_STATES) {
      expect(JOB_STATES).toContain(terminal);
    }
  });

  it('record wire version 1 is the only const accepted by the contract', () => {
    expect(jobRecordSchema.properties.recordVersion.const).toBe(1);
    expect(jobRecordSchema.properties.recordVersion.const).not.toBe(2);
  });
});
