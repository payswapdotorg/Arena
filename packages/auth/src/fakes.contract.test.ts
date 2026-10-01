/**
 * The shared session contract suite executed against the in-memory fake
 * (Work Order B004) — services/auth runs the SAME suite against the
 * control-plane-backed durable store (parity is executed, not asserted).
 */

import { describe, expect, it } from 'vitest';
import { FakeSessionStore, ManualAuthClock } from './fakes/index.js';
import { fixtureSessionRecord } from './test-support.js';
import { defineSessionContractSuite } from './testing/contract-suite.js';

defineSessionContractSuite('FakeSessionStore', () => {
  const clock = new ManualAuthClock(0);
  return { store: new FakeSessionStore({ clock }), clock };
});

describe('FakeSessionStore specific behavior', () => {
  it('shares one injected clock across operations (deterministic)', async () => {
    const clock = new ManualAuthClock(1_000);
    const store = new FakeSessionStore({ clock });
    const issued = await store.issue(fixtureSessionRecord({ issuedAt: 1_000 }));
    expect(issued.issuedAt).toBe(1_000);
    clock.advance(120_000);
    expect((await store.validate(issued.sessionId)).status).toBe('expired');
  });
});
