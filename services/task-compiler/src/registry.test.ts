/**
 * Registry suite (Work Order A008) — append-only pinning, content dedup,
 * supersession by append.
 */

import { describe, expect, it } from 'vitest';
import { createFixtureSpecs } from './registry-fixtures.js';
import { TaskSpecRegistry } from './registry.js';
import { resolveTaskIdentity, diffTaskSpecs } from '@arena/task-spec';

describe('TaskSpecRegistry', () => {
  it('pins a new spec at its own version', async () => {
    const [spec] = await createFixtureSpecs();
    const registry = new TaskSpecRegistry();
    const outcome = await registry.pin(spec);
    expect(outcome.appended).toBe(true);
    expect(outcome.superseded).toBeNull();
    expect(registry.get({ tenant: 'tenant-alpha', taskId: spec.identity.taskId }, '1.0.0')).toBe(
      spec,
    );
  });

  it('re-pinning the same content is an idempotent no-op', async () => {
    const [spec] = await createFixtureSpecs();
    const registry = new TaskSpecRegistry();
    await registry.pin(spec);
    const outcome = await registry.pin(spec);
    expect(outcome.appended).toBe(false);
    expect(outcome.spec.digest).toBe(spec.digest);
    expect(registry.list()).toHaveLength(1);
  });

  it('different content at an occupied slot is pinned as a SUPERSEDING version (append-only)', async () => {
    const [first, second] = await createFixtureSpecs();
    const registry = new TaskSpecRegistry();
    await registry.pin(first);
    const outcome = await registry.pin(second);
    expect(outcome.appended).toBe(true);
    expect(outcome.spec.version).toBe('1.1.0');
    expect(outcome.superseded?.version).toBe('1.0.0');
    expect(outcome.superseded?.digest).toBe(first.digest);
    // BOTH versions stay pinned and addressable (never rewritten):
    expect(registry.list()).toHaveLength(2);
    expect(registry.get({ tenant: 'tenant-alpha', taskId: first.identity.taskId }, '1.0.0')).toBe(
      first,
    );
    // The superseding spec carries the supersedes ref:
    expect(outcome.spec.supersedes?.digest).toBe(first.digest);
    // Resolution picks the new head:
    const latest = resolveTaskIdentity(registry.list(), {
      tenant: 'tenant-alpha',
      taskId: first.identity.taskId,
    });
    expect(latest.version).toBe('1.1.0');
    // The diff between them is content + version + supersedes:
    const diff = diffTaskSpecs(first, outcome.spec);
    expect(diff.changedFields).toContain('instructions');
    expect(diff.changedFields).toContain('version');
  });

  it('a third distinct content bumps to 1.2.0 (monotone append)', async () => {
    const [first, second, third] = await createFixtureSpecs();
    const registry = new TaskSpecRegistry();
    await registry.pin(first);
    await registry.pin(second);
    const outcome = await registry.pin(third);
    expect(outcome.spec.version).toBe('1.2.0');
    expect(outcome.superseded?.version).toBe('1.1.0');
    expect(registry.listVersions({ tenant: 'tenant-alpha', taskId: first.identity.taskId })).toHaveLength(3);
  });

  it('conflicting INITIAL seeding is a construction error, never a silent overwrite', async () => {
    const [first, second] = await createFixtureSpecs();
    expect(() => new TaskSpecRegistry([first, second])).toThrow(/conflicting initial specs/);
  });

  it('seeding with the same content is fine', async () => {
    const [first] = await createFixtureSpecs();
    const registry = new TaskSpecRegistry([first, first]);
    expect(registry.list()).toHaveLength(1);
  });
});
