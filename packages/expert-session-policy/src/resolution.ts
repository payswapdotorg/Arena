/**
 * Effective session policy resolution (Work Order C018) — the PURE merge
 * of an EscalationRequest's declared policy fields with the applicable
 * tenant PolicyPack into the concrete effective policy handed to the
 * C006 session builder and the C007 mode guards.
 *
 * THE RESOLUTION-OWNS / ENFORCEMENT-BORROWS BOUNDARY: this package OWNS
 * resolution (which controls, retention and data rights govern a session)
 * and the audit of every decision; C006 owns barrier enforcement inside
 * the capsule and C007 owns mode-guard enforcement. The resolved
 * PrivacyBarrier is built with C006's own composePrivacyBarrier (the
 * merged controls are fail-closed by construction); the mode allowance
 * is derived with C006's deriveSessionModes and checked for feasibility
 * against the request's permitted intervention modes.
 *
 * THE MONOTONE MERGE LAW: the REQUEST's declared policy fields are the
 * baseline; pack controls may only STRENGTHEN (union redactions and
 * exclusions, OR masking, MIN credential expiry, INTERSECT allowlists).
 * A pack can never remove a request-declared restriction — the
 * "re-admit excluded secrets via a weaker pack version" adversarial case
 * is structurally impossible.
 *
 * THE RETENTION BOUND LAW: when the request declares a purge disposition
 * (retentionPolicy.disposition 'purge'), the pack's per-class retention
 * windows must fit WITHIN the request's retentionMs — a pack that would
 * outlive the request's declared retention window is a typed
 * RETENTION_CONFLICT rejection (the retention-bypass adversarial case),
 * never a silent extension.
 *
 * When NO pack applies, retention/data-rights are null: the request's
 * own C001 retentionPolicy and the security layer's rights model govern
 * (this package never invents policy the request did not declare).
 */

import type { EscalationRecord, LearningPermissions } from '@arena/escalation';
import { composePrivacyBarrier, deriveSessionModes } from '@arena/expert-session';
import type { ExpertSessionMode, PrivacyBarrier } from '@arena/expert-session';
import { toNeutralText, toTenantId } from '@arena/security';
import type { DataRightsRecord } from '@arena/security';
import { ExpertSessionPolicyError } from './errors.js';
import { checkAllowlistFeasibility, checkModeFeasibility, composePackControls } from './pack.js';
import type { PolicyPack } from './pack.js';
import type { ComposedControls } from './controls.js';
import { retentionWindowMs } from './retention.js';
import type { RetentionSchedule } from './retention.js';
import { deepFreeze, expectPolicyId, expectTenantId } from './shared.js';
import { assertCrossTenantPackAuthorized } from './tenancy.js';
import type { CrossTenantPackAuthorization } from './tenancy.js';

/** Wire version of the effective policy shape. */
export const EFFECTIVE_SESSION_POLICY_VERSION = 1 as const;

/**
 * C001 permitted actions mapped onto expert-session actions (mirrors
 * services/expert-session's fabric mapping — DEVIATION NOTE: the mapping
 * constant is owned by C006's reference fabric and not exported from the
 * domain package, so it is mirrored here; see the PR's architecture
 * questions).
 */
export const PERMITTED_ACTION_TO_SESSION_ACTION: Readonly<Record<string, string>> = Object.freeze({
  'read-context': 'observe-state',
  'run-approved-tools': 'invoke-tool',
  'propose-patch': 'edit-artifact',
  'annotate-evidence': 'annotate',
  'ask-clarification': 'supply-information',
  'signal-tool-gap': 'signal-tool-gap',
});

/** Session actions inherent to the EES1.0 session flow (not host-granted). */
export const INHERENT_SESSION_ACTIONS = Object.freeze(['submit-result', 'capture-checkpoint'] as const);

/** Default PII-shaped fields redacted unless privacyPolicy.pii === 'allow'. */
export const DEFAULT_PII_FIELDS = Object.freeze(['customerEmail', 'customerPhone', 'accountNumber'] as const);

/**
 * The concrete effective policy governing one escalation's expert
 * session: the EES1.0 privacy barrier (C006 enforcement input), the
 * allowed session modes (C006/C007 enforcement input), the pack's
 * retention schedule (the retention engine's input), data rights,
 * jurisdictions and the request's learning permissions.
 */
export interface EffectiveSessionPolicy {
  readonly policyVersion: typeof EFFECTIVE_SESSION_POLICY_VERSION;
  readonly resolutionId: string;
  readonly requestId: string;
  readonly tenantId: string;
  /** The pack the resolution applied (null = request-fields-only resolution). */
  readonly packRef: { readonly packId: string; readonly version: number } | null;
  /** Cross-tenant authorization consumed (present iff pack owner ≠ tenant). */
  readonly crossTenantAuthorizationId: string | null;
  readonly barrier: PrivacyBarrier;
  readonly permittedEscalationModes: readonly string[];
  readonly allowedSessionModes: readonly ExpertSessionMode[];
  /** The pack retention schedule (null when no pack applied — C001's request retentionPolicy governs). */
  readonly retention: RetentionSchedule | null;
  /** The pack data-rights record (null when no pack applied). */
  readonly dataRights: DataRightsRecord | null;
  readonly jurisdictions: readonly string[];
  readonly residencyRegions: readonly string[];
  readonly learningPermissions: LearningPermissions;
  readonly resolvedAt: string;
}

export interface ResolveEffectivePolicyInput {
  readonly resolutionId: string;
  /** The escalation whose declared policy fields form the baseline. */
  readonly escalation: EscalationRecord;
  /** The applicable pack (null resolves from the request fields alone). */
  readonly pack: PolicyPack | null;
  /** Explicit typed authorization when the pack belongs to another tenant. */
  readonly crossTenantAuthorization?: CrossTenantPackAuthorization | null;
  readonly now: number | string | Date;
}

function toIso(value: number | string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : typeof value === 'number'
      ? new Date(value).toISOString()
      : value;
}

function mergedAllowlist(baseline: readonly string[], composed: ComposedControls | null): readonly string[] {
  if (composed === null || composed.actionAllowlist === null) {
    return Object.freeze([...baseline]);
  }
  return Object.freeze(baseline.filter((action) => composed.actionAllowlist?.includes(action) === true));
}

/**
 * Resolve the effective session policy. Fail-closed typed failures:
 *   - CROSS_TENANT_POLICY  — foreign pack without a valid authorization;
 *   - INFEASIBLE_MODES     — the pack or the merged allowlist cannot
 *                            carry the request's permitted intervention
 *                            modes (never silently weakened);
 *   - RETENTION_CONFLICT   — pack retention outlives the request's
 *                            declared purge window (retention bypass).
 */
export function resolveEffectiveSessionPolicy(input: ResolveEffectivePolicyInput): EffectiveSessionPolicy {
  const request = input.escalation.request;
  const tenantId = expectTenantId(request.tenantId, 'EffectiveSessionPolicy.tenantId');
  const resolutionId = expectPolicyId(input.resolutionId, 'EffectiveSessionPolicy.resolutionId');
  const resolvedAt = toIso(input.now);

  let composed: ComposedControls | null = null;
  let packRef: { packId: string; version: number } | null = null;
  let crossTenantAuthorizationId: string | null = null;

  if (input.pack !== null) {
    const pack = input.pack;
    if (pack.tenantId !== tenantId) {
      assertCrossTenantPackAuthorized(input.crossTenantAuthorization ?? null, pack, tenantId, resolvedAt);
      crossTenantAuthorizationId = input.crossTenantAuthorization?.authorizationId ?? null;
    }
    composed = composePackControls(pack);
    const feasibility = checkModeFeasibility(composed, request.escalationModes);
    if (!feasibility.feasible) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INFEASIBLE_MODES', {
        message: `pack '${pack.packId}' v${String(pack.version)} is infeasible for the request's permitted modes (${request.escalationModes.join(', ')}): ${feasibility.infeasibleModes
          .map((entry) => entry.message)
          .join('; ')}`,
        details: {
          packRef: { packId: pack.packId, version: pack.version },
          infeasibleModes: feasibility.infeasibleModes.map((entry) => ({
            code: entry.code,
            sessionMode: entry.sessionMode,
            action: entry.action,
          })),
        },
      });
    }

    // THE RETENTION BOUND LAW (retention bypass via conflicting packs).
    if (request.retentionPolicy.disposition === 'purge') {
      for (const entry of pack.retention.entries) {
        if (retentionWindowMs(entry) > request.retentionPolicy.retentionMs) {
          throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_RETENTION_CONFLICT', {
            message: `pack '${pack.packId}' v${String(pack.version)} retains '${entry.artifactClass}' for ${String(entry.retentionDays)} days, exceeding the request's declared purge window of ${String(request.retentionPolicy.retentionMs)} ms (a pack can never extend retention past the request's bound)`,
            details: {
              packRef: { packId: pack.packId, version: pack.version },
              artifactClass: entry.artifactClass,
              packWindowMs: retentionWindowMs(entry),
              requestWindowMs: request.retentionPolicy.retentionMs,
            },
          });
        }
      }
    }
    packRef = deepFreeze({ packId: pack.packId, version: pack.version });
  }

  // THE MONOTONE MERGE (pack controls only strengthen the baseline).
  const redactedFields = Object.freeze(
    [...new Set([
      ...(request.privacyPolicy.pii === 'allow' ? [] : DEFAULT_PII_FIELDS),
      ...(composed?.redactedFields ?? []),
    ])],
  );
  const redactedDocuments = Object.freeze([...(composed?.redactedDocuments ?? [])]);
  const excludedTools = Object.freeze([...(composed?.excludedTools ?? [])]);
  const readOnlyResources = Object.freeze([...(composed?.readOnlyResources ?? [])]);
  const identityMasking = (request.privacyPolicy.pii !== 'allow') || (composed?.identityMasking ?? false);
  let credentialsExpiresAt: string = request.deadline;
  if (composed?.credentialsExpiresAt !== null && composed?.credentialsExpiresAt !== undefined) {
    if (Date.parse(composed.credentialsExpiresAt) < Date.parse(credentialsExpiresAt)) {
      credentialsExpiresAt = composed.credentialsExpiresAt;
    }
  }

  // Baseline allowlist from the request's permitted actions + inherent
  // session actions + the observation floor; the pack INTERSECTS it.
  const baseline = [
    ...request.permittedActions
      .map((action) => PERMITTED_ACTION_TO_SESSION_ACTION[action])
      .filter((action) => action !== undefined),
    ...INHERENT_SESSION_ACTIONS,
    'observe-state',
  ];
  const actionAllowlist = mergedAllowlist(baseline, composed);

  // Post-merge feasibility: when the pack imposes an allowlist control,
  // the MERGED (request ∩ pack) allowlist is the effective authority and
  // must carry every session mode the request's escalation modes derive
  // — fail closed with typed reasons instead of silently weakening.
  // (A request whose OWN baseline starves its modes is C006's action-time
  // enforcement domain — resolution never invents allowlist entries.)
  if (composed !== null && composed.actionAllowlist !== null) {
    const feasibility = checkAllowlistFeasibility(actionAllowlist, request.escalationModes);
    if (!feasibility.feasible) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INFEASIBLE_MODES', {
        message: `the merged request+pack allowlist cannot carry the request's permitted modes (${request.escalationModes.join(', ')}): ${feasibility.infeasibleModes
          .map((entry) => entry.message)
          .join('; ')}`,
        details: {
          packRef,
          mergedAllowlist: [...actionAllowlist],
          infeasibleModes: feasibility.infeasibleModes.map((entry) => ({
            code: entry.code,
            sessionMode: entry.sessionMode,
            action: entry.action,
          })),
        },
      });
    }
  }

  const barrier = composePrivacyBarrier({
    tenantId,
    redactedFields,
    redactedDocuments,
    excludedTools,
    identityMasking,
    timeLimitedCredentials: true,
    credentialsExpiresAt,
    readOnlyResources,
    actionAllowlist,
    restrictions: { download: true, clipboard: true, screenshot: true },
  });

  return deepFreeze({
    policyVersion: EFFECTIVE_SESSION_POLICY_VERSION,
    resolutionId,
    requestId: request.requestId,
    tenantId,
    packRef,
    crossTenantAuthorizationId,
    barrier,
    permittedEscalationModes: Object.freeze([...request.escalationModes]),
    allowedSessionModes: deriveSessionModes(request.escalationModes),
    retention: input.pack === null ? null : input.pack.retention,
    dataRights: input.pack === null ? null : input.pack.dataRights,
    jurisdictions: Object.freeze([...(input.pack?.jurisdictions ?? [])]),
    residencyRegions: Object.freeze([...(input.pack?.residencyRegions ?? [])]),
    learningPermissions: request.learningPermissions,
    resolvedAt,
  });
}

/** Minimal fallback rights record builder for request-only resolutions
 * (the escalation's own declared fields; NOT invented policy — used only
 * when a caller must present a rights-shaped record). */
export function requestBaselineRights(tenantId: string, recordedAt: string): DataRightsRecord {
  return deepFreeze({
    recordVersion: 1,
    owner: toTenantId(tenantId, 'requestBaselineRights.owner'),
    source: toNeutralText('escalation-request', 'requestBaselineRights.source'),
    permittedUse: 'tenant-internal',
    contractRef: toNeutralText('request-declared', 'requestBaselineRights.contractRef'),
    retention: deepFreeze({ recordVersion: 1, mode: 'none', retentionDays: null, expiresAt: null }),
    publicationStatus: 'private',
    recordedAt,
  });
}
