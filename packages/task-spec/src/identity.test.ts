/**
 * Identity resolution suite (Work Order A008) — pure taskIdentity
 * (id + semver) resolution, tenant scoping, identity conflicts.
 */

import { describe, expect, it } from 'vitest';
import { createFixtureSpec, validSpecInput } from './test-support.js';
import { createTaskSpec } from './spec.js';
import {
  resolveTaskIdentity,
  taskLogicalKey,
  taskVersionRefLogicalKey,
  toTaskIdentity,
  toTaskVersionRef,
  formatTaskVersionRef,
} from './identity.js';
import { TASK_SPEC_ERROR_CODES } from './errors.js';

async function versions(): Promise<
  Awaited<ReturnType<typeof createTaskSpec>>[]
> {
  const base = validSpecInput();
  return Promise.all([
    createTaskSpec(base),
    createTaskSpec({ ...base, version: '1.1.0' }),
    createTaskSpec({ ...base, version: '1.2.0' }),
    createTaskSpec({ ...base, version: '0.9.0' }),
  ]);
}

describe('task identity', () => {
  it('toTaskIdentity validates + freezes', () => {
    const identity = toTaskIdentity({ tenant: 'tenant-alpha', taskId: 'task-x' });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(taskLogicalKey(identity)).toBe('tenant-alpha/task-x');
    expect(() => toTaskIdentity({ tenant: 'Bad Tenant', taskId: 'task-x' })).toThrow();
  });

  it('toTaskVersionRef validates + formats', () => {
    const ref = toTaskVersionRef({
      tenant: 'tenant-alpha',
      taskId: 'task-x',
      version: '1.0.0',
      digest: 'a'.repeat(64),
    });
    expect(formatTaskVersionRef(ref)).toBe('tenant-alpha/task-x@1.0.0');
    expect(taskVersionRefLogicalKey(ref)).toBe('tenant-alpha/task-x');
    expect(() =>
      toTaskVersionRef({ tenant: 'tenant-alpha', taskId: 'task-x', version: '1.0', digest: 'a'.repeat(64) }),
    ).toThrow();
  });
});

describe('resolveTaskIdentity', () => {
  it('resolves the LATEST version by semver precedence', async () => {
    const specs = await versions();
    const resolved = resolveTaskIdentity(specs, {
      tenant: 'tenant-alpha',
      taskId: 'task-case-001',
    });
    expect(resolved.version).toBe('1.2.0');
  });

  it('resolves an EXACT version', async () => {
    const specs = await versions();
    const resolved = resolveTaskIdentity(
      specs,
      { tenant: 'tenant-alpha', taskId: 'task-case-001' },
      { version: '0.9.0' },
    );
    expect(resolved.version).toBe('0.9.0');
  });

  it('semver precedence: 1.10.0 > 1.9.0 > 1.2.0 (numeric, not lexicographic)', async () => {
    const base = validSpecInput();
    const specs = await Promise.all([
      createTaskSpec({ ...base, version: '1.9.0' }),
      createTaskSpec({ ...base, version: '1.10.0' }),
      createTaskSpec({ ...base, version: '1.2.0' }),
    ]);
    expect(
      resolveTaskIdentity(specs, { tenant: 'tenant-alpha', taskId: 'task-case-001' }).version,
    ).toBe('1.10.0');
  });

  it('tenant scoping is exact: another tenant resolves nothing (TASK_NOT_FOUND)', async () => {
    const specs = await versions();
    expect(() =>
      resolveTaskIdentity(specs, { tenant: 'tenant-beta', taskId: 'task-case-001' }),
    ).toThrowError(
      expect.objectContaining({ code: TASK_SPEC_ERROR_CODES.TASK_NOT_FOUND }),
    );
  });

  it('a missing version is TASK_NOT_FOUND', async () => {
    const specs = await versions();
    expect(() =>
      resolveTaskIdentity(
        specs,
        { tenant: 'tenant-alpha', taskId: 'task-case-001' },
        { version: '9.9.9' },
      ),
    ).toThrowError(
      expect.objectContaining({ code: TASK_SPEC_ERROR_CODES.TASK_NOT_FOUND }),
    );
  });

  it('two different digests at the same version are an IDENTITY CONFLICT', async () => {
    const a = await createFixtureSpec();
    const b = await createTaskSpec({
      ...validSpecInput(),
      instructions: 'different content, same version',
    });
    expect(() =>
      resolveTaskIdentity([a, b], { tenant: 'tenant-alpha', taskId: 'task-case-001' }),
    ).toThrowError(
      expect.objectContaining({ code: TASK_SPEC_ERROR_CODES.IDENTITY_CONFLICT }),
    );
  });

  it('the same spec listed twice is NOT a conflict (dedup by content)', async () => {
    const a = await createFixtureSpec();
    const resolved = resolveTaskIdentity([a, a], {
      tenant: 'tenant-alpha',
      taskId: 'task-case-001',
    });
    expect(resolved.digest).toBe(a.digest);
  });
});
