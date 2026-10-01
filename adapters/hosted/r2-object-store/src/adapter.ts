/**
 * Cloudflare R2 adapter over the BlobStore port (Work Order B002; issue
 * #64; FT2.0 "Storage": R2 is the default preview blob store; artifact
 * metadata remains in PostgreSQL).
 *
 * Posture:
 *   - configuration comes ONLY from server-side env vars (see ./env.ts);
 *     values are never committed and never logged;
 *   - without configuration the adapter is DISABLED and fails closed:
 *     every port operation throws the typed capacity error
 *     (PERSISTENCE_CAPACITY_DISABLED) BEFORE any network call, and the
 *     capacity probe reports DISABLED — no crash, no secret leakage;
 *   - the infrastructure touchpoint is the injected ObjectStorageTransport
 *     seam, so the full persistence contract suite runs against this
 *     adapter without live credentials;
 *   - immutability is CONTENT ADDRESSED (FT2.0): the object key IS the
 *     sha256 digest of the content (`sha256:<hex>`), the port's put takes
 *     no key, and the adapter preserves the FIRST write's metadata and
 *     creation time on identical replays — in-place mutation is not
 *     representable;
 *   - FT2.0 fail-closed discipline: EXHAUSTED/DISABLED states surface as
 *     typed errors; no alternate path is representable anywhere in this
 *     adapter (there is no second destination to switch to).
 *
 * Object metadata namespace: the adapter stores the creation timestamp
 * under the reserved `arena-created-at` object-metadata key. Caller
 * metadata keys in the reserved `arena-` namespace are rejected with a
 * typed validation error so internal facts can never be forged or
 * shadowed.
 */

import {
  computeBlobDigest,
  contentAddressedBlobKey,
  isBlobContentType,
  PERSISTENCE_ERROR_CODES,
  PersistenceCapacityError,
  PersistenceError,
  SystemClock,
  toBlobKey,
  toCapacityDimensionReading,
  toCapacitySnapshot,
  validateBlobPutInput,
} from '@arena/persistence';
import type {
  BlobKey,
  BlobPutInput,
  BlobPutResult,
  BlobRecord,
  BlobStore,
  CapacityDimensionReading,
  CapacityProbe,
  CapacitySnapshot,
  Clock,
} from '@arena/persistence';
import { missingR2EnvVarNames, readR2ConfigFromEnv } from './env.js';
import { createR2ObjectStorageTransport } from './object-storage-transport.js';
import type { ObjectStorageTransport } from './object-storage-transport.js';

/** Declared allowance input (limit only — usage is a deployment-tier concern). */
export interface R2DeclaredAllowance {
  readonly dimension: string;
  readonly limit: number;
  readonly windowMs?: number;
}

export interface R2BlobStoreOptions {
  /** Env source; defaults to process.env. */
  readonly env?: Record<string, string | undefined>;
  /** Injected transport (tests / alternative runtimes). Overrides env discovery. */
  readonly transport?: ObjectStorageTransport;
  readonly clock?: Clock;
  /** Declared free-tier allowances surfaced through the capacity probe. */
  readonly declaredAllowances?: readonly R2DeclaredAllowance[];
}

/** The reserved object-metadata namespace for adapter-internal facts. */
export const R2_RESERVED_METADATA_PREFIX = 'arena-';

/** The object-metadata key carrying the first write's creation timestamp. */
export const R2_CREATED_AT_METADATA_KEY = 'arena-created-at';

/** Object-metadata keys must be HTTP-header-token safe (S3 metadata constraint). */
const METADATA_KEY_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_|~-]{1,128}$/;

export class R2BlobStore implements BlobStore, CapacityProbe {
  private readonly transport: ObjectStorageTransport | null;
  private readonly clock: Clock;
  private readonly declaredDimensions: readonly CapacityDimensionReading[];
  private readonly missingEnvNames: readonly string[];

  constructor(options: R2BlobStoreOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.missingEnvNames = missingR2EnvVarNames(options.env ?? process.env);
    if (options.transport !== undefined) {
      this.transport = options.transport;
    } else {
      const config = readR2ConfigFromEnv(options.env ?? process.env);
      // No configuration -> DISABLED (fail closed; no client is constructed).
      this.transport = config !== null ? createR2ObjectStorageTransport(config) : null;
    }
    this.declaredDimensions = (options.declaredAllowances ?? []).map((allowance) =>
      toCapacityDimensionReading({
        dimension: allowance.dimension,
        used: null,
        limit: allowance.limit,
        remaining: null,
        ...(allowance.windowMs !== undefined ? { windowMs: allowance.windowMs } : {}),
      }),
    );
  }

  async capacityProbe(): Promise<CapacitySnapshot> {
    if (this.transport === null) {
      return toCapacitySnapshot({
        status: 'DISABLED',
        checkedAt: this.clock.now(),
        dimensions: [],
        reasons: [{ code: 'configuration-missing' }],
      });
    }
    try {
      await this.transport.probe();
      return toCapacitySnapshot({
        status: 'AVAILABLE',
        checkedAt: this.clock.now(),
        dimensions: this.declaredDimensions,
        reasons: this.declaredDimensions.length === 0 ? [{ code: 'no-dimensions' }] : [],
      });
    } catch {
      return toCapacitySnapshot({
        status: 'DEGRADED',
        checkedAt: this.clock.now(),
        dimensions: this.declaredDimensions,
        reasons: [{ code: 'probe-failed' }],
      });
    }
  }

  async put(input: BlobPutInput): Promise<BlobPutResult> {
    const transport = this.gate();
    validateBlobPutInput(input);
    validateUserMetadata(input.metadata);
    // Content addressing: the key IS the digest. No caller key exists.
    const digest = await computeBlobDigest(input.content);
    const key = contentAddressedBlobKey(digest);
    const existing = await this.withTransportError('head_object', () =>
      transport.headObject(key),
    );
    if (existing !== null) {
      // Immutable replay: the first write's metadata and creation time win.
      return {
        key,
        digest,
        byteLength: existing.byteLength,
        createdAt: createdAtFromMetadata(existing.metadata),
        alreadyPresent: true,
      };
    }
    const createdAt = this.clock.now();
    await this.withTransportError('put_object', () =>
      transport.putObject({
        key,
        body: input.content,
        contentType: input.contentType,
        metadata: {
          ...(input.metadata ?? {}),
          [R2_CREATED_AT_METADATA_KEY]: String(createdAt),
        },
      }),
    );
    return { key, digest, byteLength: input.content.byteLength, createdAt, alreadyPresent: false };
  }

  async get(key: BlobKey): Promise<BlobRecord | null> {
    const transport = this.gate();
    toBlobKey(key);
    const stored = await this.withTransportError('get_object', () => transport.getObject(key));
    if (stored === null) return null;
    return toBlobRecord(key, stored);
  }

  async exists(key: BlobKey): Promise<boolean> {
    const transport = this.gate();
    toBlobKey(key);
    const head = await this.withTransportError('head_object', () => transport.headObject(key));
    return head !== null;
  }

  async delete(key: BlobKey): Promise<boolean> {
    const transport = this.gate();
    toBlobKey(key);
    return this.withTransportError('delete_object', () => transport.deleteObject(key));
  }

  /** True when the adapter has configuration / a transport (not DISABLED). */
  get enabled(): boolean {
    return this.transport !== null;
  }

  private gate(): ObjectStorageTransport {
    if (this.transport === null) {
      throw new PersistenceCapacityError(
        PERSISTENCE_ERROR_CODES.CAPACITY_DISABLED,
        'DISABLED',
        [{ code: 'configuration-missing' }],
        {
          message:
            'the hosted blob-store adapter is disabled: no object-store configuration was provided (fail closed)',
          details: {
            missingEnvVarNames: this.missingEnvNames,
          },
        },
      );
    }
    return this.transport;
  }

  /**
   * Wrap transport failures in the typed TRANSPORT_FAILED error. Driver
   * error messages can carry endpoint/credential detail — attached as
   * `cause` (never surfaced in the message) and the typed message stays
   * provider-detail-free.
   */
  private async withTransportError<T>(
    operationName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      if (cause instanceof PersistenceError) throw cause;
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED, {
        message: `object-store operation ${operationName} failed on the hosted blob transport`,
        details: { operation: operationName },
        cause,
      });
    }
  }
}

function validateUserMetadata(metadata: Readonly<Record<string, string>> | undefined): void {
  if (metadata === undefined) return;
  for (const [key, value] of Object.entries(metadata)) {
    if (!METADATA_KEY_PATTERN.test(key)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_BLOB_METADATA, {
        message: `blob metadata key must be header-token safe: ${JSON.stringify(key)}`,
      });
    }
    if (key.startsWith(R2_RESERVED_METADATA_PREFIX)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_BLOB_METADATA, {
        message: `blob metadata key ${JSON.stringify(key)} is in the reserved adapter namespace`,
        details: { reservedPrefix: R2_RESERVED_METADATA_PREFIX },
      });
    }
    if (!/^[\x20-\x7e]{1,128}$/.test(value)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_BLOB_METADATA, {
        message: 'blob metadata values must be 1..128 printable ASCII characters',
      });
    }
  }
}

function createdAtFromMetadata(metadata: Readonly<Record<string, string>>): number {
  const raw = metadata[R2_CREATED_AT_METADATA_KEY];
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function toBlobRecord(key: BlobKey, stored: {
  readonly contentType: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly byteLength: number;
  readonly body: Uint8Array;
}): BlobRecord {
  const digest = key.slice('sha256:'.length);
  const userMetadata: Record<string, string> = {};
  for (const [metaKey, value] of Object.entries(stored.metadata)) {
    if (!metaKey.startsWith(R2_RESERVED_METADATA_PREFIX)) {
      userMetadata[metaKey] = value;
    }
  }
  if (!isBlobContentType(stored.contentType)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_BLOB_CONTENT_TYPE, {
      message: `stored object carries an invalid content type: ${JSON.stringify(stored.contentType)}`,
    });
  }
  const record: BlobRecord = {
    key,
    // Defensive copy: mutating a returned record cannot corrupt the store.
    // (The copy stays MUTABLE by contract — callers own it.)
    content: Uint8Array.from(stored.body),
    contentType: stored.contentType,
    metadata: Object.freeze(userMetadata),
    byteLength: stored.body.byteLength,
    digest,
    createdAt: createdAtFromMetadata(stored.metadata),
  };
  return Object.freeze(record);
}
