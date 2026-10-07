/**
 * Policy-pack controls (Work Order C018; spec/expert-environment-session.md
 * EES1.0 "Privacy barrier"). The pack vocabulary IS the EES1.0 control set
 * C006 enforces (packages/expert-session/src/barrier.ts PRIVACY_CONTROL_KINDS
 * — consumed read-only, never redefined).
 *
 * THE MONOTONE LAW: a pack control may only STRENGTHEN the barrier. Packs
 * compose by union of exclusions, intersection of allowlists, OR of
 * restrictions/masking and MIN of credential expiries. A payload that
 * attempts to WEAKEN a control (masking off, un-restricting an export
 * channel, re-admitting an excluded secret/tool) is structurally
 * impossible in the closed payload vocabulary — the only payloads are
 * restrictive ones. The request's declared policy fields remain the
 * baseline; pack controls merge on top and can never remove them.
 *
 * THE TENANT LAW: every control carries its tenant scope; a
 * tenant-boundary control whose payload tenant differs from the control
 * scope (or from the pack's tenant) is a TYPED CONFLICT, never a silent
 * boundary move.
 */

import type { PrivacyControlKind } from '@arena/expert-session';
import { PRIVACY_CONTROL_KINDS } from '@arena/expert-session';
import { ExpertSessionPolicyError } from './errors.js';
import { deepFreeze, expectPolicyTimestamp, expectRefList, expectTenantId } from './shared.js';

/** Wire version of the policy control shape. */
export const POLICY_CONTROL_VERSION = 1 as const;

/** The EES1.0 control kinds (C006's closed set, re-exported for pack authors). */
export const POLICY_CONTROL_KINDS = PRIVACY_CONTROL_KINDS;
export type PolicyControlKind = PrivacyControlKind;

export function isPolicyControlKind(value: unknown): value is PolicyControlKind {
  return typeof value === 'string' && (POLICY_CONTROL_KINDS as readonly string[]).includes(value);
}

/**
 * CLOSED payload vocabulary — every payload is restrictive. There is no
 * `admit`, `unrestrict` or `mask: false` payload: weakening is
 * unrepresentable (the adversarial "re-admit excluded secrets" case is
 * structurally impossible; runtime attempts to smuggle one are rejected
 * with the typed weakening-control conflict).
 */
export type PolicyControlPayload =
  | { readonly kind: 'field-redaction'; readonly fields: readonly string[] }
  | { readonly kind: 'document-redaction'; readonly documents: readonly string[] }
  | { readonly kind: 'tool-exclusion'; readonly tools: readonly string[] }
  | { readonly kind: 'tenant-boundary'; readonly tenantId: string }
  | { readonly kind: 'identity-masking'; readonly maskIdentity: true }
  | { readonly kind: 'time-limited-credentials'; readonly expiresAt: string }
  | { readonly kind: 'read-only-resources'; readonly resources: readonly string[] }
  | { readonly kind: 'action-allowlist'; readonly actions: readonly string[] }
  | { readonly kind: 'download-restriction'; readonly restricted: true }
  | { readonly kind: 'clipboard-restriction'; readonly restricted: true }
  | { readonly kind: 'screenshot-restriction'; readonly restricted: true };

/** One EES1.0 control bundled in a policy pack. */
export interface PolicyControl {
  readonly controlVersion: typeof POLICY_CONTROL_VERSION;
  readonly kind: PolicyControlKind;
  /** The control's tenant scope (must equal the pack's tenant). */
  readonly tenantId: string;
  readonly payload: PolicyControlPayload;
}

/** The closed conflict-reason vocabulary for control validation. */
export const POLICY_CONTROL_CONFLICT_REASONS = Object.freeze([
  'control-kind-mismatch',
  'tenant-boundary-mismatch',
  'weakening-control',
  'empty-control-payload',
  'invalid-control-payload',
  'unknown-control-kind',
] as const);
export type PolicyControlConflictReason = (typeof POLICY_CONTROL_CONFLICT_REASONS)[number];

/** One machine-readable conflict reason (never a bare message). */
export interface PolicyControlConflict {
  readonly code: PolicyControlConflictReason;
  readonly controlIndex: number | null;
  readonly controlKind: string | null;
  readonly message: string;
}

function conflict(
  code: PolicyControlConflictReason,
  message: string,
  controlIndex: number | null = null,
  controlKind: string | null = null,
): PolicyControlConflict {
  return deepFreeze({ code, controlIndex, controlKind, message });
}

/**
 * Validate one control structurally. Returns a typed conflict instead of
 * throwing so pack validation can aggregate ALL reasons (the work order's
 * "conflicting-controls-with-reasons" verdict).
 */
export function validatePolicyControl(
  control: unknown,
  index: number,
): { control: PolicyControl } | { conflict: PolicyControlConflict } {
  if (typeof control !== 'object' || control === null) {
    return { conflict: conflict('invalid-control-payload', `control #${String(index)}: must be an object`, index) };
  }
  const candidate = control as Record<string, unknown>;
  if (candidate['controlVersion'] !== POLICY_CONTROL_VERSION) {
    return {
      conflict: conflict(
        'invalid-control-payload',
        `control #${String(index)}: unsupported controlVersion: ${String(candidate['controlVersion'])}`,
        index,
      ),
    };
  }
  const kind = candidate['kind'];
  if (!isPolicyControlKind(kind)) {
    return {
      conflict: conflict(
        'unknown-control-kind',
        `control #${String(index)}: unknown control kind: ${JSON.stringify(kind)}`,
        index,
        typeof kind === 'string' ? kind : null,
      ),
    };
  }
  let tenantId: string;
  try {
    tenantId = expectTenantId(candidate['tenantId'], `control #${String(index)}.tenantId`);
  } catch (error) {
    return {
      conflict: conflict(
        'invalid-control-payload',
        `control #${String(index)}.tenantId: ${(error as Error).message}`,
        index,
        kind,
      ),
    };
  }
  const payload = candidate['payload'];
  if (typeof payload !== 'object' || payload === null) {
    return {
      conflict: conflict('invalid-control-payload', `control #${String(index)}: payload must be an object`, index, kind),
    };
  }
  const payloadRecord = payload as Record<string, unknown>;
  if (payloadRecord['kind'] !== kind) {
    return {
      conflict: conflict(
        'control-kind-mismatch',
        `control #${String(index)}: payload.kind '${String(payloadRecord['kind'])}' does not match control.kind '${kind}'`,
        index,
        kind,
      ),
    };
  }

  switch (kind) {
    case 'field-redaction':
    case 'document-redaction':
    case 'tool-exclusion':
    case 'read-only-resources': {
      const field = kind === 'field-redaction' ? 'fields' : kind === 'document-redaction' ? 'documents' : kind === 'tool-exclusion' ? 'tools' : 'resources';
      const values = payloadRecord[field];
      if (!Array.isArray(values) || values.length === 0) {
        return {
          conflict: conflict(
            'empty-control-payload',
            `control #${String(index)} (${kind}): ${field} must be a NON-empty array (no-op redaction/exclusion controls are fail-closed)`,
            index,
            kind,
          ),
        };
      }
      try {
        const refs = expectRefList(values, `control #${String(index)}.payload.${field}`);
        return {
          control: deepFreeze({
            controlVersion: POLICY_CONTROL_VERSION,
            kind,
            tenantId,
            payload: deepFreeze({ kind, [field]: refs }) as PolicyControlPayload,
          }),
        };
      } catch (error) {
        return { conflict: conflict('invalid-control-payload', (error as Error).message, index, kind) };
      }
    }
    case 'tenant-boundary': {
      const boundaryTenant = payloadRecord['tenantId'];
      if (typeof boundaryTenant !== 'string' || boundaryTenant.length === 0) {
        return {
          conflict: conflict('invalid-control-payload', `control #${String(index)}: payload.tenantId is required`, index, kind),
        };
      }
      if (boundaryTenant !== tenantId) {
        return {
          conflict: conflict(
            'tenant-boundary-mismatch',
            `control #${String(index)}: tenant-boundary payload tenant '${boundaryTenant}' does not match the control scope '${tenantId}' (the tenant boundary never silently moves)`,
            index,
            kind,
          ),
        };
      }
      return {
        control: deepFreeze({
          controlVersion: POLICY_CONTROL_VERSION,
          kind,
          tenantId,
          payload: deepFreeze({ kind, tenantId: boundaryTenant }),
        }),
      };
    }
    case 'identity-masking': {
      if (payloadRecord['maskIdentity'] !== true) {
        return {
          conflict: conflict(
            'weakening-control',
            `control #${String(index)} (identity-masking): maskIdentity must be true — pack controls only STRENGTHEN the barrier`,
            index,
            kind,
          ),
        };
      }
      return {
        control: deepFreeze({
          controlVersion: POLICY_CONTROL_VERSION,
          kind,
          tenantId,
          payload: deepFreeze({ kind, maskIdentity: true }),
        }),
      };
    }
    case 'time-limited-credentials': {
      try {
        const expiresAt = expectPolicyTimestamp(payloadRecord['expiresAt'], `control #${String(index)}.payload.expiresAt`);
        return {
          control: deepFreeze({
            controlVersion: POLICY_CONTROL_VERSION,
            kind,
            tenantId,
            payload: deepFreeze({ kind, expiresAt }),
          }),
        };
      } catch (error) {
        return { conflict: conflict('invalid-control-payload', (error as Error).message, index, kind) };
      }
    }
    case 'action-allowlist': {
      const actions = payloadRecord['actions'];
      if (!Array.isArray(actions) || actions.length === 0) {
        return {
          conflict: conflict(
            'empty-control-payload',
            `control #${String(index)} (action-allowlist): actions must be a NON-empty array (an empty allowlist admits nothing — C006 fails closed)`,
            index,
            kind,
          ),
        };
      }
      try {
        const refs = expectRefList(actions, `control #${String(index)}.payload.actions`);
        return {
          control: deepFreeze({
            controlVersion: POLICY_CONTROL_VERSION,
            kind,
            tenantId,
            payload: deepFreeze({ kind, actions: refs }),
          }),
        };
      } catch (error) {
        return { conflict: conflict('invalid-control-payload', (error as Error).message, index, kind) };
      }
    }
    case 'download-restriction':
    case 'clipboard-restriction':
    case 'screenshot-restriction': {
      if (payloadRecord['restricted'] !== true) {
        return {
          conflict: conflict(
            'weakening-control',
            `control #${String(index)} (${kind}): restricted must be true — a pack can never un-restrict an export channel (the request remains the only authority that could, and C006 defaults restricted)`,
            index,
            kind,
          ),
        };
      }
      return {
        control: deepFreeze({
          controlVersion: POLICY_CONTROL_VERSION,
          kind,
          tenantId,
          payload: deepFreeze({ kind, restricted: true }),
        }),
      };
    }
    default: {
      // Exhaustiveness guard: kinds outside the closed set are unreachable.
      return {
        conflict: conflict('unknown-control-kind', `control #${String(index)}: unknown control kind: ${String(kind)}`, index, null),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Composition (the monotone merge)
// ---------------------------------------------------------------------------

/** The composed pack controls (all OR/union/intersection semantics). */
export interface ComposedControls {
  readonly redactedFields: readonly string[];
  readonly redactedDocuments: readonly string[];
  readonly excludedTools: readonly string[];
  readonly tenantId: string;
  readonly identityMasking: boolean;
  /** Earliest credential expiry across time-limited-credentials controls. */
  readonly credentialsExpiresAt: string | null;
  readonly readOnlyResources: readonly string[];
  /**
   * Intersection of all action-allowlist controls; null when the pack
   * declares none (the request's permitted actions then govern alone).
   */
  readonly actionAllowlist: readonly string[] | null;
  readonly restrictions: {
    readonly download: boolean;
    readonly clipboard: boolean;
    readonly screenshot: boolean;
  };
}

function unionAll(values: readonly (readonly string[])[]): readonly string[] {
  return Object.freeze([...new Set(values.flat())]);
}

/**
 * Compose validated controls into the monotone merge. Cross-control
 * tenant disagreement (two controls with different tenant scopes) is a
 * TYPED CONFLICT, never a silent boundary move.
 */
export function composePolicyControls(
  controls: readonly PolicyControl[],
): { composed: ComposedControls } | { conflicts: readonly PolicyControlConflict[] } {
  const conflicts: PolicyControlConflict[] = [];
  if (controls.length === 0) {
    conflicts.push(
      conflict('empty-control-payload', 'a policy pack must carry at least one control (an ungoverned session is never allowed)'),
    );
  }
  const scopes = new Set(controls.map((control) => control.tenantId));
  if (scopes.size > 1) {
    conflicts.push(
      conflict(
        'tenant-boundary-mismatch',
        `controls span multiple tenant scopes (${[...scopes].join(', ')}): a pack composition is single-tenant`,
      ),
    );
  }
  if (conflicts.length > 0) return { conflicts: Object.freeze(conflicts) };

  const tenantId = controls[0]?.tenantId ?? '';
  const allowlists: (readonly string[])[] = [];
  let credentialsExpiresAt: string | null = null;
  const composed: ComposedControls = deepFreeze({
    redactedFields: unionAll(
      controls
        .filter((control) => control.kind === 'field-redaction')
        .map((control) => (control.payload as { kind: 'field-redaction'; fields: readonly string[] }).fields),
    ),
    redactedDocuments: unionAll(
      controls
        .filter((control) => control.kind === 'document-redaction')
        .map((control) => (control.payload as { kind: 'document-redaction'; documents: readonly string[] }).documents),
    ),
    excludedTools: unionAll(
      controls
        .filter((control) => control.kind === 'tool-exclusion')
        .map((control) => (control.payload as { kind: 'tool-exclusion'; tools: readonly string[] }).tools),
    ),
    tenantId,
    identityMasking: controls.some((control) => control.kind === 'identity-masking'),
    credentialsExpiresAt,
    readOnlyResources: unionAll(
      controls
        .filter((control) => control.kind === 'read-only-resources')
        .map((control) => (control.payload as { kind: 'read-only-resources'; resources: readonly string[] }).resources),
    ),
    actionAllowlist: null,
    restrictions: Object.freeze({
      download: controls.some((control) => control.kind === 'download-restriction'),
      clipboard: controls.some((control) => control.kind === 'clipboard-restriction'),
      screenshot: controls.some((control) => control.kind === 'screenshot-restriction'),
    }),
  });

  for (const control of controls) {
    if (control.kind === 'time-limited-credentials') {
      const expiresAt = (control.payload as { kind: 'time-limited-credentials'; expiresAt: string }).expiresAt;
      credentialsExpiresAt =
        credentialsExpiresAt === null || Date.parse(expiresAt) < Date.parse(credentialsExpiresAt) ? expiresAt : credentialsExpiresAt;
    }
    if (control.kind === 'action-allowlist') {
      allowlists.push((control.payload as { kind: 'action-allowlist'; actions: readonly string[] }).actions);
    }
  }

  const effectiveAllowlist =
    allowlists.length === 0
      ? null
      : Object.freeze(
          allowlists.reduce((intersection, actions) => intersection.filter((action) => actions.includes(action))),
        );

  return {
    composed: deepFreeze({
      ...composed,
      credentialsExpiresAt,
      actionAllowlist: effectiveAllowlist,
    }),
  };
}

/** Parse + validate + compose in one step (typed verdict, no throws). */
export function validateAndComposeControls(
  values: readonly unknown[],
): { composed: ComposedControls; controls: readonly PolicyControl[] } | { conflicts: readonly PolicyControlConflict[] } {
  const controls: PolicyControl[] = [];
  const conflicts: PolicyControlConflict[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    const result = validatePolicyControl(value, index);
    if ('conflict' in result) {
      conflicts.push(result.conflict);
    } else {
      controls.push(result.control);
    }
  }
  if (conflicts.length > 0) return { conflicts: Object.freeze(conflicts) };
  const composition = composePolicyControls(controls);
  if ('conflicts' in composition) return { conflicts: composition.conflicts };
  return { composed: composition.composed, controls: Object.freeze(controls) };
}

/** Guard form: throws the typed CONFLICTING_CONTROLS failure. */
export function assertNoControlConflicts(conflicts: readonly PolicyControlConflict[]): void {
  if (conflicts.length > 0) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_CONFLICTING_CONTROLS', {
      message: `policy pack controls conflict (${String(conflicts.length)} reasons): ${conflicts
        .map((entry) => entry.message)
        .join('; ')}`,
      details: { conflicts: conflicts.map((entry) => ({ code: entry.code, message: entry.message })) },
    });
  }
}

