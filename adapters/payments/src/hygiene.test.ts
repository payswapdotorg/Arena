/**
 * Hygiene suite (Work Order C010 adapters layer) — provider neutrality,
 * typed surface, and the adapter laws: this package's non-test sources
 * import ONLY node: builtins, relative modules and the DOMAIN port
 * package @arena/payments (never services — boundary rule B4). The
 * deny-list lives only in this test file, mirroring the sibling
 * hygiene suites.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as paymentsAdapters from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const DENY_LIST = [
  // Real payment providers must never appear: C010 ships a DEMO adapter.
  'stripe',
  'paypal',
  'braintree',
  'adyen',
  'mangopay',
  'payoneer',
  'checkout\\.com',
  // Credentials/secrets never live in adapter sources.
  'api[_-]?key',
  'secret',
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

describe('adapters hygiene — provider neutrality + port purity', () => {
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

  it('non-test sources import only node: builtins, relative modules and the @arena/payments domain port', () => {
    const importPattern = /(?:import|export)\s+(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
    for (const file of listSourceFiles(join(PACKAGE_ROOT, 'src'))) {
      const source = readFileSync(file, 'utf-8');
      let match: RegExpExecArray | null;
      while ((match = importPattern.exec(source)) !== null) {
        const spec = match[1]!;
        const legal =
          spec.startsWith('node:') ||
          spec.startsWith('./') ||
          spec.startsWith('../') ||
          spec === '@arena/payments';
        expect(legal, `${file} imports ${spec} — only node: builtins, relative modules and the @arena/payments domain port are allowed (never services)`).toBe(true);
      }
    }
  });

  it('exports a coherent public surface', () => {
    expect(typeof paymentsAdapters.DemoPaymentProvider).toBe('function');
    expect(typeof paymentsAdapters.demoTransferInstruction).toBe('function');
    expect(paymentsAdapters.DEMO_PROVIDER_ID).toBe('arena-demo-payments-provider');
    expect(paymentsAdapters.DEMO_PROVIDER_POSTURE.executesCustomerMoney).toBe(false);
    expect(paymentsAdapters.DEMO_PROVIDER_POSTURE.openProductionQuestions.length).toBeGreaterThan(0);
  });
});
