/**
 * The A031 hygiene suite (mirrors the A007 hygiene discipline):
 *
 *   - no clock reads / randomness in the package sources (determinism);
 *   - no model/provider names (architecture-lock rule 10);
 *   - no PII / authorization vocabulary (lock rule 9 — commercial DATA,
 *     never authorization; PII minimization);
 *   - no service→service imports (boundary rule B2);
 *   - the closed vocabularies are frozen;
 *   - the fail-closed NULL stores resolve nothing.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AbsentCertificationRecordStore,
  AbsentExpertRecordStore,
  AbsentReleaseRecordStore,
  ENGAGEMENT_STATUSES,
  ENGAGEMENT_TERMINAL_STATUSES,
  ENGAGEMENT_TRANSITIONS,
  LISTING_STATUSES,
  LISTING_TERMINAL_STATUSES,
  LISTING_TRANSITIONS,
  MARKETPLACE_SORTS,
  OFFER_KINDS,
  RATE_UNITS,
  REVIEW_RATINGS,
  REVIEW_VERDICTS,
} from './index.js';

const SRC = join(import.meta.dirname, '.');

function sourceFiles(): string[] {
  const all: string[] = [];
  for (const entry of readdirSync(SRC, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      all.push(join(SRC, entry.name));
    }
  }
  return all;
}

describe('source hygiene', () => {
  it('contains no clock reads or randomness (determinism anchors only)', () => {
    const forbidden = [/Date\.now\s*\(/, /new Date\s*\(/, /Math\.random/, /process\.env/];
    for (const file of sourceFiles()) {
      if (file.endsWith('hygiene.test.ts')) continue;
      const source = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        expect(
          pattern.test(source),
          `${file} matches forbidden pattern ${String(pattern)}`,
        ).toBe(false);
      }
    }
  });

  it('contains no model/provider names (lock rule 10)', () => {
    const forbidden = [/\bopenai\b/i, /\banthropic\b/i, /\bgpt\b/i, /\bclaude\b/i, /\bgemini\b/i, /\bllama\b/i, /\bmistral\b/i, /\bdeepseek\b/i];
    for (const file of sourceFiles()) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        expect(
          pattern.test(source),
          `${file} mentions a model/provider name`,
        ).toBe(false);
      }
    }
  });

  it('contains no authorization or PII vocabulary (lock rule 9)', () => {
    const forbidden = [
      /\bsystemRole\b/,
      /\badminOf\b/,
      /\bpermissions?\b/i,
      /\bgrantPermission\b/,
      /\blegalName\b/,
      /\bemailAddress\b/,
      /\bphoneNumber\b/,
      /\bhomeAddress\b/,
    ];
    for (const file of sourceFiles()) {
      if (file.endsWith('hygiene.test.ts')) continue;
      const source = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        expect(
          pattern.test(source),
          `${file} carries authorization/PII vocabulary`,
        ).toBe(false);
      }
    }
  });

  it('imports no other service internals (boundary rule B2)', () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(file, 'utf8');
      const serviceImports = [
        ...source.matchAll(/from\s+['"]@arena\/(?!protocol-core|expert-registry|expert-qualification|certification|body-registry)[a-z-]+['"]/g),
      ];
      expect(
        serviceImports.length,
        `${file} imports outside the allowed package set`,
      ).toBe(0);
    }
  });
});

describe('closed vocabularies are frozen', () => {
  it('freezes every commercial vocabulary', () => {
    expect(Object.isFrozen(LISTING_STATUSES)).toBe(true);
    expect(Object.isFrozen(LISTING_TERMINAL_STATUSES)).toBe(true);
    expect(Object.isFrozen(LISTING_TRANSITIONS)).toBe(true);
    expect(Object.isFrozen(OFFER_KINDS)).toBe(true);
    expect(Object.isFrozen(RATE_UNITS)).toBe(true);
    expect(Object.isFrozen(ENGAGEMENT_STATUSES)).toBe(true);
    expect(Object.isFrozen(ENGAGEMENT_TERMINAL_STATUSES)).toBe(true);
    expect(Object.isFrozen(ENGAGEMENT_TRANSITIONS)).toBe(true);
    expect(Object.isFrozen(REVIEW_RATINGS)).toBe(true);
    expect(Object.isFrozen(REVIEW_VERDICTS)).toBe(true);
    expect(Object.isFrozen(MARKETPLACE_SORTS)).toBe(true);
    expect([...REVIEW_RATINGS]).toEqual([1, 2, 3, 4, 5]);
    expect([...OFFER_KINDS]).toContain('body-backed-service');
  });
});

describe('fail-closed NULL stores', () => {
  it('resolves nothing (R41 discipline)', async () => {
    const experts = new AbsentExpertRecordStore();
    const releases = new AbsentReleaseRecordStore();
    const certifications = new AbsentCertificationRecordStore();
    expect(await experts.getExpertProfile('a'.repeat(64))).toBeUndefined();
    expect(await experts.getQualifiedExpertCard('a'.repeat(64))).toBeUndefined();
    expect(await experts.getCompetencyClaim('a'.repeat(64))).toBeUndefined();
    expect(await experts.getQualificationRecord('a'.repeat(64))).toBeUndefined();
    expect(await releases.getReleaseRecord('a'.repeat(64))).toBeUndefined();
    expect(await certifications.getCertificationRecord('a'.repeat(64))).toBeUndefined();
  });
});
