import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Hygiene (Work Order B005): @arena/read-model is a PURE projection
 * package — zero Next.js imports, zero provider names, zero environment
 * access, and no write-path symbols. These are static-source assertions
 * over the compiled surface.
 */

const SOURCE_FILES = ['errors.ts', 'models.ts', 'queries.ts', 'contracts.ts', 'index.ts'] as const;

function source(file: string): string {
  return readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
}

const FORBIDDEN_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly why: string }> = [
  { pattern: /from\s+['"]next\b/i, why: 'Next.js imports' },
  { pattern: /from\s+['"]@?upstash/i, why: 'provider imports (Upstash)' },
  { pattern: /from\s+['"]redis/i, why: 'provider imports (Redis)' },
  { pattern: /\bprocess\.env\b/, why: 'environment access' },
  { pattern: /\bDate\.now\b/, why: 'wall-clock reads (readAt is injected)' },
  { pattern: /\bnew Date\b/, why: 'wall-clock construction' },
  { pattern: /\bfetch\s*\(/, why: 'network access' },
  { pattern: /\bsetInterval\b|\bsetTimeout\b/, why: 'timers (no background processes)' },
];

describe('read-model hygiene (pure projection package)', () => {
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

  it('exports no write-path symbols (projection only)', async () => {
    const index = await import('./index.js');
    const exportedNames = Object.keys(index);
    const writePath = exportedNames.filter((name) =>
      /^(insert|update|delete|remove|upsert|write|save|put|patch)/i.test(name),
    );
    expect(writePath).toEqual([]);
  });
});
