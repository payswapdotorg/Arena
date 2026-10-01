/**
 * Object-storage transport seam for the Cloudflare R2 adapter (Work Order
 * B002).
 *
 * The adapter's ONLY infrastructure touchpoint is `ObjectStorageTransport`:
 * a minimal object-store vocabulary (probe / head / get / put / delete).
 * The default transport maps the vocabulary onto the S3-compatible client
 * (R2's S3 API) over `@aws-sdk/client-s3`; tests (and alternative runtimes)
 * inject a transport implementing the same semantics — this is how the
 * FULL persistence contract suite runs against this adapter without live
 * credentials (FT2.0 "Local parity" / "Tests never require live provider
 * credentials").
 *
 * Semantics every transport MUST honor (mirrored by the test fake):
 *   - head/get return null for absent objects (never throw);
 *   - put writes (or overwrites) an object — immutability is enforced at
 *     the ADAPTER level through content addressing, not here;
 *   - delete returns whether a live object existed;
 *   - probe throws on unreachability, returns void otherwise.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { R2AdapterConfig } from './env.js';

/** The metadata/object facts a head operation returns. */
export interface ObjectHead {
  readonly contentType: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly byteLength: number;
}

/** A stored object: head facts plus its bytes. */
export interface StoredObject extends ObjectHead {
  readonly body: Uint8Array;
}

/** One immutable object write. */
export interface ObjectPutInput {
  readonly key: string;
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly metadata: Readonly<Record<string, string>>;
}

/** The infrastructure seam this adapter requires. */
export interface ObjectStorageTransport {
  /** Cheap reachability probe (HeadBucket); throws when unreachable. */
  probe(): Promise<void>;
  /** Object facts, or null when the object is absent. */
  headObject(key: string): Promise<ObjectHead | null>;
  /** The stored object, or null when absent. */
  getObject(key: string): Promise<StoredObject | null>;
  /** Write an object (immutability discipline lives in the adapter). */
  putObject(input: ObjectPutInput): Promise<void>;
  /** True when a live object was deleted, false when absent. */
  deleteObject(key: string): Promise<boolean>;
}

/** The closed operation-name vocabulary issued by this adapter. */
export const OBJECT_OPERATION_NAMES = Object.freeze([
  'probe',
  'head_object',
  'get_object',
  'put_object',
  'delete_object',
] as const);

export type ObjectOperationName = (typeof OBJECT_OPERATION_NAMES)[number];

function isAbsentError(error: unknown): boolean {
  if (!(error instanceof S3ServiceException)) return false;
  return error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404;
}

/**
 * The default transport over the S3-compatible API (R2). Configuration is
 * used ONLY to construct the client and is never logged. `region: 'auto'`
 * is the R2 convention; the bucket is addressed in path style through the
 * account endpoint.
 */
export function createR2ObjectStorageTransport(config: R2AdapterConfig): ObjectStorageTransport {
  const client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });
  return {
    async probe(): Promise<void> {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    },
    async headObject(key: string): Promise<ObjectHead | null> {
      try {
        const output = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        );
        return {
          contentType: output.ContentType ?? 'application/octet-stream',
          metadata: { ...(output.Metadata ?? {}) },
          byteLength: output.ContentLength ?? 0,
        };
      } catch (error) {
        if (isAbsentError(error)) return null;
        throw error;
      }
    },
    async getObject(key: string): Promise<StoredObject | null> {
      try {
        const output = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        );
        if (output.Body === undefined) {
          throw new Error('object response carried no body');
        }
        const body = await output.Body.transformToByteArray();
        return {
          contentType: output.ContentType ?? 'application/octet-stream',
          metadata: { ...(output.Metadata ?? {}) },
          byteLength: body.byteLength,
          body,
        };
      } catch (error) {
        if (isAbsentError(error)) return null;
        throw error;
      }
    },
    async putObject(input: ObjectPutInput): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          Metadata: { ...input.metadata },
        }),
      );
    },
    async deleteObject(key: string): Promise<boolean> {
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        );
        if (head === undefined) return false;
      } catch (error) {
        if (isAbsentError(error)) return false;
        throw error;
      }
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      return true;
    },
  };
}
