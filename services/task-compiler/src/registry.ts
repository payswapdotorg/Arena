/**
 * TaskSpecRegistry — the in-process, append-only spec PINNING store (Work
 * Order A008; architecture-lock rules 5, 6, 18).
 *
 * A compiled TaskSpec is a PROPOSAL; pinning it here is the act that makes
 * it durable. The registry is deliberately tiny and in-process (house
 * style: no network, no database):
 *
 *   - append-only: there is NO removal or rewrite API (the hygiene suite
 *     asserts this); every pinned version stays addressable forever;
 *   - content-deduplicated: pinning the same (identity, version, digest)
 *     again is an idempotent no-op;
 *   - supersession by append: pinning DIFFERENT content for a task whose
 *     version slot is occupied never overwrites — the new content is
 *     pinned as the NEXT minor version with `supersedes` pointing at the
 *     current head (new version = new content-addressed object; the old
 *     one is never rewritten);
 *   - identity conflicts are impossible by construction: a version slot
 *     maps to exactly one digest at a time.
 */

import {
  compareTaskVersions,
  createTaskSpec,
  taskSpecContentView,
} from '@arena/task-spec';
import type { TaskSpec } from '@arena/task-spec';
import { taskVersionRefOf } from '@arena/task-spec';
import type { TaskVersionRef } from '@arena/task-spec';

/** The outcome of one pin operation. */
export interface PinOutcome {
  /** The spec as pinned (may be a superseding version of the input). */
  readonly spec: TaskSpec;
  /** True when a NEW version was appended. */
  readonly appended: boolean;
  /** The version the pinned spec supersedes (append-only supersession). */
  readonly superseded: TaskVersionRef | null;
}

function slotKey(spec: { identity: { tenant: string; taskId: string }; version: string }): string {
  return `${spec.identity.tenant}/${spec.identity.taskId}@${spec.version}`;
}

function taskKey(identity: { tenant: string; taskId: string }): string {
  return `${identity.tenant}/${identity.taskId}`;
}

/** Bump the minor segment of a semver core version. */
function bumpMinor(version: string): string {
  const core = version.split('-')[0] ?? '1.0.0';
  const [major, minor] = core.split('.');
  return `${major ?? '1'}.${(Number.parseInt(minor ?? '0', 10) ?? 0) + 1}.0`;
}

/**
 * The in-process append-only registry of pinned TaskSpecs. Construct with
 * `new TaskSpecRegistry()` (fresh) or pass pre-pinned specs.
 */
export class TaskSpecRegistry {
  private readonly bySlot = new Map<string, TaskSpec>();
  private readonly byTask = new Map<string, TaskSpec[]>();

  constructor(initial: readonly TaskSpec[] = []) {
    // Synchronous seeding: no re-versioning, no async — conflicting
    // content at one slot is a CONSTRUCTION error (never a silent
    // overwrite), same content is an idempotent skip.
    for (const spec of initial) {
      const slot = slotKey(spec);
      const existing = this.bySlot.get(slot);
      if (existing !== undefined) {
        if (existing.digest !== spec.digest) {
          throw new Error(
            `conflicting initial specs at ${slot}: ${existing.digest} vs ${spec.digest}`,
          );
        }
        continue;
      }
      this.bySlot.set(slot, spec);
      const versions = this.byTask.get(taskKey(spec.identity)) ?? [];
      versions.push(spec);
      this.byTask.set(taskKey(spec.identity), versions);
    }
  }

  /** All pinned specs, insertion-ordered. */
  list(): readonly TaskSpec[] {
    return [...this.bySlot.values()];
  }

  /** All pinned versions of one logical task, insertion-ordered. */
  listVersions(identity: { tenant: string; taskId: string }): readonly TaskSpec[] {
    return [...(this.byTask.get(taskKey(identity)) ?? [])];
  }

  /** The pinned spec at an exact (identity, version) slot, or null. */
  get(identity: { tenant: string; taskId: string }, version: string): TaskSpec | null {
    return this.bySlot.get(`${taskKey(identity)}@${version}`) ?? null;
  }

  /**
   * Pin one spec proposal. Idempotent by content; different content for an
   * occupied slot is pinned as a superseding NEXT MINOR version (append-
   * only — the occupied spec is never rewritten).
   */
  async pin(spec: TaskSpec): Promise<PinOutcome> {
    return this.pinInternal(spec, { allowSupersede: true });
  }

  private async pinInternal(
    spec: TaskSpec,
    options: { allowSupersede: boolean },
  ): Promise<PinOutcome> {
    let current = spec;
    let appended = false;
    let superseded: TaskVersionRef | null = null;

    for (;;) {
      const existing = this.bySlot.get(slotKey(current));
      if (existing === undefined) {
        this.bySlot.set(slotKey(current), current);
        const versions = this.byTask.get(taskKey(current.identity)) ?? [];
        versions.push(current);
        this.byTask.set(taskKey(current.identity), versions);
        appended = true;
        break;
      }
      if (existing.digest === current.digest) {
        current = existing;
        break;
      }
      if (!options.allowSupersede) {
        // Initial seeding with conflicting content at one slot is a
        // construction error, never a silent overwrite.
        throw new Error(
          `conflicting initial specs at ${slotKey(current)}: ${existing.digest} vs ${current.digest}`,
        );
      }
      // Supersession by append: the new content replaces the task's HEAD
      // as the next minor version, pointing back at it.
      const head = this.latestOf(current.identity);
      const nextVersion = bumpMinor(head.version);
      superseded = taskVersionRefOf(head);
      current = await createTaskSpec({
        ...taskSpecContentView(current),
        version: nextVersion,
        supersedes: superseded,
      } as never);
    }

    return { spec: current, appended, superseded };
  }

  /** The highest-precedence pinned version of a task. */
  latestOf(identity: { tenant: string; taskId: string }): TaskSpec {
    const versions = this.byTask.get(taskKey(identity)) ?? [];
    if (versions.length === 0) {
      throw new Error(`no pinned versions for ${taskKey(identity)}`);
    }
    let latest = versions[0] as TaskSpec;
    for (const spec of versions.slice(1)) {
      if (compareTaskVersions(spec.version, latest.version) > 0) latest = spec;
    }
    return latest;
  }
}
