/**
 * Test support for the Cloudflare R2 adapter (Work Order B002):
 * `FakeObjectStorageTransport` — an in-memory implementation of the
 * ObjectStorageTransport seam mirroring the semantics of every operation
 * the adapter issues (absent objects as null, head-then-delete existence,
 * put overwrites — immutability is enforced at the adapter level through
 * content addressing).
 *
 * This is how the FULL persistence contract suite runs against the hosted
 * adapter in CI without live credentials (FT2.0 "Local parity" / "Tests
 * never require live provider credentials"). What remains untested
 * without credentials is the literal S3 request/response cycle on a live
 * endpoint — that path is covered by the live run of the same suite when
 * env vars exist.
 *
 * NOT exported from the adapter index (test-support stays private; the
 * A033 hygiene precedent).
 */

import type {
  ObjectHead,
  ObjectPutInput,
  ObjectStorageTransport,
  StoredObject,
} from './object-storage-transport.js';

interface FakeStoredObject {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface FakeObjectStorageTransportOptions {
  /** When true, probe() throws (DEGRADED posture assertions). */
  readonly probeFails?: boolean;
}

export class FakeObjectStorageTransport implements ObjectStorageTransport {
  private readonly objects = new Map<string, FakeStoredObject>();
  private readonly probeFails: boolean;
  /** Operation names executed, in order (for ordering assertions). */
  readonly executedOperations: string[] = [];

  constructor(options: FakeObjectStorageTransportOptions = {}) {
    this.probeFails = options.probeFails ?? false;
  }

  async probe(): Promise<void> {
    this.executedOperations.push('probe');
    if (this.probeFails) {
      throw new Error('connect ETIMEDOUT fake-endpoint.example (credentials redacted)');
    }
  }

  async headObject(key: string): Promise<ObjectHead | null> {
    this.executedOperations.push('head_object');
    const stored = this.objects.get(key);
    if (stored === undefined) return null;
    return {
      contentType: stored.contentType,
      metadata: { ...stored.metadata },
      byteLength: stored.body.byteLength,
    };
  }

  async getObject(key: string): Promise<StoredObject | null> {
    this.executedOperations.push('get_object');
    const stored = this.objects.get(key);
    if (stored === undefined) return null;
    // The SAME body reference: the ADAPTER must copy defensively.
    return {
      contentType: stored.contentType,
      metadata: { ...stored.metadata },
      byteLength: stored.body.byteLength,
      body: stored.body,
    };
  }

  async putObject(input: ObjectPutInput): Promise<void> {
    this.executedOperations.push('put_object');
    // Overwrite semantics: immutability (first write wins) is the ADAPTER's
    // discipline (content addressing + head-first), not the store's.
    this.objects.set(input.key, {
      body: input.body,
      contentType: input.contentType,
      metadata: { ...input.metadata },
    });
  }

  async deleteObject(key: string): Promise<boolean> {
    this.executedOperations.push('delete_object');
    return this.objects.delete(key);
  }

  /** Object keys present in the fake store (inspection helper). */
  storedKeys(): readonly string[] {
    return [...this.objects.keys()];
  }
}
