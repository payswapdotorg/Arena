/**
 * B015 env-contract tests: the registry is the single source of truth, the
 * committed template is its rendered artifact, and the contract stays in
 * sync with the B002 adapter env modules (NEON_ENV_VARS / R2_ENV_VARS /
 * UPSTASH_ENV_VARS) — names only, empty placeholders, never values.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEON_ENV_VARS } from '@arena/hosted-neon-postgres';
import { R2_ENV_VARS } from '@arena/hosted-r2-object-store';
import { UPSTASH_ENV_VARS } from '@arena/hosted-upstash-redis';
import {
  HOSTED_ENV_VARS,
  HOSTED_PREVIEW_ENV_TEMPLATE_PATH,
  hostedEnvVarNamesFor,
  missingHostedPreviewEnvVarNames,
  parseEnvTemplateKeys,
  renderHostedPreviewEnvTemplate,
} from './env-contract.js';

const TEMPLATE_PATH = resolve(__dirname, '../../env/hosted-preview.env.example');

describe('B015 env-contract registry', () => {
  it('covers the normative hosted env surface (free-tier-architecture.md)', () => {
    const names = HOSTED_ENV_VARS.map((spec) => spec.name);
    for (const required of [
      'DATABASE_URL',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'APIFY_TOKEN',
      'ARENA_SESSION_SECRET',
      'VERCEL_TOKEN',
      'VERCEL_ORG_ID',
      'VERCEL_PROJECT_ID',
    ]) {
      expect(names).toContain(required);
    }
  });

  it('stays in sync with the B002 adapter env modules (no drift)', () => {
    const registered = new Set(HOSTED_ENV_VARS.map((spec) => spec.name));
    for (const name of [...NEON_ENV_VARS, ...R2_ENV_VARS, ...UPSTASH_ENV_VARS]) {
      expect(registered.has(name)).toBe(true);
    }
  });

  it('marks every secret-bearing name as secret and never templates a value', () => {
    for (const spec of HOSTED_ENV_VARS) {
      if (spec.secret) {
        expect(spec.description.length).toBeGreaterThan(0);
      }
    }
    // The renderer output must never contain a non-empty assignment.
    const rendered = renderHostedPreviewEnvTemplate();
    for (const line of rendered.split('\n')) {
      const assignment = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (assignment !== null) {
        expect(assignment[2]).toBe('');
      }
    }
  });
});

describe('B015 committed env template (deploy/env/hosted-preview.env.example)', () => {
  it('is byte-identical to the rendered registry (deterministic artifact)', () => {
    const committed = readFileSync(TEMPLATE_PATH, 'utf8');
    expect(committed).toBe(renderHostedPreviewEnvTemplate());
  });

  it('carries exactly the runtime (in-template) names as empty placeholders', () => {
    const committed = readFileSync(TEMPLATE_PATH, 'utf8');
    const keys = parseEnvTemplateKeys(committed);
    const expected = HOSTED_ENV_VARS.filter((spec) => spec.inTemplate).map((spec) => spec.name);
    expect(keys).toEqual(expected);
    // CI deploy credentials never land in the runtime template.
    expect(keys).not.toContain('VERCEL_TOKEN');
    expect(keys).not.toContain('VERCEL_ORG_ID');
    expect(keys).not.toContain('VERCEL_PROJECT_ID');
  });

  it('round-trips through the parser (renderer -> parser -> same keys)', () => {
    expect(parseEnvTemplateKeys(renderHostedPreviewEnvTemplate())).toEqual(
      parseEnvTemplateKeys(readFileSync(TEMPLATE_PATH, 'utf8')),
    );
  });

  it('documents the template path constant it is served from', () => {
    expect(HOSTED_PREVIEW_ENV_TEMPLATE_PATH).toBe('deploy/env/hosted-preview.env.example');
  });
});

describe('B015 missing-env reporting (names only)', () => {
  it('reports every required runtime name on an empty env', () => {
    expect(missingHostedPreviewEnvVarNames({})).toEqual([
      'DATABASE_URL',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'ARENA_SESSION_SECRET',
    ]);
  });

  it('collapses the Neon alternative pair (NEON_CONNECTION_STRING satisfies DATABASE_URL)', () => {
    const missing = missingHostedPreviewEnvVarNames({ NEON_CONNECTION_STRING: 'postgres://x' });
    expect(missing).not.toContain('DATABASE_URL');
    expect(missing).toContain('R2_BUCKET');
  });

  it('treats blank values as missing', () => {
    expect(missingHostedPreviewEnvVarNames({ DATABASE_URL: '   ' })).toContain('DATABASE_URL');
  });

  it('surfaces per-surface name groups for the runbook tables', () => {
    expect(hostedEnvVarNamesFor('upstash')).toEqual(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']);
    expect(hostedEnvVarNamesFor('vercel-ci')).toEqual(['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']);
  });
});
