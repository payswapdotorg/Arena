/**
 * Signal record tests (Work Order C008) — EES1.0 field-set completeness
 * through the C006 vocabulary, provenance/correlation linkage, content-key
 * determinism (duplicate injection), and the append-only stage history.
 */

import { describe, expect, it } from 'vitest';
import { TOOL_GAP_ERROR_CODES, ToolGapError } from './errors.js';
import {
  advanceToolGapSignalStage,
  createToolGapSignalRecord,
  isToolGapSignalRecord,
  signalContentKey,
  verifyProvenanceIntegrity,
} from './signal.js';
import { CAPTURE_KEY, CORR_ID, T1, T2, T3, makeCaptureInput, makeSignal } from './test-support.js';

describe('createToolGapSignalRecord', () => {
  it('captures the full EES1.0 field set through the C006 vocabulary', () => {
    const signal = makeSignal();
    const record = createToolGapSignalRecord(makeCaptureInput(signal));
    expect(record.stage).toBe('captured');
    expect(record.signal.toolName).toBe('spectral-analyzer');
    expect(record.signal.capabilityProvided).toBe('frequency-domain analysis of sensor telemetry');
    expect(record.signal.whyNeeded).toContain('vibration');
    expect(record.signal.inputs).toEqual({ samples: [1, 2, 3], sampleRateHz: 48000 });
    expect(record.signal.outputs).toEqual({ peakHz: 148.2, harmonicCount: 4 });
    expect(record.signal.nature).toBe('external-tool');
    expect(record.signal.accessRequirements).toContain('network:reach');
    expect(record.signal.cost).toEqual({ amountMinorUnits: 250, currency: 'usd', latencyMs: 900 });
    expect(record.signal.evidenceOfUse.length).toBe(2);
    expect(record.signal.recommendedIntegrationBoundary).toContain('tool gateway');
    expect(record.signal.substitutionPossible).toBe(false);
  });

  it('is provenance-addressed and correlation-linked to the originating flow', () => {
    const record = createToolGapSignalRecord(makeCaptureInput(makeSignal()));
    expect(record.provenance.tenantId).toBe('tenant-alpha');
    expect(record.provenance.interventionId).toMatch(/^ivn_/);
    expect(record.provenance.requestId).toMatch(/^req_/);
    expect(record.provenance.sessionId).toBe(record.signal.sessionId);
    expect(record.provenance.expertRef).toBe('expert-007');
    expect(record.correlation.correlationId).toBe(CORR_ID);
    expect(record.correlation.captureKey).toBe(CAPTURE_KEY);
  });

  it('fails closed when the payload is not a C006 ToolGapSignal', () => {
    expect(() =>
      createToolGapSignalRecord(
        makeCaptureInput({ ...makeSignal(), toolName: '' } as never),
      ),
    ).toThrow(ToolGapError);
  });

  it('fails closed when the signal belongs to another session', () => {
    const foreign = makeSignal({ sessionId: 'session-another-session-0001' });
    const input = { ...makeCaptureInput(foreign), sessionId: 'session-tool-gap-fixture-0001' };
    expect(() => createToolGapSignalRecord(input)).toThrow(ToolGapError);
  });

  it('is deep-frozen (append-only by construction)', () => {
    const record = createToolGapSignalRecord(makeCaptureInput(makeSignal()));
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.provenance)).toBe(true);
    expect(Object.isFrozen(record.stageHistory)).toBe(true);
    expect(() => {
      (record as { stage: string }).stage = 'triaged';
    }).toThrow();
  });

  it('content keys are deterministic over signal content (duplicate detection)', () => {
    const a = makeSignal();
    const b = makeSignal();
    expect(signalContentKey(a)).toBe(signalContentKey(b));
    const different = makeSignal({ toolName: 'other-tool' });
    expect(signalContentKey(a)).not.toBe(signalContentKey(different));
  });

  it('structural guard accepts constructed records and rejects lookalikes', () => {
    const record = createToolGapSignalRecord(makeCaptureInput(makeSignal()));
    expect(isToolGapSignalRecord(record)).toBe(true);
    expect(isToolGapSignalRecord({ recordVersion: 99 })).toBe(false);
    expect(isToolGapSignalRecord(null)).toBe(false);
  });
});

describe('append-only stage history', () => {
  it('advance appends a new history entry on a NEW record (original untouched)', () => {
    const original = createToolGapSignalRecord(makeCaptureInput(makeSignal()));
    const advanced = advanceToolGapSignalStage({
      record: original,
      toStage: 'triaged',
      decision: 'triaged: signal is actionable, propose a tool specification',
      now: T2,
    });
    expect(advanced.stage).toBe('triaged');
    expect(advanced.stageHistory.length).toBe(original.stageHistory.length + 1);
    expect(original.stage).toBe('captured');
    expect(advanced).not.toBe(original);
    expect(verifyProvenanceIntegrity(original).intact).toBe(true);
    expect(verifyProvenanceIntegrity(advanced).intact).toBe(true);
  });

  it('history entries record the machine-readable reason and decision', () => {
    const triaged = advanceToolGapSignalStage({
      record: createToolGapSignalRecord(makeCaptureInput(makeSignal())),
      toStage: 'triaged',
      decision: 'triage disposition',
      now: T2,
    });
    const proposed = advanceToolGapSignalStage({
      record: triaged,
      toStage: 'tool-specification-proposed',
      decision: 'spec proposal drafted',
      now: T3,
    });
    const disposed = advanceToolGapSignalStage({
      record: proposed,
      toStage: 'adapter-request',
      decision: 'route to the adapter request feed',
      now: T1,
    });
    expect(disposed.stage).toBe('adapter-request');
    expect(disposed.stageHistory.map((e) => e.decisionCode)).toEqual([
      'capture',
      'triage_disposition',
      'tool_specification_proposed',
      'feed_disposition',
    ]);
  });

  it('tampered histories are detected (provenance integrity check)', () => {
    const record = createToolGapSignalRecord(makeCaptureInput(makeSignal()));
    const tampered = {
      ...record,
      stage: 'triaged' as const,
      stageHistory: [
        ...record.stageHistory,
        {
          from: 'triaged' as const,
          to: 'captured' as const,
          reason: 'transition_ok' as const,
          decisionCode: 'capture' as const,
          decision: 'spliced',
          actor: null,
          occurredAt: T2,
        },
      ],
    };
    const verdict = verifyProvenanceIntegrity(tampered);
    expect(verdict.intact).toBe(false);
    expect(verdict.reason).toBe('history_discontiguous');
  });
});

describe('fail-closed guards', () => {
  it('rejects unknown provenance fields', () => {
    expect(() =>
      createToolGapSignalRecord(makeCaptureInput(makeSignal(), { interventionId: '' })),
    ).toThrow(ToolGapError);
  });

  it('duplicate signals carry the same content key but distinct capture keys', () => {
    const first = createToolGapSignalRecord(makeCaptureInput(makeSignal(), { captureKey: 'k1' }));
    const second = createToolGapSignalRecord(makeCaptureInput(makeSignal(), { captureKey: 'k2' }));
    expect(first.contentKey).toBe(second.contentKey);
    expect(first.correlation.captureKey).not.toBe(second.correlation.captureKey);
  });

  it('invalid signal ids are rejected', () => {
    expect(() =>
      createToolGapSignalRecord({ ...makeCaptureInput(makeSignal()), signalId: 'tgs_nothex' }),
    ).toThrow(ToolGapError);
  });

  it('error taxonomy: unknown codes rejected at parse time', async () => {
    const { parseWireToolGapError } = await import('./errors.js');
    expect(() => parseWireToolGapError({ code: 'TOOL_GAP_NOPE' })).toThrow(ToolGapError);
    const parsed = parseWireToolGapError({
      code: TOOL_GAP_ERROR_CODES.INVALID_TRANSITION,
      category: 'state',
      message: 'no edge',
    });
    expect(parsed.code).toBe('TOOL_GAP_INVALID_TRANSITION');
  });
});
