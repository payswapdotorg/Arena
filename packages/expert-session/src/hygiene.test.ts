/**
 * Hygiene suite (Work Order C006; architecture-lock rules 10, 23):
 *
 *   1. Public-surface hygiene — no `any` type leaks in the non-test
 *      sources (type-position scan).
 *   2. Provider-leakage hygiene — no model/provider or runtime tokens
 *      in the package's non-test sources.
 *
 * The deny-list lives only in this test file (the checker must not be
 * part of the scanned surface), mirroring the sibling hygiene suites.
 * NOTE: unlike @arena/escalation's list, this deny-list deliberately
 * does NOT include generic credential-shaped words — the privacy
 * barrier domain legitimately names secret/tool EXCLUSION and
 * credential EXPIRY controls (EES1.0 vocabulary, mirroring
 * @arena/environment-protocol's SecretPolicy hygiene posture); what is
 * denied here is provider/model/runtime branding, never the
 * privacy-control vocabulary itself.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as expertSession from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Model/provider and runtime tokens (case-insensitive substring). */
const DENY_LIST = [
  'openai',
  'anthropic',
  'claude',
  'gemini',
  'gpt-',
  'docker',
  'podman',
  'firecracker',
  'containerd',
  'gvisor',
  'qemu',
  'vmware',
  'vercel',
  'neon',
  'upstash',
  'r2 bucket',
  'apify',
];

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) continue;
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(path);
  }
  return files;
}

describe('hygiene — provider neutrality + typed surface', () => {
  it('non-test sources contain no provider/runtime tokens', () => {
    const files = listSourceFiles(join(PACKAGE_ROOT, 'src'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const token of DENY_LIST) {
        expect(text.includes(token), `${file} must not contain '${token}'`).toBe(false);
      }
    }
  });

  it('non-test sources contain no `any` type leaks', () => {
    const files = listSourceFiles(join(PACKAGE_ROOT, 'src'));
    const anyPattern = /(?::|\bas\b|\()\s*any\b/;
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;
        expect(anyPattern.test(line), `${file}:${index + 1} must not use the any type`).toBe(false);
      });
    }
  });

  it('package surface exports the EES1.0 vocabulary', () => {
    expect(typeof expertSession.deriveExpertSessionCapsule).toBe('function');
    expect(typeof expertSession.composePrivacyBarrier).toBe('function');
    expect(typeof expertSession.deriveSessionModes).toBe('function');
    expect(typeof expertSession.createExpertSessionEvent).toBe('function');
    expect(typeof expertSession.createToolGapSignal).toBe('function');
    expect(typeof expertSession.createKnowledgeArtifact).toBe('function');
    expect(typeof expertSession.promoteKnowledgeArtifact).toBe('function');
    expect(typeof expertSession.createExpertSessionSubmission).toBe('function');
    expect(typeof expertSession.buildReplayTrace).toBe('function');
    expect(typeof expertSession.asLiveMutation).toBe('function');
    expect(statSync(join(PACKAGE_ROOT, 'package.json')).isFile()).toBe(true);
  });
});
