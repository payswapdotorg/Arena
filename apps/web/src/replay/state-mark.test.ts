/**
 * Replay truth-treatment tests (Work Order B011; apps/web/src/replay).
 *
 * The class->treatment map is INJECTIVE over the closed B003 taxonomy:
 * the ten badgeable classes map one-to-one onto the ten B001 badge
 * kinds; pending and unknown get their own DISTINCT non-badge marks —
 * no two truth classes ever render as the same treatment.
 */

import { describe, expect, it } from 'vitest';
import { STATE_KINDS } from '@arena/ui-platform';
import type { StateKind } from '@arena/ui-platform';
import {
  REPLAY_TRUTH_CLASS_TREATMENT,
  isReplayBadgeTreatment,
  replayTruthClassTreatment,
  replayTruthLabel,
} from './state-mark.js';
import { REPLAY_STEP_TRUTH_CLASS } from '../../../../packages/replay-ui/src/index.js';

const TRUTH_CLASSES = Object.keys(REPLAY_TRUTH_CLASS_TREATMENT) as ReadonlyArray<
  keyof typeof REPLAY_TRUTH_CLASS_TREATMENT
>;

describe('replay truth-class treatments (injective by construction)', () => {
  it('covers the full closed B003 taxonomy (eleven classes)', () => {
    expect(TRUTH_CLASSES).toHaveLength(11);
    expect(TRUTH_CLASSES).toContain('simulation-replay');
    expect(TRUTH_CLASSES).toContain('pending');
    expect(TRUTH_CLASSES).toContain('unknown');
  });

  it('is injective — no two classes share a treatment (never one generic "AI result")', () => {
    const treatments = TRUTH_CLASSES.map((kind) => REPLAY_TRUTH_CLASS_TREATMENT[kind]);
    expect(new Set(treatments).size).toBe(treatments.length);
  });

  it('uses only real B001 badge kinds for the badgeable classes (closed vocabulary)', () => {
    for (const kind of TRUTH_CLASSES) {
      const treatment = REPLAY_TRUTH_CLASS_TREATMENT[kind];
      if (isReplayBadgeTreatment(treatment)) {
        expect((STATE_KINDS as readonly string[]).includes(treatment)).toBe(true);
      }
    }
  });

  it('keeps pending and unknown OUT of the badge vocabulary (honesty-critical marks)', () => {
    expect(REPLAY_TRUTH_CLASS_TREATMENT.pending).toBe('pending');
    expect(REPLAY_TRUTH_CLASS_TREATMENT.unknown).toBe('unknown');
    expect((STATE_KINDS as readonly string[]).includes('pending')).toBe(false);
    expect((STATE_KINDS as readonly string[]).includes('unknown')).toBe(false);
    expect(isReplayBadgeTreatment('pending')).toBe(false);
    expect(isReplayBadgeTreatment('unknown')).toBe(false);
  });

  it('pins the replayed-step class to the simulation badge treatment (never "result")', () => {
    const treatment = replayTruthClassTreatment(REPLAY_STEP_TRUTH_CLASS);
    expect(treatment).toBe('simulation');
    expect(treatment).not.toBe('verified');
    const badge = treatment as StateKind;
    expect((STATE_KINDS as readonly string[]).includes(badge)).toBe(true);
  });

  it('labels every class distinctly (labels never rest on colour alone)', () => {
    const labels = TRUTH_CLASSES.map((kind) => replayTruthLabel(kind));
    expect(new Set(labels).size).toBe(labels.length);
    expect(replayTruthLabel('simulation-replay')).toBe('Simulation replay');
    expect(replayTruthLabel('evaluation-result')).toBe('Evaluation result');
  });
});
