/**
 * KnowledgePatch tests (Work Order C008) — the learning-candidate gate:
 * only reusable tiers with granted rights and evidence become patches;
 * task-specific guidance can NEVER become a patch; candidateOnly is
 * structural.
 */

import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_CAPTURE_ERROR_CODES, KnowledgeCaptureError } from './errors.js';
import { createLatticeKnowledgeRecord, promoteLatticeKnowledge } from './lattice.js';
import { createKnowledgePatch, isKnowledgePatch } from './patch.js';
import { CASE_SCOPE, GRANTED, makeArtifact, makeCaptureInput } from './test-support.js';

describe('createKnowledgePatch', () => {
  it('cuts a scoped, rights-carrying, evidence-backed patch from a reusable record', () => {
    const record = createLatticeKnowledgeRecord(makeCaptureInput(makeArtifact(), CASE_SCOPE));
    const patch = createKnowledgePatch({ record, now: 0 });
    expect(patch.tier).toBe('scoped-reusable-knowledge');
    expect(patch.scope).toEqual(CASE_SCOPE);
    expect(patch.evidenceRefs.length).toBe(2);
    expect(patch.rights.granted).toBe(true);
    expect(patch.candidateOnly).toBe(true);
    expect(patch.sourceRecordId).toBe(record.recordId);
  });

  it('task-specific guidance can NEVER become a patch (fail-closed)', () => {
    const record = createLatticeKnowledgeRecord(
      makeCaptureInput(
        makeArtifact({ tier: 'task-specific-guidance', scope: 'task:task-2026-1042' }),
        { kind: 'task', ref: 'task-2026-1042' },
      ),
    );
    expect(() => createKnowledgePatch({ record, now: 0 })).toThrow(KnowledgeCaptureError);
    try {
      createKnowledgePatch({ record, now: 0 });
      expect.unreachable('must throw');
    } catch (error) {
      expect(error instanceof KnowledgeCaptureError).toBe(true);
      expect((error as KnowledgeCaptureError).code).toBe(KNOWLEDGE_CAPTURE_ERROR_CODES.PATCH_DENIED);
    }
  });

  it('ungranted rights fail closed (no patch without explicit reuse rights)', () => {
    const record = createLatticeKnowledgeRecord(makeCaptureInput(makeArtifact(), CASE_SCOPE));
    const ungranted = {
      ...record,
      rights: { granted: false, statement: 'revoked' },
    } as typeof record;
    expect(() => createKnowledgePatch({ record: ungranted, now: 0 })).toThrow(/GRANTED/);
  });

  it('the source record is untouched (append-only lineage)', () => {
    const record = createLatticeKnowledgeRecord(makeCaptureInput(makeArtifact(), CASE_SCOPE));
    createKnowledgePatch({ record, now: 0 });
    expect(record.artifact.tier).toBe('scoped-reusable-knowledge');
    expect(record.promotions.length).toBe(0);
  });

  it('a promoted record yields a patch carrying the promoted tier and scope', () => {
    const task = createLatticeKnowledgeRecord(
      makeCaptureInput(
        makeArtifact({ tier: 'task-specific-guidance', scope: 'task:task-2026-1042' }),
        { kind: 'task', ref: 'task-2026-1042' },
      ),
    );
    const promoted = promoteLatticeKnowledge({
      record: task,
      toTier: 'scoped-reusable-knowledge',
      toScope: CASE_SCOPE,
      justification: 'case-level reuse consented',
      consent: GRANTED,
      now: 1,
    });
    const patch = createKnowledgePatch({ record: promoted, now: 2 });
    expect(patch.tier).toBe('scoped-reusable-knowledge');
    expect(patch.scope).toEqual(CASE_SCOPE);
    expect(patch.provenance.sessionId).toBe(promoted.provenance.sessionId);
  });

  it('structural guard accepts patches and rejects lookalikes (candidateOnly mandatory)', () => {
    const record = createLatticeKnowledgeRecord(makeCaptureInput(makeArtifact(), CASE_SCOPE));
    const patch = createKnowledgePatch({ record, now: 0 });
    expect(isKnowledgePatch(patch)).toBe(true);
    expect(isKnowledgePatch({ ...patch, candidateOnly: false })).toBe(false);
    expect(isKnowledgePatch(null)).toBe(false);
  });

  it('patches are deep-frozen', () => {
    const record = createLatticeKnowledgeRecord(makeCaptureInput(makeArtifact(), CASE_SCOPE));
    const patch = createKnowledgePatch({ record, now: 0 });
    expect(Object.isFrozen(patch)).toBe(true);
    expect(Object.isFrozen(patch.scope)).toBe(true);
    expect(() => {
      (patch as { candidateOnly: boolean }).candidateOnly = false;
    }).toThrow();
  });
});
