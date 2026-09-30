import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as epochModule from './index.js';
import {
  EPOCH_ADAPTER_ERROR_CODES,
  EPOCH_SCHEMAS,
  EPOCH_ADAPTER_SCHEMA_VERSION,
  EPOCH_ADAPTER_PROTOCOL_VERSION,
  EPOCH_JOB_STATUSES,
  EPOCH_OUTPUT_REF_KINDS,
  EPOCH_OUTPUT_REF_KIND_COUNT,
  EPOCH_SCHEMA_REGISTRY,
  SUPPORTED_EPOCH_ADAPTER_ERROR_CODES,
} from './index.js';
import { createEpochAdapter, EPOCH_AUTHORITY_BOUNDARY } from './adapter.js';
import {
  makeJobCompletedEvent,
  makeRunCapabilityDevelopmentCommand,
  parseRunCapabilityDevelopmentCommand,
  serializeEpochEnvelope,
} from './schemas.js';
import { toCapabilityDevelopmentRequest } from './request.js';
import { makeEpochJob, toCausationId } from './job.js';
import { toEpochOutputRef } from './refs.js';
import { newCorrelationId, newIdempotencyKey } from '@arena/protocol-core';
import { createLoopbackArenaClient, buildEpochRequest, buildOutputRef, FIXED_CLOCK, DIGESTS } from './test-support.js';

const FORBIDDEN_NAME_PARTS = [
  'worldmodel',
  'world',
  'mutate',
  'epochaction',
  'baseline',
  'deliverystate',
  'semanticauthority',
  'constraint',
];

function forbiddenNames(names: readonly string[]): readonly string[] {
  return names.filter((name) => {
    const lowered = name.toLowerCase();
    return FORBIDDEN_NAME_PARTS.some((part) => lowered.includes(part));
  });
}

describe('epoch adapter — hygiene + authority boundary (EPI1.0)', () => {
  it('freezes every closed vocabulary', () => {
    expect(Object.isFrozen(EPOCH_OUTPUT_REF_KINDS)).toBe(true);
    expect(Object.isFrozen(EPOCH_JOB_STATUSES)).toBe(true);
    expect(Object.isFrozen(EPOCH_SCHEMAS)).toBe(true);
    expect(Object.isFrozen(EPOCH_ADAPTER_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(EPOCH_AUTHORITY_BOUNDARY)).toBe(true);
    expect(Object.isFrozen(EPOCH_SCHEMA_REGISTRY)).toBe(true);
    expect(Object.isFrozen(SUPPORTED_EPOCH_ADAPTER_ERROR_CODES)).toBe(true);
  });

  it('pins the schema registry (8 in-package schemas, all @1.0.0)', () => {
    expect(EPOCH_ADAPTER_SCHEMA_VERSION).toBe('1.0.0');
    expect(Object.keys(EPOCH_SCHEMA_REGISTRY).sort()).toEqual(
      [
        'epoch/authorization-metadata',
        'epoch/capability-development-request',
        'epoch/error',
        'epoch/epoch-job',
        'epoch/job-completed-event',
        'epoch/output-ref',
        'epoch/run-capability-development-command',
        'epoch/schema-registry',
      ].sort(),
    );
    for (const version of Object.values(EPOCH_SCHEMA_REGISTRY)) {
      expect(version).toBe('1.0.0');
    }
  });

  it('pins the EPI1.0 output ref count and the protocol label', () => {
    expect(EPOCH_OUTPUT_REF_KIND_COUNT).toBe(11);
    expect(EPOCH_OUTPUT_REF_KINDS).toHaveLength(11);
    expect(EPOCH_ADAPTER_PROTOCOL_VERSION).toBe('EPI1.0');
  });

  it('exposes NO World-Model mutation surface in the module exports (authority boundary)', () => {
    const exportedNames = Object.keys(epochModule);
    expect(exportedNames.length).toBeGreaterThan(20);
    expect(forbiddenNames(exportedNames)).toEqual([]);
  });

  it('exposes NO World-Model mutation surface on the adapter instance (authority boundary)', () => {
    const adapter = createEpochAdapter({
      client: createLoopbackArenaClient('acme'),
      clock: FIXED_CLOCK,
    });
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).filter(
      (name) => name !== 'constructor',
    );
    expect(methodNames.sort()).toEqual([
      'cancelJob',
      'completeJob',
      'failJob',
      'getJob',
      'jobCompletedEvent',
      'listJobs',
      'reportHealth',
      'requireJob',
      'resolveOutputRef',
      'startJob',
      'store',
      'submitCapabilityDevelopmentRequest',
      'toCaseInput',
    ]);
    expect(forbiddenNames(methodNames)).toEqual([]);
    // The boundary is DECLARED, frozen, and matches EPI1.0's six clauses.
    expect(Object.isFrozen(adapter.authorityBoundary)).toBe(true);
    expect(adapter.authorityBoundary).toBe(EPOCH_AUTHORITY_BOUNDARY);
  });

  it('commands REQUIRE idempotency keys; events carry none (lock rule 17)', async () => {
    const request = toCapabilityDevelopmentRequest(buildEpochRequest());
    const correlationId = newCorrelationId();
    const idempotencyKey = newIdempotencyKey();
    expect(() =>
      makeRunCapabilityDevelopmentCommand(request, {
        correlationId,
        idempotencyKey: null as never,
      }),
    ).toThrow(EPOCH_ADAPTER_ERROR_CODES.IDEMPOTENCY_REQUIRED);
    expect(() =>
      makeRunCapabilityDevelopmentCommand(request, {
        correlationId: null as never,
        idempotencyKey,
      }),
    ).toThrow(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST);

    const command = makeRunCapabilityDevelopmentCommand(request, {
      correlationId,
      idempotencyKey,
    });
    expect(command.idempotencyKey).toBe(idempotencyKey);

    const caseRef = toEpochOutputRef(
      buildOutputRef('capability-case', DIGESTS.certification, `arena:case/acme/epoch-req-001@1.0.0#${DIGESTS.certification}`),
    );
    const job = makeEpochJob({
      jobId: globalThis.crypto.randomUUID(),
      idempotencyKey,
      correlationId,
      causationId: toCausationId('cause-1'),
      requestDigest: DIGESTS.evidence,
      authorization: request.authorization,
      targetReleaseChannel: 'development',
      caseRef,
      submittedAt: FIXED_CLOCK(),
    });
    const event = makeJobCompletedEvent(job, { correlationId });
    expect(event.idempotencyKey).toBeNull();
    expect(event.kind).toBe('event');
  });

  it('parses valid commands off the wire and rejects tampered schemas', async () => {
    const request = toCapabilityDevelopmentRequest(buildEpochRequest());
    const command = makeRunCapabilityDevelopmentCommand(request, {
      correlationId: newCorrelationId(),
      idempotencyKey: newIdempotencyKey(),
    });
    const raw = serializeEpochEnvelope(command);
    const parsed = parseRunCapabilityDevelopmentCommand(raw);
    expect(parsed.payload.requestId).toBe('epoch-req-001');
    expect(parsed.idempotencyKey).not.toBeNull();

    const tamperedSchema = raw.replace(
      'epoch/run-capability-development-command',
      'epoch/epoch-job',
    );
    expect(() => parseRunCapabilityDevelopmentCommand(tamperedSchema)).toThrow(
      EPOCH_ADAPTER_ERROR_CODES.SCHEMA_MISMATCH,
    );

    const tamperedNamespace = raw.replace('arena:schema/epoch/', 'arena:schema/api/');
    expect(() => parseRunCapabilityDevelopmentCommand(tamperedNamespace)).toThrow();

    const tamperedKind = raw.replace('"kind":"command"', '"kind":"query"');
    expect(() => parseRunCapabilityDevelopmentCommand(tamperedKind)).toThrow();
  });

  it('keeps dependency intake provider-neutral and workspace-frozen (G6 spirit)', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      name: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.name).toBe('@arena/epoch-adapter');
    // The four turbo battery scripts must exist.
    for (const script of ['typecheck', 'lint', 'test', 'build']) {
      expect(typeof manifest.scripts[script]).toBe('string');
    }
    // Every runtime dependency is a frozen workspace link to a protocol/
    // domain package — no provider SDKs, no services-layer imports (B4).
    for (const [name, spec] of Object.entries(manifest.dependencies)) {
      expect(spec).toBe('workspace:*');
      expect(name.startsWith('@arena/')).toBe(true);
      expect(name.startsWith('@arena/api-')).toBe(false);
    }
    for (const spec of Object.values(manifest.devDependencies)) {
      expect(spec === 'catalog:' || spec === 'workspace:*').toBe(true);
    }
  });

  it('supports the closed error-code parity list', () => {
    expect(SUPPORTED_EPOCH_ADAPTER_ERROR_CODES).toHaveLength(
      Object.keys(EPOCH_ADAPTER_ERROR_CODES).length,
    );
    expect(SUPPORTED_EPOCH_ADAPTER_ERROR_CODES).toContain('EPOCH_ADAPTER_CROSS_TENANT');
    expect(SUPPORTED_EPOCH_ADAPTER_ERROR_CODES).toContain('EPOCH_ADAPTER_WORLD_MODEL_FORBIDDEN');
  });
});
