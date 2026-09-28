/**
 * Public-view derivation tests (Work Order A006 gate 6 privacy half;
 * architecture-lock rules 11, 23) — the derived public view strips
 * tenant-internal-marked groups and can never leak them.
 */

import { describe, expect, it } from 'vitest';
import {  EXPERT_PUBLIC_VIEW_VERSION,
  assertPublicViewLeaksNothing,
  deriveExpertPublicView,
  isExpertPublicView,
} from './public-view.js';
import { EXPERT_ERROR_CODES } from './errors.js';
import { createExpertProfile } from './profile.js';
import { publishProfile, recordReliabilityOutcome, recordTaskHistory } from './lifecycle.js';
import { defaultExpertProfilePolicy } from './privacy-policy.js';
import { recomputeReliabilityMetrics } from './reliability.js';
import {
  AT,
  AT_LATER,
  DECLARER,
  DIGEST_D,
  RECORDER,
  validProfileInput,
  expectThrowsCode,
} from './test-support.js';

async function profileWithHistory() {
  let profile = await createExpertProfile(validProfileInput());
  profile = await recordTaskHistory(profile, {
    at: AT_LATER,
    actor: DECLARER,
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
  profile = await recordReliabilityOutcome(profile, {
    at: AT_LATER,
    actor: DECLARER,
    entry: { kind: 'task-completed', occurredAt: AT_LATER, recordedBy: RECORDER },
  });
  return profile;
}

describe('deriveExpertPublicView (positive)', () => {
  it('derives a frozen view carrying the public-marked groups unchanged', async () => {
    const profile = await profileWithHistory();
    const view = deriveExpertPublicView(profile, { derivedAt: AT_LATER });
    expect(view.viewVersion).toBe(EXPERT_PUBLIC_VIEW_VERSION);
    expect(view.tenant).toBe('tenant-a');
    expect(view.expertId).toBe('expert-invoice-reconciliation');
    expect(view.version).toBe(profile.version);
    expect(view.status).toBe(profile.status);
    expect(view.sourceDigest).toBe(profile.digest);
    expect(view.competencies).toEqual(profile.competencies);
    expect(view.qualifications).toEqual(profile.qualifications);
    expect(view.availability).toEqual(profile.availability);
    expect(view.domainScope).toEqual(profile.domainScope);
    expect(Object.isFrozen(view)).toBe(true);
    expect(isExpertPublicView(view)).toBe(true);
  });

  it('default policy: measurement/identity internals are stripped (absent, not emptied)', async () => {
    const profile = await profileWithHistory();
    const view = deriveExpertPublicView(profile, { derivedAt: AT_LATER });
    const record = view as unknown as Record<string, unknown>;
    expect(record['reliability']).toBeUndefined();
    expect(record['taskHistory']).toBeUndefined();
    expect(record['evidence']).toBeUndefined();
    expect(record['identityRefs']).toBeUndefined();
    expect(record['lifecycle']).toBeUndefined();
    expect(() => assertPublicViewLeaksNothing(view, profile)).not.toThrow();
  });

  it('an all-public policy carries even measurement data into the view', async () => {
    const open = await createExpertProfile({
      ...validProfileInput(),
      privacyPolicy: {
        visibility: {
          identityRefs: 'public',
          competencies: 'public',
          qualifications: 'public',
          evidence: 'public',
          taskHistory: 'public',
          reliability: 'public',
          availability: 'public',
          domainScope: 'public',
        },
      },
    });
    const view = deriveExpertPublicView(open, { derivedAt: AT_LATER });
    expect(view.identityRefs).toEqual(open.identityRefs);
    expect(() => assertPublicViewLeaksNothing(view, open)).not.toThrow();
    expect(defaultExpertProfilePolicy().visibility.reliability).toBe('tenant-internal');
  });

  it('the view is reproducible from the source digest (derivation is pure)', async () => {
    const profile = await profileWithHistory();
    const first = deriveExpertPublicView(profile, { derivedAt: AT_LATER });
    const second = deriveExpertPublicView(profile, { derivedAt: AT_LATER });
    expect(first).toEqual(second);
  });
});

describe('deriveExpertPublicView (negative — cannot leak)', () => {
  it('policy-marked private groups cannot leak through the derivation', async () => {
    const profile = await profileWithHistory();
    const view = deriveExpertPublicView(profile, { derivedAt: AT_LATER });
    // The profile HAS task history and reliability events…
    expect(profile.taskHistory).toHaveLength(1);
    expect(profile.reliability).toHaveLength(1);
    // …the derived view cannot carry them (policy marks them tenant-internal).
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('task-invoice-close-42');
    expect(serialized).not.toContain('task-completed');
    expect(serialized).not.toContain('registry-orchestrator');
    // The reliability content is not even partially present.
    const metrics = recomputeReliabilityMetrics(profile.reliability);
    expect(metrics.tasksCompleted).toBe(1);
    expect(serialized).not.toContain('"tasksCompleted"');
  });

  it('identity attestations (declared identity refs) stay tenant-internal by default', async () => {
    const profile = await profileWithHistory();
    const view = deriveExpertPublicView(profile, { derivedAt: AT_LATER });
    const serialized = JSON.stringify(view);
    expect(profile.identityRefs[0]!.locator).toBe('did:arena:expert:01');
    expect(serialized).not.toContain('did:arena:expert:01');
    expect(serialized).not.toContain('identity-attestation');
  });

  it('the derived view is immutable — mutation cannot inject internals', async () => {
    const profile = await profileWithHistory();
    const view = deriveExpertPublicView(profile, { derivedAt: AT_LATER });
    expect(() => {
      (view as unknown as Record<string, unknown>)['reliability'] = profile.reliability;
    }).toThrow(TypeError);
  });

  it('rejects derivation from non-profiles and bad timestamps', async () => {
    expectThrowsCode(
      () => deriveExpertPublicView(null as never, { derivedAt: AT }),
      EXPERT_ERROR_CODES.INVALID_PUBLIC_VIEW,
    );
    const profile = await profileWithHistory();
    expect(() =>
      deriveExpertPublicView(profile, { derivedAt: 'not-a-time' }),
    ).toThrow(/timestamp/);
  });

  it('the leak tripwire fires on hand-crafted views (negative control)', async () => {
    const profile = await profileWithHistory();
    const view = deriveExpertPublicView(profile, { derivedAt: AT_LATER });
    const leaky = { ...view, reliability: profile.reliability } as unknown as typeof view;
    expect(() => assertPublicViewLeaksNothing(leaky, profile)).toThrow(
      /structurally non-public groups/,
    );
    const leaky2 = {
      ...view,
      domainScope: undefined,
    } as unknown as typeof view;
    expect(() => assertPublicViewLeaksNothing(leaky2, profile)).not.toThrow();
    // A view that carries a policy-private group (impossible via derive, but
    // the tripwire must catch it if hand-crafted).
    const privatePolicyProfile = await createExpertProfile({
      ...validProfileInput(),
      privacyPolicy: {
        visibility: {
          ...defaultExpertProfilePolicy().visibility,
          competencies: 'tenant-internal',
        },
      },
    });
    const leaky3 = {
      ...deriveExpertPublicView(privatePolicyProfile, { derivedAt: AT_LATER }),
      competencies: privatePolicyProfile.competencies,
    } as ReturnType<typeof deriveExpertPublicView>;
    expect(() => assertPublicViewLeaksNothing(leaky3, privatePolicyProfile)).toThrow(
      /leaks tenant-internal groups/,
    );
  });

  it('published profiles derive public views with their status', async () => {
    const published = await publishProfile(
      await createExpertProfile(validProfileInput()),
      { at: AT_LATER, actor: DECLARER },
    );
    const view = deriveExpertPublicView(published, { derivedAt: AT_LATER });
    expect(view.status).toBe('published');
    expect(view.sourceDigest).toBe(published.digest);
    expect(isExpertPublicView({ viewVersion: 1 })).toBe(false);
  });
});
