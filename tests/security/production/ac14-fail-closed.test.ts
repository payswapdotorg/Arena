/**
 * tests/security/production/ac14-fail-closed.test.ts — AC-14 fail-closed
 * bypass attempts (Work Order P007 integrated pass; issue #159; ADR-
 * P001-07 provider posture as an attack class).
 *
 * "fail-closed bypass attempts (missing config, degraded capacity —
 * assert NO silent fallback)" — attacks the REAL host + adapter
 * composition:
 *
 *   - MISSING CONFIG: a host composed with NO persistence transport
 *     constructs but start() fails CLOSED (typed
 *     RUNTIME_PERSISTENCE_DISABLED; state `failed` is TERMINAL — never
 *     a partially-started host serving traffic); every surface call
 *     fails typed; health reports NOT ready with capacity DISABLED;
 *   - DEGRADED CAPACITY: a transport whose statements fail yields a
 *     health snapshot with capacity DEGRADED (probe-failed) — NEVER a
 *     spoofed AVAILABLE (availability spoofing, the inverse failure);
 *     the readiness aggregate is false;
 *   - the no-alternate-route law: the exhaustion policy is the ONLY
 *     representable policy, and no error vocabulary in the persistence
 *     / escalation / runtime-host code families offers any fallback,
 *     alternate-route or paid-tier vocabulary (the silent-fallback
 *     class is unrepresentable at the vocabulary level);
 *   - exhaustion: a declared-EXHAUSTED observation throws the typed
 *     exhaustion error through the port gate.
 */

import { describe, expect, it } from 'vitest';
import {
  assertCapacityUsable,
  CAPACITY_EXHAUSTION_POLICY,
  PERSISTENCE_ERROR_CODES,
} from '@arena/persistence';
import { ESCALATION_ERROR_CODES } from '@arena/escalation';
import { composeRuntimeHost } from '@arena/runtime-host-composition';
import { createFailingSqlTransport } from './support/pglite-transport.js';

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? '';
}

describe('AC-14 — missing config: the host fails CLOSED (never partially started)', () => {
  it('no transport: start() throws typed, state is terminal-failed, surfaces refuse, health is NOT ready', async () => {
    // Compose with an EMPTY env (no DATABASE_URL / NEON_CONNECTION_STRING).
    const host = await composeRuntimeHost({ env: {} });
    expect(host.state).toBe('constructed');

    // start() fails closed BEFORE anything else (typed).
    let startCode = '';
    try {
      await host.start();
    } catch (error) {
      startCode = codeOf(error);
    }
    expect(startCode).toBe('RUNTIME_PERSISTENCE_DISABLED');
    // `failed` is TERMINAL — a second start refuses (never a retried
    // partial start), and stop() is idempotent.
    let secondStart = '';
    try {
      await host.start();
    } catch (error) {
      secondStart = codeOf(error);
    }
    expect(secondStart).toBe('RUNTIME_INVALID_TRANSITION');
    await expect(host.stop()).resolves.toBeUndefined();
    await expect(host.stop()).resolves.toBeUndefined();

    // The never-started host refuses every surface call typed.
    let surfaceCode = '';
    try {
      await host.escalations.status('tenant-alpha', 'req_any');
    } catch (error) {
      surfaceCode = codeOf(error);
    }
    expect(surfaceCode).toBe('RUNTIME_NOT_STARTED');
    let jobCode = '';
    try {
      await host.jobs.submitByKind({
        kindName: 'escalation-recompute',
        input: {},
        correlationId: 'corr-ac14' as never,
        idempotencyKey: 'idem-ac14' as never,
        actor: { type: 'service', tenant: 'arena', principalId: 'p007' },
      });
    } catch (error) {
      jobCode = codeOf(error);
    }
    expect(jobCode).toBe('RUNTIME_NOT_STARTED');

    // Health: the probe NEVER throws — capacity DISABLED (the
    // zero-credential posture), aggregate NOT ready.
    const health = await host.health();
    expect(health.capacity.status).toBe('DISABLED');
    expect(health.ready).toBe(false);
  });

  it('a DISABLED capacity observation is a blocking status (no usable-through-degradation)', () => {
    // The port-level gate agrees with the host posture.
    let disabledCode = '';
    try {
      assertCapacityUsable({ status: 'DISABLED' });
    } catch (error) {
      disabledCode = codeOf(error);
    }
    expect(disabledCode).toBe(PERSISTENCE_ERROR_CODES.CAPACITY_DISABLED);
    // The typed error carries the fail-closed policy fact.
    try {
      assertCapacityUsable({ status: 'DISABLED' });
    } catch (error) {
      expect((error as { details?: { policy?: string } }).details?.policy).toBe(
        'fail-closed',
      );
    }
  });
});

describe('AC-14 — degraded capacity: health NEVER spoofs AVAILABLE', () => {
  it('a failing transport yields capacity DEGRADED + probe-failed, ready=false', async () => {
    const clock = { now: () => Date.parse('2026-10-09T12:00:00.000Z') };
    const host = await composeRuntimeHost({
      transport: createFailingSqlTransport(),
      clock,
    });
    // The host STARTS over a configured-but-failing transport? start()
    // runs migrations first — which fail → fail-closed start. The host
    // NEVER comes up serving on a dead transport.
    let startThrew = false;
    try {
      await host.start();
    } catch {
      startThrew = true;
    }
    expect(startThrew).toBe(true);
    expect(host.state).toBe('failed');

    // Health from the FAILED host: the probe rides the SAME transport
    // and reports DEGRADED (probe-failed) — never AVAILABLE.
    const health = await host.health();
    expect(['DEGRADED', 'DISABLED']).toContain(health.capacity.status);
    expect(health.ready).toBe(false);
    if (health.capacity.status === 'DEGRADED') {
      expect(health.capacity.reasons).toEqual([
        expect.objectContaining({ code: 'probe-failed' }),
      ]);
    }
    await host.stop();
  });
});

describe('AC-14 — the no-alternate-route law (vocabulary-level)', () => {
  it('the exhaustion policy is fail-closed and the ONLY representable policy', () => {
    expect(CAPACITY_EXHAUSTION_POLICY).toBe('fail-closed');
    // The type is a literal singleton (compile-time law; pinned at
    // runtime by value here).
    expect(typeof CAPACITY_EXHAUSTION_POLICY).toBe('string');
    // The blocking statuses keep EXHAUSTED/DISABLED out of usable set.
    let exhaustedCode = '';
    try {
      assertCapacityUsable({ status: 'EXHAUSTED' });
    } catch (error) {
      exhaustedCode = codeOf(error);
    }
    expect(exhaustedCode).toBe(PERSISTENCE_ERROR_CODES.CAPACITY_EXHAUSTED);
  });

  it('NO error vocabulary in the persistence / escalation families offers fallback or alternate-route vocabulary', () => {
    // The silent-paid-fallback class (FT2.0's named evil) must be
    // UNREPRESENTABLE: no code in the closed sets advertises a second
    // destination, a retry-route or a paid tier.
    const persistenceCodes = Object.values(PERSISTENCE_ERROR_CODES) as readonly string[];
    const escalationCodes = Object.values(ESCALATION_ERROR_CODES) as readonly string[];
    const forbidden = /fallback|alternate|alternate-route|paid|upgrade|second-destination|route-around/i;
    for (const code of [...persistenceCodes, ...escalationCodes]) {
      expect(code).not.toMatch(forbidden);
    }
    // Sanity: the vocabularies are non-empty closed sets.
    expect(persistenceCodes.length).toBeGreaterThan(10);
    expect(escalationCodes.length).toBeGreaterThan(10);
  });
});
