import { describe, expect, it } from 'vitest';
import { serializeEpochEnvelope, parseJobCompletedEvent } from './schemas.js';
import {
  createEpochAdapter,
  EPOCH_AUTHORITY_BOUNDARY,
  EpochAdapter,
} from './adapter.js';
import { isCapabilityCase, caseVersionRef } from '@arena/capability-case';
import { EPOCH_ADAPTER_ERROR_CODES, isEpochAdapterError } from './errors.js';
import { toEpochOutputRef } from './refs.js';
import { buildEpochRequest, buildOutputRef, createLoopbackArenaClient, DIGESTS } from './test-support.js';

const CERT_REF = buildOutputRef(
  'certification',
  DIGESTS.certification,
  `arena:certification/${DIGESTS.certification}`,
);
const BODY_REF = buildOutputRef(
  'agent-body-version',
  DIGESTS.bodyVersion,
  `acme/structural-engineer@1.2.0#${DIGESTS.bodyVersion}`,
);

function cloneRequest(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(buildEpochRequest())) as Record<string, unknown>;
}

let uniqueCounter = 100;

/** A request with FRESH identity fields (a distinct, non-replayed job). */
function uniqueRequest(): Record<string, unknown> {
  const request = cloneRequest();
  uniqueCounter += 1;
  request['requestId'] = `epoch-req-${uniqueCounter}`;
  request['idempotencyKey'] = `epoch-key-${uniqueCounter}`;
  request['correlationId'] = `epoch-corr-${uniqueCounter}`;
  return request;
}

function makeAdapter(): EpochAdapter {
  return createEpochAdapter({
    client: createLoopbackArenaClient('acme'),
    clock: () => '2026-01-15T09:30:00.000Z',
  });
}

async function submitRunningJob(
  adapter: EpochAdapter,
  request: Record<string, unknown> = uniqueRequest(),
) {
  const submission = await adapter.submitCapabilityDevelopmentRequest(request);
  const running = adapter.startJob(submission.job.jobId);
  return { submission, running };
}

describe('epoch adapter — typed translation (Epoch → Arena)', () => {
  it('translates a CapabilityDevelopmentRequest into a provisioned Arena Capability Case', async () => {
    const adapter = makeAdapter();
    const submission = await adapter.submitCapabilityDevelopmentRequest(cloneRequest());

    expect(submission.replayed).toBe(false);
    // The A005 constructor produced a real, frozen, content-addressed case.
    expect(isCapabilityCase(submission.caseRecord)).toBe(true);
    expect(Object.isFrozen(submission.caseRecord)).toBe(true);
    // The case identity is derived from the request (tenant + requestId).
    expect(caseVersionRef(submission.caseRecord).caseId).toBe('epoch-req-001');
    expect(caseVersionRef(submission.caseRecord).tenant).toBe('acme');
    // The EPI1.0 CapabilityCaseRef cites the case digest + address.
    expect(submission.job.caseRef?.kind).toBe('capability-case');
    expect(submission.job.caseRef?.digest).toBe(submission.caseRecord.digest);
    expect(submission.job.artifactDigests).toEqual([submission.caseRecord.digest]);
  });

  it('emits a typed run-capability-development COMMAND envelope (idempotency REQUIRED)', async () => {
    const adapter = makeAdapter();
    const submission = await adapter.submitCapabilityDevelopmentRequest(cloneRequest());
    const command = submission.command;
    expect(command).not.toBeNull();
    expect(command?.kind).toBe('command');
    expect(command?.schema).toBe('arena:schema/epoch/run-capability-development-command@1.0.0');
    expect(command?.idempotencyKey).toBe('epoch-key-001');
    expect(command?.correlationId).toBe('epoch-corr-001');
    // Causation: the command cites the Epoch-side originating exchange.
    expect((command?.payload as { causationId?: string }).causationId).toBe('epoch-cause-001');
  });

  it('fail-closes on cross-tenant authorization metadata', async () => {
    const adapter = makeAdapter();
    const request = cloneRequest();
    const authorization = request['authorization'] as Record<string, unknown>;
    authorization['tenant'] = 'other-tenant';
    await expect(adapter.submitCapabilityDevelopmentRequest(request)).rejects.toThrow(
      EPOCH_ADAPTER_ERROR_CODES.CROSS_TENANT,
    );
  });

  it('fail-closes when the A005 constructor rejects the case seed', async () => {
    const adapter = makeAdapter();
    const request = cloneRequest();
    const seed = request['caseSeed'] as Record<string, unknown>;
    seed['unknowns'] = [];
    await expect(adapter.submitCapabilityDevelopmentRequest(request)).rejects.toThrow(
      /A005 capability-case constructor/,
    );
  });

  it('requires a real @arena/arena-sdk client (no untyped access)', () => {
    expect(
      () =>
        createEpochAdapter({
          client: { getBodyVersion: async () => null } as never,
          clock: () => '2026-01-15T09:30:00.000Z',
        }),
    ).toThrow(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST);
  });
});

describe('epoch adapter — idempotent submission (A015 discipline)', () => {
  it('replays the SAME job for a repeated identical submission (no re-execution)', async () => {
    const adapter = makeAdapter();
    const first = await adapter.submitCapabilityDevelopmentRequest(cloneRequest());
    const second = await adapter.submitCapabilityDevelopmentRequest(cloneRequest());
    expect(second.replayed).toBe(true);
    expect(second.job.jobId).toBe(first.job.jobId);
    // A replay MUST NOT emit a new command (that would duplicate execution).
    expect(second.command).toBeNull();
    expect(adapter.listJobs()).toHaveLength(1);
  });

  it('rejects a replayed idempotency key bound to DIFFERENT content', async () => {
    const adapter = makeAdapter();
    await adapter.submitCapabilityDevelopmentRequest(cloneRequest());
    const conflicting = cloneRequest();
    const seed = conflicting['caseSeed'] as Record<string, unknown>;
    seed['problemStatement'] = 'A different problem statement entirely';
    await expect(adapter.submitCapabilityDevelopmentRequest(conflicting)).rejects.toThrow(
      EPOCH_ADAPTER_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    );
  });
});

describe('epoch adapter — completion gates (Arena → Epoch outputs)', () => {
  it('completes a running job with validated EPI1.0 output refs', async () => {
    const adapter = makeAdapter();
    const { submission } = await submitRunningJob(adapter);
    const job = adapter.completeJob(submission.job.jobId, {
      refs: [CERT_REF, BODY_REF],
    });
    expect(job.status).toBe('succeeded');
    expect(job.outputs).toHaveLength(3);
    expect(job.outputs.map((ref) => ref.kind)).toEqual([
      'capability-case',
      'certification',
      'agent-body-version',
    ]);
    expect(job.artifactDigests).toEqual(
      [DIGESTS.certification, DIGESTS.bodyVersion, submission.caseRecord.digest].sort(),
    );
    expect(job.failure).toBeNull();
  });

  it('emits a job-completed event that round-trips the wire discipline', async () => {
    const adapter = makeAdapter();
    const { submission } = await submitRunningJob(adapter);
    adapter.completeJob(submission.job.jobId, { refs: [CERT_REF] });
    const event = adapter.jobCompletedEvent(submission.job.jobId);
    expect(event.kind).toBe('event');
    expect(event.schema).toBe('arena:schema/epoch/job-completed-event@1.0.0');
    expect(event.idempotencyKey).toBeNull();
    const parsed = parseJobCompletedEvent(serializeEpochEnvelope(event));
    expect(parsed.payload.jobId).toBe(submission.job.jobId);
    expect(parsed.payload.status).toBe('succeeded');
  });

  it('rejects completion of unknown jobs, queued jobs and terminal jobs', async () => {
    const adapter = makeAdapter();
    expect(() => adapter.completeJob('00000000-0000-4000-8000-000000000000', { refs: [] })).toThrow(
      EPOCH_ADAPTER_ERROR_CODES.JOB_NOT_FOUND,
    );
    const submission = await adapter.submitCapabilityDevelopmentRequest(cloneRequest());
    // queued → succeeded is illegal (explicit lifecycle: must run first)
    expect(() => adapter.completeJob(submission.job.jobId, { refs: [CERT_REF] })).toThrow(
      EPOCH_ADAPTER_ERROR_CODES.INVALID_LIFECYCLE,
    );
    const { submission: running } = await submitRunningJob(adapter, cloneRequest());
    const done = adapter.completeJob(running.job.jobId, { refs: [CERT_REF] });
    expect(() => adapter.completeJob(running.job.jobId, { refs: [CERT_REF] })).toThrow(
      EPOCH_ADAPTER_ERROR_CODES.JOB_TERMINAL,
    );
    expect(done.status).toBe('succeeded');
  });

  it('rejects malformed output refs and cross-kind digest collisions', async () => {
    const adapter = makeAdapter();
    const { submission } = await submitRunningJob(adapter);
    expect(() =>
      adapter.completeJob(submission.job.jobId, {
        refs: [buildOutputRef('certification', 'not-a-digest', 'arena:x')],
      }),
    ).toThrow(EPOCH_ADAPTER_ERROR_CODES.INVALID_REF);
    const { submission: other } = await submitRunningJob(adapter, cloneRequest());
    expect(() =>
      adapter.completeJob(other.job.jobId, {
        refs: [
          CERT_REF,
          buildOutputRef('compatibility-report', DIGESTS.certification, 'arena:compat'),
        ],
      }),
    ).toThrow(/different kinds/);
  });

  it('cites the A024 release admission gate for candidate/stable channels', async () => {
    const adapter = makeAdapter();
    const request = cloneRequest();
    request['targetReleaseChannel'] = 'stable';
    const submission = await adapter.submitCapabilityDevelopmentRequest(request);
    adapter.startJob(submission.job.jobId);
    expect(() =>
      adapter.completeJob(submission.job.jobId, { refs: [BODY_REF] }),
    ).toThrow(/A024 channel grant requirements/);
    const completed = adapter.completeJob(submission.job.jobId, { refs: [BODY_REF, CERT_REF] });
    expect(completed.status).toBe('succeeded');
  });

  it('failJob and cancelJob are terminal and validated', async () => {
    const adapter = makeAdapter();
    const { submission } = await submitRunningJob(adapter);
    const { submission: fresh } = await submitRunningJob(adapter, cloneRequest());
    // Input validation fires before any lifecycle mutation.
    expect(() =>
      adapter.failJob(fresh.job.jobId, { code: '', message: 'x' }),
    ).toThrow(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST);
    const failed = adapter.failJob(submission.job.jobId, {
      code: 'EPOCH_ADAPTER_UNRESOLVED_ARTIFACT',
      message: 'evaluation never produced a verdict',
    });
    expect(failed.status).toBe('failed');
    expect(failed.failure?.code).toBe('EPOCH_ADAPTER_UNRESOLVED_ARTIFACT');
    expect(() => adapter.startJob(submission.job.jobId)).toThrow(
      EPOCH_ADAPTER_ERROR_CODES.JOB_TERMINAL,
    );

    const { submission: cancellable } = await submitRunningJob(adapter);
    expect(adapter.cancelJob(cancellable.job.jobId).status).toBe('cancelled');
  });
});

describe('epoch adapter — Arena reads via the A025 client', () => {
  it('resolves output refs through the real ArenaApiClient envelope discipline', async () => {
    const adapter = makeAdapter();
    // Not-found is a VALUE (null) — never an error — and the read went
    // through a real query envelope + response validation round-trip.
    const bodyRecord = await adapter.resolveOutputRef(toEpochOutputRef(BODY_REF));
    expect(bodyRecord).toBeNull();
    const certRecord = await adapter.resolveOutputRef(toEpochOutputRef(CERT_REF));
    expect(certRecord).toBeNull();
  });

  it('returns null for kinds the A025 surface does not yet expose', async () => {
    const adapter = makeAdapter();
    const taskRef = toEpochOutputRef(
      buildOutputRef('task-spec', DIGESTS.evidence, `arena:task/${DIGESTS.evidence}`),
    );
    expect(await adapter.resolveOutputRef(taskRef)).toBeNull();
  });

  it('rejects invalid refs before any read', async () => {
    const adapter = makeAdapter();
    await expect(
      adapter.resolveOutputRef({ refVersion: 1, kind: 'task-spec', digest: 'x', address: 'y' } as never),
    ).rejects.toThrow(EPOCH_ADAPTER_ERROR_CODES.INVALID_REF);
  });

  it('reports health and answers job lookups', async () => {
    const adapter = makeAdapter();
    const health = adapter.reportHealth();
    expect(health.adapterId).toBe('epoch');
    expect(health.protocol).toBe('EPI1.0');
    expect(health.ok).toBe(true);
    expect(health.jobs).toBe(0);
    const submission = await adapter.submitCapabilityDevelopmentRequest(cloneRequest());
    expect(adapter.reportHealth().jobs).toBe(1);
    expect(adapter.getJob(submission.job.jobId)?.jobId).toBe(submission.job.jobId);
    expect(adapter.getJob('missing')).toBeNull();
  });
});

describe('epoch adapter — error normalization', () => {
  it('surfaces typed EpochAdapterErrors throughout', async () => {
    const adapter = makeAdapter();
    try {
      await adapter.submitCapabilityDevelopmentRequest({ nope: true });
      expect.unreachable('must throw');
    } catch (error) {
      expect(isEpochAdapterError(error)).toBe(true);
    }
  });

  it('declares the six EPI1.0 authority clauses', () => {
    expect(EPOCH_AUTHORITY_BOUNDARY).toHaveLength(6);
    expect(EPOCH_AUTHORITY_BOUNDARY).toContain('mutate Epoch World Model');
    expect(EPOCH_AUTHORITY_BOUNDARY).toContain('become Epoch semantic authority');
  });
});
