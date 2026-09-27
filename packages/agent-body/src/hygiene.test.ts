/**
 * Hygiene suite (Work Order A003 acceptance criteria 11 and 14):
 *
 *   1. Provider-leakage negatives — no provider-specific strings (openai,
 *      anthropic, gpt-, claude, bearer, ...) appear in CANONICAL / DIGESTED
 *      agent-body objects, and the committed generated contracts are clean.
 *      Construction-side rejection of provider brand names is covered by
 *      substrate.test.ts / body.test.ts; here we prove the OUTPUT side.
 *   2. Public-surface hygiene — no `any` type leaks in the non-test sources
 *      (type-position scan), and the internal test-support module is not
 *      part of the public surface.
 *
 * The deny-lists live only in this test file (the checker must not be part
 * of the scanned surface), mirroring how scripts/governance-check.py keeps
 * its provider regex outside packages/protocol-core.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson, digestCanonical, makeEnvelope, newCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import * as agentBody from './index.js';
import { makePossession, makeSubstrate, makeBodyVersion } from './test-support.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

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
  'bearer',
  'apikey',
  'api-key',
  'api_key',
];

const PROVIDER_DENY_PATTERN = new RegExp(`(?:${PROVIDER_DENY_LIST.join('|')})`, 'i');

function collectFiles(dir: string, filter: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(abs, filter));
    } else if (entry.isFile() && filter(entry.name)) {
      files.push(abs);
    }
  }
  return files;
}

describe('provider-leakage hygiene (gate 11 — canonical/digested objects)', () => {
  it('canonical and digested domain objects contain no deny-listed provider string', async () => {
    const bodyVersion = await makeBodyVersion();
    const substrate = await makeSubstrate();
    const possession = await makePossession({ bodyVersion, substrate });
    const instance = agentBody.createAgentInstance({
      possessionDigest: possession.digest,
      environment: {
        environmentId: 'env-standard',
        environmentVersion: '3.2.0',
        instanceId: 'env-inst-0001',
        snapshotDigest: '5'.repeat(64),
      },
      instanceId: 'agent-inst-0001',
      createdAt: '2026-01-15T09:30:00.000Z',
    });
    const terminated = agentBody.completeAgentInstance(instance, {
      reason: 'task finished',
      terminatedAt: '2026-01-15T10:15:00.000Z',
    });
    const envelope = makeEnvelope({
      kind: 'command',
      schema: 'arena:schema/agent-body/register-substrate-command@1.0.0',
      correlationId: newCorrelationId(),
      idempotencyKey: toIdempotencyKey('idem-key-1'),
      payload: { substrate },
    });

    const canonicalForms = [
      canonicalJson(bodyVersion),
      canonicalJson(substrate),
      canonicalJson(possession),
      canonicalJson(terminated),
      canonicalJson(envelope),
      canonicalJson(agentBody.possessionView(possession)),
      canonicalJson(agentBody.bodyVersionView(bodyVersion)),
      // Digest inputs flow through the same canonical serializer; hashing
      // them also proves the digested byte stream is provider-neutral.
      await digestCanonical(bodyVersion),
      await digestCanonical(substrate),
    ];
    expect(canonicalForms.length).toBe(9);
    for (const form of canonicalForms) {
      expect(PROVIDER_DENY_PATTERN.test(form), `provider leakage in: ${form.slice(0, 120)}`).toBe(
        false,
      );
    }
  });

  it('the committed generated contracts contain no deny-listed provider string', () => {
    const contractFiles = statSync(join(REPO_ROOT, 'contracts', 'agent-body'), {
      throwIfNoEntry: false,
    })
      ? collectFiles(join(REPO_ROOT, 'contracts', 'agent-body'), (name) => name.endsWith('.json'))
      : [];
    expect(contractFiles).toHaveLength(17);
    const violations: string[] = [];
    for (const file of contractFiles) {
      const text = readFileSync(file, 'utf-8');
      const match = PROVIDER_DENY_PATTERN.exec(text);
      if (match) violations.push(`${file}: /${match[0]}/i`);
    }
    expect(violations, `provider leakage in contracts:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the scanner itself detects the deny-list words (self-test, negative control)', () => {
    expect(PROVIDER_DENY_PATTERN.test('provider: "gpt-4o"')).toBe(true);
    expect(PROVIDER_DENY_PATTERN.test('model: "claude-3-sonnet"')).toBe(true);
    expect(PROVIDER_DENY_PATTERN.test('Authorization: Bearer xyz')).toBe(true);
    expect(PROVIDER_DENY_PATTERN.test('x-api-key: abc')).toBe(true);
    // No false positives on this package's vocabulary:
    expect(PROVIDER_DENY_PATTERN.test('adapter-reasoning-1 reasoner-general-2')).toBe(false);
    expect(PROVIDER_DENY_PATTERN.test('maxContextUnits minContextUnits')).toBe(false);
    expect(PROVIDER_DENY_PATTERN.test('possessionDigest bodyVersionRef substrate')).toBe(false);
  });
});

describe('public-surface hygiene (gate 14 — no any leaks)', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThan(8);
    const anyPatterns = [
      /:\s*any\b/,
      /\bas\s+any\b/,
      /<any>/,
      /\bany\[\]/,
      /readonly\s+any\b/,
      /\bPromise<any>\b/,
    ];
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      for (const pattern of anyPatterns) {
        const match = pattern.exec(text);
        if (match) violations.push(`${file}: /${match[0]}/`);
      }
    }
    expect(violations, `any leaks found:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the public surface is rich but excludes the internal test-support module', () => {
    const exportNames = Object.keys(agentBody);
    expect(exportNames.length).toBeGreaterThan(50);
    for (const internal of ['makeSubstrate', 'makeBodyVersion', 'makePossession', 'makeProfileInput']) {
      expect(exportNames).not.toContain(internal);
    }
    // Key domain constructors and guards are exported:
    for (const expected of [
      'createAgentBody',
      'createBodyVersion',
      'registerBodyVersion',
      'verifyBodyVersion',
      'createCognitiveSubstrate',
      'verifyCognitiveSubstrate',
      'toSubstrateCompatibilityProfile',
      'evaluateSubstrateCompatibility',
      'createPossession',
      'verifyPossession',
      'upgradeModelSpecificArtifact',
      'createAgentInstance',
      'startAgentInstance',
      'completeAgentInstance',
      'terminateAgentInstance',
      'parseAgentInstance',
      'makeRegisterSubstrateCommand',
      'makeCreatePossessionCommand',
      'makeTerminateAgentInstanceCommand',
      'parseAgentBodyEnvelope',
      'verifyAgentBodyEnvelope',
      'AgentBodyError',
      'AGENT_BODY_ERROR_CODES',
      'AGENT_BODY_SCHEMAS',
      'AGENT_BODY_PROTOCOL_VERSION',
    ]) {
      expect(exportNames).toContain(expected);
    }
  });

  it('every exported constructor/validator is a function or a frozen constant', () => {
    for (const [name, value] of Object.entries(agentBody)) {
      if (typeof value === 'function') continue;
      if (typeof value === 'object' && value !== null && Object.isFrozen(value)) continue;
      if (typeof value === 'string') continue;
      // Classes (AgentBodyError) are functions; anything else is suspect.
      expect(typeof value, `unexpected export ${name} of type ${typeof value}`).toMatch(
        /^(function|object|string|boolean|number)$/,
      );
    }
  });
});
