/**
 * Hygiene suite (Work Order C015) — provider neutrality, no `any` leaks,
 * coherent public surface. Mirrors the sibling hygiene suites.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as capabilityRouting from './index.js';

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

describe('package hygiene — provider neutrality + typed surface', () => {
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

  it('imports no service and no app (boundary discipline)', () => {
    for (const file of listSourceFiles(join(PACKAGE_ROOT, 'src'))) {
      const source = readFileSync(file, 'utf-8');
      expect(source, `${file} must not import a service`).not.toMatch(
        /from\s+['"]@arena\/(?:escalation-api|escalation-routing-service|body-marketplace-service|marketplace-artifacts-fabric|capability-improvement)/,
      );
      expect(source, `${file} must not import an app`).not.toMatch(/from\s+['"]@arena\/web/);
    }
  });

  it('exports a coherent public surface', () => {
    expect(typeof capabilityRouting.compileCrossResourceDemand).toBe('function');
    expect(typeof capabilityRouting.matchResources).toBe('function');
    expect(typeof capabilityRouting.createBodyCandidate).toBe('function');
    expect(typeof capabilityRouting.createToolCandidate).toBe('function');
    expect(typeof capabilityRouting.createKnowledgeCandidate).toBe('function');
    expect(typeof capabilityRouting.createArtifactCandidate).toBe('function');
    expect(typeof capabilityRouting.createExpertCandidate).toBe('function');
    expect(typeof capabilityRouting.appendResourceDecision).toBe('function');
    expect(typeof capabilityRouting.verifyResourceDecisionChain).toBe('function');
    expect(typeof capabilityRouting.allowedResourceClasses).toBe('function');
    expect(capabilityRouting.ELIMINATION_REASONS).toContain('offer-delisted');
    expect(capabilityRouting.ELIMINATION_REASONS).toContain('incompatible-substrate');
    expect(capabilityRouting.RESOURCE_MATCH_OUTCOMES).toContain('matched');
    expect(capabilityRouting.RESOURCE_MATCH_OUTCOMES).toContain('class-not-allowed');
    expect(capabilityRouting.CROSS_UNDER_SPECIFIED_REASONS).toContain('resource-class-missing');
    expect(capabilityRouting.ESCALATION_MODES).toHaveLength(8);
    expect(capabilityRouting.RESOURCE_CLASSES).toHaveLength(5);
    expect(capabilityRouting.CAPABILITY_ROUTING_VERSION).toBe(1);
  });
});
