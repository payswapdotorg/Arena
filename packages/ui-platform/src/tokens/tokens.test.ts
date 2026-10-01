import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  BREAKPOINTS,
  COLOR,
  cssVariablesFromEntries,
  ELEVATION,
  FONT,
  FONT_WEIGHT,
  generateTokensCss,
  LINE_HEIGHT,
  MOTION_DURATION,
  MOTION_EASING,
  RADIUS,
  SPACE,
  STATE_KINDS,
  STATE_MARKER_SHAPES,
  STATE_KIND_CONFIGS,
  stateKindConfig,
  TEXT,
  TOKEN_ENTRIES,
  TOKEN_GROUPS,
  TOKENS_VERSION,
  type TokenEntry,
} from './tokens.js';

const css = generateTokensCss();

describe('token registry determinism and shape', () => {
  it('generates byte-identical CSS on every call (positive)', () => {
    expect(generateTokensCss()).toBe(css);
  });

  it('declares its version and a closed group set (positive)', () => {
    expect(TOKENS_VERSION).toBe('1.0.0');
    expect(TOKEN_GROUPS).toEqual([
      'color',
      'space',
      'type',
      'font',
      'radius',
      'elevation',
      'motion',
      'breakpoint',
      'truth',
    ]);
  });

  it('names every variable inside the arena namespace (positive)', () => {
    for (const entry of TOKEN_ENTRIES) {
      expect(entry.variable).toMatch(/^--arena-[a-z0-9-]+$/);
    }
  });

  it('has no duplicate CSS variables in the registry (positive)', () => {
    const variables = TOKEN_ENTRIES.map((entry) => entry.variable);
    expect(new Set(variables).size).toBe(variables.length);
  });

  it('emits every scale key as a CSS custom property with its value (positive)', () => {
    for (const [key, value] of Object.entries(SPACE)) {
      expect(css).toContain(`--arena-space-${key}: ${value};`);
    }
    for (const [key, value] of Object.entries(RADIUS)) {
      expect(css).toContain(`--arena-radius-${key}: ${value};`);
    }
    for (const [key, value] of Object.entries(TEXT)) {
      expect(css).toContain(`--arena-text-${key}: ${value};`);
    }
    for (const [key, value] of Object.entries(COLOR)) {
      expect(css).toContain(
        `--arena-color-${key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}: ${value};`,
      );
    }
    for (const [key, value] of Object.entries(FONT)) {
      expect(css).toContain(`--arena-font-${key}: ${value};`);
    }
    for (const [key, value] of Object.entries(FONT_WEIGHT)) {
      expect(css).toContain(`--arena-font-weight-${key}: ${value};`);
    }
    for (const [key, value] of Object.entries(LINE_HEIGHT)) {
      expect(css).toContain(`--arena-line-height-${key}: ${value};`);
    }
    for (const [key, value] of Object.entries(ELEVATION)) {
      expect(css).toContain(`--arena-elevation-${key}: ${value};`);
    }
    for (const [key, value] of Object.entries(MOTION_DURATION)) {
      expect(css).toContain(`--arena-motion-duration-${key}: ${value};`);
    }
    for (const [key, value] of Object.entries(MOTION_EASING)) {
      expect(css).toContain(`--arena-motion-easing-${key}: ${value};`);
    }
    for (const [key, value] of Object.entries(BREAKPOINTS)) {
      expect(css).toContain(`--arena-breakpoint-${key}: ${value};`);
    }
  });

  it('rejects duplicate CSS variable names (negative)', () => {
    const duplicate: TokenEntry = {
      variable: '--arena-space-xs',
      value: '9rem',
      group: 'space',
      description: 'deliberate duplicate',
    };
    const first: TokenEntry = {
      variable: '--arena-space-xs',
      value: '0.5rem',
      group: 'space',
      description: 'original',
    };
    expect(() => cssVariablesFromEntries([first, duplicate])).toThrowError(
      /duplicate CSS variable/,
    );
  });
});

describe('product-truth state vocabulary (UXM1.0 / P1.0)', () => {
  it('is exactly the ten-term closed vocabulary (positive)', () => {
    expect([...STATE_KINDS]).toEqual([
      'verified',
      'evidence',
      'expert-judgment',
      'model-output',
      'simulation',
      'evaluation',
      'certification',
      'suggestion',
      'hypothesis',
      'demo',
    ]);
    expect(STATE_KINDS).toHaveLength(10);
  });

  it('configures every kind and nothing else (positive)', () => {
    expect(Object.keys(STATE_KIND_CONFIGS).sort()).toEqual(
      [...STATE_KINDS].sort(),
    );
    for (const kind of STATE_KINDS) {
      expect(stateKindConfig(kind).kind).toBe(kind);
      expect(stateKindConfig(kind).label.length).toBeGreaterThan(0);
      expect(stateKindConfig(kind).meaning.length).toBeGreaterThan(0);
    }
  });

  it('gives every kind a unique label, color, tint and marker (positive)', () => {
    const configs = STATE_KINDS.map((kind) => stateKindConfig(kind));
    const by = <T,>(pick: (c: (typeof configs)[number]) => T): number =>
      new Set(configs.map(pick)).size;
    expect(by((c) => c.label)).toBe(10);
    expect(by((c) => c.color)).toBe(10);
    expect(by((c) => c.softColor)).toBe(10);
    expect(by((c) => c.marker)).toBe(10);
    expect(STATE_MARKER_SHAPES).toHaveLength(10);
  });

  it('emits both CSS variables for every kind (positive)', () => {
    for (const kind of STATE_KINDS) {
      const config = stateKindConfig(kind);
      expect(css).toContain(`--arena-truth-${kind}-color: ${config.color};`);
      expect(css).toContain(`--arena-truth-${kind}-soft: ${config.softColor};`);
    }
  });

  it('rejects unknown state kinds, including near-misses (negative)', () => {
    expect(() => stateKindConfig('nope')).toThrowError(
      /unknown product-truth state kind/,
    );
    expect(() => stateKindConfig('verified ')).toThrowError(
      /unknown product-truth state kind/,
    );
    expect(() => stateKindConfig('')).toThrowError(
      /unknown product-truth state kind/,
    );
  });
});

describe('committed tokens.css stylesheet', () => {
  it('is in sync with the generated registry — no drift (positive)', () => {
    const committed = readFileSync(
      new URL('./tokens.css', import.meta.url),
      'utf-8',
    );
    expect(committed).toBe(generateTokensCss());
  });

  it('is a :root custom-property block (positive)', () => {
    expect(css).toMatch(/^\/\*[\s\S]*\*\/\n\n:root \{\n/);
    expect(css.trimEnd().endsWith('}')).toBe(true);
  });
});
