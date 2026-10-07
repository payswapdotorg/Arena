/**
 * Sandbox mode (Work Order C017) — the deterministic, VISIBLY LABELLED
 * sandbox over the C001 reference fabric.
 *
 * THE TRUTH-LABEL LAW (spec/free-tier-contract.md + the C010
 * truth-label law): sandbox escalations are labelled `sandbox`
 * everywhere they surface; sandbox money is DEMO money and is never
 * customer money; the sandbox never fakes capacity — a probe reporting
 * EXHAUSTED or DISABLED fails closed (no silent paid path, no
 * best-effort run).
 *
 * Sandbox keys can never touch live surfaces: the scope allowlist in
 * api-keys.ts denies `escalations:create` to sandbox keys, and
 * authorizeDeveloperKey denies environment mismatch.
 */

import { DEVELOPER_PLATFORM_ERROR_CODES, DeveloperPlatformError } from './errors.js';
import { newSandboxRunId, toDeveloperTimestamp } from './shared.js';
import type {
  ClientAppId,
  DeveloperKeyId,
  DeveloperTimestamp,
  SandboxRunId,
  TenantId,
} from './shared.js';

/** The visible label attached to every sandbox object (truth-label law). */
export const SANDBOX_TRUTH_LABEL = 'sandbox' as const;

/** Demo money label (the C010 truth-label law: demo money is not customer money). */
export const SANDBOX_MONEY_LABEL = 'demo-money' as const;

// ---------------------------------------------------------------------------
// Capacity — never faked (free-tier contract FT2.0)
// ---------------------------------------------------------------------------

export const SANDBOX_CAPACITY_STATES = Object.freeze([
  'AVAILABLE',
  'DEGRADED',
  'EXHAUSTED',
  'DISABLED',
] as const);
export type SandboxCapacityState = (typeof SANDBOX_CAPACITY_STATES)[number];

/** Capacity states that fail a sandbox run CLOSED. */
export const SANDBOX_CAPACITY_FAIL_CLOSED_STATES: readonly SandboxCapacityState[] = Object.freeze([
  'EXHAUSTED',
  'DISABLED',
]);

/** The injected capacity probe port (hosts wire the free-tier quota surface). */
export interface SandboxCapacityProbe {
  readonly state: () => SandboxCapacityState;
}

/** Deterministic constant probe (the reference fabric default: AVAILABLE). */
export function constantSandboxCapacity(state: SandboxCapacityState): SandboxCapacityProbe {
  return { state: () => state };
}

/** Fail-closed capacity gate — EXHAUSTED/DISABLED never run, never pay, never fake. */
export function assertSandboxCapacity(state: SandboxCapacityState): void {
  if (state === 'EXHAUSTED') {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.SANDBOX_CAPACITY_EXHAUSTED, {
      message: 'sandbox capacity is EXHAUSTED — the run fails closed (no silent paid path)',
      details: { state },
    });
  }
  if (state === 'DISABLED') {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.SANDBOX_CAPACITY_DISABLED, {
      message: 'sandbox capacity is DISABLED — the run fails closed',
      details: { state },
    });
  }
}

// ---------------------------------------------------------------------------
// Deterministic scenarios (the canned escalations)
// ---------------------------------------------------------------------------

/** A deterministic canned sandbox scenario (the reference fabric's scripted path). */
export interface SandboxScenario {
  readonly scenarioId: string;
  readonly displayName: string;
  readonly description: string;
  readonly capabilityNeed: string;
  readonly escalationMode: 'solve' | 'correct' | 'unblock' | 'review' | 'teach';
  readonly urgency: 'routine' | 'expedited' | 'critical';
  /** Canned budget in minor units — DEMO money, never customer money. */
  readonly budgetMinorUnits: number;
  readonly currency: string;
}

export const SANDBOX_SCENARIOS: readonly SandboxScenario[] = Object.freeze([
  Object.freeze({
    scenarioId: 'boq-quantity-takeoff',
    displayName: 'Quantity takeoff verification',
    description:
      'Your agent produced a bill-of-quantities takeoff it cannot verify. Escalate to a qualified estimator and watch the full lifecycle arrive.',
    capabilityNeed: 'boq-estimation.quantity-takeoff',
    escalationMode: 'solve',
    urgency: 'expedited',
    budgetMinorUnits: 250_00,
    currency: 'USD',
  }),
  Object.freeze({
    scenarioId: 'rates-gap',
    displayName: 'Local rates gap',
    description:
      'Your agent is missing current local material rates for a region it must price. Request a correction from a domain expert.',
    capabilityNeed: 'boq-estimation.rates',
    escalationMode: 'correct',
    urgency: 'routine',
    budgetMinorUnits: 120_00,
    currency: 'USD',
  }),
  Object.freeze({
    scenarioId: 'compliance-review',
    displayName: 'Unblock a compliance review',
    description:
      'A filing requires a licensed reviewer sign-off the agent cannot self-provide. Escalate for a bounded human review.',
    capabilityNeed: 'compliance.licensed-review',
    escalationMode: 'review',
    urgency: 'critical',
    budgetMinorUnits: 480_00,
    currency: 'USD',
  }),
] as const);

export function sandboxScenarioById(scenarioId: string): SandboxScenario {
  const scenario = SANDBOX_SCENARIOS.find((candidate) => candidate.scenarioId === scenarioId);
  if (scenario === undefined) {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown sandbox scenario: ${JSON.stringify(scenarioId)}`,
      details: { scenarioId, valid: SANDBOX_SCENARIOS.map((s) => s.scenarioId) },
    });
  }
  return scenario;
}

// ---------------------------------------------------------------------------
// Sandbox run record (the visible label rides on every projection)
// ---------------------------------------------------------------------------

export const SANDBOX_RUN_RECORD_VERSION = 1 as const;

/** One deterministic sandbox escalation run, visibly labelled. */
export interface SandboxRunRecord {
  readonly runVersion: typeof SANDBOX_RUN_RECORD_VERSION;
  readonly runId: SandboxRunId;
  readonly keyId: DeveloperKeyId;
  readonly clientAppId: ClientAppId;
  readonly tenantId: TenantId;
  /** The C001 escalation request id created by the run. */
  readonly requestId: string;
  readonly scenarioId: string;
  readonly createdAt: DeveloperTimestamp;
  readonly environment: 'sandbox';
  readonly truthLabel: typeof SANDBOX_TRUTH_LABEL;
}

/** Record a sandbox run (called by the service after the escalation port accepts). */
export function recordSandboxRun(input: {
  readonly keyId: string;
  readonly clientAppId: string;
  readonly tenantId: string;
  readonly requestId: string;
  readonly scenarioId: string;
  readonly now: number | string | Date;
}, deps: { readonly material: { readonly bytes32Hex: () => string } }): SandboxRunRecord {
  if (!SANDBOX_SCENARIOS.some((scenario) => scenario.scenarioId === input.scenarioId)) {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown sandbox scenario: ${JSON.stringify(input.scenarioId)}`,
      details: { scenarioId: input.scenarioId },
    });
  }
  return Object.freeze({
    runVersion: SANDBOX_RUN_RECORD_VERSION,
    runId: newSandboxRunId(deps.material),
    keyId: input.keyId as DeveloperKeyId,
    clientAppId: input.clientAppId as ClientAppId,
    tenantId: input.tenantId as TenantId,
    requestId: input.requestId,
    scenarioId: input.scenarioId,
    createdAt: toDeveloperTimestamp(input.now),
    environment: 'sandbox',
    truthLabel: SANDBOX_TRUTH_LABEL,
  });
}

/** Wire projection — the truth label is ALWAYS present. */
export function sandboxRunWire(run: SandboxRunRecord): Record<string, unknown> {
  return Object.freeze({ ...run });
}
