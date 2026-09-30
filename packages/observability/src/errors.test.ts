/**
 * Error taxonomy tests (Work Order A035): closed codes, structured
 * round-trips, fail-closed parsing.
 */

import { describe, expect, it } from 'vitest';
import {
  categoryForObservabilityCode,
  fromObservabilityErrorStruct,
  isObservabilityError,
  isObservabilityErrorCode,
  OBS_ERROR_CODES,
  ObservabilityError,
  toObservabilityErrorStruct,
} from './errors.js';

describe('observability error taxonomy', () => {
  it('maps every code to a category (positive)', () => {
    for (const code of Object.values(OBS_ERROR_CODES)) {
      expect(categoryForObservabilityCode(code)).toBeTruthy();
    }
  });

  it('round-trips structured forms (positive)', () => {
    const error = new ObservabilityError(OBS_ERROR_CODES.INVALID_SIGNAL, {
      message: 'bad signal',
      details: { field: 'kind' },
    });
    const struct = toObservabilityErrorStruct(error);
    const parsed = fromObservabilityErrorStruct(JSON.parse(JSON.stringify(struct)));
    expect(parsed.code).toBe(OBS_ERROR_CODES.INVALID_SIGNAL);
    expect(parsed.category).toBe('validation');
    expect(parsed.message).toBe('bad signal');
    expect(parsed.details).toEqual({ field: 'kind' });
    expect(isObservabilityError(parsed)).toBe(true);
    expect(isObservabilityErrorCode(OBS_ERROR_CODES.UNKNOWN_ERROR)).toBe(true);
  });

  it('REJECTS unknown codes fail-closed (adversarial)', () => {
    expect(() =>
      fromObservabilityErrorStruct({ code: 'OBS_NOT_A_CODE', category: 'validation', message: 'x' }),
    ).toThrow(ObservabilityError);
  });

  it('rejects category/code mismatches, missing messages, malformed shapes (adversarial)', () => {
    expect(() =>
      fromObservabilityErrorStruct({
        code: OBS_ERROR_CODES.INVALID_SIGNAL,
        category: 'integrity',
        message: 'x',
      }),
    ).toThrow(ObservabilityError);
    expect(() =>
      fromObservabilityErrorStruct({ code: OBS_ERROR_CODES.INVALID_SIGNAL, category: 'validation' }),
    ).toThrow(ObservabilityError);
    expect(() => fromObservabilityErrorStruct('nope')).toThrow(ObservabilityError);
    expect(() => fromObservabilityErrorStruct(null)).toThrow(ObservabilityError);
    expect(() =>
      fromObservabilityErrorStruct({
        code: OBS_ERROR_CODES.INVALID_SIGNAL,
        category: 'validation',
        message: '',
      }),
    ).toThrow(ObservabilityError);
  });
});
