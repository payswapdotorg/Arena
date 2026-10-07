/**
 * @arena/capability-routing-service — the reference service for Work
 * Order C015 (issue #121): wiring the @arena/capability-routing
 * cross-resource compiler + ResourceMatch engine to injected catalog
 * ports (fail-closed per class), an append-only decision log, and
 * durable idempotent routing jobs over the A015 job-protocol submission
 * identity. In-memory reference fabric + structural-mirror adapters
 * (C014 listings / A032 offers + entitlements / C008 tool specs) live in
 * fabric.ts.
 */

export * from './ports.js';
export * from './jobs.js';
export * from './fabric.js';
export * from './service.js';
