import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Hygiene (Work Order B005): @arena/read-model-service is READ-ONLY —
 * no mutation symbols on its contract surface, no state of its own, no
 * provider names, no environment access, no network. The read model is
 * a projection over canonical Arena objects, never a second authority.
 */

const SOURCE_FILES = ['service.ts', 'index.ts'] as const;

function source(file: string): string {
  return readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
}

const FORBIDDEN_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly why: string }> = [
  { pattern: /from\s+['"]next\b/i, why: 'Next.js imports' },
  { pattern: /from\s+['"]@?upstash/i, why: 'provider imports (Upstash)' },
  { pattern: /from\s+['"]redis/i, why: 'provider imports (Redis)' },
  { pattern: /\bprocess\.env\b/, why: 'environment access' },
  { pattern: /\bDate\.now\b/, why: 'wall-clock reads (Clock is injected)' },
  { pattern: /\bnew Date\b/, why: 'wall-clock construction' },
  { pattern: /\bfetch\s*\(/, why: 'network access' },
];

describe('read-model-service hygiene (read-only projection service)', () => {
  it('imports only from node builtins and workspace packages', () => {
    for (const file of SOURCE_FILES) {
      const text = source(file);
      for (const importMatch of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const specifier = importMatch[1] as string;
        expect(
          specifier.startsWith('.') ||
            specifier.startsWith('node:') ||
            specifier.startsWith('@arena/'),
          `${file} imports non-workspace specifier ${specifier}`,
        ).toBe(true);
      }
    }
  });

  it('contains no provider names, environment access, clocks or network', () => {
    for (const file of SOURCE_FILES) {
      const text = source(file);
      for (const rule of FORBIDDEN_PATTERNS) {
        expect(String(rule.pattern.test(text)), `${file} violates hygiene (${rule.why})`).toBe('false');
      }
    }
  });

  it('exports NO write-path symbols (read-only surface)', async () => {
    const index = await import('./index.js');
    const exportedNames = Object.keys(index);
    const writePath = exportedNames.filter((name) =>
      /^(insert|update|delete|remove|upsert|write|save|put|patch)/i.test(name),
    );
    expect(writePath).toEqual([]);
  });

  it('the service class itself exposes no mutation methods', async () => {
    const module = await import('./service.js');
    const ReadModelService = module.ReadModelService as new (...args: never[]) => object;
    const methodNames = Object.getOwnPropertyNames(ReadModelService.prototype).filter(
      (name) => name !== 'constructor',
    );
    const writeMethods = methodNames.filter((name) =>
      /^(insert|update|delete|remove|upsert|write|save|put|patch)/i.test(name),
    );
    expect(writeMethods).toEqual([]);
    expect(methodNames.sort()).toEqual(
      ['listByTenant', 'listKinds', 'readCanonical', 'scrollByKind'].sort(),
    );
  });
});
