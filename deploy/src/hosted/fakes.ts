/**
 * Local fakes for the hosted wiring dry-run (Work Order B015).
 *
 * NO second fake implementations: these are re-exports of the B002 adapter
 * test-support transports (`FakeSqlTransport`, `FakeObjectStorageTransport`,
 * `FakeRestTransport`) — the in-memory implementations of the adapter
 * transport seams that already run the full B002 persistence contract
 * suite without live credentials. B015's dry-run injects them through the
 * same seams (FT2.0 "Local parity": every hosted adapter has a local
 * fake/in-memory implementation exercising the same contract).
 *
 * The adapters keep test-support private to their public barrels (A033
 * hygiene precedent); the deploy wiring — the sanctioned composition layer
 * — reaches the source files directly through the same tsconfig/vitest
 * path mapping A036's @arena/deploy already uses for cross-package source
 * imports.
 */

export {
  FakeSqlTransport,
} from '@arena/hosted-neon-postgres/test-support';
export type { FakeSqlTransportOptions } from '@arena/hosted-neon-postgres/test-support';
export {
  FakeObjectStorageTransport,
} from '@arena/hosted-r2-object-store/test-support';
export type { FakeObjectStorageTransportOptions } from '@arena/hosted-r2-object-store/test-support';
export { FakeRestTransport } from '@arena/hosted-upstash-redis/test-support';
export type { FakeRestTransportOptions } from '@arena/hosted-upstash-redis/test-support';
