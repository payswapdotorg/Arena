/**
 * FakeBlobStore (Work Order B002) — the local in-memory implementation of
 * the immutable blob port with FULL contract parity with the hosted
 * adapter (shared contract suite; FT2.0 "Local parity").
 *
 * Content addressing is real: keys are `sha256:<digest>` computed with the
 * protocol-core digest primitive, and the first write wins (identical
 * replays return alreadyPresent; content cannot be overwritten because
 * no put operation accepts a key).
 */

import {
  computeBlobDigest,
  contentAddressedBlobKey,
  isBlobKey,
  toBlobKey,
  validateBlobPutInput,
} from '../ports/blob-store.js';
import type {
  BlobKey,
  BlobPutInput,
  BlobPutResult,
  BlobRecord,
  BlobStore,
} from '../ports/blob-store.js';
import type { Clock } from '../ports/clock.js';
import { SystemClock } from './clock.js';

interface StoredBlob {
  readonly content: Uint8Array;
  readonly contentType: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly createdAt: number;
}

export interface FakeBlobStoreOptions {
  readonly clock?: Clock;
}

export class FakeBlobStore implements BlobStore {
  private readonly clock: Clock;
  private readonly blobs = new Map<string, StoredBlob>();

  constructor(options: FakeBlobStoreOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
  }

  async put(input: BlobPutInput): Promise<BlobPutResult> {
    validateBlobPutInput(input);
    const digest = await computeBlobDigest(input.content);
    const key = contentAddressedBlobKey(digest);
    const existing = this.blobs.get(key);
    if (existing !== undefined) {
      // Immutable: the first write wins; identical content replays.
      return {
        key,
        digest,
        byteLength: existing.content.byteLength,
        createdAt: existing.createdAt,
        alreadyPresent: true,
      };
    }
    const createdAt = this.clock.now();
    // Private copy — callers may mutate their buffer afterwards.
    const storedContent = Uint8Array.from(input.content);
    const metadata = input.metadata !== undefined ? { ...input.metadata } : {};
    this.blobs.set(key, { content: storedContent, contentType: input.contentType, metadata, createdAt });
    return { key, digest, byteLength: storedContent.byteLength, createdAt, alreadyPresent: false };
  }

  async get(key: BlobKey): Promise<BlobRecord | null> {
    toBlobKey(key);
    const stored = this.blobs.get(key);
    if (stored === undefined) return null;
    return this.toRecord(key, stored);
  }

  async exists(key: BlobKey): Promise<boolean> {
    toBlobKey(key);
    return this.blobs.has(key);
  }

  async delete(key: BlobKey): Promise<boolean> {
    toBlobKey(key);
    return this.blobs.delete(key);
  }

  /** Number of stored blobs (test/inspection helper). */
  get size(): number {
    return this.blobs.size;
  }

  private toRecord(key: BlobKey, stored: StoredBlob): BlobRecord {
    if (!isBlobKey(key)) {
      // Unreachable after toBlobKey; kept for total functions.
      throw new Error(`invalid blob key: ${JSON.stringify(key)}`);
    }
    const digest = key.slice('sha256:'.length);
    return Object.freeze({
      key,
      // Defensive copy: mutation of a returned record cannot corrupt the store.
      content: Uint8Array.from(stored.content),
      contentType: stored.contentType,
      metadata: Object.freeze({ ...stored.metadata }),
      byteLength: stored.content.byteLength,
      digest,
      createdAt: stored.createdAt,
    } satisfies BlobRecord);
  }
}
