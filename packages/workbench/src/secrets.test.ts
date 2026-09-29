/**
 * No-secrets negatives (Work Order A017): no tokens, credentials or
 * provider/brand strings appear in ANY rendered page or in the
 * reference corpus — including the DEGRADED pages (a degradation banner
 * must never leak the reason a source failed in credential-shaped
 * form). The deny-lists live only in this test file (the checker must
 * not be part of the scanned surface), mirroring the A018 conventions.
 *
 * Credential matching is SHAPE-AWARE (the A018 app-suite pattern): key
 * material is long and charset-constrained, so neutral identifiers such
 * as `task-spec` or `task-fixture-review` never match.
 */

import { describe, expect, it } from 'vitest';
import { WORKBENCH_ROUTES, handleWorkbenchRequest } from './router.js';
import {
  makeDegradedCorpus,
  makeEmptyDegradedCorpus,
  makeFixtureCorpus,
  FIXTURE_TRAJECTORY_ID,
} from './test-support.js';

/** Credential-VALUE shapes and access material (never rendered, never seeded). */
const CREDENTIAL_PATTERN =
  /(ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9]{20,}|xoxb-[0-9A-Za-z-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN|bearer\s|apikey|api-key|api_key|password=|secret=|authorization:)/i;

/** Model/provider brand names (case-insensitive substring semantics). */
const PROVIDER_PATTERN =
  /(openai|anthropic|gpt-|claude|gemini|mistral|groq|ollama|deepseek|bedrock|copilot|azure|google|amazon)/i;

const ALL_ROUTES = [...WORKBENCH_ROUTES, `/trajectories/${FIXTURE_TRAJECTORY_ID}`] as const;

describe('no-secrets negatives over every rendered page', () => {
  it('renders no credential or provider material on any route (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    for (const method of ['GET', 'POST']) {
      for (const path of ALL_ROUTES) {
        const response = handleWorkbenchRequest({ method, path }, corpus);
        expect(
          CREDENTIAL_PATTERN.test(response.html),
          `${method} ${path} leaked credentials`,
        ).toBe(false);
        expect(PROVIDER_PATTERN.test(response.html), `${method} ${path} leaked a brand`).toBe(
          false,
        );
      }
    }
  });

  it('renders no credential or provider material on DEGRADED pages either (negative, R41)', async () => {
    for (const corpus of [await makeDegradedCorpus(), await makeEmptyDegradedCorpus()]) {
      for (const method of ['GET', 'POST']) {
        for (const path of ALL_ROUTES) {
          const response = handleWorkbenchRequest({ method, path }, corpus);
          expect(
            CREDENTIAL_PATTERN.test(response.html),
            `degraded ${method} ${path} leaked credentials`,
          ).toBe(false);
          expect(
            PROVIDER_PATTERN.test(response.html),
            `degraded ${method} ${path} leaked a brand`,
          ).toBe(false);
        }
      }
    }
  });

  it('carries no secrets in the corpus itself (negative)', async () => {
    for (const corpus of [
      await makeFixtureCorpus(),
      await makeDegradedCorpus(),
      await makeEmptyDegradedCorpus(),
    ]) {
      const serialized = JSON.stringify(corpus);
      expect(CREDENTIAL_PATTERN.test(serialized)).toBe(false);
      expect(PROVIDER_PATTERN.test(serialized)).toBe(false);
    }
  });

  it('the scanner itself detects the deny-list words (self-test, negative control)', async () => {
    // Assembled at runtime so no literal token-shaped string is committed.
    const githubPat = ['g', 'h', 'p', '_'].join('') + 'a1b2c3d4e5f6a7b8c9d0';
    expect(CREDENTIAL_PATTERN.test(`token: ${githubPat}`)).toBe(true);
    expect(CREDENTIAL_PATTERN.test('key: sk-abcdefghijklmnopqrstuvwx')).toBe(true);
    expect(CREDENTIAL_PATTERN.test('Authorization: Bearer xyz')).toBe(true);
    expect(CREDENTIAL_PATTERN.test('x-api-key: abc')).toBe(true);
    // No false positives on the workbench vocabulary:
    const corpus = await makeFixtureCorpus();
    const serialized = JSON.stringify(corpus);
    expect(/task-fixture-review/.test(serialized)).toBe(true);
    expect(CREDENTIAL_PATTERN.test(serialized)).toBe(false);
    expect(PROVIDER_PATTERN.test(serialized)).toBe(false);
  });
});
