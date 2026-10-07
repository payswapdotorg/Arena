/**
 * DemandProfile compiler unit tests (Work Order C002) — determinism,
 * graph resolution (need path, required capabilities, required tools),
 * typed closed outcomes and tamper detection.
 */

import { describe, expect, it } from 'vitest';
import {
  compileDemandProfile,
  recomputeDemandProfileDigest,
  demandProfileView,
} from './demand-profile.js';
import {
  buildFixtureGraph,
  fixtureDemandInput,
  fixtureNodeRef,
  FIXTURE_EVALUATED_AT,
} from './test-support.js';

describe('demand compiler — compilation over the capability graph', () => {
  it('compiles the capability need into competency + tool refs', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(fixtureDemandInput(), graph, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(result.outcome).toBe('compilable');
    if (result.outcome !== 'compilable') return;
    const profile = result.profile;
    expect(profile.domainRef).toBeDefined();
    expect(profile.domainRef?.id).toBe('construction');
    const competencyKeys = profile.requiredCompetencyRefs.map((ref) => `${ref.kind}/${ref.id}`);
    expect(competencyKeys).toContain('capability/quantity-surveying');
    expect(competencyKeys).toContain('sub-capability/boq-verification');
    expect(competencyKeys).toContain('skill/boq-assumption-check');
    expect(competencyKeys.sort()).toEqual([...competencyKeys].sort());
    const toolKeys = profile.requiredToolRefs.map((ref) => `${ref.kind}/${ref.id}`);
    expect(toolKeys).toEqual(['tool/local-rate-database']);
    expect(profile.locales).toEqual(['en']);
    expect(profile.budget.amountMinorUnits).toBe(50000);
    expect(profile.deadlineMs).toBe(Date.parse('2026-10-07T18:00:00.000Z'));
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it('carries the resolved node digests (content-addressed refs)', async () => {
    const graph = await buildFixtureGraph();
    const skillRef = await fixtureNodeRef(graph, 'skill', 'boq-assumption-check');
    const result = await compileDemandProfile(fixtureDemandInput(), graph, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(result.outcome).toBe('compilable');
    if (result.outcome !== 'compilable') return;
    const match = result.profile.requiredCompetencyRefs.find((ref) => ref.id === 'boq-assumption-check');
    expect(match?.digest).toBe(skillRef.digest);
  });

  it('is deterministic — identical inputs compile to identical digests', async () => {
    const graph = await buildFixtureGraph();
    const first = await compileDemandProfile(fixtureDemandInput(), graph, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    const second = await compileDemandProfile(fixtureDemandInput(), graph, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(first.outcome).toBe('compilable');
    expect(second.outcome).toBe('compilable');
    if (first.outcome !== 'compilable' || second.outcome !== 'compilable') return;
    expect(second.profile.digest).toBe(first.profile.digest);
  });

  it('preferred locales are appended after the request locale, deduplicated', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(
      fixtureDemandInput({ preferredLocales: ['en', 'fr'] }),
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(result.outcome).toBe('compilable');
    if (result.outcome !== 'compilable') return;
    expect(result.profile.locales).toEqual(['en', 'fr']);
  });

  it('parses jurisdiction strings into typed views', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(
      fixtureDemandInput({ jurisdictions: ['GH', 'FR-IDF'] }),
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(result.outcome).toBe('compilable');
    if (result.outcome !== 'compilable') return;
    expect(result.profile.jurisdictions).toEqual([
      { jurisdictionVersion: 1, country: 'GH' },
      { jurisdictionVersion: 1, country: 'FR', region: 'IDF' },
    ]);
  });
});

describe('demand compiler — typed closed outcomes (never a bare boolean)', () => {
  it('under-specified: an unresolved capability need carries the reason and the input', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(
      fixtureDemandInput({ capabilityNeed: 'medicine.surgery' }),
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(result.outcome).toBe('under-specified');
    if (result.outcome !== 'under-specified') return;
    expect(result.reasons).toContain('capability-need-unresolved');
    expect(result.unresolved).toContain('medicine.surgery');
  });

  it('under-specified: a mid-path miss is reported (not silently truncated)', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(
      fixtureDemandInput({ capabilityNeed: 'construction.quantity-surveying.plumbing' }),
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(result.outcome).toBe('under-specified');
    if (result.outcome !== 'under-specified') return;
    expect(result.reasons).toContain('capability-need-unresolved');
  });

  it('under-specified: an unresolved required capability is reported', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(
      fixtureDemandInput({ requiredCapabilities: ['construction.quantity-surveying', 'legal.contract-review'] }),
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(result.outcome).toBe('under-specified');
    if (result.outcome !== 'under-specified') return;
    expect(result.reasons).toContain('required-capability-unresolved');
    expect(result.unresolved).toContain('legal.contract-review');
  });

  it('under-specified: malformed jurisdictions, budget and deadline are closed reasons', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(
      fixtureDemandInput({
        jurisdictions: ['Ghana'],
        budget: { amountMinorUnits: -1, currency: 'USD' },
        deadline: 'not-a-date',
      }),
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(result.outcome).toBe('under-specified');
    if (result.outcome !== 'under-specified') return;
    expect(result.reasons).toContain('jurisdiction-malformed');
    expect(result.reasons).toContain('budget-malformed');
    expect(result.reasons).toContain('deadline-malformed');
  });

  it('under-specified: a missing required-capabilities list is a closed reason', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(
      fixtureDemandInput({ requiredCapabilities: [] }),
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(result.outcome).toBe('under-specified');
    if (result.outcome !== 'under-specified') return;
    expect(result.reasons).toContain('required-capabilities-missing');
  });

  it('not-derivable: a non-graph input is a closed reason', async () => {
    const result = await compileDemandProfile(fixtureDemandInput(), {} as never, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(result.outcome).toBe('not-derivable');
    if (result.outcome !== 'not-derivable') return;
    expect(result.reason).toBe('graph-missing');
  });
});

describe('demand compiler — integrity', () => {
  it('recomputes the profile digest and detects tampering', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(fixtureDemandInput(), graph, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(result.outcome).toBe('compilable');
    if (result.outcome !== 'compilable') return;
    await expect(recomputeDemandProfileDigest(result.profile)).resolves.toBe(result.profile.digest);
    const tampered = { ...result.profile, budget: { amountMinorUnits: 1, currency: 'EUR' } };
    await expect(recomputeDemandProfileDigest(tampered)).rejects.toThrow(/digest mismatch/);
  });

  it('the digest commits to the digest-free view', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(fixtureDemandInput(), graph, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(result.outcome).toBe('compilable');
    if (result.outcome !== 'compilable') return;
    expect(demandProfileView(result.profile).capabilityNeed).toBe('construction.quantity-surveying.boq-verification');
    const view = demandProfileView(result.profile) as unknown as Record<string, unknown>;
    expect(view['digest']).toBeUndefined();
  });
});
