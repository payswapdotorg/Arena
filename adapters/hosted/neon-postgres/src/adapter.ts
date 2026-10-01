/**
 * Neon PostgreSQL adapter over the ControlPlaneRepository port
 * (Work Order B002; issue #64; FT2.0 "Database": the authoritative store
 * for Arena control-plane records).
 *
 * Posture:
 *   - configuration comes ONLY from server-side env vars
 *     (DATABASE_URL / NEON_CONNECTION_STRING — see ./env.ts); values are
 *     never committed and never logged;
 *   - without configuration the adapter is DISABLED and fails closed:
 *     every port operation throws the typed capacity error
 *     (PERSISTENCE_CAPACITY_DISABLED) BEFORE any network call, and the
 *     capacity probe reports DISABLED — no crash, no secret leakage;
 *   - the infrastructure touchpoint is the injected SqlTransport seam, so
 *     the full persistence contract suite runs against this adapter
 *     without live credentials (the default transport maps statements
 *     onto the Neon serverless HTTP driver — Vercel compatible);
 *   - FT2.0 fail-closed discipline: EXHAUSTED/DISABLED states surface as
 *     typed errors; no alternate path is representable anywhere in this
 *     adapter (there is no second destination to switch to).
 */

import {
  canonicalEqual,
  deepFreeze,
  isRecordId,
  isRecordKind,
  isTenantId,
  PERSISTENCE_ERROR_CODES,
  PersistenceError,
  PersistenceCapacityError,
  SystemClock,
  toCapacityDimensionReading,
  toCapacitySnapshot,
  toRecordData,
} from '@arena/persistence';
import type {
  CapacityDimensionReading,
  CapacityProbe,
  CapacitySnapshot,
  Clock,
  ControlPlaneCountQuery,
  ControlPlaneInsertInput,
  ControlPlaneInsertResult,
  ControlPlaneListQuery,
  ControlPlaneRecord,
  ControlPlaneRepository,
  ControlPlaneUpdateInput,
  JsonSafeValue,
} from '@arena/persistence';
import { missingNeonEnvVarNames, readNeonConfigFromEnv } from './env.js';
import { createNeonHttpSqlTransport } from './sql-transport.js';
import type { SqlRow, SqlTransport } from './sql-transport.js';
import { executeStatement } from './sql-transport.js';
import {
  countControlRecordsStatement,
  deleteControlRecordStatement,
  insertControlRecordStatement,
  selectAllControlRecordsStatement,
  selectControlRecordStatement,
  selectControlRecordsStatement,
  selectOneStatement,
  updateControlRecordStatement,
} from './statements.js';

/** Declared allowance input (limit only — usage is a deployment-tier concern). */
export interface NeonDeclaredAllowance {
  readonly dimension: string;
  readonly limit: number;
  readonly windowMs?: number;
}

export interface NeonControlPlaneRepositoryOptions {
  /** Env source; defaults to process.env. */
  readonly env?: Record<string, string | undefined>;
  /** Injected transport (tests / alternative runtimes). Overrides env discovery. */
  readonly transport?: SqlTransport;
  readonly clock?: Clock;
  /** Declared free-tier allowances surfaced through the capacity probe. */
  readonly declaredAllowances?: readonly NeonDeclaredAllowance[];
}

export class NeonControlPlaneRepository implements ControlPlaneRepository, CapacityProbe {
  private readonly transport: SqlTransport | null;
  private readonly clock: Clock;
  private readonly declaredDimensions: readonly CapacityDimensionReading[];
  private readonly missingEnvNames: readonly string[];

  constructor(options: NeonControlPlaneRepositoryOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.missingEnvNames = missingNeonEnvVarNames(options.env ?? process.env);
    if (options.transport !== undefined) {
      this.transport = options.transport;
    } else {
      const config = readNeonConfigFromEnv(options.env ?? process.env);
      // No configuration -> DISABLED (fail closed; no client is constructed).
      this.transport = config !== null ? createNeonHttpSqlTransport(config.connectionString) : null;
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
      await executeStatement(this.transport, selectOneStatement());
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

  async insert(input: ControlPlaneInsertInput): Promise<ControlPlaneInsertResult> {
    const transport = this.gate();
    const validated = validateInsertInput(input);
    // Idempotency and conflict semantics live in the adapter (identical to
    // the local fake): select, replay or conflict, then insert.
    const existingRows = await executeStatement(
      transport,
      selectControlRecordStatement(validated.recordId),
    );
    const existing = existingRows.length > 0 ? toControlPlaneRecord(existingRows[0] as SqlRow) : null;
    if (existing !== null) {
      const identical =
        existing.tenantId === validated.tenantId &&
        existing.kind === validated.kind &&
        existing.version === validated.version &&
        canonicalEqual(existing.data, validated.data);
      if (!identical) {
        throw new PersistenceError(PERSISTENCE_ERROR_CODES.RECORD_EXISTS, {
          message: `record already exists with different content: ${validated.recordId}`,
          details: { recordId: validated.recordId },
        });
      }
      return { record: existing, created: false };
    }
    const now = this.clock.now();
    const record: ControlPlaneRecord = deepFreeze({
      recordId: validated.recordId,
      tenantId: validated.tenantId,
      kind: validated.kind,
      version: validated.version,
      revision: 1,
      data: deepFreeze(validated.data),
      createdAt: now,
      updatedAt: now,
    });
    await executeStatement(transport, insertControlRecordStatement(record));
    return { record, created: true };
  }

  async get(recordId: string): Promise<ControlPlaneRecord | null> {
    const transport = this.gate();
    if (!isRecordId(recordId)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_ID, {
        message: `invalid record id: ${JSON.stringify(recordId)}`,
      });
    }
    const rows = await executeStatement(transport, selectControlRecordStatement(recordId));
    return rows.length > 0 ? toControlPlaneRecord(rows[0] as SqlRow) : null;
  }

  async update(recordId: string, update: ControlPlaneUpdateInput): Promise<ControlPlaneRecord> {
    const transport = this.gate();
    if (!isRecordId(recordId)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_ID, {
        message: `invalid record id: ${JSON.stringify(recordId)}`,
      });
    }
    if (!Number.isInteger(update.expectedRevision) || update.expectedRevision < 1) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_REVISION, {
        message: 'expectedRevision must be a positive integer',
        details: { received: update.expectedRevision },
      });
    }
    const data = toRecordData(update.data);
    const currentRows = await executeStatement(
      transport,
      selectControlRecordStatement(recordId),
    );
    if (currentRows.length === 0) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.RECORD_NOT_FOUND, {
        message: `record not found: ${recordId}`,
        details: { recordId },
      });
    }
    const current = toControlPlaneRecord(currentRows[0] as SqlRow);
    if (current.revision !== update.expectedRevision) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.REVISION_CONFLICT, {
        message: `revision conflict for ${recordId}: expected ${String(update.expectedRevision)}, current ${String(current.revision)}`,
        details: {
          recordId,
          expectedRevision: update.expectedRevision,
          currentRevision: current.revision,
        },
      });
    }
    const rows = await executeStatement(
      transport,
      updateControlRecordStatement({
        recordId,
        expectedRevision: update.expectedRevision,
        nextRevision: current.revision + 1,
        data,
        updatedAt: this.clock.now(),
      }),
    );
    if (rows.length === 0) {
      // Lost a concurrent race between the guard and the update.
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.REVISION_CONFLICT, {
        message: `revision conflict for ${recordId}: concurrent update won the guard`,
        details: { recordId, expectedRevision: update.expectedRevision },
      });
    }
    return toControlPlaneRecord(rows[0] as SqlRow);
  }

  async delete(recordId: string): Promise<boolean> {
    const transport = this.gate();
    if (!isRecordId(recordId)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_ID, {
        message: `invalid record id: ${JSON.stringify(recordId)}`,
      });
    }
    const rows = await executeStatement(transport, deleteControlRecordStatement(recordId));
    return rows.length > 0;
  }

  async list(query: ControlPlaneListQuery): Promise<readonly ControlPlaneRecord[]> {
    const transport = this.gate();
    validateListQuery(query);
    const rows =
      query.limit !== undefined
        ? await executeStatement(
            transport,
            selectControlRecordsStatement({
              kind: query.kind,
              tenantId: query.tenantId,
              limit: query.limit,
              offset: query.offset,
            }),
          )
        : await executeStatement(
            transport,
            selectAllControlRecordsStatement({
              kind: query.kind,
              tenantId: query.tenantId,
              offset: query.offset,
            }),
          );
    return Object.freeze(rows.map((row) => toControlPlaneRecord(row)));
  }

  async count(query: ControlPlaneCountQuery): Promise<number> {
    const transport = this.gate();
    validateListQuery(query);
    const rows = await executeStatement(
      transport,
      countControlRecordsStatement({ kind: query.kind, tenantId: query.tenantId }),
    );
    const total = rows[0]?.['total'];
    return typeof total === 'number' ? total : 0;
  }

  /** True when the adapter has configuration / a transport (not DISABLED). */
  get enabled(): boolean {
    return this.transport !== null;
  }

  private gate(): SqlTransport {
    if (this.transport === null) {
      throw new PersistenceCapacityError(
        PERSISTENCE_ERROR_CODES.CAPACITY_DISABLED,
        'DISABLED',
        [{ code: 'configuration-missing' }],
        {
          message:
            'the hosted control-plane adapter is disabled: no connection configuration was provided (fail closed)',
          details: {
            missingEnvVarNames: this.missingEnvNames,
          },
        },
      );
    }
    return this.transport;
  }
}

function validateInsertInput(
  input: ControlPlaneInsertInput,
): ControlPlaneInsertInput & { data: JsonSafeValue } {
  if (!isRecordId(input.recordId)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_ID, {
      message: `invalid record id: ${JSON.stringify(input.recordId)}`,
    });
  }
  if (!isTenantId(input.tenantId)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_TENANT_ID, {
      message: `invalid tenant id: ${JSON.stringify(input.tenantId)}`,
    });
  }
  if (!isRecordKind(input.kind)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_KIND, {
      message: `invalid record kind: ${JSON.stringify(input.kind)}`,
    });
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_VERSION, {
      message: `record version must be a positive integer: ${String(input.version)}`,
    });
  }
  const data = toRecordData(input.data);
  return { ...input, data };
}

function validateListQuery(query: { readonly kind?: string; readonly tenantId?: string; readonly limit?: number; readonly offset?: number }): void {
  if (query.kind !== undefined && !isRecordKind(query.kind)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_KIND, {
      message: `invalid record kind filter: ${JSON.stringify(query.kind)}`,
    });
  }
  if (query.tenantId !== undefined && !isTenantId(query.tenantId)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_TENANT_ID, {
      message: `invalid tenant id filter: ${JSON.stringify(query.tenantId)}`,
    });
  }
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
      message: `limit must be a positive integer: ${String(query.limit)}`,
    });
  }
  if (query.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
      message: `offset must be a non-negative integer: ${String(query.offset)}`,
    });
  }
}

/** Map a result row onto the port record (fail closed on shape). */
export function toControlPlaneRecord(row: SqlRow): ControlPlaneRecord {
  const recordId = row['record_id'];
  const tenantId = row['tenant_id'];
  const kind = row['kind'];
  const version = Number(row['version']);
  const revision = Number(row['revision']);
  const createdAtRaw = row['created_at'];
  const updatedAtRaw = row['updated_at'];
  if (
    !isRecordId(recordId) ||
    !isTenantId(tenantId) ||
    !isRecordKind(kind) ||
    !Number.isInteger(version) ||
    version < 1 ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    createdAtRaw === null ||
    createdAtRaw === undefined ||
    updatedAtRaw === null ||
    updatedAtRaw === undefined
  ) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
      message: 'hosted control-plane row does not map onto the port record shape',
    });
  }
  // Some drivers return BIGINT/int8 as strings; epoch ms always fit Number.
  const createdAt = Number(createdAtRaw);
  const updatedAt = Number(updatedAtRaw);
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
      message: 'hosted control-plane row carries non-numeric timestamps',
    });
  }
  // jsonb may arrive parsed (object) or as a JSON string depending on driver mode.
  const rawData = row['data'];
  const data = typeof rawData === 'string' ? safeParseJson(rawData) : rawData;
  return deepFreeze({
    recordId,
    tenantId,
    kind,
    version,
    revision,
    data: deepFreeze(toRecordData(data)),
    createdAt,
    updatedAt,
  } satisfies ControlPlaneRecord);
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
