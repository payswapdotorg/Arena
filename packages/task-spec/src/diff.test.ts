/**
 * TaskDiff suite (Work Order A008) — deterministic version-to-version
 * diffing.
 */

import { describe, expect, it } from 'vitest';
import { createFixtureSpec, validSpecInput } from './test-support.js';
import { createTaskSpec } from './spec.js';
import { diffTaskSpecs, isIdentityOnlyDiff } from './diff.js';
import { TASK_SPEC_ERROR_CODES } from './errors.js';
import { compareTaskVersions } from './shared.js';

describe('diffTaskSpecs', () => {
  it('diffs two versions of one task with sorted dot-paths', async () => {
    const a = await createFixtureSpec();
    const b = await createTaskSpec({
      ...validSpecInput(),
      version: '1.1.0',
      instructions: 'rewritten instructions',
      difficulty: { scale: 'arena:task-difficulty@1', class: 'exploratory' },
    });
    const diff = diffTaskSpecs(a, b);
    expect(diff.from.version).toBe('1.0.0');
    expect(diff.to.version).toBe('1.1.0');
    expect(diff.changedFields).toContain('instructions');
    expect(diff.changedFields).toContain('difficulty.class');
    expect(diff.changedFields).toContain('version');
    expect([...diff.changedFields]).toEqual([...diff.changedFields].sort());
  });

  it('is deterministic: same pair ⇒ same diff', async () => {
    const a = await createFixtureSpec();
    const b = await createTaskSpec({ ...validSpecInput(), version: '2.0.0' });
    expect(diffTaskSpecs(a, b)).toEqual(diffTaskSpecs(a, b));
  });

  it('diffing different logical tasks is a typed error', async () => {
    const a = await createFixtureSpec();
    const b = await createTaskSpec({
      ...validSpecInput(),
      identity: { tenant: 'tenant-alpha', taskId: 'task-other' },
    });
    expect(() => diffTaskSpecs(a, b)).toThrowError(
      expect.objectContaining({ code: TASK_SPEC_ERROR_CODES.INVALID_DIFF }),
    );
  });

  it('diffing a version with itself is a typed error', async () => {
    const a = await createFixtureSpec();
    expect(() => diffTaskSpecs(a, a)).toThrowError(
      expect.objectContaining({ code: TASK_SPEC_ERROR_CODES.INVALID_DIFF }),
    );
  });

  it('a version bump with no content change diffs as version-only', async () => {
    const a = await createFixtureSpec();
    const b = await createTaskSpec({ ...validSpecInput(), version: '1.0.1' });
    const diff = diffTaskSpecs(a, b);
    expect(diff.changedFields).toEqual(['version']);
    expect(isIdentityOnlyDiff(diff)).toBe(true);
  });

  it('arrays diff atomically (documented limitation)', async () => {
    const a = await createFixtureSpec();
    const b = await createTaskSpec({
      ...validSpecInput(),
      version: '1.1.0',
      objectives: [...validSpecInput().objectives, 'a third objective'],
    });
    const diff = diffTaskSpecs(a, b);
    expect(diff.changedFields).toContain('objectives');
    expect(diff.changedFields).not.toContain('objectives.2');
  });
});

describe('compareTaskVersions (semver precedence)', () => {
  it('orders core versions numerically', () => {
    expect(compareTaskVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareTaskVersions('2.0.0', '1.999.999')).toBeGreaterThan(0);
    expect(compareTaskVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('prerelease < release; prerelease identifiers compare per semver 2.0.0', () => {
    expect(compareTaskVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
    expect(compareTaskVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    expect(compareTaskVersions('1.0.0-2', '1.0.0-10')).toBeLessThan(0);
    expect(compareTaskVersions('1.0.0-alpha.1', '1.0.0-alpha')).toBeGreaterThan(0);
  });
});
