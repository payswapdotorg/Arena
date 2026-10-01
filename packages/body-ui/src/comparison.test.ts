import { describe, expect, it } from 'vitest';

/**
 * The composition-scoped substrate comparison battery (Work Order B010;
 * issue #82) — THE core acceptance of this Work Order:
 *
 *   - POSITIVE: a comparison whose arms are full compositions sharing one
 *     pinned body version + identical environment semantics produces a
 *     per-composition table (never a ranking, never a winner);
 *   - NEGATIVE: a BARE substrate/model comparison request is a TYPED
 *     REJECTION (`BODY_UI_BARE_SUBSTRATE_COMPARISON`), as are mixed body
 *     versions, incomplete arms, insufficient arms and environment basis
 *     mismatches.
 */

import {
  buildSubstrateComparison,
  COMPARISON_SCOPE_CONTRACT,
  possessionRowsToComparisonArms,
  SUBSTRATE_COMPARISON_REJECTION_CODES,
} from './index.js';

function arm(overrides: {
  readonly armId: string;
  readonly bodyVersion?: { readonly bodyId: string; readonly version: string };
  readonly substrate?: string;
  readonly runtime?: string;
  readonly environment?: string;
  readonly possessionId?: string;
  readonly verdict?: string;
  readonly reasons?: readonly string[];
}) {
  return {
    armId: overrides.armId,
    bodyVersion: overrides.bodyVersion,
    substrate: overrides.substrate,
    runtime: overrides.runtime,
    environment: overrides.environment,
    possessionId: overrides.possessionId,
    evidence: {
      verdict: overrides.verdict,
      reasons: overrides.reasons ?? [],
    },
  };
}

const PINNED = { bodyId: 'body-software-engineer', version: '1.1.0' } as const;

describe('substrate comparison — composition-scoped successes (positive)', () => {
  it('compares full compositions sharing one pinned body version (positive)', () => {
    const outcome = buildSubstrateComparison({
      basis: { suite: 'suite-software-engineer-evaluation', environment: 'sandboxed-workspace' },
      arms: [
        arm({
          armId: 'possession-a',
          bodyVersion: { bodyId: PINNED.bodyId, version: PINNED.version },
          substrate: 'substrate-alpha',
          runtime: 'runtime-1',
          environment: 'sandboxed-workspace',
          possessionId: 'possession-a',
          verdict: 'pass',
          reasons: ['suite green'],
        }),
        arm({
          armId: 'possession-b',
          bodyVersion: { bodyId: PINNED.bodyId, version: PINNED.version },
          substrate: 'substrate-beta',
          runtime: 'runtime-2',
          environment: 'sandboxed-workspace',
          possessionId: 'possession-b',
          verdict: 'unknown',
        }),
      ],
    });
    expect(outcome.kind).not.toBe('rejected');
    if (outcome.kind === 'rejected') return;
    expect(outcome.kind).toBe('substrate-within-composition');
    expect(outcome.basis.suite).toBe('suite-software-engineer-evaluation');
    expect(outcome.suiteUnknown).toBe(false);
    expect(outcome.rows).toHaveLength(2);
    expect(outcome.rows[0]?.substrate).toBe('substrate-alpha');
    expect(outcome.rows[1]?.substrate).toBe('substrate-beta');
    // Every row pins the SAME body version — the comparison scope.
    for (const row of outcome.rows) {
      expect(row.bodyVersion).toEqual(PINNED);
      expect(row.claimScopeNote).toContain('never about the substrate in isolation');
    }
    // Evidence is carried verbatim — including an honest unknown verdict.
    expect(outcome.rows[0]?.evidence.verdict).toBe('pass');
    expect(outcome.rows[1]?.evidence.verdict).toBe('unknown');
  });

  it('never ranks, scores or names a winner (negative — structural)', () => {
    const outcome = buildSubstrateComparison({
      basis: { suite: 's', environment: 'e' },
      arms: [
        arm({ armId: 'a', bodyVersion: { bodyId: 'b', version: '1' }, substrate: 's1', environment: 'e', verdict: 'pass' }),
        arm({ armId: 'b', bodyVersion: { bodyId: 'b', version: '1' }, substrate: 's2', environment: 'e', verdict: 'fail' }),
      ],
    });
    if (outcome.kind === 'rejected') {
      expect.unreachable('valid comparison must not be rejected');
      return;
    }
    const serialized = JSON.stringify(outcome);
    for (const forbidden of ['rank', 'winner', 'score', 'best', 'leaderboard']) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
  });

  it('marks an unknown shared suite as unknown — never fabricated (negative)', () => {
    const outcome = buildSubstrateComparison({
      basis: { suite: undefined, environment: 'e' },
      arms: [
        arm({ armId: 'a', bodyVersion: { bodyId: 'b', version: '1' }, substrate: 's1', environment: 'e' }),
        arm({ armId: 'b', bodyVersion: { bodyId: 'b', version: '1' }, substrate: 's2', environment: 'e' }),
      ],
    });
    if (outcome.kind === 'rejected') {
      expect.unreachable('valid comparison must not be rejected');
      return;
    }
    expect(outcome.suiteUnknown).toBe(true);
    expect(outcome.basis.suite).toBeUndefined();
  });

  it('is deterministic — two builds are deep-equal (positive)', () => {
    const request = {
      basis: { suite: 's', environment: 'e' },
      arms: [
        arm({ armId: 'a', bodyVersion: { bodyId: 'b', version: '1' }, substrate: 's1', environment: 'e' }),
        arm({ armId: 'b', bodyVersion: { bodyId: 'b', version: '1' }, substrate: 's2', environment: 'e' }),
      ],
    };
    expect(buildSubstrateComparison(request)).toEqual(buildSubstrateComparison(request));
  });
});

describe('substrate comparison — TYPED rejections (the core negatives)', () => {
  it('rejects a BARE substrate comparison with the typed code (negative)', () => {
    // A bare model-vs-model ranking: arms name substrates but NO body
    // version — the forbidden shape.
    const outcome = buildSubstrateComparison({
      basis: { suite: 's', environment: 'e' },
      arms: [
        arm({ armId: 'model-a', substrate: 'substrate-alpha', environment: 'e' }),
        arm({ armId: 'model-b', substrate: 'substrate-beta', environment: 'e' }),
      ],
    });
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') return;
    expect(outcome.code).toBe('BODY_UI_BARE_SUBSTRATE_COMPARISON');
    expect(outcome.message).toContain('arm "model-a"');
    expect(outcome.message).toContain('no body version');
    expect(outcome.guidance).toContain('full composition');
    expect(outcome.guidance).toContain('never the bare model');
  });

  it('rejects a bare comparison even when only ONE arm lacks its body version (negative)', () => {
    const outcome = buildSubstrateComparison({
      basis: { suite: 's', environment: 'e' },
      arms: [
        arm({ armId: 'a', bodyVersion: { bodyId: 'b', version: '1' }, substrate: 's1', environment: 'e' }),
        arm({ armId: 'bare', substrate: 's2', environment: 'e' }),
      ],
    });
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') return;
    expect(outcome.code).toBe('BODY_UI_BARE_SUBSTRATE_COMPARISON');
    expect(outcome.message).toContain('arm "bare"');
  });

  it('rejects MIXED body versions — the substrate must be the only variable (negative)', () => {
    const outcome = buildSubstrateComparison({
      basis: { suite: 's', environment: 'e' },
      arms: [
        arm({ armId: 'a', bodyVersion: { bodyId: 'b', version: '1.1.0' }, substrate: 's1', environment: 'e' }),
        arm({ armId: 'b', bodyVersion: { bodyId: 'b', version: '1.2.0' }, substrate: 's2', environment: 'e' }),
      ],
    });
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') return;
    expect(outcome.code).toBe('BODY_UI_MIXED_BODY_VERSIONS');
    expect(outcome.guidance).toContain('pins one body version');
  });

  it('rejects an INCOMPLETE arm (substrate missing) — never a guessed row (negative)', () => {
    const outcome = buildSubstrateComparison({
      basis: { suite: 's', environment: 'e' },
      arms: [
        arm({ armId: 'a', bodyVersion: { bodyId: 'b', version: '1' }, substrate: 's1', environment: 'e' }),
        arm({ armId: 'b', bodyVersion: { bodyId: 'b', version: '1' }, environment: 'e' }),
      ],
    });
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') return;
    expect(outcome.code).toBe('BODY_UI_INCOMPLETE_ARM');
  });

  it('rejects INSUFFICIENT arms — one composition is a fact, not a comparison (negative)', () => {
    const outcome = buildSubstrateComparison({
      basis: { suite: 's', environment: 'e' },
      arms: [arm({ armId: 'only', bodyVersion: { bodyId: 'b', version: '1' }, substrate: 's1', environment: 'e' })],
    });
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') return;
    expect(outcome.code).toBe('BODY_UI_INSUFFICIENT_ARMS');
  });

  it('rejects an ENVIRONMENT BASIS mismatch — identical semantics required (negative)', () => {
    const outcome = buildSubstrateComparison({
      basis: { suite: 's', environment: 'sandboxed-workspace' },
      arms: [
        arm({ armId: 'a', bodyVersion: { bodyId: 'b', version: '1' }, substrate: 's1', environment: 'sandboxed-workspace' }),
        arm({ armId: 'b', bodyVersion: { bodyId: 'b', version: '1' }, substrate: 's2', environment: 'live-workspace' }),
      ],
    });
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') return;
    expect(outcome.code).toBe('BODY_UI_ENVIRONMENT_BASIS_MISMATCH');
  });

  it('rejects arms with differing environments when no basis is declared (negative)', () => {
    const outcome = buildSubstrateComparison({
      basis: { suite: 's', environment: undefined },
      arms: [
        arm({ armId: 'a', bodyVersion: { bodyId: 'b', version: '1' }, substrate: 's1', environment: 'env-1' }),
        arm({ armId: 'b', bodyVersion: { bodyId: 'b', version: '1' }, substrate: 's2', environment: 'env-2' }),
      ],
    });
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') return;
    expect(outcome.code).toBe('BODY_UI_ENVIRONMENT_BASIS_MISMATCH');
  });
});

describe('the comparison scope contract + possession bridge', () => {
  it('exposes the composition-scoped rule and closed rejection vocabulary (positive)', () => {
    expect(COMPARISON_SCOPE_CONTRACT.scope).toBe('composition-scoped');
    expect(COMPARISON_SCOPE_CONTRACT.rule).toContain('never a rendered comparison');
    expect(COMPARISON_SCOPE_CONTRACT.rejectionVocabulary).toEqual(
      SUBSTRATE_COMPARISON_REJECTION_CODES,
    );
    expect(SUBSTRATE_COMPARISON_REJECTION_CODES).toContain('BODY_UI_BARE_SUBSTRATE_COMPARISON');
  });

  it('bridges possession rows into arms — bodyless rows keep the rejection honest (positive + negative)', () => {
    const arms = possessionRowsToComparisonArms([
      {
        possessionId: 'p1',
        bodyVersion: { bodyId: 'b', version: '1' },
        substrate: 's1',
        runtime: 'r1',
        environment: 'e1',
      },
      {
        possessionId: 'p2',
        bodyVersion: undefined,
        substrate: 's2',
        runtime: undefined,
        environment: undefined,
      },
    ]);
    expect(arms).toHaveLength(2);
    expect(arms[0]?.bodyVersion).toEqual({ bodyId: 'b', version: '1' });
    // Feeding these into the builder yields the TYPED bare-substrate
    // rejection — the unreadable body half is never guessed.
    const outcome = buildSubstrateComparison({
      basis: { suite: 's', environment: 'e1' },
      arms,
    });
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') return;
    expect(outcome.code).toBe('BODY_UI_BARE_SUBSTRATE_COMPARISON');
  });

  it('bridges two well-formed rows into a compared table (positive)', () => {
    const outcome = buildSubstrateComparison({
      basis: { suite: 'suite-x', environment: 'env-1' },
      arms: possessionRowsToComparisonArms([
        { possessionId: 'p1', bodyVersion: { bodyId: 'b', version: '1' }, substrate: 's1', runtime: 'r', environment: 'env-1' },
        { possessionId: 'p2', bodyVersion: { bodyId: 'b', version: '1' }, substrate: 's2', runtime: 'r', environment: 'env-1' },
      ]),
    });
    if (outcome.kind === 'rejected') {
      expect.unreachable('two well-formed arms must compare');
      return;
    }
    expect(outcome.rows.map((row) => row.substrate)).toEqual(['s1', 's2']);
  });
});
