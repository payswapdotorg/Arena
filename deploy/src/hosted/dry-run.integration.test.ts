/**
 * B015 dry-run integration test: executes the FULL wiring path against
 * the B002 local fakes — env resolution, adapter instantiation, capacity
 * probes, the fail-closed guard, deterministic bootstrap and the
 * fail-closed refusal simulation — with ZERO live credentials and ZERO
 * network. This is the deploy workflow's wiring self-test.
 */

import { describe, expect, it } from 'vitest';
import { formatDryRunReport, runHostedWiringDryRun } from './dry-run.js';

describe('B015 hosted-wiring dry run (integration, credential-free)', () => {
  it('passes end to end against an empty env (pre-provisioning posture)', async () => {
    const report = await runHostedWiringDryRun({});
    const failures = report.checks.filter((check) => check.status === 'fail');
    expect(failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.mode).toBe('dry-run');
  });

  it('passes end to end against placeholder-shaped values (provisioned posture)', async () => {
    const report = await runHostedWiringDryRun({
      DATABASE_URL: 'postgres://someone:somewhere@example.invalid/db',
      R2_ACCOUNT_ID: 'abc123',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'bucket',
      UPSTASH_REDIS_REST_URL: 'https://example.invalid',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      ARENA_SESSION_SECRET: 'a'.repeat(48),
    });
    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === 'env-presence:control-plane-store')?.status).toBe('pass');
  });

  it('covers the full check spectrum (presence, resolution, profile, quotas, composition, bootstrap, fail-closed)', async () => {
    const report = await runHostedWiringDryRun({});
    const ids = report.checks.map((check) => check.id);
    for (const expected of [
      'env-presence:control-plane-store',
      'env-presence:object-store',
      'env-presence:coordination-store',
      'env-presence:apify-optional',
      'env-presence:session-boundary',
      'wiring-resolve:control-plane-store',
      'wiring-resolve:object-store',
      'wiring-resolve:coordination-store',
      'vercel-profile',
      'vercel-deploy-credentials',
      'quota-ceilings',
      'fail-closed-policy',
      'vercel-hobby-constraints',
      'composition:control-plane-store',
      'composition:object-store',
      'composition:coordination-store',
      'composition:capacity-guard',
      'bootstrap:migrations',
      'bootstrap:seed',
      'bootstrap:reproducible',
      'fail-closed:exhausted',
      'fail-closed:disabled',
    ]) {
      expect(ids).toContain(expected);
    }
  });

  it('reports names only — env VALUES never leak into the report', async () => {
    const canary = 'canary-value-that-must-never-leak';
    const report = await runHostedWiringDryRun({
      DATABASE_URL: `postgres://user:${canary}@example.invalid/db`,
      UPSTASH_REDIS_REST_TOKEN: canary,
      ARENA_SESSION_SECRET: canary,
    });
    expect(JSON.stringify(report)).not.toContain(canary);
    expect(formatDryRunReport(report)).not.toContain(canary);
  });

  it('FAILS when a provided value is unusable (present-but-broken beats silent-ignore)', async () => {
    const report = await runHostedWiringDryRun({
      DATABASE_URL: 'mysql://definitely-not-postgres',
      ARENA_SESSION_SECRET: 'a'.repeat(48),
    });
    const presence = report.checks.find((check) => check.id === 'env-presence:control-plane-store');
    expect(presence?.status).toBe('fail');
    expect(report.ok).toBe(false);
  });

  it('FAILS when a provided session secret is too short (B004 parity)', async () => {
    const report = await runHostedWiringDryRun({
      DATABASE_URL: 'postgres://u:p@example.invalid/db',
      ARENA_SESSION_SECRET: 'short',
    });
    expect(report.checks.find((check) => check.id === 'env-presence:session-boundary')?.status).toBe('fail');
    expect(report.ok).toBe(false);
  });

  it('renders a human-readable report (names only)', async () => {
    const report = await runHostedWiringDryRun({});
    const text = formatDryRunReport(report);
    expect(text).toContain('hosted wiring dry-run: OK');
    expect(text).toContain('[PASS] composition:control-plane-store');
    expect(text).toContain('[WARN] env-presence:control-plane-store');
  });
});
