/**
 * Test support (Work Order C008) — deterministic fixtures for the EES1.0
 * signal field set (constructed through the REAL C006 constructor, so the
 * fixtures stay valid vocabulary by construction) and capture inputs.
 */

import { createToolGapSignal } from '@arena/expert-session';
import type { ToolGapSignal } from '@arena/expert-session';

export const T0 = '2026-10-07T10:00:00.000Z';
export const T1 = '2026-10-07T10:00:01.000Z';
export const T2 = '2026-10-07T10:00:02.000Z';
export const T3 = '2026-10-07T10:00:03.000Z';
export const CORR_ID = 'corr-c008-0001';
export const CAPTURE_KEY = 'capture-key-0001';

export function makeSignal(overrides: { sessionId?: string; toolName?: string; recordedAt?: string } = {}): ToolGapSignal {
  return createToolGapSignal({
    sessionId: overrides.sessionId ?? 'session-tool-gap-fixture-0001',
    toolName: overrides.toolName ?? 'spectral-analyzer',
    capabilityProvided: 'frequency-domain analysis of sensor telemetry',
    whyNeeded: 'the agent could not decompose the vibration signal to isolate the bearing fault frequency',
    inputs: { samples: [1, 2, 3], sampleRateHz: 48000 },
    outputs: { peakHz: 148.2, harmonicCount: 4 },
    nature: 'external-tool',
    accessRequirements: ['network:reach', 'credential-class:lab-instrument'],
    cost: { amountMinorUnits: 250, currency: 'usd', latencyMs: 900 },
    evidenceOfUse: ['event/evt-tool-invocation-0001', 'event/evt-tool-result-0001'],
    recommendedIntegrationBoundary: 'adapter behind the tool gateway, read-only telemetry input',
    substitutionPossible: false,
    now: overrides.recordedAt ?? T0,
  });
}

export function makeCaptureInput(
  signal: ToolGapSignal,
  overrides: { captureKey?: string; interventionId?: string } = {},
) {
  return {
    signal,
    tenantId: 'tenant-alpha',
    interventionId: overrides.interventionId ?? 'ivn_00000000000000000000000000000001',
    requestId: 'req_00000000000000000000000000000001',
    sessionId: signal.sessionId,
    expertRef: 'expert-007',
    correlationId: CORR_ID,
    captureKey: overrides.captureKey ?? CAPTURE_KEY,
    now: T1,
  };
}
