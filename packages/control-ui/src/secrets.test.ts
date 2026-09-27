/**
 * No-secrets negatives (Work Order A018, gate 9): no tokens, credentials
 * or provider/brand strings appear in ANY rendered page or in the
 * reference corpus. The deny-lists live only in this test file (the
 * checker must not be part of the scanned surface), mirroring the A003/
 * A016 hygiene conventions.
 */

import { describe, expect, it } from 'vitest';
import { CONSOLE_ROUTES, handleConsoleRequest } from './router.js';
import { makeFixtureCorpus, RUN_ID } from './test-support.js';

/** Credential-VALUE shapes and access material (never rendered, never seeded). */
const CREDENTIAL_DENY_LIST = [
  'ghp_', // GitHub PAT prefix
  'github_pat_',
  'sk-', // provider secret key prefix
  'xoxb-',
  'AKIA', // AWS access key id prefix
  '-----BEGIN', // PEM blocks
  'bearer ', // authorization headers (any case below)
  'apikey',
  'api-key',
  'api_key',
  'password=',
  'secret=',
  'authorization:',
];

/** Model/provider brand names (case-insensitive substring semantics). */
const PROVIDER_DENY_LIST = [
  'openai',
  'anthropic',
  'gpt-',
  'claude',
  'gemini',
  'mistral',
  'groq',
  'ollama',
  'deepseek',
  'bedrock',
  'copilot',
  'azure',
  'google',
  'amazon',
];

const CREDENTIAL_PATTERN = new RegExp(`(?:${CREDENTIAL_DENY_LIST.join('|')})`, 'i');
const PROVIDER_PATTERN = new RegExp(`(?:${PROVIDER_DENY_LIST.join('|')})`, 'i');

const ALL_ROUTES = [...CONSOLE_ROUTES, `/runs/${RUN_ID}/trajectory`] as const;

describe('no-secrets negatives (gate 9)', () => {
  it('renders no credential material on any route (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    for (const path of [...ALL_ROUTES, '/nope']) {
      for (const method of ['GET', 'HEAD', 'POST']) {
        const response = handleConsoleRequest({ method, path }, corpus);
        expect(
          CREDENTIAL_PATTERN.test(response.html),
          `${method} ${path} leaked credential-shaped material`,
        ).toBe(false);
      }
    }
  });

  it('renders no provider/brand strings on any route (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    for (const path of [...ALL_ROUTES, '/nope']) {
      const response = handleConsoleRequest({ method: 'GET', path }, corpus);
      expect(
        PROVIDER_PATTERN.test(response.html),
        `${path} leaked a provider brand string`,
      ).toBe(false);
    }
  });

  it('carries no secrets in the reference corpus (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    const serialized = JSON.stringify(corpus);
    expect(CREDENTIAL_PATTERN.test(serialized)).toBe(false);
    expect(PROVIDER_PATTERN.test(serialized)).toBe(false);
  });

  it('renders substrates by neutral ids and digests only (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    const response = handleConsoleRequest({ method: 'GET', path: '/substrates' }, corpus);
    // Neutral identifiers and content digests — never brand names.
    expect(response.html).toContain('substrate-fixture');
    expect(response.html).toContain('fixture-family');
    expect(response.html).toMatch(/[0-9a-f]{64}/);
    expect(PROVIDER_PATTERN.test(response.html)).toBe(false);
  });
});
