/**
 * Hygiene suite for the reference runner (Work Order A010 gates 13,
 * 15): runtime-neutrality negatives over the service's non-test
 * sources (the reference runner is explicitly covered by gate 13) and
 * public-surface hygiene (no `any` leaks).
 *
 * The deny-lists live only in this test file (the checker must not be
 * part of the scanned surface), mirroring the domain package's hygiene
 * suite.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SERVICE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Runner / provider tokens (case-insensitive); long tokens use
 * substring semantics, short tokens use alphanumeric delimiters.
 */
const RUNTIME_SUBSTRING_DENY = [
  'docker',
  'podman',
  'firecracker',
  'containerd',
  'gvisor',
  'qemu',
  'vmware',
  'virtualbox',
  'hyperv',
  'kubernetes',
  'openstack',
  'nspawn',
  'microvm',
];
const RUNTIME_WORD_DENY = ['aws', 'gcp', 'azure', 'k8s', 'ec2', 'gce', 'vm', 'runc', 'crun', 'kvm'];

const SUBSTRING_PATTERN = new RegExp(`(?:${RUNTIME_SUBSTRING_DENY.join('|')})`, 'i');
const WORD_PATTERN = new RegExp(`(?<![a-z0-9])(?:${RUNTIME_WORD_DENY.join('|')})(?![a-z0-9])`, 'i');

function containsRuntimeToken(text: string): boolean {
  return SUBSTRING_PATTERN.test(text) || WORD_PATTERN.test(text);
}

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

describe('reference runner hygiene (gates 13, 15)', () => {
  it('non-test sources (including main.mjs) contain no runner/provider token', () => {
    const sources = collectFiles(SERVICE_ROOT, (name) =>
      (name.endsWith('.ts') && !name.endsWith('.test.ts')) || name.endsWith('.mjs'),
    ).filter((file) => !file.includes(`${join('src', 'dist')}`) && !resolve(file).includes(join(SERVICE_ROOT, 'dist')));
    expect(sources.length).toBeGreaterThanOrEqual(5);
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      if (containsRuntimeToken(text)) violations.push(file);
    }
    expect(violations, `runtime/provider leakage in sources:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the scanner detects the deny-list tokens (self-test, negative control)', () => {
    expect(containsRuntimeToken('image: "docker:24"')).toBe(true);
    expect(containsRuntimeToken('deployed to k8s')).toBe(true);
    expect(containsRuntimeToken('aws lambda')).toBe(true);
    expect(containsRuntimeToken('gvisor sandbox')).toBe(true);
    // No false positives on this service's vocabulary:
    expect(containsRuntimeToken('the reference runner simulates deterministically')).toBe(false);
    expect(containsRuntimeToken('manual clock envelope idempotency')).toBe(false);
    expect(containsRuntimeToken('provisioning checkpointing evidence trajectory')).toBe(false);
  });

  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(join(SERVICE_ROOT, 'src'), (name) =>
      name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(4);
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
});
