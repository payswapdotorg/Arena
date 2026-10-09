/**
 * P004 — Upstash failure/capacity matrix (fail-closed posture, live rows).
 *
 *   LIVE rows:
 *     - wrong REST token against the REAL endpoint → typed
 *       PERSISTENCE_TRANSPORT_FAILED (fail closed; no fallback, no
 *       silent retry to another destination), capacity probe DEGRADED;
 *     - unreachable endpoint → typed TRANSPORT_FAILED through a REAL
 *       network failure (RFC-2606 `.invalid` host — genuine DNS
 *       resolution failure, no provider round-trip; the row says exactly
 *       that), capacity probe DEGRADED.
 *
 *   The DISABLED (no configuration) posture belongs to the
 *   zero-credential suite — the two halves together cover the failure
 *   matrix: unconfigured → DISABLED before any network call;
 *   misconfigured/unreachable → typed transport error, never a fallback.
 */

import { describe, expect, it } from 'vitest';
import {
  isPersistenceError,
  PERSISTENCE_ERROR_CODES,
  toCoordinationKey,
} from '@arena/persistence';
import { UpstashCoordinationStore, readUpstashConfigFromEnv } from '@arena/hosted-upstash-redis';
import { resolveUpstashLive } from '../support/live-env.js';
import { recordTranscript } from '../support/transcript.js';

const FACET = 'upstash-failure-capacity';

const gate = resolveUpstashLive();

/** Deliberately-invalid bearer token (never a real secret). */
const WRONG_TOKEN = 'arena-p004-deliberately-invalid-token';

/** RFC-2606 reserved: guaranteed NXDOMAIN — a REAL network failure path. */
const UNREACHABLE_URL = 'https://p004-unreachable-host.invalid';

describe('upstash failure matrix gates (always run)', () => {
  it('reports the live-suite activation status with an explicit reason', (ctx) => {
    if (gate.live === null) {
      ctx.skip(
        'Upstash REST configuration incomplete — the live failure rows need UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in the environment',
      );
    }
  });
});

describe.skipIf(gate.live === null)('upstash wrong-credential posture (live endpoint)', () => {
  const live = gate.live!;

  it('wrong REST token → typed TRANSPORT_FAILED (fail closed, no fallback)', async () => {
    const store = new UpstashCoordinationStore({
      env: {
        UPSTASH_REDIS_REST_URL: live.config.url,
        UPSTASH_REDIS_REST_TOKEN: WRONG_TOKEN,
      },
    });
    expect(store.enabled).toBe(true); // configured (but wrong) — NOT disabled
    let caught: unknown;
    try {
      await store.cacheSet(toCoordinationKey('p004-wrong-token-probe'), 'value', 60_000);
    } catch (error) {
      caught = error;
    }
    expect(isPersistenceError(caught)).toBe(true);
    const typed = caught as { code?: string; message?: string; cause?: unknown };
    expect(typed.code).toBe(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED);
    expect(typed.message).not.toContain(WRONG_TOKEN);
    const cause = typed.cause as { message?: string };
    recordTranscript(FACET, {
      step: 'wrong credentials (REST bearer token)',
      command: 'UpstashCoordinationStore.cacheSet(...) with UPSTASH_REDIS_REST_TOKEN=<deliberately-invalid> [transport: SET over REST]',
      resource: live.config.url,
      result: `typed PERSISTENCE_TRANSPORT_FAILED (cause: ${String(cause?.message ?? 'n/a')} — the endpoint rejected the token; detail stays in cause, never in the typed message) — fail closed, no silent fallback`,
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('wrong token → capacity probe DEGRADED (probe-failed), not AVAILABLE', async () => {
    const store = new UpstashCoordinationStore({
      env: {
        UPSTASH_REDIS_REST_URL: live.config.url,
        UPSTASH_REDIS_REST_TOKEN: WRONG_TOKEN,
      },
    });
    const snapshot = await store.capacityProbe();
    expect(snapshot.status).toBe('DEGRADED');
    expect(snapshot.reasons).toEqual([{ code: 'probe-failed' }]);
    recordTranscript(FACET, {
      step: 'wrong credentials — capacity state',
      command: 'UpstashCoordinationStore.capacityProbe() with UPSTASH_REDIS_REST_TOKEN=<deliberately-invalid> [transport: PING over REST]',
      resource: live.config.url,
      result: 'status=DEGRADED reasons=[probe-failed] (a misconfigured adapter is never reported healthy)',
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('unreachable endpoint → typed TRANSPORT_FAILED through a real network failure', async () => {
    const store = new UpstashCoordinationStore({
      env: {
        UPSTASH_REDIS_REST_URL: UNREACHABLE_URL,
        UPSTASH_REDIS_REST_TOKEN: live.config.token,
      },
    });
    let caught: unknown;
    try {
      await store.cacheGet(toCoordinationKey('p004-unreachable-probe'));
    } catch (error) {
      caught = error;
    }
    expect(isPersistenceError(caught)).toBe(true);
    expect((caught as { code?: string }).code).toBe(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED);
    const snapshot = await store.capacityProbe();
    expect(snapshot.status).toBe('DEGRADED');
    recordTranscript(FACET, {
      step: 'unreachable endpoint',
      command: `UpstashCoordinationStore.cacheGet(...) with UPSTASH_REDIS_REST_URL=${UNREACHABLE_URL} [transport: GET over REST]`,
      resource: UNREACHABLE_URL,
      result: 'typed PERSISTENCE_TRANSPORT_FAILED; capacity probe DEGRADED. Scope stated exactly: a REAL DNS resolution failure (RFC-2606 .invalid host) through the real network stack — no provider round-trip is involved in this row',
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('readUpstashConfigFromEnv resolves null only for genuinely unusable configurations', () => {
    // Structural cross-check of the gate itself: a non-http URL or a
    // blank token must resolve to DISABLED (fail closed), never to a
    // half-configured transport.
    expect(readUpstashConfigFromEnv({})).toBeNull();
    expect(
      readUpstashConfigFromEnv({
        UPSTASH_REDIS_REST_URL: 'not-a-url',
        UPSTASH_REDIS_REST_TOKEN: 'token',
      }),
    ).toBeNull();
    expect(
      readUpstashConfigFromEnv({
        UPSTASH_REDIS_REST_URL: live.config.url,
        UPSTASH_REDIS_REST_TOKEN: '   ',
      }),
    ).toBeNull();
    expect(true).toBe(true);
  });
});
