/**
 * Hygiene tests for the reference body package: frozen registries,
 * namespace discipline, no provider leakage, no credential-shaped
 * fields, in-package schema registry correctness.
 */

import { describe, expect, it } from 'vitest';
import { formatSchemaRef } from '@arena/protocol-core';
import {
  SOFTWARE_ENGINEER_BODY_ERROR_CODES,
  SOFTWARE_ENGINEER_BODY_IDENTITY,
  SOFTWARE_ENGINEER_BODY_SCHEMA_REGISTRY,
  SOFTWARE_ENGINEER_BODY_SCHEMAS,
  SUPPORTED_SOFTWARE_ENGINEER_BODY_ERROR_CODES,
  isKnownSoftwareEngineerBodySchema,
  softwareEngineerBodySchemaRef,
} from './index.js';

describe('hygiene (frozen registries + namespace discipline)', () => {
  it('ships a frozen in-package schema registry (A019/A022 precedent)', () => {
    expect(Object.isFrozen(SOFTWARE_ENGINEER_BODY_SCHEMAS)).toBe(true);
    expect(Object.isFrozen(SOFTWARE_ENGINEER_BODY_SCHEMA_REGISTRY)).toBe(true);
    for (const key of Object.keys(SOFTWARE_ENGINEER_BODY_SCHEMAS)) {
      expect(key.startsWith('software-engineer-body/')).toBe(true);
    }
    expect(SOFTWARE_ENGINEER_BODY_SCHEMAS['software-engineer-body/schema-registry']).toBe(
      '1.0.0',
    );
  });

  it('builds known SchemaRefs and rejects unknown names', () => {
    const ref = softwareEngineerBodySchemaRef('software-engineer-body/tool-descriptor');
    expect(formatSchemaRef(ref)).toBe('arena:schema/software-engineer-body/tool-descriptor@1.0.0');
    expect(isKnownSoftwareEngineerBodySchema(ref)).toBe(true);
    expect(
      isKnownSoftwareEngineerBodySchema({
        namespace: 'software-engineer-body',
        name: 'no-such-shape',
        version: '1.0.0',
      }),
    ).toBe(false);
    expect(() =>
      softwareEngineerBodySchemaRef(
        'software-engineer-body/no-such-shape' as 'software-engineer-body/tool-descriptor',
      ),
    ).toThrow();
  });

  it('exposes a closed, frozen error-code list', () => {
    expect(Object.isFrozen(SUPPORTED_SOFTWARE_ENGINEER_BODY_ERROR_CODES)).toBe(true);
    expect(SUPPORTED_SOFTWARE_ENGINEER_BODY_ERROR_CODES).toContain(
      SOFTWARE_ENGINEER_BODY_ERROR_CODES.INVALID_SURFACE_ARTIFACT,
    );
  });

  it('keeps the reference body identity neutral (no provider names)', () => {
    const serialized = JSON.stringify(SOFTWARE_ENGINEER_BODY_IDENTITY);
    expect(serialized).not.toMatch(/openai|anthropic|claude|gemini|gpt-|bedrock|mistral|groq|ollama|deepseek|copilot/i);
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
