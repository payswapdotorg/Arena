/**
 * Observable event stream + ToolGapSignal suites (Work Order C006;
 * EES1.0 "Agent observation" + "Tool-gap discovery" — architecture-lock
 * rule 30).
 *
 * Adversarial minimums covered here:
 *   - SECRET LEAKAGE through the observation stream: the projection
 *     re-screens payloads through the privacy barrier, so redacted
 *     fields / masked identities never reach the originating agent;
 *   - private chain-of-thought is never captured or transmitted
 *     (typed PRIVATE_REASONING at construction; filtered at projection);
 *   - unknown event kinds never enter the approved stream;
 *   - tool-gap signals without evidence of use cannot be constructed.
 */

import { describe, expect, it } from 'vitest';
import {
  createExpertSessionEvent,
  filterObservableEvents,
  isObservableSessionEvent,
  projectObservationStream,
  EXPERT_SESSION_EVENT_KINDS,
  PRIVATE_REASONING_MARKERS,
} from './events.js';
import { createToolGapSignal, isToolGapSignal, TOOL_GAP_NATURES } from './toolgap.js';
import { composePrivacyBarrier } from './barrier.js';
import { ExpertSessionError, EXPERT_SESSION_ERROR_CODES } from './errors.js';
import { T0, T1, T2, makeBarrierInput } from './test-support.js';

const SESSION_ID = 'session-stream-test-1';

describe('observable event stream', () => {
  it('exposes exactly the closed approved EES1.0 vocabulary', () => {
    expect([...EXPERT_SESSION_EVENT_KINDS]).toEqual([
      'environment-observation',
      'human-action',
      'tool-invocation',
      'tool-result',
      'artifact-change',
      'annotation',
      'checkpoint',
      'final-result',
      'expert-correction',
      'tool-gap-signal',
    ]);
  });

  it('creates approved events with monotonic sequences and injected timestamps', () => {
    const event = createExpertSessionEvent({
      sessionId: SESSION_ID,
      sequence: 1,
      kind: 'human-action',
      payload: { action: 'opened-catalog' },
      now: T0,
      actor: 'expert-alice',
    });
    expect(event.sequence).toBe(1);
    expect(event.recordedAt).toBe(T0);
    expect(Object.isFrozen(event)).toBe(true);
    expect(isObservableSessionEvent(event)).toBe(true);
  });

  it('rejects unknown kinds (fail-closed closed vocabulary)', () => {
    expect(() =>
      createExpertSessionEvent({ sessionId: SESSION_ID, sequence: 1, kind: 'system-internal', payload: {}, now: T0 }),
    ).toThrowError(ExpertSessionError);
    try {
      createExpertSessionEvent({ sessionId: SESSION_ID, sequence: 1, kind: 'reasoning', payload: {}, now: T0 });
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.INVALID_EVENT);
    }
  });

  it('ADVERSARIAL: private chain-of-thought is never captured (nested markers rejected)', () => {
    for (const marker of PRIVATE_REASONING_MARKERS) {
      expect(() =>
        createExpertSessionEvent({
          sessionId: SESSION_ID,
          sequence: 1,
          kind: 'human-action',
          payload: { nested: { [marker]: 'first I would think about...' } },
          now: T0,
        }),
      ).toThrowError(ExpertSessionError);
    }
    try {
      createExpertSessionEvent({
        sessionId: SESSION_ID,
        sequence: 1,
        kind: 'annotation',
        payload: { chainOfThought: 'hidden reasoning' },
        now: T0,
      });
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.PRIVATE_REASONING);
    }
  });

  it('filterObservableEvents drops forged wire events (unknown kinds, private carriers, bad shape)', () => {
    const good = createExpertSessionEvent({
      sessionId: SESSION_ID,
      sequence: 1,
      kind: 'checkpoint',
      payload: { at: 'step-3' },
      now: T0,
    });
    const forged = [
      { eventVersion: 1, eventId: 'esevt_00000000000000000000000000000001', sessionId: SESSION_ID, sequence: 2, kind: 'reasoning', payload: {}, recordedAt: T1 },
      { eventVersion: 1, eventId: 'esevt_00000000000000000000000000000002', sessionId: SESSION_ID, sequence: 3, kind: 'human-action', payload: { chainOfThought: 'x' }, recordedAt: T2 },
      { kind: 'human-action' },
      null,
    ];
    const filtered = filterObservableEvents([good, ...forged]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.eventId).toBe(good.eventId);
  });

  it('ADVERSARIAL: secret leakage through the observation stream — projection re-screens payloads', () => {
    const barrier = composePrivacyBarrier(makeBarrierInput());
    // A forged-but-structurally-valid event carrying pre-barrier data.
    const forged = {
      eventVersion: 1,
      eventId: 'esevt_00000000000000000000000000000003',
      sessionId: SESSION_ID,
      sequence: 1,
      kind: 'environment-observation',
      payload: {
        customerEmail: 'acme-buyer@example.com',
        accountNumber: '1234567890',
        customerName: 'Acme Buyer',
        attachment: 'docs/confidential-notes.md',
        step: 'awaiting-vendor-match',
      },
      recordedAt: T0,
    };
    const projected = projectObservationStream(barrier, [forged as never]);
    expect(projected).toHaveLength(1);
    expect(projected[0]?.payload).toEqual({
      customerEmail: '[REDACTED]',
      accountNumber: '[REDACTED]',
      customerName: 'masked-identity',
      attachment: '[REDACTED]',
      step: 'awaiting-vendor-match',
    });
  });
});

describe('ToolGapSignal records', () => {
  it('records the full EES1.0 field set', () => {
    const signal = createToolGapSignal({
      sessionId: SESSION_ID,
      toolName: 'vendor-registry-lookup',
      capabilityProvided: 'authoritative vendor identity resolution',
      whyNeeded: 'the agent could not disambiguate two vendors sharing a name',
      inputs: { query: 'Acme Supply' },
      outputs: { vendorId: 'vendor-7' },
      nature: 'external-tool',
      accessRequirements: ['network:vendor-registry.example', 'credentials-class:api'],
      cost: { amountMinorUnits: 15, currency: 'USD', latencyMs: 400 },
      evidenceOfUse: ['esevt_00000000000000000000000000000004'],
      recommendedIntegrationBoundary: 'adapter-request',
      substitutionPossible: false,
      now: T0,
    });
    expect(isToolGapSignal(signal)).toBe(true);
    expect(signal.nature).toBe('external-tool');
    expect(signal.cost).toEqual({ amountMinorUnits: 15, currency: 'USD', latencyMs: 400 });
    expect([...signal.evidenceOfUse]).toHaveLength(1);
  });

  it('natures are the closed vocabulary; unknown natures rejected', () => {
    expect([...TOOL_GAP_NATURES]).toEqual(['external-tool', 'manual-action', 'environment-native']);
    expect(() =>
      createToolGapSignal({
        sessionId: SESSION_ID,
        toolName: 'x',
        capabilityProvided: 'y',
        whyNeeded: 'z',
        nature: 'psychic',
        evidenceOfUse: ['esevt_00000000000000000000000000000005'],
        recommendedIntegrationBoundary: 'adapter-request',
        substitutionPossible: true,
        now: T0,
      }),
    ).toThrowError(ExpertSessionError);
  });

  it('ADVERSARIAL: a signal without evidence of use is an unverifiable claim (rejected)', () => {
    expect(() =>
      createToolGapSignal({
        sessionId: SESSION_ID,
        toolName: 'vendor-registry-lookup',
        capabilityProvided: 'resolution',
        whyNeeded: 'needed',
        nature: 'manual-action',
        evidenceOfUse: [],
        recommendedIntegrationBoundary: 'tool-specification',
        substitutionPossible: true,
        now: T0,
      }),
    ).toThrowError(ExpertSessionError);
  });
});
