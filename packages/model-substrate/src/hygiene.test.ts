/**
 * Hygiene suite (Work Order A016 acceptance gates 2, 10, 11, 12):
 *
 *   1. Provider-leakage negatives — no provider-specific strings (openai,
 *      anthropic, gpt-, claude, bearer, ...) appear in CANONICAL / DIGESTED
 *      model-substrate objects, and the committed generated contracts are
 *      clean. Construction-side rejection is covered by the per-module
 *      suites; here we prove the OUTPUT side.
 *   2. Domain purity — the package's workspace imports are EXACTLY:
 *      @arena/protocol-core (runtime) and @arena/agent-body (type-only).
 *      Any other workspace import, or a non-type import of agent-body, is
 *      a violation (gate 10).
 *   3. Public-surface hygiene — no `any` type leaks in non-test sources;
 *      the public surface exports the protocol and NO possession-mutating
 *      or rebind APIs (R45), no provider names in export names.
 *
 * The deny-lists live only in this test file (the checker must not be part
 * of the scanned surface), mirroring the A003 hygiene conventions.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson, digestCanonical, makeEnvelope, newCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import * as modelSubstrate from './index.js';
import { createAdapterDescriptor } from './adapter.js';
import { createSubstrateRecord } from './substrate.js';
import { createSubstrateRegistry } from './registry.js';
import { createSubstrateCompatibilityResult, createSubstrateCompatibilityTest } from './compatibility.js';
import { createSubstrateUpgrade } from './upgrade.js';

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

describe('provider-leakage hygiene (gate 2 — canonical/digested objects)', () => {
  it('canonical and digested domain objects contain no deny-listed provider string', async () => {
    const descriptor = await createAdapterDescriptor({
      adapterId: 'neutral-mock',
      adapterVersion: '1.0.0',
      protocolVersion: modelSubstrate.MODEL_SUBSTRATE_PROTOCOL_VERSION,
      supportedModalities: ['text-input', 'text-output', 'structured-input'],
      supportedToolCalling: 'function-calling',
      contextCeiling: { maxContextUnits: 200000, maxOutputUnits: 32000 },
    });
    const substrate = await createSubstrateRecord({
      adapterId: 'neutral-mock',
      adapterVersion: '1.0.0',
      modelFamily: 'reasoner',
      modelId: 'reasoner-general-2',
      modelRevision: 'r7',
      modalityProfile: ['text-input', 'text-output', 'structured-input'],
      toolCallingProfile: 'function-calling',
      contextLimits: { maxContextUnits: 200000, maxOutputUnits: 32000 },
      conditions: ['stable'],
    });
    const registry = createSubstrateRegistry();
    const registration = await registry.register({
      substrateId: 'sub-reasoner-1',
      substrate,
      adapterDescriptor: descriptor,
      registeredAt: '2026-01-15T09:30:00.000Z',
    });
    const capabilityProfile = modelSubstrate.toSubstrateCapabilityProfile({
      modalityProfile: ['text-input', 'text-output'],
      toolCallingProfile: 'function-calling',
      contextLimits: { maxContextUnits: 1000, maxOutputUnits: 100 },
    });
    const health = modelSubstrate.toAdapterHealthReport({
      status: 'healthy',
      checkedAt: '2026-01-15T09:30:00.000Z',
      descriptorDigest: descriptor.digest,
      integrityVerified: true,
    });
    const compatTest = createSubstrateCompatibilityTest({
      testId: 'compat-1',
      bodyVersion: { tenant: 'tenant-a', name: 'structural-engineer', version: '1.2.0', digest: '1'.repeat(64) },
      substrateDigest: '2'.repeat(64),
      requiredModalities: ['text-input', 'text-output'],
      requiredToolCalling: 'json-schema',
      minContextUnits: 1000,
    });
    const compatResult = createSubstrateCompatibilityResult({
      testId: 'compat-1',
      bodyVersionDigest: '1'.repeat(64),
      substrateDigest: '2'.repeat(64),
      outcome: 'pass',
    });
    const upgrade = createSubstrateUpgrade({
      upgradeId: 'upgrade-1',
      fromSubstrateDigest: '1'.repeat(64),
      toSubstrateDigest: '2'.repeat(64),
      recertificationRequired: true,
    });
    const command = modelSubstrate.makeRegisterSubstrateCommand(
      { registration },
      { correlationId: newCorrelationId(), idempotencyKey: toIdempotencyKey('idem-1') },
    );
    const errorStruct = modelSubstrate.toModelSubstrateErrorStruct(
      new modelSubstrate.ModelSubstrateError(modelSubstrate.MODEL_SUBSTRATE_ERROR_CODES.TAMPERED, {
        message: 'tamper',
      }),
    );
    const envelope = makeEnvelope({
      kind: 'command',
      schema: 'arena:schema/model-substrate/register-substrate-command@1.0.0',
      correlationId: newCorrelationId(),
      idempotencyKey: toIdempotencyKey('idem-2'),
      payload: { registration },
    });

    const canonicalForms = [
      canonicalJson(descriptor),
      canonicalJson(substrate),
      canonicalJson(registration),
      canonicalJson(capabilityProfile),
      canonicalJson(health),
      canonicalJson(compatTest),
      canonicalJson(compatResult),
      canonicalJson(upgrade),
      canonicalJson(command),
      canonicalJson(envelope),
      canonicalJson(errorStruct),
      // Digest inputs flow through the same canonical serializer.
      await digestCanonical(substrate),
      await digestCanonical(descriptor),
    ];
    expect(canonicalForms.length).toBe(13);
    for (const form of canonicalForms) {
      expect(PROVIDER_DENY_PATTERN.test(form), `provider leakage in: ${form.slice(0, 120)}`).toBe(
        false,
      );
    }
  });

  it('the committed generated contracts contain no deny-listed provider string', () => {
    const contractDir = join(REPO_ROOT, 'contracts', 'model-substrate');
    expect(statSync(contractDir, { throwIfNoEntry: false })?.isDirectory()).toBe(true);
    const contractFiles = collectFiles(contractDir, (name) => name.endsWith('.json'));
    expect(contractFiles).toHaveLength(18);
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
    expect(PROVIDER_DENY_PATTERN.test('neutral-mock offline-stub reasoner-general-2')).toBe(false);
    expect(PROVIDER_DENY_PATTERN.test('maxContextUnits minContextUnits substrate')).toBe(false);
    expect(PROVIDER_DENY_PATTERN.test('adapterDescriptor recertificationRequired')).toBe(false);
  });
});

describe('domain purity (gate 10 — workspace imports)', () => {
  it('imports ONLY @arena/protocol-core (runtime) and @arena/agent-body (type-only)', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts'),
    );
    expect(sources.length).toBeGreaterThan(20);
    const violations: string[] = [];
    const workspaceImport = /(?:^|\n)\s*(import|export)\s+([^'"\n]*?)\s*(?:from\s*)?['"](@arena\/[a-z0-9-]+)['"]/g;
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      let match: RegExpExecArray | null;
      workspaceImport.lastIndex = 0;
      while ((match = workspaceImport.exec(text)) !== null) {
        const clause = match[2] ?? '';
        const specifier = match[3] ?? '';
        if (specifier === '@arena/protocol-core') continue; // runtime + type import allowed
        if (specifier === '@arena/agent-body') {
          // TYPE-ONLY import: the clause must start with `type`.
          if (!/^\s*type\b/.test(clause)) {
            violations.push(`${file}: non-type agent-body import (${specifier})`);
          }
          continue;
        }
        violations.push(`${file}: forbidden workspace import (${specifier})`);
      }
    }
    expect(violations, `purity violations:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the package.json dependency surface matches the purity rule', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['@arena/protocol-core']);
    expect(Object.keys(pkg.devDependencies ?? {})).toContain('@arena/agent-body');
  });
});

describe('public-surface hygiene (gate 12 — no any leaks; R45 — no rebind APIs)', () => {
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

  it('the public surface exports the protocol and NO possession/rebind APIs', () => {
    const exportNames = Object.keys(modelSubstrate);
    expect(exportNames.length).toBeGreaterThan(80);
    // R45: nothing in this package rebinds, updates or mutates possessions.
    for (const forbidden of [
      'rebindPossession',
      'upgradePossession',
      'applyUpgradeToPossession',
      'mutatePossession',
      'updatePossession',
      'replacePossession',
      'rebind',
      'createPossession',
    ]) {
      expect(exportNames, `forbidden export ${forbidden}`).not.toContain(forbidden);
    }
    // No provider strings in export names.
    for (const name of exportNames) {
      expect(PROVIDER_DENY_PATTERN.test(name), `provider-shaped export name ${name}`).toBe(false);
    }
    // Key protocol constructors and guards are exported:
    for (const expected of [
      'SubstrateAdapter',
      'createAdapterDescriptor',
      'verifyAdapterDescriptor',
      'adapterDescriptorDigest',
      'assertRegistrationWithinAdapterEnvelope',
      'toSubstrateCapabilityProfile',
      'toAdapterHealthReport',
      'createSubstrateRecord',
      'verifySubstrateRecord',
      'toSubstrateRegistrationDescriptor',
      'createSubstrateRegistry',
      'createSubstrateCompatibilityTest',
      'createSubstrateCompatibilityResult',
      'createSubstrateUpgrade',
      'makeRegisterSubstrateCommand',
      'makeDeclareSubstrateUpgradeCommand',
      'makeRecordCompatibilityResultCommand',
      'makeSubstrateRegisteredEvent',
      'makeSubstrateUpgradeDeclaredEvent',
      'makeCompatibilityResultRecordedEvent',
      'parseModelSubstrateEnvelope',
      'verifyModelSubstrateEnvelope',
      'ModelSubstrateError',
      'MODEL_SUBSTRATE_ERROR_CODES',
      'MODEL_SUBSTRATE_PROTOCOL_VERSION',
      'MODEL_SUBSTRATE_SCHEMAS',
      // Type-only re-exports of the agent-body shapes:
      'CognitiveSubstrate',
      'BodyVersionRef',
      'VersionedArtifactRef',
    ]) {
      // Type-only re-exports do not appear as runtime keys; check those via
      // a compile-time assertion instead (upgrade.test.ts pins possession
      // absence; here we assert the value exports).
      if (['SubstrateAdapter', 'CognitiveSubstrate', 'BodyVersionRef', 'VersionedArtifactRef'].includes(expected)) {
        continue;
      }
      expect(exportNames).toContain(expected);
    }
  });

  it('every exported constant is frozen or scalar; every function is a function', () => {
    for (const [name, value] of Object.entries(modelSubstrate)) {
      if (typeof value === 'function') continue;
      if (typeof value === 'string') continue;
      if (typeof value === 'number' || typeof value === 'boolean') continue; // literal record-version consts
      if (typeof value === 'object' && value !== null && Object.isFrozen(value)) continue;
      expect(typeof value, `unexpected mutable export ${name} of type ${typeof value}`).toMatch(
        /^(function|object)$/,
      );
      expect(Object.isFrozen(value), `mutable object export ${name}`).toBe(true);
    }
  });
});
