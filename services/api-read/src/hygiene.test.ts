import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Hygiene (Work Order B005): @arena/api-read is a read-only, protocol-
 * level boundary — no write-path symbols, no provider names, no
 * environment access, no network, and NO tenant field in the request
 * grammar (tenancy is server-controlled).
 */

const SOURCE_FILES = ['protocol.ts', 'service.ts', 'index.ts'] as const;

function source(file: string): string {
  return readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
}

const FORBIDDEN_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly why: string }> = [
  { pattern: /from\s+['"]next\b/i, why: 'Next.js imports' },
  { pattern: /from\s+['"]@?upstash/i, why: 'provider imports (Upstash)' },
  { pattern: /from\s+['"]redis/i, why: 'provider imports (Redis)' },
  { pattern: /\bprocess\.env\b/, why: 'environment access' },
  { pattern: /\bDate\.now\b/, why: 'wall-clock reads' },
  { pattern: /\bnew Date\b/, why: 'wall-clock construction' },
  { pattern: /\bfetch\s*\(/, why: 'network access' },
];

describe('api-read hygiene (read-only auth-gated boundary)', () => {
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

  it('the request grammar carries NO tenant field (server-controlled tenancy)', async () => {
    const { parseReadApiRequest } = await import('./protocol.js');
    for (const tenantField of ['tenantId', 'tenant']) {
      expect(() => parseReadApiRequest({ kind: 'list-kinds', [tenantField]: 'x' })).toThrow(
        /NO tenant field/,
      );
    }
  });

  it('the service class exposes only the read request handler', async () => {
    const module = await import('./service.js');
    const ReadApiService = module.ReadApiService as new (...args: never[]) => object;
    const methodNames = Object.getOwnPropertyNames(ReadApiService.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(methodNames.sort()).toEqual(['handleReadRequest']);
  });
});
