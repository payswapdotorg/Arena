/**
 * Hygiene tests for the reference body package: frozen registries,
 * namespace discipline, no provider leakage, no credential-shaped
 * fields, in-package schema registry correctness.
 */

import { describe, expect, it } from 'vitest';
import { formatSchemaRef } from '@arena/protocol-core';
import {
  STRUCTURAL_ENGINEER_BODY_ERROR_CODES,
  STRUCTURAL_ENGINEER_BODY_IDENTITY,
  STRUCTURAL_ENGINEER_BODY_SCHEMA_REGISTRY,
  STRUCTURAL_ENGINEER_BODY_SCHEMAS,
  SUPPORTED_STRUCTURAL_ENGINEER_BODY_ERROR_CODES,
  isKnownStructuralEngineerBodySchema,
  structuralEngineerBodySchemaRef,
} from './index.js';

describe('hygiene (frozen registries + namespace discipline)', () => {
  it('ships a frozen in-package schema registry (A019/A022 precedent)', () => {
    expect(Object.isFrozen(STRUCTURAL_ENGINEER_BODY_SCHEMAS)).toBe(true);
    expect(Object.isFrozen(STRUCTURAL_ENGINEER_BODY_SCHEMA_REGISTRY)).toBe(true);
    for (const key of Object.keys(STRUCTURAL_ENGINEER_BODY_SCHEMAS)) {
      expect(key.startsWith('structural-engineer-body/')).toBe(true);
    }
    expect(STRUCTURAL_ENGINEER_BODY_SCHEMAS['structural-engineer-body/schema-registry']).toBe(
      '1.0.0',
    );
  });

  it('builds known SchemaRefs and rejects unknown names', () => {
    const ref = structuralEngineerBodySchemaRef('structural-engineer-body/tool-descriptor');
    expect(formatSchemaRef(ref)).toBe(
      'arena:schema/structural-engineer-body/tool-descriptor@1.0.0',
    );
    expect(isKnownStructuralEngineerBodySchema(ref)).toBe(true);
    expect(
      isKnownStructuralEngineerBodySchema({
        namespace: 'structural-engineer-body',
        name: 'no-such-shape',
        version: '1.0.0',
      }),
    ).toBe(false);
    expect(() =>
      structuralEngineerBodySchemaRef(
        'structural-engineer-body/no-such-shape' as 'structural-engineer-body/tool-descriptor',
      ),
    ).toThrow();
  });

  it('exposes a closed, frozen error-code list', () => {
    expect(Object.isFrozen(SUPPORTED_STRUCTURAL_ENGINEER_BODY_ERROR_CODES)).toBe(true);
    expect(SUPPORTED_STRUCTURAL_ENGINEER_BODY_ERROR_CODES).toContain(
      STRUCTURAL_ENGINEER_BODY_ERROR_CODES.INVALID_SURFACE_ARTIFACT,
    );
  });

  it('keeps the reference body identity neutral (no provider names)', () => {
    const serialized = JSON.stringify(STRUCTURAL_ENGINEER_BODY_IDENTITY);
    expect(serialized).not.toMatch(
      /openai|anthropic|claude|gemini|gpt-|bedrock|mistral|groq|ollama|deepseek|copilot/i,
    );
  });
});

describe('hygiene (source scan)', () => {
  it('contains no credential-shaped field names in its own source', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    for (const file of [
      'shared.ts',
      'surface.ts',
      'reference-surface.ts',
      'manifest.ts',
      'body.ts',
      'envelopes.ts',
      'index.ts',
    ]) {
      const text = await readFile(
        fileURLToPath(new URL(`./${file}`, import.meta.url)),
        'utf-8',
      );
      expect(
        text.match(/api[_-]?key|client[_-]?secret|private[_-]?key|password|passwd|bearer\s+token/i),
      ).toBeNull();
    }
  });
});
