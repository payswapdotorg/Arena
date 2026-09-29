/**
 * Data-rights metadata (Work Order A008; spec/task-spec.md TS1.0
 * "data-rights metadata"; requirement R24 posture; architecture-lock
 * rules 11 and 23).
 *
 * Data rights are MANDATORY on every TaskSpec — a task cannot carry
 * undocumented data usage. The classification vocabulary is CLOSED:
 *
 *   - `private-tenant` — the default posture (R24): task content and
 *     derived data stay inside the owning tenant; cross-tenant reuse is
 *     FORBIDDEN under this classification (guard-enforced);
 *   - `tenant-shareable` — the owning tenant may explicitly share the task
 *     with named other tenants;
 *   - `arena-internal` — usable inside Arena's own capability-development
 *     pipelines (never published);
 *   - `public` — explicitly published (lock rule 12: public artifacts are
 *     explicitly published and versioned).
 *
 * Cross-tenant reuse is a tri-state the metadata makes EXPLICIT; the
 * private-tenant default forbids it, and no compilation path may turn it
 * on silently (the reference compiler always emits `crossTenantReuse:
 * false` — reuse is a later, explicit, tenant-side act).
 *
 * Safety/privacy/licensing are explicit metadata (lock rule 23): the
 * licensing statement and privacy notes are optional but, when present,
 * must be non-empty.
 */

import { TASK_SPEC_ERROR_CODES, TaskSpecError } from './errors.js';
import {
  expectFields,
  isTenantScope,
  toTenantScope,
} from './shared.js';

/** The CLOSED data-rights classification vocabulary (R24 posture). */
export const DATA_RIGHTS_CLASSIFICATIONS = Object.freeze([
  'private-tenant',
  'tenant-shareable',
  'arena-internal',
  'public',
] as const);

export type DataRightsClassification = (typeof DATA_RIGHTS_CLASSIFICATIONS)[number];

/** The default classification (R24: private-tenant by default). */
export const DEFAULT_DATA_RIGHTS_CLASSIFICATION: DataRightsClassification =
  'private-tenant';

export function isDataRightsClassification(
  value: unknown,
): value is DataRightsClassification {
  return (
    typeof value === 'string' &&
    (DATA_RIGHTS_CLASSIFICATIONS as readonly string[]).includes(value)
  );
}

/** Stable field list (tests + contracts mirror it). */
export const DATA_RIGHTS_FIELDS = Object.freeze([
  'classification',
  'tenantScope',
  'crossTenantReuse',
  'licensing',
  'privacyNotes',
] as const) as readonly string[];

/** Mandatory data-rights metadata on every TaskSpec. */
export interface DataRightsMetadata {
  readonly classification: DataRightsClassification;
  readonly tenantScope: string;
  readonly crossTenantReuse: boolean;
  readonly licensing: string | null;
  readonly privacyNotes: string | null;
}

export function isDataRightsMetadata(value: unknown): value is DataRightsMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isDataRightsClassification(candidate['classification']) &&
    isTenantScope(candidate['tenantScope']) &&
    typeof candidate['crossTenantReuse'] === 'boolean' &&
    (candidate['licensing'] === null ||
      (typeof candidate['licensing'] === 'string' && candidate['licensing'].length > 0)) &&
    (candidate['privacyNotes'] === null ||
      (typeof candidate['privacyNotes'] === 'string' &&
        candidate['privacyNotes'].length > 0))
  );
}

/**
 * Validate and freeze data-rights metadata. The cross-field rules:
 *   - `private-tenant` classification FORBIDS cross-tenant reuse;
 *   - the tenant scope is required (tenant-scoped data — lock rule 11).
 */
export function toDataRightsMetadata(value: {
  classification: string;
  tenantScope: string;
  crossTenantReuse: boolean;
  licensing?: string | null;
  privacyNotes?: string | null;
}): DataRightsMetadata {
  const record = expectFields(
    value,
    ['classification', 'tenantScope', 'crossTenantReuse'],
    ['licensing', 'privacyNotes'],
    TASK_SPEC_ERROR_CODES.INVALID_DATA_RIGHTS,
    'data-rights metadata',
  );
  const classification = record['classification'];
  if (!isDataRightsClassification(classification)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_DATA_RIGHTS, {
      message: `unknown data-rights classification: ${JSON.stringify(classification)} (known: ${DATA_RIGHTS_CLASSIFICATIONS.join(', ')}; the default posture is ${DEFAULT_DATA_RIGHTS_CLASSIFICATION})`,
      details: { known: [...DATA_RIGHTS_CLASSIFICATIONS] },
    });
  }
  const crossTenantReuse = record['crossTenantReuse'];
  if (typeof crossTenantReuse !== 'boolean') {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_DATA_RIGHTS, {
      message: 'crossTenantReuse must be an explicit boolean (never implied)',
    });
  }
  if (classification === 'private-tenant' && crossTenantReuse) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_DATA_RIGHTS, {
      message:
        'private-tenant data rights forbid cross-tenant reuse (R24 default posture — reuse requires an explicit, differently-classified act)',
      details: { classification, crossTenantReuse },
    });
  }
  const licensing = record['licensing'] ?? null;
  if (licensing !== null && (typeof licensing !== 'string' || licensing.length === 0)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_DATA_RIGHTS, {
      message: 'licensing, when present, must be a non-empty statement (lock rule 23: explicit metadata)',
    });
  }
  const privacyNotes = record['privacyNotes'] ?? null;
  if (
    privacyNotes !== null &&
    (typeof privacyNotes !== 'string' || privacyNotes.length === 0)
  ) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_DATA_RIGHTS, {
      message: 'privacyNotes, when present, must be a non-empty statement (lock rule 23: explicit metadata)',
    });
  }
  return Object.freeze({
    classification,
    tenantScope: toTenantScope(
      typeof record['tenantScope'] === 'string' ? record['tenantScope'] : '',
    ),
    crossTenantReuse,
    licensing,
    privacyNotes,
  });
}
