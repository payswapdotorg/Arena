/**
 * Case/task record addressing + codecs (Work Order B008; issue #80).
 *
 * The canonical write path stores CapabilityCase protocol objects as B002
 * control-plane records — no parallel store, no parallel shape:
 *
 *   - recordId scheme: `case.<tenant>.<caseId>` (tenant-qualified so the
 *     repository's global recordId keyspace can never collide across
 *     tenants — lock rule 11);
 *   - kind: `capability-case` (a disclosed B005 read-model kind, so the
 *     record scrolls through the canonical read path);
 *   - version: the A005 CAPABILITY_CASE_RECORD_VERSION;
 *   - data: the frozen CapabilityCase object itself (JSON-safe, content
 *     addressed — the record payload IS the canonical object).
 *
 * Reading back is FAIL-CLOSED: the payload must satisfy `isCapabilityCase`
 * and `verifyCapabilityCase` (digest re-computation). A `capability-case`
 * record whose payload is NOT a canonical protocol object (e.g. the B006
 * demo corpus's narrative-shaped case record) is a typed
 * PRODUCT_FLOW_RECORD_INVALID — the flow runtime never guesses a case
 * into existence, and never mutates a record it cannot verify.
 *
 * TaskSpec proposals compose-task produces (when a task composer is
 * injected) are stored the same way: kind `task-spec`, recordId
 * `task.<tenant>.<taskId>`, data = the frozen TaskSpec. `task-spec` is not
 * (yet) a disclosed read-model kind — it is read by id through the
 * canonical read path (`read-canonical`), never dropped, never coerced.
 */

import {
  CAPABILITY_CASE_RECORD_VERSION,
  isCapabilityCase,
  verifyCapabilityCase,
} from '@arena/capability-case';
import type { CapabilityCase } from '@arena/capability-case';
import { isTaskSpec, verifyTaskSpec } from '@arena/task-spec';
import type { TaskSpec } from '@arena/task-spec';
import { isJsonSafeValue } from '@arena/persistence';
import type {
  ControlPlaneInsertInput,
  ControlPlaneRecord,
  JsonSafeValue,
} from '@arena/persistence';
import { PRODUCT_FLOW_ERROR_CODES, ProductFlowError } from './errors.js';

/** The control-plane kind a canonical capability case is stored under. */
export const CASE_RECORD_KIND = 'capability-case' as const;

/** The control-plane kind a TaskSpec proposal is stored under. */
export const TASK_RECORD_KIND = 'task-spec' as const;

/** True iff the tenant/case ids are safe record-key components. */
function isSafeIdComponent(value: string): boolean {
  return /^[a-z0-9][a-z0-9-_.]{0,127}$/i.test(value);
}

function requireSafeId(value: string, field: string): string {
  if (typeof value !== 'string' || !isSafeIdComponent(value)) {
    throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.MALFORMED_INPUT, {
      message: `${field} must be a bounded slug (letters, digits, dash, underscore, dot; 1-128 chars): ${JSON.stringify(value)}`,
      details: { field, value },
    });
  }
  return value;
}

/** The tenant-qualified recordId of a canonical case (stable, global-safe). */
export function caseRecordId(identity: {
  readonly tenant: string;
  readonly caseId: string;
}): string {
  return `case.${requireSafeId(identity.tenant, 'identity.tenant')}.${requireSafeId(identity.caseId, 'identity.caseId')}`;
}

/** The tenant-qualified recordId of a TaskSpec proposal. */
export function taskRecordId(identity: {
  readonly tenant: string;
  readonly taskId: string;
}): string {
  return `task.${requireSafeId(identity.tenant, 'identity.tenant')}.${requireSafeId(identity.taskId, 'identity.taskId')}`;
}

/** Assert + carry a JSON-safe payload (fail closed before any write). */
function asJsonSafeData(payload: unknown, what: string): JsonSafeValue {
  if (!isJsonSafeValue(payload)) {
    throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.RECORD_INVALID, {
      message: `refusing to store a payload that is not canonical-JSON-safe: ${what}`,
    });
  }
  return payload;
}

/** The insert input that stores a canonical case (idempotent insert). */
export function toCaseInsertInput(caseRecord: CapabilityCase): ControlPlaneInsertInput {
  if (!isCapabilityCase(caseRecord)) {
    throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.RECORD_INVALID, {
      message: 'refusing to store a payload that is not a canonical capability case',
      details: { digest: (caseRecord as { digest?: unknown } | null)?.digest },
    });
  }
  return Object.freeze({
    recordId: caseRecordId(caseRecord.identity),
    tenantId: caseRecord.identity.tenant,
    kind: CASE_RECORD_KIND,
    version: CAPABILITY_CASE_RECORD_VERSION,
    data: asJsonSafeData(caseRecord, `capability case ${caseRecord.identity.caseId}`),
  });
}

/**
 * Decode a stored record's payload back into a canonical case. Fail
 * closed: wrong kind → RECORD_INVALID; non-canonical payload →
 * RECORD_INVALID; digest mismatch → the CANONICAL CAPABILITY_CASE_TAMPERED
 * error propagates verbatim.
 */
export async function fromCaseRecord(record: ControlPlaneRecord): Promise<CapabilityCase> {
  if (record.kind !== CASE_RECORD_KIND) {
    throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.RECORD_INVALID, {
      message: `record ${JSON.stringify(record.recordId)} has kind ${JSON.stringify(record.kind)}, not ${JSON.stringify(CASE_RECORD_KIND)}`,
      details: { recordId: record.recordId, kind: record.kind },
    });
  }
  const data = record.data as unknown;
  if (!isCapabilityCase(data)) {
    throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.RECORD_INVALID, {
      message: `capability-case record ${JSON.stringify(record.recordId)} does not carry a canonical A005 case payload (e.g. a narrative-shaped record); the flow runtime never guesses a case out of it`,
      details: { recordId: record.recordId },
    });
  }
  // Tamper tripwire: recompute the content digest (canonical typed error).
  await verifyCapabilityCase(data);
  return data;
}

/** The insert input that stores a TaskSpec proposal (idempotent insert). */
export function toTaskInsertInput(spec: TaskSpec): ControlPlaneInsertInput {
  if (!isTaskSpec(spec)) {
    throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.RECORD_INVALID, {
      message: 'refusing to store a payload that is not a canonical TaskSpec',
      details: { digest: (spec as { digest?: unknown } | null)?.digest },
    });
  }
  return Object.freeze({
    recordId: taskRecordId(spec.identity),
    tenantId: spec.identity.tenant,
    kind: TASK_RECORD_KIND,
    version: spec.recordVersion,
    data: asJsonSafeData(spec, `task spec ${spec.identity.taskId}`),
  });
}

/**
 * Decode a stored task record's payload back into a canonical TaskSpec
 * (fail closed; the TaskSpec digest is re-verified — canonical typed
 * TASK_SPEC_TAMPERED propagates verbatim).
 */
export async function fromTaskRecord(record: ControlPlaneRecord): Promise<TaskSpec> {
  if (record.kind !== TASK_RECORD_KIND) {
    throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.RECORD_INVALID, {
      message: `record ${JSON.stringify(record.recordId)} has kind ${JSON.stringify(record.kind)}, not ${JSON.stringify(TASK_RECORD_KIND)}`,
      details: { recordId: record.recordId, kind: record.kind },
    });
  }
  const data = record.data as unknown;
  if (!isTaskSpec(data)) {
    throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.RECORD_INVALID, {
      message: `task-spec record ${JSON.stringify(record.recordId)} does not carry a canonical A008 TaskSpec payload`,
      details: { recordId: record.recordId },
    });
  }
  await verifyTaskSpec(data);
  return data;
}
