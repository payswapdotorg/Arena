/**
 * Hygiene suite (Work Order C015 service) — provider neutrality, no
 * `any` leaks, no service-to-service imports (boundary rule B2),
 * coherent public surface.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as capabilityRoutingService from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const DENY_LIST = [
  'openai',
  'anthropic',
  'claude',
  'gemini',
  'gpt',
  'api[_-]?key',
  'secret',
  'token',
  'credential',
  'password',
  'bearer',
  'authorization',
];

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(join(dir, entry.name));
  }
  return files;
}

describe('service hygiene — neutrality + boundaries + typed surface', () => {
  it('non-test sources contain no provider/credential strings', () => {
    for (const file of listSourceFiles(join(PACKAGE_ROOT, 'src'))) {
      const source = readFileSync(file, 'utf-8');
      for (const pattern of DENY_LIST) {
        const matcher = new RegExp(pattern, 'i');
        expect(matcher.test(source), `${file} matches deny-list pattern /${pattern}/i`).toBe(false);
      }
    }
  });

  it('non-test sources leak no `any` type positions', () => {
    for (const file of listSourceFiles(join(PACKAGE_ROOT, 'src'))) {
      const source = readFileSync(file, 'utf-8');
      const anyTypePositions = source.match(/:\s*any\b/g) ?? [];
      expect(anyTypePositions, `${file} contains bare any type positions`).toHaveLength(0);
    }
  });

  it('imports no other service and no app (boundary rule B2)', () => {
    for (const file of listSourceFiles(join(PACKAGE_ROOT, 'src'))) {
      const source = readFileSync(file, 'utf-8');
      expect(source, `${file} must not import a service package`).not.toMatch(
        /from\s+['"]@arena\/(?:[a-z-]+-service|[a-z-]+-fabric)\b/,
      );
      expect(source, `${file} must not import an app`).not.toMatch(/from\s+['"]@arena\/web/);
    }
  });

  it('exports a coherent public surface', () => {
    expect(typeof capabilityRoutingService.CapabilityRoutingService).toBe('function');
    expect(typeof capabilityRoutingService.seamDecisionOf).toBe('function');
    expect(typeof capabilityRoutingService.bodyCandidateFromListing).toBe('function');
    expect(typeof capabilityRoutingService.artifactCandidateFromOffer).toBe('function');
    expect(typeof capabilityRoutingService.toolCandidateFromSpecification).toBe('function');
    expect(capabilityRoutingService.CAPABILITY_NO_MATCH_REASONS).toContain('class-not-allowed');
    expect(capabilityRoutingService.CAPABILITY_ROUTING_JOB_MAX_ATTEMPTS).toBe(3);
  });
});
