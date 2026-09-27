/**
 * Image and evidence tests: the image/build digest declaration (declare
 * field 2) and evidence outputs + evaluation hooks (declare fields 14, 15).
 */

import { describe, expect, it } from 'vitest';
import { createEnvironmentDefinition } from './definition.js';
import {
  assertImageConsistency,
  isEnvironmentImage,
  toEnvironmentImage,
} from './image.js';
import {
  isEvidenceOutputs,
  isEvaluationHooks,
  isHookDeclaration,
  toEvidenceOutputs,
  toEvaluationHooks,
} from './evidence.js';
import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import { DIGEST_A, DIGEST_D, makeDefinitionInput } from './test-support.js';

describe('environment image (declare field 2)', () => {
  it('a content-addressed image validates and freezes', () => {
    const image = toEnvironmentImage({
      imageKind: 'content-addressed-image',
      digest: DIGEST_A,
      buildDigest: null,
    });
    expect(isEnvironmentImage(image)).toBe(true);
    expect(Object.isFrozen(image)).toBe(true);
    expect(assertImageConsistency(image)).toBeUndefined();
  });

  it('a derived image carries its build digest', () => {
    const image = toEnvironmentImage({
      imageKind: 'derived-image',
      digest: DIGEST_A,
      buildDigest: DIGEST_D,
    });
    expect(image.buildDigest).toBe(DIGEST_D);
    expect(assertImageConsistency(image)).toBeUndefined();
  });

  it('a derived image without a build digest is rejected', () => {
    const image = toEnvironmentImage({
      imageKind: 'derived-image',
      digest: DIGEST_A,
      buildDigest: null,
    });
    expect(() => assertImageConsistency(image)).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_IMAGE }),
    );
  });

  it('malformed digests and kinds are rejected', () => {
    expect(() =>
      toEnvironmentImage({ imageKind: 'content-addressed-image', digest: 'nope', buildDigest: null }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_DIGEST }),
    );
    expect(() =>
      toEnvironmentImage({ imageKind: 'registry-pull', digest: DIGEST_A, buildDigest: null }),
    ).toThrowError(EnvironmentError);
    expect(() =>
      toEnvironmentImage({ imageKind: 'content-addressed-image', digest: DIGEST_A, buildDigest: 42 as unknown as string }),
    ).toThrowError(EnvironmentError);
  });

  it('unknown fields are rejected (strict shape)', () => {
    expect(() =>
      toEnvironmentImage({
        imageKind: 'content-addressed-image',
        digest: DIGEST_A,
        buildDigest: null,
        registry: 'somewhere',
      } as unknown as Parameters<typeof toEnvironmentImage>[0]),
    ).toThrowError(EnvironmentError);
  });
});

describe('evidence outputs (declare field 14)', () => {
  it('validates the closed kind and addressing sets, freezing the list', () => {
    const outputs = toEvidenceOutputs({
      outputs: [
        { outputId: 'ev-trajectory', kind: 'trajectory', addressing: 'content-addressed', description: null },
        { outputId: 'ev-logs', kind: 'logs', addressing: 'append-only-ledger', description: 'Run logs.' },
      ],
    });
    expect(isEvidenceOutputs(outputs)).toBe(true);
    expect(Object.isFrozen(outputs)).toBe(true);
    expect(Object.isFrozen(outputs.outputs)).toBe(true);
  });

  it('empty output lists are rejected', () => {
    expect(() => toEvidenceOutputs({ outputs: [] })).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_EVIDENCE_OUTPUTS }),
    );
  });

  it('unknown kinds/addressings and duplicates are rejected', () => {
    expect(() =>
      toEvidenceOutputs({ outputs: [{ outputId: 'ev', kind: 'video', addressing: 'content-addressed' }] }),
    ).toThrowError(EnvironmentError);
    expect(() =>
      toEvidenceOutputs({ outputs: [{ outputId: 'ev', kind: 'logs', addressing: 'best-effort' }] }),
    ).toThrowError(EnvironmentError);
    expect(() =>
      toEvidenceOutputs({
        outputs: [
          { outputId: 'ev', kind: 'logs', addressing: 'content-addressed' },
          { outputId: 'ev', kind: 'metrics', addressing: 'content-addressed' },
        ],
      }),
    ).toThrowError(EnvironmentError);
  });
});

describe('evaluation hooks (declare field 15)', () => {
  const HOOK_INPUT = {
    evaluators: [
      {
        hookId: 'eval-standard-suite',
        role: 'evaluator',
        phase: 'post-run',
        invocationSchema: 'arena:schema/evaluation/suite-run@1.0.0',
        description: null,
      },
    ],
    verifiers: [
      {
        hookId: 'verify-output-contracts',
        role: 'verifier',
        phase: 'on-evidence',
        invocationSchema: 'arena:schema/verification/check@1.0.0',
        description: null,
      },
    ],
  };

  it('validates and freezes both hook lists', () => {
    const hooks = toEvaluationHooks(HOOK_INPUT);
    expect(isEvaluationHooks(hooks)).toBe(true);
    expect(isHookDeclaration(hooks.evaluators[0])).toBe(true);
    expect(Object.isFrozen(hooks)).toBe(true);
    expect(Object.isFrozen(hooks.evaluators)).toBe(true);
  });

  it('missing evaluators or verifiers are rejected', () => {
    expect(() => toEvaluationHooks({ ...HOOK_INPUT, evaluators: [] })).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_EVALUATION_HOOKS }),
    );
    expect(() => toEvaluationHooks({ ...HOOK_INPUT, verifiers: [] })).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_EVALUATION_HOOKS }),
    );
  });

  it('role mismatches between the lists are rejected', () => {
    expect(() =>
      toEvaluationHooks({
        ...HOOK_INPUT,
        verifiers: [
          {
            hookId: 'hook-x',
            role: 'evaluator',
            phase: 'on-evidence',
            invocationSchema: 'arena:schema/evaluation/suite-run@1.0.0',
            description: null,
          },
        ],
      }),
    ).toThrowError(EnvironmentError);
  });

  it('malformed invocation schemas are rejected (versioned SchemaRef required)', () => {
    expect(() =>
      toEvaluationHooks({
        ...HOOK_INPUT,
        verifiers: [
          {
            hookId: 'hook-x',
            role: 'verifier',
            phase: 'on-evidence',
            invocationSchema: 'https://example.com/hook',
            description: null,
          },
        ],
      }),
    ).toThrowError(EnvironmentError);
  });

  it('duplicate hook ids and unknown phases are rejected', () => {
    expect(() =>
      toEvaluationHooks({
        ...HOOK_INPUT,
        verifiers: [
          {
            hookId: 'eval-standard-suite',
            role: 'verifier',
            phase: 'on-evidence',
            invocationSchema: 'arena:schema/verification/check@1.0.0',
            description: null,
          },
        ],
      }),
    ).toThrowError(EnvironmentError);
    expect(() =>
      toEvaluationHooks({
        ...HOOK_INPUT,
        verifiers: [
          {
            hookId: 'hook-x',
            role: 'verifier',
            phase: 'mid-run',
            invocationSchema: 'arena:schema/verification/check@1.0.0',
            description: null,
          },
        ],
      }),
    ).toThrowError(EnvironmentError);
  });

  it('runtime leakage in a hook description is rejected at construction', async () => {
    const input = makeDefinitionInput({
      evaluationHooks: {
        ...HOOK_INPUT,
        evaluators: [
          {
            hookId: 'eval-standard-suite',
            role: 'evaluator',
            phase: 'post-run',
            invocationSchema: 'arena:schema/evaluation/suite-run@1.0.0',
            description: 'evaluates runs on a docker substrate',
          },
        ],
      },
    });
    await expect(createEnvironmentDefinition(input)).rejects.toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.RUNTIME_LEAKAGE }),
    );
  });
});
