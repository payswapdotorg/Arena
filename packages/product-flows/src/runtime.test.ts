import { describe, expect, it } from 'vitest';

import { isTerminalCase } from '@arena/capability-case';
import type { CapabilityCase } from '@arena/capability-case';
import { FakeControlPlaneRepository, ManualClock } from '@arena/persistence';
import type {
  ControlPlaneCountQuery,
  ControlPlaneInsertInput,
  ControlPlaneListQuery,
  ControlPlaneRecord,
  ControlPlaneRepository,
  ControlPlaneUpdateInput,
} from '@arena/persistence';
import {
  caseRecordId,
  createProductFlowRuntime,
  fromCaseRecord,
} from './index.js';
import { PRODUCT_FLOW_ERROR_CODES } from './errors.js';
import {
  ACTOR,
  CASE_ID,
  DIGESTS,
  TENANT,
  T0,
  T1,
  T2,
  T3,
  T4,
  T5,
  T6,
  validStartInput,
} from './test-support.js';

const identity = { tenant: TENANT, caseId: CASE_ID } as const;

function freshRepository(): FakeControlPlaneRepository {
  // Fixed epoch; the runtime itself reads no clock at all.
  return new FakeControlPlaneRepository({ clock: new ManualClock(1_000_000_000_000) });
}

async function startedCase(repository: FakeControlPlaneRepository): Promise<CapabilityCase> {
  const runtime = createProductFlowRuntime({ repository });
  const result = await runtime.startCase(validStartInput());
  return result.caseRecord;
}

/** Walk a case to ACTIVE (start → frame → compose → run). */
async function startAndActivate(repository: FakeControlPlaneRepository): Promise<void> {
  const runtime = createProductFlowRuntime({ repository });
  await runtime.startCase(validStartInput());
  await runtime.continueCase({ stepId: 'frame-gap', identity, actor: ACTOR, at: T1 });
  await runtime.continueCase({
    stepId: 'compose-task',
    identity,
    actor: ACTOR,
    at: T2,
    note: 'Selected.',
  });
  await runtime.continueCase({ stepId: 'run', identity, actor: ACTOR, at: T3 });
}

describe('flow runtime — the guided journey over the B002 port (positive)', () => {
  it('starts a canonical DRAFT case through the repository (create + insert)', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    const result = await runtime.startCase(validStartInput());
    expect(result.step.stepId).toBe('start-case');
    expect(result.caseRecord.status).toBe('draft');
    expect(result.caseRecord.lifecycle).toHaveLength(1);
    expect(result.event.kind).toBe('case-created');
    expect(result.revision).toBe(1);
    const stored = await repository.get(caseRecordId(identity));
    expect(stored?.kind).toBe('capability-case');
    expect(await fromCaseRecord(stored as ControlPlaneRecord)).toBe(result.caseRecord);
  });

  it('replays an identical start idempotently (created: false, same digest)', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    const first = await runtime.startCase(validStartInput());
    const replay = await runtime.startCase(validStartInput());
    expect(replay.alreadyExisted).toBe(true);
    expect(replay.caseRecord.digest).toBe(first.caseRecord.digest);
  });

  it('walks the full guided journey: draft → submitted → triaged → active → resolved', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    await runtime.startCase(validStartInput());

    const framed = await runtime.continueCase({
      stepId: 'frame-gap',
      identity,
      actor: ACTOR,
      at: T1,
    });
    expect(framed.caseRecord.status).toBe('submitted');
    expect(framed.event.kind).toBe('case-submitted');
    expect(framed.revision).toBe(2);

    const composed = await runtime.continueCase({
      stepId: 'compose-task',
      identity,
      actor: ACTOR,
      at: T2,
      note: 'Selected: the retry-storm failure is reproducible and blocks the monthly close.',
    });
    expect(composed.caseRecord.status).toBe('triaged');
    expect(composed.event.kind).toBe('case-triaged');
    expect(composed.event.note).toContain('Selected:');
    // The compilation target is derived from the EXACT triaged state.
    expect(composed.compilationTarget?.caseRef.caseId).toBe(CASE_ID);
    expect(composed.compilationTarget?.caseRef.digest).toBe(composed.caseRecord.digest);

    const running = await runtime.continueCase({
      stepId: 'run',
      identity,
      actor: ACTOR,
      at: T3,
    });
    expect(running.caseRecord.status).toBe('active');

    const observed = await runtime.continueCase({
      stepId: 'observe',
      identity,
      actor: ACTOR,
      at: T4,
      evidence: [{ digest: DIGESTS.evidenceTwo, description: 'Trajectory of the jittered-backoff run.' }],
    });
    expect(observed.caseRecord.status).toBe('active');
    expect(observed.caseRecord.evidence).toHaveLength(2);
    expect(observed.event.kind).toBe('evidence-attached');

    const evaluated = await runtime.continueCase({
      stepId: 'evaluate',
      identity,
      actor: ACTOR,
      at: T5,
      evidence: [
        { digest: DIGESTS.evidenceThree, description: 'Evaluation result: zero timeout storms across the replayed batch.' },
      ],
    });
    expect(evaluated.caseRecord.evidence).toHaveLength(3);
    expect(evaluated.event.evidenceAppended).toHaveLength(1);

    const decided = await runtime.continueCase({
      stepId: 'decide',
      identity,
      actor: ACTOR,
      at: T6,
      resolution: 'Resolved: jittered exponential backoff with a three-retry cap eliminated the storms.',
    });
    expect(decided.caseRecord.status).toBe('resolved');
    expect(isTerminalCase(decided.caseRecord)).toBe(true);
    expect(decided.event.kind).toBe('case-resolved');
    expect(decided.revision).toBe(7);
  });

  it('keeps history append-only: every event prefix is preserved verbatim', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    const start = await runtime.startCase(validStartInput());
    const framed = await runtime.continueCase({ stepId: 'frame-gap', identity, actor: ACTOR, at: T1 });
    expect(framed.caseRecord.lifecycle.slice(0, 1)).toEqual(start.caseRecord.lifecycle);
    expect(framed.caseRecord.lifecycle).toHaveLength(2);
  });

  it('getCase returns the verified canonical state + revision', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    await startedCase(repository);
    const { caseRecord, revision } = await runtime.getCase(identity);
    expect(caseRecord.status).toBe('draft');
    expect(revision).toBe(1);
  });

  it('invokes the injected task composer with the derived target (composition seam)', async () => {
    const repository = freshRepository();
    const seen: string[] = [];
    const runtime = createProductFlowRuntime({
      repository,
      composeTask: async (target) => {
        seen.push(target.caseRef.caseId);
        return [];
      },
    });
    await runtime.startCase(validStartInput());
    await runtime.continueCase({ stepId: 'frame-gap', identity, actor: ACTOR, at: T1 });
    const composed = await runtime.continueCase({
      stepId: 'compose-task',
      identity,
      actor: ACTOR,
      at: T2,
      note: 'Selected for capability development.',
    });
    expect(seen).toEqual([CASE_ID]);
    expect(composed.taskSpecs).toEqual([]);
  });
});

describe('flow runtime — canonical rejections propagate VERBATIM (negative)', () => {
  it('rejects a step whose validFrom does not match the case status with the CANONICAL typed error', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    await runtime.startCase(validStartInput());
    // 'run' is valid from triaged; the case is draft.
    await expect(
      runtime.continueCase({ stepId: 'run', identity, actor: ACTOR, at: T1 }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_CASE_INVALID_TRANSITION' }),
    );
  });

  it('rejects a canonical transition out of order even when the guided binding matches (canonical authority)', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    await runtime.startCase(validStartInput());
    // decide is bound validFrom active; case is draft → canonical rejection.
    await expect(
      runtime.continueCase({ stepId: 'decide', identity, actor: ACTOR, at: T1, resolution: 'x' }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_CASE_INVALID_TRANSITION' }),
    );
  });

  it('rejects triage without the REQUIRED rationale note (canonical)', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    await runtime.startCase(validStartInput());
    await runtime.continueCase({ stepId: 'frame-gap', identity, actor: ACTOR, at: T1 });
    await expect(
      runtime.continueCase({ stepId: 'compose-task', identity, actor: ACTOR, at: T2, note: '' }),
    ).rejects.toThrowError(/rationale/);
  });

  it('rejects decide without a resolution statement (canonical)', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    await startAndActivate(repository);
    await expect(
      runtime.continueCase({ stepId: 'decide', identity, actor: ACTOR, at: T5 }),
    ).rejects.toThrowError(/resolution requires a non-empty outcome statement/);
  });

  it('rejects observe without evidence refs (canonical INVALID_EVIDENCE)', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    await startAndActivate(repository);
    await expect(
      runtime.continueCase({ stepId: 'observe', identity, actor: ACTOR, at: T4 }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_CASE_INVALID_EVIDENCE' }),
    );
  });

  it('rejects a duplicate evidence digest (canonical DUPLICATE_EVIDENCE — append-only)', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    await runtime.startCase(validStartInput());
    await runtime.continueCase({ stepId: 'frame-gap', identity, actor: ACTOR, at: T1 });
    await runtime.continueCase({
      stepId: 'compose-task',
      identity,
      actor: ACTOR,
      at: T2,
      note: 'Selected.',
    });
    await runtime.continueCase({ stepId: 'run', identity, actor: ACTOR, at: T3 });
    await expect(
      runtime.continueCase({
        stepId: 'observe',
        identity,
        actor: ACTOR,
        at: T4,
        // The case was CREATED with evidenceOne already attached.
        evidence: [{ digest: DIGESTS.evidenceOne, description: 'duplicate' }],
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_CASE_DUPLICATE_EVIDENCE' }),
    );
  });

  it('rejects any transition on a terminal case (canonical TERMINAL_STATE)', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    await startAndActivate(repository);
    await runtime.continueCase({ stepId: 'decide', identity, actor: ACTOR, at: T4, resolution: 'done' });
    // Terminal states are final: no guided step is valid from `resolved`,
    // and the canonical typed rejection names the mismatch.
    await expect(
      runtime.continueCase({
        stepId: 'observe',
        identity,
        actor: ACTOR,
        at: T5,
        evidence: [{ digest: DIGESTS.evidenceTwo, description: 'late' }],
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_CASE_INVALID_TRANSITION' }),
    );
    // The terminal state itself stays readable + verifiable (append-only history).
    const terminal = await runtime.getCase(identity);
    expect(terminal.caseRecord.status).toBe('resolved');
    expect(terminal.caseRecord.lifecycle.length).toBeGreaterThanOrEqual(5);
  });

  it('rejects unknown step ids with the typed PRODUCT_FLOW_UNKNOWN_STEP', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    await startedCase(repository);
    await expect(
      runtime.continueCase({ stepId: 'make-coffee', identity, actor: ACTOR, at: T1 }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: PRODUCT_FLOW_ERROR_CODES.UNKNOWN_STEP }),
    );
  });

  it('rejects continueCase(start-case) — a case is started, not continued (negative)', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    await expect(
      runtime.continueCase({ stepId: 'start-case', identity, actor: ACTOR, at: T0 }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: PRODUCT_FLOW_ERROR_CODES.MALFORMED_INPUT }),
    );
  });

  it('rejects a missing case with the typed PRODUCT_FLOW_CASE_NOT_FOUND', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    await expect(
      runtime.getCase({ tenant: TENANT, caseId: 'case-never-started' }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: PRODUCT_FLOW_ERROR_CODES.CASE_NOT_FOUND }),
    );
  });

  it('rejects an actor from another tenant (tenant-scoped transitions)', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    await startedCase(repository);
    await expect(
      runtime.continueCase({
        stepId: 'frame-gap',
        identity,
        actor: { type: 'user', tenant: 'tenant-other', principalId: 'intruder' },
        at: T1,
      }),
    ).rejects.toThrowError(/must match the case tenant/);
  });

  it('rejects a missing `at` timestamp (the runtime reads no clock)', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    await expect(
      runtime.continueCase({
        stepId: 'frame-gap',
        identity,
        actor: ACTOR,
        at: '',
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: PRODUCT_FLOW_ERROR_CODES.MALFORMED_INPUT }),
    );
  });

  it('rejects malformed start input with the CANONICAL validation error', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    const broken = validStartInput();
    (broken as { problemStatement: string }).problemStatement = '';
    await expect(runtime.startCase(broken)).rejects.toThrowError(/problem statement/);
  });

  it('rejects a start that collides with an existing case id of different content (B002 typed)', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    await runtime.startCase(validStartInput());
    const conflicting = validStartInput();
    (conflicting as { problemStatement: string }).problemStatement = 'A different gap entirely.';
    await expect(runtime.startCase(conflicting)).rejects.toThrowError(
      expect.objectContaining({ code: 'PERSISTENCE_RECORD_EXISTS' }),
    );
  });
});

describe('flow runtime — record integrity (fail closed)', () => {
  it('rejects a capability-case record that is not a canonical protocol object (narrative-shaped)', async () => {
    const repository = freshRepository();
    // A NARRATIVE-shaped capability-case record (the B006 demo corpus shape).
    await repository.insert({
      recordId: caseRecordId({ tenant: TENANT, caseId: 'case-narrative' }),
      tenantId: TENANT,
      kind: 'capability-case',
      version: 1,
      data: { caseId: 'case-narrative', title: 'A demo narrative case', lifecycle: 'active' },
    });
    const runtime = createProductFlowRuntime({ repository });
    await expect(
      runtime.getCase({ tenant: TENANT, caseId: 'case-narrative' }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: PRODUCT_FLOW_ERROR_CODES.RECORD_INVALID }),
    );
  });

  it('rejects a TAMPERED case payload with the canonical CAPABILITY_CASE_TAMPERED error', async () => {
    const repository = freshRepository();
    const runtime = createProductFlowRuntime({ repository });
    const result = await runtime.startCase(validStartInput());
    // Tamper: claim a different content digest while keeping the shape.
    const tampered = { ...result.caseRecord, digest: 'f'.repeat(64) };
    await repository.update(caseRecordId(identity), {
      expectedRevision: 1,
      data: tampered as unknown as import('@arena/persistence').JsonSafeValue,
    });
    await expect(runtime.getCase(identity)).rejects.toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_CASE_TAMPERED' }),
    );
  });

  it('surfaces the B002 optimistic-concurrency conflict (no lost updates)', async () => {
    const repository = freshRepository();
    // A racing-writer repository: between the runtime's read and update, a
    // concurrent writer lands FIRST (the classic lost-update race).
    const racing = {
      insert: (input: ControlPlaneInsertInput) => repository.insert(input),
      get: (recordId: string) => repository.get(recordId),
      update: async (recordId: string, update: ControlPlaneUpdateInput) => {
        // A concurrent writer lands FIRST (the lost-update race).
        const current = await repository.get(recordId);
        if (current !== null) {
          await repository.update(recordId, {
            expectedRevision: current.revision,
            data: current.data,
          });
        }
        return repository.update(recordId, update);
      },
      delete: (recordId: string) => repository.delete(recordId),
      list: (query: ControlPlaneListQuery) => repository.list(query),
      count: (query: ControlPlaneCountQuery) => repository.count(query),
    };
    const runtime = createProductFlowRuntime({ repository: racing satisfies ControlPlaneRepository });
    await runtime.startCase(validStartInput());
    await expect(
      runtime.continueCase({ stepId: 'frame-gap', identity, actor: ACTOR, at: T1 }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: 'PERSISTENCE_REVISION_CONFLICT' }),
    );
  });

  it('requires an injected repository (malformed composition)', () => {
    expect(() => createProductFlowRuntime({ repository: {} as never })).toThrowError(
      expect.objectContaining({ code: PRODUCT_FLOW_ERROR_CODES.MALFORMED_INPUT }),
    );
  });
});
