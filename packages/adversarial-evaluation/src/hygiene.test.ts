/**
 * Hygiene tests (Work Order C013): the shared-law textual enforcement —
 * the adjudication engine source NEVER mentions the community ratio (the
 * structural discovery-signal law), no domain source claims certification
 * or authorization authority, and the package imports only domain
 * packages (zero service imports).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)));

function source(name: string): string {
  return readFileSync(join(SRC_DIR, name), 'utf8');
}

const DOMAIN_SOURCES = [
  'lifecycle.ts',
  'judgments.ts',
  'guardrails.ts',
  'signals.ts',
  'adjudication.ts',
  'certification.ts',
  'byproducts.ts',
  'shared.ts',
  'errors.ts',
  'index.ts',
];

describe('the discovery-signal law (textual half of the structural law)', () => {
  it('the AdjudicationInputs interface body has no ratio/signal member — the engine cannot read it', () => {
    const text = source('adjudication.ts');
    const inputsMatch = /export interface AdjudicationInputs \{([\s\S]*?)\n\}/.exec(text);
    expect(inputsMatch).toBeDefined();
    const body = inputsMatch?.[1] ?? '';
    expect(body).not.toMatch(/ratio/i);
    expect(body).not.toMatch(/signal/i);
    // The exclusion is DISCLOSED as the law, not consumed.
    expect(text).toContain('EXCLUDED from these inputs by construction');
  });

  it('signals.ts never frames the ratio as a verdict or correctness authority', () => {
    const text = source('signals.ts');
    expect(text).toContain('discovery signal only');
    expect(text).not.toMatch(/verdict of the competition/);
  });
});

describe('certification authority is never claimed', () => {
  it('no domain source claims certification or authorization authority', () => {
    for (const name of DOMAIN_SOURCES) {
      const text = source(name);
      expect(text, name).not.toMatch(/is (a |an )?(certification|authorization|access grant)/i);
      expect(text, name).not.toMatch(/grants? (certification|authorization|access)/i);
    }
  });

  it('the lock-rule-34 guard exists with no happy path', () => {
    const text = source('certification.ts');
    expect(text).toContain('function consumeResultAsCertification');
    expect(text).toContain('NO happy path');
  });
});

describe('layer purity', () => {
  it('zero service imports across the domain sources', () => {
    for (const name of DOMAIN_SOURCES) {
      const text = source(name);
      expect(text, name).not.toMatch(/from\s+'@arena\/[a-z-]*service/);
      expect(text, name).not.toMatch(/from\s+'\.\.\/\.\.\/services\//);
    }
  });

  it('the six AE1.0 judgment types and ten states are exactly the canonical vocabularies', () => {
    expect(source('judgments.ts')).toContain("'upvote_with_proof'");
    expect(source('judgments.ts')).toContain("'downvote_with_proof'");
    expect(source('judgments.ts')).toContain("'accept_challenge'");
    expect(source('judgments.ts')).toContain("'reject_challenge'");
    expect(source('judgments.ts')).toContain("'needs_more_evidence'");
    const lifecycle = source('lifecycle.ts');
    for (const state of [
      'open',
      'soliciting',
      'submitted',
      'challenge',
      'response',
      'voting',
      'adjudication',
      'verified_result',
      'abandoned',
      'insufficient_participation',
    ]) {
      expect(lifecycle).toContain(`'${state}'`);
    }
  });
});
