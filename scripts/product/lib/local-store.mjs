/**
 * The local fake persistence store (Work Order B016): a FILE-BACKED
 * implementation of the B002 ControlPlaneRepository port.
 *
 * Why: the B002 fakes are in-memory (per-process), but a local developer
 * workflow needs local state that SURVIVES across CLI invocations — seed
 * writes it, doctor inspects it, reset wipes it. This module implements
 * the SAME port with the SAME semantics (validation, error taxonomy,
 * idempotent insert, optimistic concurrency, deterministic listing,
 * frozen records), so the B006 DemoStore seeds through the port exactly
 * as it does over the in-memory fake — there is NO bespoke path that
 * bypasses the repository.
 *
 * Storage shape (deterministic serialization — identical state produces
 * identical file bytes):
 *
 *   { "formatVersion": 1, "records": [ <ControlPlaneRecord>, ... ] }
 *
 * Records are sorted by recordId on write; each mutation persists
 * atomically (temp file + rename). Reads deep-freeze loaded records
 * (read-discipline parity with the fakes).
 *
 * This is a LOCAL FAKE — zero providers, zero credentials, zero
 * customer-posture. It is disposable by design (reset wipes it).
 *
 * Plain .mjs — zero external dependencies; the @arena/persistence
 * validators/errors are INJECTED so the module stays testable and the
 * port parity is explicit.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Wire version of the local store file format. */
export const STORE_FORMAT_VERSION = 1;

/**
 * Deterministic serialization: record ids sorted ascending, fixed field
 * order, 2-space indent, trailing newline. Two stores holding the same
 * records produce byte-identical files.
 *
 * @param {Map<string, Record<string, unknown>>} records
 * @returns {string}
 */
export function serializeStore(records) {
  const ordered = [...records.keys()].sort().map((id) => records.get(id));
  return `${JSON.stringify({ formatVersion: STORE_FORMAT_VERSION, records: ordered }, null, 2)}\n`;
}

/**
 * Parse + structurally validate a store file's text.
 *
 * @param {string} text
 * @returns {{ ok: true, records: Map<string, Record<string, unknown>> } | { ok: false, reason: string }}
 */
export function parseStoreFile(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `not valid JSON (${String(error instanceof Error ? error.message : error)})` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'store root must be a JSON object' };
  }
  if (parsed.formatVersion !== STORE_FORMAT_VERSION) {
    return { ok: false, reason: `unsupported store formatVersion ${JSON.stringify(parsed.formatVersion)} (expected ${STORE_FORMAT_VERSION})` };
  }
  if (!Array.isArray(parsed.records)) {
    return { ok: false, reason: 'store "records" must be an array' };
  }
  const records = new Map();
  for (const entry of parsed.records) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, reason: 'every store record must be an object' };
    }
    if (typeof entry.recordId !== 'string' || entry.recordId.length === 0) {
      return { ok: false, reason: 'a store record is missing its recordId' };
    }
    if (records.has(entry.recordId)) {
      return { ok: false, reason: `duplicate recordId ${entry.recordId} in store` };
    }
    records.set(entry.recordId, entry);
  }
  return { ok: true, records };
}

/**
 * Read a store snapshot for diagnosis (doctor) — never mutates.
 *
 * @param {string} storePath
 * @returns {{ status: 'absent' } | { status: 'corrupt', reason: string } | { status: 'ok', recordCount: number, recordIds: string[], tenantCounts: Record<string, number>, records: Map<string, Record<string, unknown>> }}
 */
export function readStoreSnapshot(storePath) {
  if (!existsSync(storePath)) {
    return { status: 'absent' };
  }
  let text;
  try {
    text = readFileSync(storePath, 'utf-8');
  } catch (error) {
    return { status: 'corrupt', reason: `unreadable (${String(error instanceof Error ? error.message : error)})` };
  }
  const parsed = parseStoreFile(text);
  if (!parsed.ok) {
    return { status: 'corrupt', reason: parsed.reason };
  }
  const records = [...parsed.records.values()];
  const tenantCounts = {};
  for (const record of records) {
    const tenant = typeof record.tenantId === 'string' ? record.tenantId : '<missing-tenantId>';
    tenantCounts[tenant] = (tenantCounts[tenant] ?? 0) + 1;
  }
  return {
    status: 'ok',
    recordCount: records.length,
    recordIds: records.map((record) => String(record.recordId)).sort(),
    tenantCounts,
    records: parsed.records,
  };
}

/**
 * Open the file-backed ControlPlaneRepository.
 *
 * Semantics mirror FakeControlPlaneRepository exactly (the shared B002
 * contract): idempotent insert (identical replay → created:false;
 * conflicting content → PERSISTENCE_RECORD_EXISTS), optimistic update,
 * deterministic list (recordId ascending, limit/offset), frozen records.
 * Mutations persist atomically; no-op replays do not rewrite the file.
 *
 * @param {{
 *   persistence: Record<string, any>,
 *   storePath: string,
 *   clock?: { now(): number },
 * }} options — persistence is the loaded @arena/persistence module.
 * @returns {Promise<{ repository: Record<string, any>, recordCount: number, storePath: string }>}
 * @throws {Error} with an actionable message when the existing store is corrupt.
 */
export async function openFileBackedControlPlaneRepository(options) {
  const { persistence, storePath } = options;
  const clock = options.clock ?? { now: () => 0 };

  let records = new Map();
  if (existsSync(storePath)) {
    const text = readFileSync(storePath, 'utf-8');
    const parsed = parseStoreFile(text);
    if (!parsed.ok) {
      throw new Error(
        `local store is corrupt: ${parsed.reason} — next: node scripts/product/reset.mjs --yes, then node scripts/product/seed.mjs`,
      );
    }
    records = parsed.records;
  }
  for (const [id, record] of records) {
    records.set(id, persistence.deepFreeze(record));
  }

  const persist = () => {
    mkdirSync(dirname(storePath), { recursive: true });
    const tmpPath = `${storePath}.tmp`;
    writeFileSync(tmpPath, serializeStore(records), 'utf-8');
    renameSync(tmpPath, storePath);
  };

  const validateInsertInput = (input) => {
    if (!persistence.isRecordId(input.recordId)) {
      throw new persistence.PersistenceError(persistence.PERSISTENCE_ERROR_CODES.INVALID_RECORD_ID, {
        message: `invalid record id: ${JSON.stringify(input.recordId)}`,
      });
    }
    if (!persistence.isTenantId(input.tenantId)) {
      throw new persistence.PersistenceError(persistence.PERSISTENCE_ERROR_CODES.INVALID_TENANT_ID, {
        message: `invalid tenant id: ${JSON.stringify(input.tenantId)}`,
      });
    }
    if (!persistence.isRecordKind(input.kind)) {
      throw new persistence.PersistenceError(persistence.PERSISTENCE_ERROR_CODES.INVALID_RECORD_KIND, {
        message: `invalid record kind: ${JSON.stringify(input.kind)}`,
      });
    }
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new persistence.PersistenceError(persistence.PERSISTENCE_ERROR_CODES.INVALID_RECORD_VERSION, {
        message: `record version must be a positive integer: ${String(input.version)}`,
      });
    }
    const data = persistence.toRecordData(input.data);
    return { ...input, data };
  };

  const validateRecordId = (recordId) => {
    if (!persistence.isRecordId(recordId)) {
      throw new persistence.PersistenceError(persistence.PERSISTENCE_ERROR_CODES.INVALID_RECORD_ID, {
        message: `invalid record id: ${JSON.stringify(recordId)}`,
      });
    }
  };

  const validateListQuery = (query) => {
    if (query.kind !== undefined && !persistence.isRecordKind(query.kind)) {
      throw new persistence.PersistenceError(persistence.PERSISTENCE_ERROR_CODES.INVALID_RECORD_KIND, {
        message: `invalid record kind filter: ${JSON.stringify(query.kind)}`,
      });
    }
    if (query.tenantId !== undefined && !persistence.isTenantId(query.tenantId)) {
      throw new persistence.PersistenceError(persistence.PERSISTENCE_ERROR_CODES.INVALID_TENANT_ID, {
        message: `invalid tenant id filter: ${JSON.stringify(query.tenantId)}`,
      });
    }
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) {
      throw new persistence.PersistenceError(persistence.PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
        message: `limit must be a positive integer: ${String(query.limit)}`,
      });
    }
    if (query.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0)) {
      throw new persistence.PersistenceError(persistence.PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
        message: `offset must be a non-negative integer: ${String(query.offset)}`,
      });
    }
  };

  const validateCountQuery = (query) => {
    if (query.kind !== undefined && !persistence.isRecordKind(query.kind)) {
      throw new persistence.PersistenceError(persistence.PERSISTENCE_ERROR_CODES.INVALID_RECORD_KIND, {
        message: `invalid record kind filter: ${JSON.stringify(query.kind)}`,
      });
    }
    if (query.tenantId !== undefined && !persistence.isTenantId(query.tenantId)) {
      throw new persistence.PersistenceError(persistence.PERSISTENCE_ERROR_CODES.INVALID_TENANT_ID, {
        message: `invalid tenant id filter: ${JSON.stringify(query.tenantId)}`,
      });
    }
  };

  const repository = {
    async insert(input) {
      const validated = validateInsertInput(input);
      const existing = records.get(validated.recordId);
      if (existing !== undefined) {
        const identical =
          existing.tenantId === validated.tenantId &&
          existing.kind === validated.kind &&
          existing.version === validated.version &&
          persistence.canonicalEqual(existing.data, validated.data);
        if (!identical) {
          throw new persistence.PersistenceError(persistence.PERSISTENCE_ERROR_CODES.RECORD_EXISTS, {
            message: `record already exists with different content: ${validated.recordId}`,
            details: { recordId: validated.recordId },
          });
        }
        return { record: existing, created: false };
      }
      const now = clock.now();
      const record = persistence.deepFreeze({
        recordId: validated.recordId,
        tenantId: validated.tenantId,
        kind: validated.kind,
        version: validated.version,
        revision: 1,
        data: persistence.deepFreeze(validated.data),
        createdAt: now,
        updatedAt: now,
      });
      records.set(validated.recordId, record);
      persist();
      return { record, created: true };
    },

    async get(recordId) {
      validateRecordId(recordId);
      return records.get(recordId) ?? null;
    },

    async update(recordId, update) {
      validateRecordId(recordId);
      if (!Number.isInteger(update.expectedRevision) || update.expectedRevision < 1) {
        throw new persistence.PersistenceError(persistence.PERSISTENCE_ERROR_CODES.INVALID_REVISION, {
          message: 'expectedRevision must be a positive integer',
          details: { received: update.expectedRevision },
        });
      }
      const data = persistence.toRecordData(update.data);
      const existing = records.get(recordId);
      if (existing === undefined) {
        throw new persistence.PersistenceError(persistence.PERSISTENCE_ERROR_CODES.RECORD_NOT_FOUND, {
          message: `record not found: ${recordId}`,
          details: { recordId },
        });
      }
      if (existing.revision !== update.expectedRevision) {
        throw new persistence.PersistenceError(persistence.PERSISTENCE_ERROR_CODES.REVISION_CONFLICT, {
          message: `revision conflict for ${recordId}: expected ${String(update.expectedRevision)}, current ${String(existing.revision)}`,
          details: { recordId, expectedRevision: update.expectedRevision, currentRevision: existing.revision },
        });
      }
      const updated = persistence.deepFreeze({
        ...existing,
        revision: existing.revision + 1,
        data: persistence.deepFreeze(data),
        updatedAt: clock.now(),
      });
      records.set(recordId, updated);
      persist();
      return updated;
    },

    async delete(recordId) {
      validateRecordId(recordId);
      const deleted = records.delete(recordId);
      if (deleted) persist();
      return deleted;
    },

    async list(query) {
      validateListQuery(query);
      const offset = query.offset ?? 0;
      const limit = query.limit ?? Number.POSITIVE_INFINITY;
      const matches = [...records.values()]
        .filter(
          (record) =>
            (query.kind === undefined || record.kind === query.kind) &&
            (query.tenantId === undefined || record.tenantId === query.tenantId),
        )
        .sort((a, b) => (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0));
      return Object.freeze(matches.slice(offset, offset + limit));
    },

    async count(query) {
      validateCountQuery(query);
      let total = 0;
      for (const record of records.values()) {
        if (
          (query.kind === undefined || record.kind === query.kind) &&
          (query.tenantId === undefined || record.tenantId === query.tenantId)
        ) {
          total += 1;
        }
      }
      return total;
    },
  };

  return Object.freeze({ repository, recordCount: records.size, storePath });
}
