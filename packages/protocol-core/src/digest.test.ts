import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json.js';
import { digestCanonical, sha256Hex } from './digest.js';
import { ProtocolError } from './protocol-error.js';

describe('sha256Hex (positive, known-answer vectors)', () => {
  it('empty string digest matches the RFC 6234 test vector', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('"hello" digest matches the known test vector', async () => {
    expect(await sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('accepts Uint8Array input with identical result', async () => {
    const bytes = new TextEncoder().encode('hello');
    expect(await sha256Hex(bytes)).toBe(await sha256Hex('hello'));
  });

  it('produces 64 lowercase hex characters', async () => {
    const digest = await sha256Hex('arena');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('digestCanonical (positive)', () => {
  it('is deterministic across calls', async () => {
    const value = { b: [1, 2], a: 'x' };
    expect(await digestCanonical(value)).toBe(await digestCanonical(value));
  });

  it('is independent of key order in the input value', async () => {
    const a = { x: 1, y: { b: 2, a: 3 } };
    const b = { y: { a: 3, b: 2 }, x: 1 };
    expect(await digestCanonical(a)).toBe(await digestCanonical(b));
  });

  it('equals sha256 of the canonical JSON form', async () => {
    const value = { b: 1, a: 2 };
    expect(await digestCanonical(value)).toBe(await sha256Hex(canonicalJson(value)));
  });
});

describe('digestCanonical (negative — tamper and non-serializable input)', () => {
  it('different payloads produce different digests', async () => {
    const d1 = await digestCanonical({ payload: 'original' });
    const d2 = await digestCanonical({ payload: 'tampered' });
    expect(d1).not.toBe(d2);
  });

  it('a single flipped byte in the payload changes the digest', async () => {
    const d1 = await digestCanonical({ count: 1 });
    const d2 = await digestCanonical({ count: 2 });
    expect(d1).not.toBe(d2);
  });

  it('rejects non-canonically-serializable payloads', async () => {
    await expect(digestCanonical({ bad: Number.NaN })).rejects.toBeInstanceOf(ProtocolError);
    await expect(digestCanonical(undefined)).rejects.toBeInstanceOf(ProtocolError);
    await expect(digestCanonical(10n)).rejects.toBeInstanceOf(ProtocolError);
  });
});
