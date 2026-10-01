import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Hygiene (Work Order B006): @arena/demo is a PURE, deterministic
 * package — zero Next.js imports, zero provider names, zero environment
 * access, zero wall-clock reads, zero randomness. These are
 * static-source assertions over the package surface.
 */

const SOURCE_FILES = [
  'errors.ts',
  'shared.ts',
  'corpus.ts',
  'narrative.ts',
  'store.ts',
  'views.ts',
  'index.ts',
] as const;

function source(file: string): string {
  return readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
}

const FORBIDDEN_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly why: string }> = [
  { pattern: /from\s+['"]next\b/i, why: 'Next.js imports' },
  { pattern: /from\s+['"]@?upstash/i, why: 'provider imports (Upstash)' },
  { pattern: /from\s+['"]redis/i, why: 'provider imports (Redis)' },
  { pattern: /from\s+['"]vercel/i, why: 'provider imports (Vercel)' },
  { pattern: /from\s+['"]openai|from\s+['"]anthropic/i, why: 'provider imports (model providers)' },
  { pattern: /\bprocess\.env\b/, why: 'environment access' },
  { pattern: /\bDate\.now\b/, why: 'wall-clock reads' },
  { pattern: /\bnew Date\b/, why: 'wall-clock construction' },
  { pattern: /\bMath\.random\b|\bcrypto\.randomUUID\b/, why: 'randomness (determinism contract)' },
  { pattern: /\bfetch\s*\(/, why: 'network access' },
  { pattern: /\bsetInterval\b|\bsetTimeout\b/, why: 'timers (no background processes)' },
];

describe('demo package hygiene (pure + deterministic)', () => {
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

  it('imports only DOMAIN packages (never services, adapters or apps)', () => {
    for (const file of SOURCE_FILES) {
      for (const importMatch of source(file).matchAll(/from\s+['"]@arena\/([^'"]+)['"]/g)) {
        const target = importMatch[1] as string;
        expect(
          ['persistence', 'protocol-core', 'read-model'].includes(target),
          `${file} imports non-domain workspace package @arena/${target}`,
        ).toBe(true);
      }
    }
  });

  it('contains no provider names, environment access, clocks, randomness or network', () => {
    for (const file of SOURCE_FILES) {
      const text = source(file);
      for (const rule of FORBIDDEN_PATTERNS) {
        expect(String(rule.pattern.test(text)), `${file} violates hygiene (${rule.why})`).toBe('false');
      }
    }
  });
});
