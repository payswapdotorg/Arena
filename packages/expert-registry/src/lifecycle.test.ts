/**
 * Lifecycle tests (Work Order A006 gate 5) — DRAFT → PUBLISHED →
 * SUSPENDED → RETIRED with terminal finality, append-only event history,
 * supersession, and the append-only growth APIs (evidence, task history,
 * reliability).
 */

import { describe, expect, it } from 'vitest';
import { toPrincipalRefView } from './shared.js';
import {
  EXPERT_LIFECYCLE_EVENT_KINDS,
  EXPERT_LIFECYCLE_EVENT_VERSION,
  EXPERT_STATUSES,
  EXPERT_TERMINAL_STATUSES,
  attachExpertEvidence,
  assertProfileHistoryAppendOnly,
  isExpertStatus,
  isTerminalProfile,
  makeProfileCreatedEvent,
  publishProfile,
  recordReliabilityOutcome,
  recordTaskHistory,
  reinstateProfile,
  retireProfile,
  supersedeProfile,
  suspendProfile,
  toExpertStatus,
  } from './lifecycle.js';
import { EXPERT_ERROR_CODES,
  ExpertRegistryError } from './errors.js';
import { createExpertProfile } from './profile.js';
import { recomputeReliabilityMetrics } from './reliability.js';
import {
  AT,
  AT_EVEN_LATER,
  AT_LATER,
  DECLARER,
  DIGEST_D,
  expectRejectsCode,
  RECORDER,
  validProfileInput,
} from './test-support.js';
import { expertVersionRef } from './profile.js';

const ACTOR = toPrincipalRefView(DECLARER);

async function draft() {
  return createExpertProfile(validProfileInput());
}

describe('lifecycle vocabulary (positive)', () => {
  it('the closed status set is exactly DRAFT → PUBLISHED → SUSPENDED → RETIRED', () => {
    expect(EXPERT_STATUSES).toEqual(['draft', 'published', 'suspended', 'retired']);
    expect(EXPERT_TERMINAL_STATUSES).toEqual(['retired']);
    expect(isExpertStatus('draft')).toBe(true);
    expect(isExpertStatus('archived')).toBe(false);
    expect(toExpertStatus('retired')).toBe('retired');
    expect(() => toExpertStatus('gone')).toThrow(/unknown expert profile status/);
  });

  it('the closed event kind set covers the full append-only surface', () => {
    expect(EXPERT_LIFECYCLE_EVENT_KINDS).toEqual([
      'profile-created',
      'profile-published',
      'profile-suspended',
      'profile-reinstated',
      'profile-retired',
      'profile-superseded',
      'evidence-attached',
      'task-recorded',
      'reliability-recorded',
    ]);
    expect(EXPERT_LIFECYCLE_EVENT_VERSION).toBe(1);
  });

  it('makeProfileCreatedEvent pins sequence 1 and draft → draft', () => {
    const event = makeProfileCreatedEvent({
      sequence: 1,
      occurredAt: AT,
      actor: ACTOR,
      expertIdentity: { tenant: 'tenant-a', expertId: 'expert-x' } as never,
    });
    expect(event.kind).toBe('profile-created');
    expect(event.fromStatus).toBe('draft');
    expect(event.toStatus).toBe('draft');
    expect(() =>
      makeProfileCreatedEvent({
        sequence: 2,
        occurredAt: AT,
        actor: ACTOR,
        expertIdentity: { tenant: 'tenant-a', expertId: 'expert-x' } as never,
      }),
    ).toThrow(/sequence 1/);
  });
});

describe('lifecycle transitions (positive — the gate 5 chain)', () => {
  it('publish: DRAFT → PUBLISHED appends an event and changes the digest', async () => {
    const before = await draft();
    const published = await publishProfile(before, { at: AT_LATER, actor: ACTOR });
    expect(published.status).toBe('published');
    expect(published.lifecycle).toHaveLength(2);
    expect(published.lifecycle[1]!.kind).toBe('profile-published');
    expect(published.lifecycle[1]!.fromStatus).toBe('draft');
    expect(published.lifecycle[1]!.toStatus).toBe('published');
    expect(published.digest).not.toBe(before.digest);
    expect(before.status).toBe('draft'); // purity: input untouched
    expect(Object.isFrozen(published)).toBe(true);
  });

  it('suspend and reinstate: PUBLISHED ⇄ SUSPENDED', async () => {
    const published = await publishProfile(await draft(), { at: AT_LATER, actor: ACTOR });
    const suspended = await suspendProfile(published, { at: AT_EVEN_LATER, actor: ACTOR });
    expect(suspended.status).toBe('suspended');
    const reinstated = await reinstateProfile(suspended, {
      at: AT_EVEN_LATER,
      actor: ACTOR,
    });
    expect(reinstated.status).toBe('published');
    expect(reinstated.lifecycle).toHaveLength(4);
  });

  it('retire: PUBLISHED → RETIRED and SUSPENDED → RETIRED (terminal finality)', async () => {
    const published = await publishProfile(await draft(), { at: AT_LATER, actor: ACTOR });
    const retired = await retireProfile(published, {
      at: AT_EVEN_LATER,
      actor: ACTOR,
      note: 'Expert left the program.',
    });
    expect(retired.status).toBe('retired');
    expect(isTerminalProfile(retired)).toBe(true);
    expect(retired.lifecycle[retired.lifecycle.length - 1]!.kind).toBe('profile-retired');

    const suspended = await suspendProfile(published, { at: AT_LATER, actor: ACTOR });
    const retiredFromSuspended = await retireProfile(suspended, {
      at: AT_EVEN_LATER,
      actor: ACTOR,
      note: 'Suspended then retired.',
    });
    expect(retiredFromSuspended.status).toBe('retired');
  });

  it('every transition preserves the history prefix verbatim (append-only)', async () => {
    const before = await draft();
    const published = await publishProfile(before, { at: AT_LATER, actor: ACTOR });
    expect(() => assertProfileHistoryAppendOnly(before, published)).not.toThrow();
    const suspended = await suspendProfile(published, { at: AT_EVEN_LATER, actor: ACTOR });
    expect(() => assertProfileHistoryAppendOnly(published, suspended)).not.toThrow();
  });
});

describe('lifecycle transitions (negative — invalid sources and terminal finality)', () => {
  it('rejects transitions from wrong source states', async () => {
    const draftProfile = await draft();
    await expect(
      suspendProfile(draftProfile, { at: AT_LATER, actor: ACTOR }),
    ).rejects.toThrow(/cannot transition from draft/);
    await expect(
      reinstateProfile(draftProfile, { at: AT_LATER, actor: ACTOR }),
    ).rejects.toThrow(ExpertRegistryError);
    const published = await publishProfile(draftProfile, { at: AT_LATER, actor: ACTOR });
    await expect(
      publishProfile(published, { at: AT_EVEN_LATER, actor: ACTOR }),
    ).rejects.toThrow(/expected source state draft/);
    await expect(
      retireProfile(draftProfile, { at: AT_LATER, actor: ACTOR, note: 'x' }),
    ).rejects.toThrow(/cannot retire from draft/);
  });

  it('terminal states are FINAL: every lifecycle operation throws', async () => {
    const published = await publishProfile(await draft(), { at: AT_LATER, actor: ACTOR });
    const retired = await retireProfile(published, {
      at: AT_EVEN_LATER,
      actor: ACTOR,
      note: 'Done.',
    });
    await expectRejectsCode(
      () => publishProfile(retired, { at: AT_EVEN_LATER, actor: ACTOR }),
      EXPERT_ERROR_CODES.TERMINAL_STATE,
    );
    await expect(
      suspendProfile(retired, { at: AT_EVEN_LATER, actor: ACTOR }),
    ).rejects.toThrow(/terminal states are final/);
    await expect(
      retireProfile(retired, { at: AT_EVEN_LATER, actor: ACTOR, note: 'x' }),
    ).rejects.toThrow(ExpertRegistryError);
    await expectRejectsCode(
      () =>
        supersedeProfile(retired, {
          at: AT_EVEN_LATER,
          actor: ACTOR,
          superseding: {
            tenant: 'tenant-a',
            expertId: 'expert-invoice-reconciliation',
            version: '2.0.0',
            digest: 'f'.repeat(64),
          },
        }),
      EXPERT_ERROR_CODES.TERMINAL_STATE,
    );
    await expectRejectsCode(
      () =>
        attachExpertEvidence(retired, {
          at: AT_EVEN_LATER,
          actor: ACTOR,
          evidence: [{ digest: DIGEST_D, description: 'late evidence' }],
        }),
      EXPERT_ERROR_CODES.TERMINAL_STATE,
    );
  });

  it('retirement requires a non-empty rationale note', async () => {
    const published = await publishProfile(await draft(), { at: AT_LATER, actor: ACTOR });
    await expect(
      retireProfile(published, { at: AT_EVEN_LATER, actor: ACTOR, note: '' }),
    ).rejects.toThrow(/non-empty rationale note/);
  });

  it('rejects cross-tenant actors (lock rule 11)', async () => {
    const rogue = { type: 'user', tenant: 'tenant-b', principalId: 'rogue' };
    await expectRejectsCode(
      async () => publishProfile(await draft(), { at: AT_LATER, actor: rogue }),
      EXPERT_ERROR_CODES.CROSS_TENANT_ACCESS,
    );
  });
});

describe('supersession (gate 5 — new versions; old stays immutable+addressable)', () => {
  it('supersedeProfile marks the old state without changing its status', async () => {
    const published = await publishProfile(await draft(), { at: AT_LATER, actor: ACTOR });
    const supersedingRef = {
      tenant: 'tenant-a',
      expertId: 'expert-invoice-reconciliation',
      version: '2.0.0',
      digest: 'e'.repeat(64),
    };
    const superseded = await supersedeProfile(published, {
      at: AT_EVEN_LATER,
      actor: ACTOR,
      superseding: supersedingRef,
    });
    expect(superseded.status).toBe('published'); // status unchanged: version-level concern
    expect(superseded.supersededBy).toEqual(supersedingRef);
    expect(superseded.lifecycle[superseded.lifecycle.length - 1]!.kind).toBe(
      'profile-superseded',
    );
    // The OLD state stays immutable and addressable by ITS digest.
    expect(published.supersededBy).toBeUndefined();
    expect(published.digest).not.toBe(superseded.digest);
  });

  it('a superseded-marked version cannot be superseded twice', async () => {
    const published = await publishProfile(await draft(), { at: AT_LATER, actor: ACTOR });
    const superseded = await supersedeProfile(published, {
      at: AT_EVEN_LATER,
      actor: ACTOR,
      superseding: {
        tenant: 'tenant-a',
        expertId: 'expert-invoice-reconciliation',
        version: '2.0.0',
        digest: 'e'.repeat(64),
      },
    });
    await expect(
      supersedeProfile(superseded, {
        at: AT_EVEN_LATER,
        actor: ACTOR,
        superseding: {
          tenant: 'tenant-a',
          expertId: 'expert-invoice-reconciliation',
          version: '3.0.0',
          digest: 'd'.repeat(64),
        },
      }),
    ).rejects.toThrow(/already superseded/);
  });

  it('rejects cross-expert, same-version and same-digest supersession', async () => {
    const published = await publishProfile(await draft(), { at: AT_LATER, actor: ACTOR });
    await expect(
      supersedeProfile(published, {
        at: AT_EVEN_LATER,
        actor: ACTOR,
        superseding: {
          tenant: 'tenant-a',
          expertId: 'expert-someone-else',
          version: '2.0.0',
          digest: 'e'.repeat(64),
        },
      }),
    ).rejects.toThrow(/one logical expert/);
    await expect(
      supersedeProfile(published, {
        at: AT_EVEN_LATER,
        actor: ACTOR,
        superseding: { ...expertVersionRef(published) },
      }),
    ).rejects.toThrow(/same version/);
    await expect(
      supersedeProfile(published, {
        at: AT_EVEN_LATER,
        actor: ACTOR,
        superseding: {
          tenant: 'tenant-a',
          expertId: 'expert-invoice-reconciliation',
          version: '2.0.0',
          digest: published.digest,
        },
      }),
    ).rejects.toThrow(/DIFFERENT content state/);
  });

  it('the full supersession flow: new version created, old marked, both addressable', async () => {
    const v1Draft = await draft();
    const v1Published = await publishProfile(v1Draft, { at: AT_LATER, actor: ACTOR });
    const v2 = await createExpertProfile({
      ...validProfileInput(),
      version: '2.0.0',
      supersedes: expertVersionRef(v1Published),
      declaredAt: AT_EVEN_LATER,
    });
    expect(v2.supersedes!.version).toBe('1.0.0');
    const v1Superseded = await supersedeProfile(v1Published, {
      at: AT_EVEN_LATER,
      actor: ACTOR,
      superseding: expertVersionRef(v2),
    });
    expect(v1Superseded.supersededBy!.digest).toBe(v2.digest);
    // Both versions immutable and addressable.
    expect(v1Published.status).toBe('published');
    expect(v2.status).toBe('draft');
  });
});

describe('append-only growth APIs (lock rule 6)', () => {
  it('attachExpertEvidence appends without a status change; duplicates rejected', async () => {
    const profile = await draft();
    const grown = await attachExpertEvidence(profile, {
      at: AT_LATER,
      actor: ACTOR,
      evidence: [{ digest: DIGEST_D, description: 'Additional evidence.' }],
    });
    expect(grown.evidence).toHaveLength(2);
    expect(grown.status).toBe('draft');
    expect(grown.lifecycle[grown.lifecycle.length - 1]!.kind).toBe('evidence-attached');
    await expectRejectsCode(
      () =>
        attachExpertEvidence(grown, {
          at: AT_EVEN_LATER,
          actor: ACTOR,
          evidence: [{ digest: DIGEST_D, description: 'Duplicate.' }],
        }),
      EXPERT_ERROR_CODES.DUPLICATE_EVIDENCE,
    );
    await expect(
      attachExpertEvidence(profile, { at: AT_LATER, actor: ACTOR, evidence: [] }),
    ).rejects.toThrow(/at least one evidence reference/);
  });

  it('recordTaskHistory appends tenant-scoped record refs; cross-tenant rejected', async () => {
    const profile = await draft();
    const grown = await recordTaskHistory(profile, {
      at: AT_LATER,
      actor: ACTOR,
      records: [
        {
          kind: 'task-outcome',
          tenant: 'tenant-a',
          taskId: 'task-invoice-close-42',
          version: '1.0.0',
          digest: DIGEST_D,
          occurredAt: AT_LATER,
        },
      ],
    });
    expect(grown.taskHistory).toHaveLength(1);
    expect(grown.lifecycle[grown.lifecycle.length - 1]!.kind).toBe('task-recorded');
    await expect(
      recordTaskHistory(grown, {
        at: AT_EVEN_LATER,
        actor: ACTOR,
        records: [
          {
            kind: 'task-outcome',
            tenant: 'tenant-b',
            taskId: 'task-x',
            version: '1.0.0',
            digest: DIGEST_D,
            occurredAt: AT_EVEN_LATER,
          },
        ],
      }),
    ).rejects.toThrow(/profile's tenant/);
    await expect(
      recordTaskHistory(profile, { at: AT_LATER, actor: ACTOR, records: [] }),
    ).rejects.toThrow(/at least one task record ref/);
  });

  it('recordReliabilityOutcome appends ledger entries and derives counters (gate 7)', async () => {
    const profile = await draft();
    const one = await recordReliabilityOutcome(profile, {
      at: AT_LATER,
      actor: ACTOR,
      entry: { kind: 'task-completed', occurredAt: AT_LATER, recordedBy: RECORDER },
    });
    const two = await recordReliabilityOutcome(one, {
      at: AT_EVEN_LATER,
      actor: ACTOR,
      entry: { kind: 'no-response', occurredAt: AT_EVEN_LATER, recordedBy: RECORDER },
    });
    expect(two.reliability).toHaveLength(2);
    expect(two.reliability[1]!.sequence).toBe(2);
    expect(two.lifecycle[two.lifecycle.length - 1]!.kind).toBe('reliability-recorded');
    const metrics = recomputeReliabilityMetrics(two.reliability);
    expect(metrics.tasksCompleted).toBe(1);
    expect(metrics.noResponse).toBe(1);
    await expect(
      recordReliabilityOutcome(two, {
        at: AT_EVEN_LATER,
        actor: ACTOR,
        entry: {
          kind: 'task-failed',
          occurredAt: AT_EVEN_LATER,
          recordedBy: { type: 'service', tenant: 'tenant-b', principalId: 'rogue' },
        },
      }),
    ).rejects.toThrow(/own tenant principals/);
  });

  it('assertProfileHistoryAppendOnly rejects shrinks, rewrites and version jumps', async () => {
    const before = await draft();
    const after = await attachExpertEvidence(before, {
      at: AT_LATER,
      actor: ACTOR,
      evidence: [{ digest: DIGEST_D, description: 'More evidence.' }],
    });
    expect(() => assertProfileHistoryAppendOnly(after, before)).toThrow(
      /evidence removal detected/,
    );
    const v2 = await createExpertProfile({
      ...validProfileInput(),
      version: '2.0.0',
      declaredAt: AT_LATER,
    });
    expect(() => assertProfileHistoryAppendOnly(before, v2)).toThrow(
      /within one profile version/,
    );
    const foreign = await createExpertProfile({
      ...validProfileInput(),
      identity: { tenant: 'tenant-a', expertId: 'expert-different' },
    });
    expect(() => assertProfileHistoryAppendOnly(before, foreign)).toThrow(
      /within one logical expert/,
    );
  });
});
