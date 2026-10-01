/**
 * Executed local parity (Work Order B004; FT2.0): the shared behavioral
 * session-store contract suite (defineSessionContractSuite from
 * @arena/auth) runs against the durable ControlPlaneSessionStore composed
 * over the B002 in-memory fakes. Parity is not a claim — it is executed:
 * the same suite that validates FakeSessionStore (in packages/auth)
 * validates the control-plane-backed store here.
 */

import { defineSessionContractSuite, ManualAuthClock } from '@arena/auth';
import { FakeControlPlaneRepository, FakeCoordinationStore } from '@arena/persistence';
import { ControlPlaneSessionStore } from './control-plane-session-store.js';

defineSessionContractSuite('ControlPlaneSessionStore over B002 fakes', () => {
  const clock = new ManualAuthClock(0);
  const controlPlane = new FakeControlPlaneRepository({ clock });
  const coordination = new FakeCoordinationStore({ clock });
  const store = new ControlPlaneSessionStore({
    controlPlane,
    coordination,
    clock,
    // 0 disables the epoch cache: the suite's expiry/epoch transitions must
    // observe the authoritative control-plane state immediately.
    epochCacheTtlMs: 0,
  });
  return { store, clock };
});
