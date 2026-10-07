/**
 * PolicyPack model + typed closed validation outcomes (Work Order C018;
 * spec/human-escalation-work-items.md C018 row; spec/security.md S1.0).
 *
 * A PolicyPack is a VERSIONED, TENANT-SCOPED, COMPOSABLE bundle of:
 *   - EES1.0 privacy-barrier controls (controls.ts — the pack vocabulary);
 *   - a retention schedule per artifact class (session transcript,
 *     observation stream, artifacts, annotations — retention.ts);
 *   - data-rights metadata per spec/security.md (composed with A034's
 *     DataRightsRecord — owner, source, permitted use, contract/license
 *     reference, retention, publication status);
 *   - jurisdiction/residency declarations as EXPLICIT metadata
 *     (architecture-lock rule 23: safety/privacy/licensing are explicit
 *     metadata, never ambient).
 *
 * Validation has THREE closed outcomes — valid / conflicting-controls-
 * with-reasons / infeasible-for-session-modes — and a pack that lands on
 * either failure outcome is REJECTED with reasons, NEVER silently
 * weakened (C007's mode guards stay feasible or the pack does not apply).
 */

import { deriveSessionModes } from '@arena/expert-session';
import type { ExpertSessionMode, SessionAction } from '@arena/expert-session';
import { toDataRightsRecord } from '@arena/security';
import type { DataRightsRecord } from '@arena/security';
import { ExpertSessionPolicyError } from './errors.js';
import {
  assertNoControlConflicts,
  validateAndComposeControls,
} from './controls.js';
import type { ComposedControls, PolicyControl, PolicyControlConflict } from './controls.js';
import {
  deepFreeze,
  expectPolicyId,
  expectPolicyTimestamp,
  expectRefList,
  expectTenantId,
} from './shared.js';
import type { RetentionSchedule } from './retention.js';

/** Wire version of the policy pack shape. */
export const POLICY_PACK_VERSION = 1 as const;

/** The closed validation outcome vocabulary (typed, never boolean). */
export const PACK_VALIDATION_OUTCOMES = Object.freeze([
  'valid',
  'conflicting-controls',
  'infeasible-for-session-modes',
] as const);
export type PackValidationOutcome = (typeof PACK_VALIDATION_OUTCOMES)[number];

/** The closed infeasibility-reason vocabulary. */
export const PACK_INFEASIBILITY_REASONS = Object.freeze([
  'mode-requires-action-not-allowlisted',
  'observation-floor-violated',
] as const);
export type PackInfeasibilityReason = (typeof PACK_INFEASIBILITY_REASONS)[number];

/** One machine-readable infeasibility reason (never a bare message). */
export interface PackInfeasibility {
  readonly code: PackInfeasibilityReason;
  readonly sessionMode: ExpertSessionMode;
  readonly action: SessionAction;
  readonly message: string;
}

/** The machine-readable pack validation verdict. */
export interface PolicyPackValidation {
  readonly outcome: PackValidationOutcome;
  readonly packRef: { readonly packId: string; readonly version: number };
  readonly conflictingControls?: readonly PolicyControlConflict[];
  readonly infeasibleModes?: readonly PackInfeasibility[];
}

/** The versioned, tenant-scoped, composable enterprise policy pack. */
export interface PolicyPack {
  readonly packVersion: typeof POLICY_PACK_VERSION;
  readonly packId: string;
  /** Monotonically increasing per (tenant, packId). */
  readonly version: number;
  readonly tenantId: string;
  readonly displayName: string;
  readonly description: string | null;
  /** EES1.0 privacy-barrier control bundle (>= 1 control; monotone). */
  readonly controls: readonly PolicyControl[];
  /** Retention schedule per artifact class (all four classes required). */
  readonly retention: RetentionSchedule;
  /** security.md data-rights metadata (composed with A034's record). */
  readonly dataRights: DataRightsRecord;
  /** Jurisdiction declarations (explicit metadata — lock rule 23). */
  readonly jurisdictions: readonly string[];
  /** Data residency declarations (explicit metadata — lock rule 23). */
  readonly residencyRegions: readonly string[];
  readonly createdAt: string;
  /** The pack this version supersedes (same packId, version - 1), if any. */
  readonly supersedes: { readonly packId: string; readonly version: number } | null;
}

// ---------------------------------------------------------------------------
// Mode feasibility (the C007 mode guards stay feasible or the pack fails)
// ---------------------------------------------------------------------------

/**
 * Session actions each EES1.0 mode REQUIRES to be feasible (mirrors C006's
 * SESSION_MODE_CAPABILITIES capability booleans; Teach additionally
 * requires observable capture which is mandatory in that mode).
 */
export const MODE_REQUIRED_ACTIONS: Readonly<Record<ExpertSessionMode, readonly SessionAction[]>> = Object.freeze({
  observe: Object.freeze(['observe-state'] as const),
  correct: Object.freeze(['observe-state', 'annotate', 'edit-artifact', 'submit-result'] as const),
  unblock: Object.freeze(['observe-state', 'annotate', 'supply-information', 'submit-result'] as const),
  takeover: Object.freeze([
    'observe-state',
    'annotate',
    'edit-artifact',
    'invoke-tool',
    'supply-information',
    'submit-result',
  ] as const),
  teach: Object.freeze([
    'observe-state',
    'annotate',
    'edit-artifact',
    'invoke-tool',
    'supply-information',
    'submit-result',
    'capture-checkpoint',
  ] as const),
  review: Object.freeze(['observe-state', 'annotate', 'submit-result'] as const),
});

/**
 * Check an ALLOWLIST (null = unconstrained) for feasibility against the
 * escalation modes the REQUEST permits. Derives the session modes via
 * C006's deriveSessionModes (Observe is always in the allowance) and
 * verifies every required session action survives the allowlist.
 * Returns typed reasons, never a silent weakening.
 */
export function checkAllowlistFeasibility(
  actionAllowlist: readonly string[] | null,
  escalationModes: readonly string[],
): { feasible: true } | { feasible: false; infeasibleModes: readonly PackInfeasibility[] } {
  const sessionModes = deriveSessionModes(escalationModes);
  if (actionAllowlist === null) {
    return { feasible: true };
  }
  const allowlist = actionAllowlist;
  const infeasible: PackInfeasibility[] = [];
  for (const sessionMode of sessionModes) {
    for (const action of MODE_REQUIRED_ACTIONS[sessionMode]) {
      if (!allowlist.includes(action)) {
        const code: PackInfeasibilityReason =
          action === 'observe-state' ? 'observation-floor-violated' : 'mode-requires-action-not-allowlisted';
        infeasible.push(
          deepFreeze({
            code,
            sessionMode,
            action,
            message: `session mode '${sessionMode}' requires action '${action}' which the allowlist does not admit (${JSON.stringify([...allowlist])})`,
          }),
        );
      }
    }
  }
  if (infeasible.length > 0) return { feasible: false, infeasibleModes: Object.freeze(infeasible) };
  return { feasible: true };
}

/**
 * Check a composed control set for feasibility (the pack's own allowlist
 * intersection) — delegates to checkAllowlistFeasibility.
 */
export function checkModeFeasibility(
  composed: ComposedControls,
  escalationModes: readonly string[],
): { feasible: true } | { feasible: false; infeasibleModes: readonly PackInfeasibility[] } {
  return checkAllowlistFeasibility(composed.actionAllowlist, escalationModes);
}

// ---------------------------------------------------------------------------
// Pack construction + validation
// ---------------------------------------------------------------------------

export interface CreatePolicyPackInput {
  readonly packId: string;
  readonly version: number;
  readonly tenantId: string;
  readonly displayName: string;
  readonly description?: string | null;
  readonly controls: readonly unknown[];
  readonly retention: RetentionSchedule;
  readonly dataRights: DataRightsRecord;
  readonly jurisdictions?: readonly string[];
  readonly residencyRegions?: readonly string[];
  readonly now: number | string | Date;
  readonly supersedes?: { readonly packId: string; readonly version: number } | null;
}

/**
 * Build a typed PolicyPack. Structural control conflicts are thrown as
 * the typed CONFLICTING_CONTROLS failure (use validatePolicyPack for the
 * non-throwing closed-outcome verdict).
 */
export function createPolicyPack(input: CreatePolicyPackInput): PolicyPack {
  const composed = validateAndComposeControls(input.controls);
  if ('conflicts' in composed) {
    assertNoControlConflicts(composed.conflicts);
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_CONTROL', {
      message: 'unreachable: assertNoControlConflicts throws',
    });
  }
  if (composed.controls.length === 0) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_CONTROL', {
      message: 'a policy pack must carry at least one control',
    });
  }
  const packId = expectPolicyId(input.packId, 'PolicyPack.packId');
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
      message: 'PolicyPack.version must be an integer >= 1',
      details: { received: String(input.version) },
    });
  }
  const tenantId = expectTenantId(input.tenantId, 'PolicyPack.tenantId');
  for (const control of composed.controls) {
    if (control.tenantId !== tenantId) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_CROSS_TENANT_POLICY', {
        message: `control of tenant '${control.tenantId}' cannot be bundled into pack of tenant '${tenantId}' (pack reads and controls are tenant-scoped)`,
        details: { packTenant: tenantId, controlTenant: control.tenantId, controlKind: control.kind },
      });
    }
  }
  if (typeof input.displayName !== 'string' || input.displayName.length === 0 || input.displayName.length > 256) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
      message: 'PolicyPack.displayName must be 1..256 characters',
    });
  }
  if (input.retention.scheduleVersion !== 1) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_SCHEDULE', {
      message: `unsupported retention scheduleVersion: ${String(input.retention.scheduleVersion)}`,
    });
  }
  const dataRights = toDataRightsRecord(input.dataRights);
  if (dataRights.owner !== tenantId) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_CROSS_TENANT_POLICY', {
      message: `data-rights owner '${String(dataRights.owner)}' does not match the pack tenant '${tenantId}' (pack data rights are tenant-scoped)`,
      details: { packTenant: tenantId, rightsOwner: String(dataRights.owner) },
    });
  }
  const createdAt = expectPolicyTimestamp(
    typeof input.now === 'number' || input.now instanceof Date
      ? new Date(input.now instanceof Date ? input.now.getTime() : input.now).toISOString()
      : input.now,
    'PolicyPack.createdAt',
  );
  const jurisdictions = expectRefList(input.jurisdictions ?? [], 'PolicyPack.jurisdictions');
  const residencyRegions = expectRefList(input.residencyRegions ?? [], 'PolicyPack.residencyRegions');
  const description =
    input.description === undefined || input.description === null ? null : String(input.description);

  return deepFreeze({
    packVersion: POLICY_PACK_VERSION,
    packId,
    version: input.version,
    tenantId,
    displayName: input.displayName,
    description,
    controls: composed.controls,
    retention: input.retention,
    dataRights,
    jurisdictions,
    residencyRegions,
    createdAt,
    supersedes:
      input.supersedes === undefined || input.supersedes === null
        ? null
        : deepFreeze({ packId: input.supersedes.packId, version: input.supersedes.version }),
  });
}

/**
 * The closed-outcome validation verdict. `context.escalationModes`
 * (the request's permitted intervention modes) enables the
 * infeasibility check; without it only structural conflicts are checked.
 */
export function validatePolicyPack(
  pack: PolicyPack,
  context: { escalationModes?: readonly string[] } = {},
): PolicyPackValidation {
  const composition = validateAndComposeControls(pack.controls);
  const packRef = deepFreeze({ packId: pack.packId, version: pack.version });
  if ('conflicts' in composition) {
    return deepFreeze({ outcome: 'conflicting-controls', packRef, conflictingControls: composition.conflicts });
  }
  if (context.escalationModes !== undefined) {
    const feasibility = checkModeFeasibility(composition.composed, context.escalationModes);
    if (!feasibility.feasible) {
      return deepFreeze({ outcome: 'infeasible-for-session-modes', packRef, infeasibleModes: feasibility.infeasibleModes });
    }
  }
  return deepFreeze({ outcome: 'valid', packRef });
}

/** Compose a validated pack's controls (throws on conflict). */
export function composePackControls(pack: PolicyPack): ComposedControls {
  const composition = validateAndComposeControls(pack.controls);
  if ('conflicts' in composition) {
    assertNoControlConflicts(composition.conflicts);
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_CONTROL', {
      message: 'unreachable: assertNoControlConflicts throws',
    });
  }
  return composition.composed;
}
