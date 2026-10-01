/**
 * BlobStore port (Work Order B002; issue #64; FT2.0 "Storage": large
 * immutable artifacts — trajectories, datasets, evidence bundles,
 * releases — with metadata remaining in the control plane).
 *
 * Content-addressed, immutable large-artifact storage:
 *
 *   - `put` NEVER accepts a caller-supplied key. The key IS the sha256
 *     digest of the content (`sha256:<64 hex>`), so a key can only ever
 *     address exactly one content: overwriting a key is UNREPRESENTABLE —
 *     there is no put(key, bytes) operation anywhere in the port.
 *   - putting identical bytes twice is an idempotent replay
 *     (`alreadyPresent: true`, first-write metadata preserved);
 *   - `get`/`exists`/`delete` address content by its digest key; deletion
 *     is lifecycle, not in-place mutation;
 *   - records carry provenance-friendly metadata (content type + bounded
 *     string map) so lineage can reference blobs without a second
 *     authority.
 *
 * Semantics asserted by the shared contract suite for EVERY
 * implementation (fakes and hosted adapters alike).
 */

import type { Brand } from '@arena/protocol-core';
import { sha256Hex } from '@arena/protocol-core';
import { PERSISTENCE_ERROR_CODES, PersistenceError } from '../errors.js';
import { MAX_BLOB_BYTES } from '../shared.js';

/** Content-addressed blob key: `sha256:<64 lowercase hex>`. */
export type BlobKey = Brand<string, 'BlobKey'>;

export const BLOB_KEY_PATTERN_SOURCE = '^sha256:[0-9a-f]{64}$';
const BLOB_KEY_PATTERN = new RegExp(BLOB_KEY_PATTERN_SOURCE);

export function isBlobKey(value: unknown): value is BlobKey {
  return typeof value === 'string' && BLOB_KEY_PATTERN.test(value);
}

/** Validate and brand a blob key; throws PersistenceError when invalid. */
export function toBlobKey(value: string): BlobKey {
  if (!isBlobKey(value)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_BLOB_KEY, {
      message: `invalid blob key: ${JSON.stringify(value)}`,
      details: { pattern: BLOB_KEY_PATTERN_SOURCE },
    });
  }
  return value;
}

/** The digest inside a blob key (without the `sha256:` prefix). */
export function blobKeyDigest(key: BlobKey): string {
  return key.slice('sha256:'.length);
}

/** Content-addressed key for a digest hex string. */
export function contentAddressedBlobKey(digest: string): BlobKey {
  return `sha256:${digest}` as BlobKey;
}

/** Compute the content digest (sha256 hex) for blob bytes. */
export async function computeBlobDigest(content: Uint8Array): Promise<string> {
  return sha256Hex(content);
}

/** Provenance-friendly content type: `type/subtype`, bounded charset. */
export const BLOB_CONTENT_TYPE_PATTERN_SOURCE =
  '^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,62}/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,62}$';
const BLOB_CONTENT_TYPE_PATTERN = new RegExp(BLOB_CONTENT_TYPE_PATTERN_SOURCE);

export function isBlobContentType(value: unknown): value is string {
  return typeof value === 'string' && BLOB_CONTENT_TYPE_PATTERN.test(value);
}

/** Immutable blob put input (NO key — the key IS the content digest). */
export interface BlobPutInput {
  /** Non-empty bytes (max MAX_BLOB_BYTES). */
  readonly content: Uint8Array;
  readonly contentType: string;
  /** Bounded provenance metadata (string map). */
  readonly metadata?: Readonly<Record<string, string>>;
}

/** Blob put receipt (content-addressed key + provenance-friendly facts). */
export interface BlobPutResult {
  readonly key: BlobKey;
  readonly digest: string;
  readonly byteLength: number;
  readonly createdAt: number;
  /** True when identical content was already present (idempotent replay). */
  readonly alreadyPresent: boolean;
}

/** An addressed blob (content is a defensive copy; the record is frozen). */
export interface BlobRecord {
  readonly key: BlobKey;
  readonly content: Uint8Array;
  readonly contentType: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly byteLength: number;
  readonly digest: string;
  readonly createdAt: number;
}

/**
 * The provider-neutral immutable blob port. `put` takes no key: content
 * addressing makes in-place mutation unrepresentable.
 */
export interface BlobStore {
  put(input: BlobPutInput): Promise<BlobPutResult>;
  get(key: BlobKey): Promise<BlobRecord | null>;
  exists(key: BlobKey): Promise<boolean>;
  delete(key: BlobKey): Promise<boolean>;
}

/** Structural validation shared by implementations (fail closed). */
export function validateBlobPutInput(input: BlobPutInput): void {
  if (!(input.content instanceof Uint8Array) || input.content.byteLength === 0) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_BLOB_CONTENT, {
      message: `blob content must be a non-empty Uint8Array (1..${String(MAX_BLOB_BYTES)} bytes)`,
    });
  }
  if (input.content.byteLength > MAX_BLOB_BYTES) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_BLOB_CONTENT, {
      message: `blob content exceeds the ${String(MAX_BLOB_BYTES)}-byte bound`,
      details: { byteLength: input.content.byteLength, max: MAX_BLOB_BYTES },
    });
  }
  if (!isBlobContentType(input.contentType)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_BLOB_CONTENT_TYPE, {
      message: `invalid blob content type: ${JSON.stringify(input.contentType)}`,
      details: { pattern: BLOB_CONTENT_TYPE_PATTERN_SOURCE },
    });
  }
  if (input.metadata !== undefined) {
    const entries = Object.entries(input.metadata);
    if (entries.length > 16) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_BLOB_METADATA, {
        message: `blob metadata allows at most 16 entries`,
      });
    }
    for (const [key, value] of entries) {
      if (key.length === 0 || key.length > 128 || value.length > 128) {
        throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_BLOB_METADATA, {
          message: 'blob metadata keys/values must be 1..128 characters',
        });
      }
    }
  }
}
