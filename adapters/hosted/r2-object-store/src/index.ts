/**
 * @arena/hosted-r2-object-store — the Cloudflare R2 adapter for
 * @arena/persistence (Work Order B002; issue #64; FT2.0 "Storage").
 *
 * Public surface:
 *   env                       — env-var contract (R2_ACCOUNT_ID /
 *                               R2_S3_ENDPOINT / R2_ACCESS_KEY_ID /
 *                               R2_SECRET_ACCESS_KEY / R2_BUCKET)
 *   object-storage-transport  — the ObjectStorageTransport seam + the
 *                               default S3-compatible client transport (the
 *                               ONLY infrastructure touchpoint)
 *   adapter                   — R2BlobStore (BlobStore + CapacityProbe;
 *                               DISABLED fail-closed without config;
 *                               content-addressed immutable puts)
 *
 * Configuration is read ONLY from server-side env vars; values are never
 * committed and never logged. Without configuration the adapter is
 * DISABLED and every operation fails closed with the typed capacity
 * error. The ObjectStorageTransport seam lets the FULL persistence
 * contract suite run against this adapter without live credentials.
 */

export * from './env.js';
export * from './object-storage-transport.js';
export * from './adapter.js';
