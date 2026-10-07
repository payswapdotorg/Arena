/**
 * Result taxonomy tests (Work Order C001) — the closed 11-kind ES1.0
 * vocabulary with per-kind required fields.
 */

import { describe, expect, it } from 'vitest';
import { ESCALATION_RESULT_KINDS, createEscalationResult, isEscalationResult } from './results.js';

const NOW = '2026-10-07T10:20:00.000Z';

describe('escalation result taxonomy', () => {
  it('has exactly the 11 ES1.0 kinds', () => {
    expect([...ESCALATION_RESULT_KINDS]).toEqual([
      'correction',
      'unblock',
      'answer',
      'decision',
      'solution',
      'review',
      'evidence-bundle',
      'knowledge-patch',
      'tool-gap-signal',
      'evaluation-verdict',
      'learning-artifact-ref',
    ]);
  });

  const happy: ReadonlyArray<Record<string, unknown>> = [
    { kind: 'correction', correctedRef: 'task-7', replacement: { rate: 42.5 } },
    { kind: 'unblock', blockageRef: 'step-12', resolution: { cleared: true } },
    { kind: 'answer', payload: { total: 42_500 } },
    { kind: 'decision', decision: 'approve-change-order', rationale: 'within tolerance', optionsConsidered: ['approve', 'reject'] },
    { kind: 'solution', payload: { total: 42_500 }, steps: ['takeoff', 'rate-apply'] },
    { kind: 'review', verdict: 'approved', findings: ['rates consistent'] },
    { kind: 'evidence-bundle', evidenceRefs: ['artifact-a', 'artifact-b'] },
    { kind: 'knowledge-patch', statement: 'Use rate library v3 for GH region.', scope: 'boq-estimation' },
    { kind: 'tool-gap-signal', missingToolId: 'quantity-takeoff-auto', rationale: 'manual takeoff took 3h' },
    { kind: 'evaluation-verdict', verdict: 'pass', subjectRef: 'body-qa-v2' },
    { kind: 'learning-artifact-ref', artifactRef: 'artifact-c', provenance: 'expert-session-0001' },
  ];

  for (const input of happy) {
    it(`constructs a ${String(input.kind)} result`, () => {
      const created = createEscalationResult({
        ...(input as { kind: string }),
        producedAt: NOW,
        summary: 'expert deliverable',
      } as Parameters<typeof createEscalationResult>[0]);
      expect(isEscalationResult(created)).toBe(true);
      expect(created.summary).toBe('expert deliverable');
      expect(Object.isFrozen(created)).toBe(true);
    });
  }

  const negative: ReadonlyArray<[string, Record<string, unknown>]> = [
    ['unknown kind', { kind: 'hot-take' }],
    ['correction without replacement', { kind: 'correction', correctedRef: 'task-7' }],
    ['unblock without blockage ref', { kind: 'unblock', resolution: {} }],
    ['answer without payload', { kind: 'answer' }],
    ['decision without options', { kind: 'decision', decision: 'x', rationale: 'y' }],
    ['solution without steps', { kind: 'solution', payload: {} }],
    ['review with bad verdict', { kind: 'review', verdict: 'meh', findings: ['f'] }],
    ['evidence bundle without refs', { kind: 'evidence-bundle' }],
    ['knowledge patch without scope', { kind: 'knowledge-patch', statement: 's' }],
    ['tool gap without rationale', { kind: 'tool-gap-signal', missingToolId: 't-1' }],
    ['evaluation verdict with bad verdict', { kind: 'evaluation-verdict', verdict: 'maybe', subjectRef: 's-1' }],
    ['learning artifact without provenance', { kind: 'learning-artifact-ref', artifactRef: 'a-1' }],
    ['empty summary', { kind: 'answer', payload: {}, summary: '' }],
    ['bad timestamp', { kind: 'answer', payload: {}, producedAt: 'yesterday' }],
  ];

  for (const [name, overrides] of negative) {
    it(`rejects: ${name}`, () => {
      expect(() =>
        createEscalationResult({
          producedAt: NOW,
          summary: 's',
          ...(overrides as Record<string, unknown>),
        } as Parameters<typeof createEscalationResult>[0]),
      ).toThrowError();
    });
  }
});
