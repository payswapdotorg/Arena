/**
 * Error taxonomy tests (positive AND negative), mirroring the A002 error
 * suite conventions.
 */

import { describe, expect, it } from 'vitest';
import {
  AGENT_BODY_ERROR_CATEGORIES,
  AGENT_BODY_ERROR_CODES,
  AgentBodyError,
  categoryForAgentBodyCode,
  fromAgentBodyErrorStruct,
  isAgentBodyError,
  isAgentBodyErrorCode,
  normalizeToAgentBodyError,
  toAgentBodyErrorStruct,
} from './errors.js';

describe('AgentBodyError taxonomy (positive)', () => {
  it('every code maps to exactly one known category', () => {
    for (const code of Object.values(AGENT_BODY_ERROR_CODES)) {
      expect(AGENT_BODY_ERROR_CATEGORIES).toContain(categoryForAgentBodyCode(code));
    }
  });

  it('codes are unique and prefixed', () => {
    const codes = Object.values(AGENT_BODY_ERROR_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code.startsWith('AGENT_BODY_')).toBe(true);
    }
  });

  it('constructs, structurizes and round-trips an error', () => {
    const error = new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_SUBSTRATE, {
      message: 'bad substrate',
      details: { field: 'modelId' },
    });
    expect(error.name).toBe('AgentBodyError');
    expect(error.category).toBe('validation');
    expect(isAgentBodyError(error)).toBe(true);
    const struct = toAgentBodyErrorStruct(error);
    const parsed = fromAgentBodyErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.category).toBe(error.category);
    expect(parsed.message).toBe(error.message);
    expect(parsed.details).toEqual({ field: 'modelId' });
  });

  it('normalizes unknown thrown values into AGENT_BODY_UNKNOWN_ERROR', () => {
    expect(normalizeToAgentBodyError(new Error('boom')).code).toBe(
      AGENT_BODY_ERROR_CODES.UNKNOWN_ERROR,
    );
    expect(normalizeToAgentBodyError('plain string').code).toBe(
      AGENT_BODY_ERROR_CODES.UNKNOWN_ERROR,
    );
    const existing = new AgentBodyError(AGENT_BODY_ERROR_CODES.TAMPERED, { message: 'x' });
    expect(normalizeToAgentBodyError(existing)).toBe(existing);
  });
});

describe('AgentBodyError taxonomy (negative — malformed structs are rejected)', () => {
  it('rejects non-objects, arrays and unknown codes', () => {
    expect(() => fromAgentBodyErrorStruct(null)).toThrow(AgentBodyError);
    expect(() => fromAgentBodyErrorStruct([1, 2])).toThrow(AgentBodyError);
    expect(() => fromAgentBodyErrorStruct({ code: 'AGENT_BODY_MADE_UP' })).toThrow(
      /unknown or missing agent body error code/,
    );
  });

  it('rejects category/code mismatches', () => {
    const error = new AgentBodyError(AGENT_BODY_ERROR_CODES.TAMPERED, { message: 'x' });
    const bad = { ...toAgentBodyErrorStruct(error), category: 'validation' };
    expect(() => fromAgentBodyErrorStruct(bad)).toThrow(/does not match code/);
  });

  it('rejects missing messages and invalid optional fields', () => {
    const error = new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE, {
      message: 'x',
    });
    const noMessage = { ...toAgentBodyErrorStruct(error), message: '' };
    expect(() => fromAgentBodyErrorStruct(noMessage)).toThrow(/non-empty string/);
    const badDetails = { ...toAgentBodyErrorStruct(error), details: [1] };
    expect(() => fromAgentBodyErrorStruct(badDetails)).toThrow(/plain object/);
    const badCorrelation = { ...toAgentBodyErrorStruct(error), correlationId: '###' };
    expect(() => fromAgentBodyErrorStruct(badCorrelation)).toThrow(/correlation id/);
  });

  it('isAgentBodyErrorCode accepts only known codes', () => {
    expect(isAgentBodyErrorCode('AGENT_BODY_TAMPERED')).toBe(true);
    expect(isAgentBodyErrorCode('AGENT_BODY_NOT_A_CODE')).toBe(false);
    expect(isAgentBodyErrorCode(42)).toBe(false);
  });
});
