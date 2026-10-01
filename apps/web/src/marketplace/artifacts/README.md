# Artifact Marketplace Web Surface (A032)

Read-only web views over the dataset / evaluation-suite / environment
marketplace (`services/marketplace-artifacts`) — the A018 console
web-surface house pattern, in the app layer because A032 owns no
UI-package surface.

## Files

- `server.ts` — the node:http transport (zero deps, injected pure
  handler, fail-closed 500, HEAD suppression, 405 + Allow);
- `router.mjs` — the pure router/renderer (GET/HEAD only; every view is
  projected from the frozen corpus; every interpolation is escaped;
  byte-deterministic rendering);
- `corpus.mjs` — the deterministic seeded corpus: REAL domain artifacts
  (A002/A009/A012/A013/A014 factories) driven through the REAL
  marketplace service (gate → listings, license/data-rights → grants,
  grant gating → reviews), then projected back through the service's
  query surface;
- `corpus.d.mts` / `router.d.mts` — the self-contained type surface
  (the frozen @arena/web manifest forbids cross-tree compiled imports);
- `loader.mjs` — the `.js` → `.ts` resolution shim;
- `main.mjs` — the bootstrap (`node --experimental-strip-types
  apps/web/src/marketplace/artifacts/main.mjs`, port
  `$ARENA_MARKETPLACE_PORT` default 8790);
- `marketplace.test.ts` — content gates, corpus determinism + freeze,
  read-only method policy, escaping, golden-digest stability,
  no-secrets negatives and a real node:http round trip.

## Routes

`/` (alias `/offers`) — the listing cards; `/offers/<offerId>` — the
artifact profile (license/rights, admission evidence with digests,
grants, reviews). Everything else is 404; every non-GET/HEAD is 405.
