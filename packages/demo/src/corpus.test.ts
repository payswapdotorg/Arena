import { describe, expect, it } from 'vitest';

import { READ_MODEL_KINDS } from '@arena/read-model';

import {
  DEMO_CORPUS_RECORD_IDS,
  DEMO_CORPUS_RECORD_VERSION,
  DEMO_CORPUS_VERSION,
  DEMO_NARRATIVE_EPOCH_MS,
  DEMO_NARRATIVE_TIME_ISO,
  DEMO_TENANT_ID,
  buildDemoCorpus,
  computeDemoCorpusHash,
  demoCorpusHashSummary,
  isDemoTenant,
  PRODUCT_TRUTH_LABELS,
  isProductTruthLabel,
  DEMO_LABELLING,
  DEMO_LABELLING_VERSION,
  DEMO_BANNER_TITLE,
  DEMO_BANNER_TEXT,
  DEMO_BADGE_TEXT,
  DEMO_BADGE_NOTE,
  DEMO_RESET_LABEL,
  DEMO_RESET_HINT,
} from './index.js';

describe('demo corpus determinism (B006 acceptance: demo is deterministic)', () => {
  it('two constructions produce the identical corpus hash', () => {
    expect(computeDemoCorpusHash()).toBe(computeDemoCorpusHash());
  });

  it('two constructions produce byte-identical records (no randomness, no wall-clock)', () => {
    expect(buildDemoCorpus()).toEqual(buildDemoCorpus());
    expect(JSON.stringify(buildDemoCorpus())).toBe(JSON.stringify(buildDemoCorpus()));
  });

  it('the corpus hash is a stable non-empty canonical-JSON digest with a fixed summary', () => {
    const hash = computeDemoCorpusHash();
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
    expect(demoCorpusHashSummary(hash)).toBe(demoCorpusHashSummary(computeDemoCorpusHash()));
    expect(demoCorpusHashSummary(hash)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('record ids are deterministic and ordered', () => {
    const ids = buildDemoCorpus().map((item) => item.recordId);
    expect(ids).toEqual([...DEMO_CORPUS_RECORD_IDS]);
    expect(ids).toEqual([...ids].sort());
    for (const id of ids) {
      expect(id.startsWith('demo.')).toBe(true);
    }
  });

  it('provenance is the fixed narrative epoch (never wall-clock)', () => {
    for (const item of buildDemoCorpus()) {
      expect(item.createdAt).toBe(DEMO_NARRATIVE_EPOCH_MS);
      expect(item.updatedAt).toBe(DEMO_NARRATIVE_EPOCH_MS);
      expect(item.revision).toBe(1);
      expect(item.version).toBe(DEMO_CORPUS_RECORD_VERSION);
    }
  });

  it('the only time inside data is the fixed narrative constant', () => {
    const json = JSON.stringify(buildDemoCorpus());
    expect(json.includes(DEMO_NARRATIVE_TIME_ISO)).toBe(true);
    // No OTHER ISO-8601 timestamp may appear inside data payloads.
    const otherTimes = json.match(/20\d\d-\d\d-\d\dT/g) ?? [];
    expect([...new Set(otherTimes)]).toEqual([DEMO_NARRATIVE_TIME_ISO.slice(0, 11)]);
  });
});

describe('demo tenant scope (B006: demo records live under the reserved demo tenant)', () => {
  it('every corpus record carries the demo tenant', () => {
    for (const item of buildDemoCorpus()) {
      expect(item.tenantId).toBe(DEMO_TENANT_ID);
    }
  });

  it('isDemoTenant guards the reserved id', () => {
    expect(isDemoTenant(DEMO_TENANT_ID)).toBe(true);
    expect(isDemoTenant('arena-reference')).toBe(false);
    expect(isDemoTenant('')).toBe(false);
    expect(isDemoTenant(null)).toBe(false);
  });

  it('every corpus kind is a disclosed B005 read-model kind (reads go through the canonical path)', () => {
    for (const item of buildDemoCorpus()) {
      expect((READ_MODEL_KINDS as readonly string[]).includes(item.kind)).toBe(true);
    }
  });
});

describe('labelling contract (B006: demo state is always visibly labelled)', () => {
  it('exports non-empty banner, badge and reset constants', () => {
    for (const text of [
      DEMO_BANNER_TITLE,
      DEMO_BANNER_TEXT,
      DEMO_BADGE_TEXT,
      DEMO_BADGE_NOTE,
      DEMO_RESET_LABEL,
      DEMO_RESET_HINT,
    ]) {
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('the frozen contract object carries the same texts', () => {
    expect(DEMO_LABELLING.version).toBe(DEMO_LABELLING_VERSION);
    expect(DEMO_LABELLING.bannerTitle).toBe(DEMO_BANNER_TITLE);
    expect(DEMO_LABELLING.bannerText).toBe(DEMO_BANNER_TEXT);
    expect(DEMO_LABELLING.badgeText).toBe(DEMO_BADGE_TEXT);
    expect(DEMO_LABELLING.badgeNote).toBe(DEMO_BADGE_NOTE);
    expect(DEMO_LABELLING.resetLabel).toBe(DEMO_RESET_LABEL);
    expect(DEMO_LABELLING.resetHint).toBe(DEMO_RESET_HINT);
    expect(Object.isFrozen(DEMO_LABELLING)).toBe(true);
  });

  it('the banner states the governing product truth (not customer state)', () => {
    expect(DEMO_BANNER_TEXT.toLowerCase().includes('not customer state')).toBe(true);
  });
});

describe('product-truth label vocabulary (B006: every datum displays its label)', () => {
  it('is the closed spec hierarchy vocabulary', () => {
    expect([...PRODUCT_TRUTH_LABELS]).toEqual([
      'verified-fact',
      'evidence',
      'expert-judgment',
      'model-output',
      'simulation-replay',
      'evaluation-result',
      'certification',
      'suggestion',
    ]);
  });

  it('guards membership', () => {
    expect(isProductTruthLabel('evidence')).toBe(true);
    expect(isProductTruthLabel('definitely-true')).toBe(false);
    expect(isProductTruthLabel(42)).toBe(false);
  });
});

describe('corpus versioning', () => {
  it('the corpus and its records carry frozen versions', () => {
    expect(DEMO_CORPUS_VERSION).toBe(1);
    expect(DEMO_CORPUS_RECORD_VERSION).toBe(1);
  });
});
