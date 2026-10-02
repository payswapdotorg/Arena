/**
 * B015 Vercel profile tests: the hosted-preview deployment profile
 * validates against the free-tier (Hobby) constraints, and CI deploy
 * credential resolution fails closed with NAMES only.
 */

import { describe, expect, it } from 'vitest';
import {
  HOSTED_PREVIEW_VERCEL_PROFILE,
  missingVercelDeployEnvVarNames,
  resolveVercelDeployConfig,
  validateVercelProjectProfile,
  VERCEL_DEPLOY_ENV_VARS,
} from './vercel.js';
import type { VercelProjectProfile } from './vercel.js';

describe('B015 Vercel project profile (hosted preview)', () => {
  it('targets the Next.js app root with a frozen-lockfile install on Node 22', () => {
    expect(HOSTED_PREVIEW_VERCEL_PROFILE.rootDirectory).toBe('apps/web');
    expect(HOSTED_PREVIEW_VERCEL_PROFILE.framework).toBe('nextjs');
    expect(HOSTED_PREVIEW_VERCEL_PROFILE.installCommand).toContain('--frozen-lockfile');
    expect(HOSTED_PREVIEW_VERCEL_PROFILE.nodeVersion).toBe('22.x');
    expect(HOSTED_PREVIEW_VERCEL_PROFILE.target).toBe('production');
  });

  it('bounds function duration to the Vercel Hobby ceiling (300s)', () => {
    expect(HOSTED_PREVIEW_VERCEL_PROFILE.functionMaxDurationSeconds).toBe(300);
    expect(validateVercelProjectProfile(HOSTED_PREVIEW_VERCEL_PROFILE)).toEqual({ ok: true });
  });

  it('rejects profiles that break the free-tier/monorepo constraints (fail closed)', () => {
    const wrongRoot: VercelProjectProfile = { ...HOSTED_PREVIEW_VERCEL_PROFILE, rootDirectory: '/abs' };
    expect(validateVercelProjectProfile(wrongRoot).ok).toBe(false);

    const paidDuration: VercelProjectProfile = {
      ...HOSTED_PREVIEW_VERCEL_PROFILE,
      functionMaxDurationSeconds: 900,
    };
    expect(validateVercelProjectProfile(paidDuration).ok).toBe(false);

    const floatingInstall: VercelProjectProfile = {
      ...HOSTED_PREVIEW_VERCEL_PROFILE,
      installCommand: 'pnpm install',
    };
    expect(validateVercelProjectProfile(floatingInstall).ok).toBe(false);

    const wrongNode: VercelProjectProfile = { ...HOSTED_PREVIEW_VERCEL_PROFILE, nodeVersion: '20.x' };
    expect(validateVercelProjectProfile(wrongNode).ok).toBe(false);
  });
});

describe('B015 Vercel CI deploy credentials (GitHub repository secrets)', () => {
  it('documents the three secret names', () => {
    expect(VERCEL_DEPLOY_ENV_VARS).toEqual(['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']);
  });

  it('fails closed by NAME on an empty env (the TL injects at B019)', () => {
    expect(missingVercelDeployEnvVarNames({})).toEqual([
      'VERCEL_TOKEN',
      'VERCEL_ORG_ID',
      'VERCEL_PROJECT_ID',
    ]);
    expect(resolveVercelDeployConfig({})).toBeNull();
  });

  it('resolves only when all three are present and non-blank', () => {
    expect(resolveVercelDeployConfig({ VERCEL_TOKEN: 't' })).toBeNull();
    expect(missingVercelDeployEnvVarNames({ VERCEL_TOKEN: 't', VERCEL_ORG_ID: ' ' })).toEqual([
      'VERCEL_ORG_ID',
      'VERCEL_PROJECT_ID',
    ]);
    const resolved = resolveVercelDeployConfig({
      VERCEL_TOKEN: ' token ',
      VERCEL_ORG_ID: 'org',
      VERCEL_PROJECT_ID: 'proj',
    });
    expect(resolved).toEqual({ token: 'token', orgId: 'org', projectId: 'proj' });
  });
});
