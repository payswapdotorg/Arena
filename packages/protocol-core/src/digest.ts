/**
 * SHA-256 digests over canonical values, via the platform's WebCrypto
 * (globalThis.crypto.subtle) — zero runtime dependencies; works in Node >= 18,
 * browsers and other runtimes that provide WebCrypto.
 */

import { PROTOCOL_ERROR_CODES, ProtocolError } from './protocol-error.js';
import { canonicalJson } from './canonical-json.js';

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** SHA-256 of a string (UTF-8 encoded) or byte array, as lowercase hex. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.CANONICALIZATION_FAILED, {
      message: 'WebCrypto (globalThis.crypto.subtle) is unavailable in this runtime',
    });
  }
  const data =
    typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

/** Canonical-serialize a value and return the sha256 hex digest of it. */
export async function digestCanonical(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}
