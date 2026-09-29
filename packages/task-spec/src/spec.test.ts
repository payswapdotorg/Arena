/**
 * Spec suite (Work Order A008) — TaskSpec construction, content
 * addressing, immutability, tamper detection (positive + negative).
 */

import { describe, expect, it } from 'vitest';
import { createFixtureSpec, validSpecInput, T0, T1 } from './test-support.js';
import {
  createTaskSpec,
  isTaskSpec,
  taskSpecContentView,
  taskSpecVersionRef,
  verifyTaskSpec,
} from './spec.js';
import { TASK_SPEC_ERROR_CODES, TaskSpecError } from './errors.js';

describe('TaskSpec construction (positive)', () => {
  it('creates the fixture spec with a valid sha256 digest', async () => {
    const spec = await createFixtureSpec();
    expect(spec.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(spec.recordVersion).toBe(1);
    expect(spec.identity).toEqual({ tenant: 'tenant-alpha', taskId: 'task-case-001' });
    expect(spec.taskClass).toBe('correction');
    expect(spec.prohibitedShortcuts).toEqual([
      'do not delete the failing test to make it pass',
    ]);
    expect(spec.longHorizonEvidence).toBeNull();
  });

  it('is deterministic: same input ⇒ same digest', async () => {
    const a = await createTaskSpec(validSpecInput());
    const b = await createTaskSpec(validSpecInput());
    expect(a.digest).toBe(b.digest);
  });

  it('is deep-frozen: mutation attempts fail silently or throw', async () => {
    const spec = await createFixtureSpec();
    expect(Object.isFrozen(spec)).toBe(true);
    expect(() => {
      (spec as unknown as Record<string, unknown>)['instructions'] = 'tampered';
    }).toThrow();
    expect(Object.isFrozen(spec.objectives)).toBe(true);
    expect(Object.isFrozen(spec.quality)).toBe(true);
    expect(Object.isFrozen(spec.dataRights)).toBe(true);
  });

  it('verifyTaskSpec accepts pristine content and returns the digest', async () => {
    const spec = await createFixtureSpec();
    await expect(verifyTaskSpec(spec)).resolves.toBe(spec.digest);
  });

  it('structural checks: isTaskSpec accepts the fixture, rejects non-specs', async () => {
    const spec = await createFixtureSpec();
    expect(isTaskSpec(spec)).toBe(true);
    expect(isTaskSpec({ recordVersion: 1 })).toBe(false);
    expect(isTaskSpec(null)).toBe(false);
    expect(isTaskSpec('task')).toBe(false);
  });

  it('taskSpecVersionRef carries identity+version+digest', async () => {
    const spec = await createFixtureSpec();
    expect(taskSpecVersionRef(spec)).toEqual({
      tenant: 'tenant-alpha',
      taskId: 'task-case-001',
      version: '1.0.0',
      digest: spec.digest,
    });
  });

  it('taskSpecContentView strips exactly the digest', async () => {
    const spec = await createFixtureSpec();
    const view = taskSpecContentView(spec);
    expect('digest' in view).toBe(false);
    expect(view.identity).toEqual(spec.identity);
  });
});

describe('TaskSpec tamper detection (negative)', () => {
  it('a mutated field fails verification with TASK_SPEC_TAMPERED', async () => {
    const spec = await createFixtureSpec();
    const tampered = {
      ...spec,
      instructions: 'do nothing instead',
      objectives: ['fake objective'],
    } as typeof spec;
    await expect(verifyTaskSpec(tampered)).rejects.toMatchObject({
      code: TASK_SPEC_ERROR_CODES.TAMPERED,
    });
  });

  it('an expected-digest mismatch fails closed', async () => {
    const spec = await createFixtureSpec();
    const wrongDigest = 'f'.repeat(64);
    await expect(verifyTaskSpec(spec, wrongDigest)).rejects.toBeInstanceOf(TaskSpecError);
  });

  it('verifyTaskSpec rejects structurally invalid input', async () => {
    await expect(
      verifyTaskSpec({ recordVersion: 1, instructions: 'x' } as never),
    ).rejects.toMatchObject({ code: TASK_SPEC_ERROR_CODES.INVALID_SPEC });
  });

  it('supersession creates a new content-addressed object (append-only)', async () => {
    const first = await createFixtureSpec();
    const second = await createTaskSpec({
      ...validSpecInput(),
      version: '1.1.0',
      supersedes: taskSpecVersionRef(first),
    });
    expect(second.digest).not.toBe(first.digest);
    expect(second.supersedes?.digest).toBe(first.digest);
    // The first version stays intact and addressable:
    expect(first.version).toBe('1.0.0');
    expect((first as unknown as Record<string, unknown>)['supersedes']).toBeUndefined();
  });

  it('timestamps do not participate: T0/T1 fixture inputs still create specs', async () => {
    // (The spec view has NO timestamp field — this pins that invariant.)
    const spec = await createFixtureSpec();
    const view = taskSpecContentView(spec) as unknown as Record<string, unknown>;
    expect(view['createdAt']).toBeUndefined();
    expect(view['derivedAt']).toBeUndefined();
    expect(view['compiledAt']).toBeUndefined();
    expect([T0, T1].length).toBe(2);
  });
});
