/**
 * Body detail view-model composition (Work Order B010; issue #82;
 * apps/web/src/bodies). SERVER-ONLY.
 *
 * Resolves the `/bodies/:id` experience: ONE canonical read by record id
 * through the read port, projected through @arena/body-ui into the full
 * studio detail (identity card with EXPLICIT versioning, inspectable
 * composition, possession matrix, certification claims matched exactly,
 * and the composition-scoped comparison outcome for this body's
 * possessions). Fail-closed + fail-honest outcomes: a record that is not
 * found, not a body, or unreadable renders as exactly that — never a
 * fabricated body.
 */

import { describeDemoRecord, DemoError } from '@arena/demo';
import {
  buildBodyStudioCard,
  buildCertificationClaimCard,
  buildSubstrateComparison,
  certificationAppliesToBody,
  possessionRowsToComparisonArms,
} from '../../../../packages/body-ui/src/index.js';
import type {
  CertificationClaimCard,
  SubstrateComparisonOutcome,
} from '../../../../packages/body-ui/src/index.js';
import { classifyDatum, truthTreatment } from '../cockpit/state-mark.js';
import type { CockpitTruthTreatment } from '../cockpit/state-mark.js';
import { resolveActiveRole } from '../cockpit/role-lens.js';
import type { CockpitRoleSwitch } from '../cockpit/cockpit-view.js';
import type { CockpitReadPort, CockpitSessionFacts } from './runtime.js';
import { bodyStudioRoleLens } from './role-lens.js';
import type { BodyStudioRoleLens } from './role-lens.js';
import type { CanonicalStateKind, RoleId } from '../../../../packages/role-context/src/index.js';

/** The default detail lens role (same as the library default). */
const DEFAULT_STUDIO_ROLE: RoleId = 'agent-builder';

/** The fail-closed / fail-honest detail outcomes (never a fabricated body). */
export type BodyDetailOutcome =
  | { readonly status: 'body'; readonly view: BodyDetailViewModel }
  | { readonly status: 'not-found'; readonly recordId: string }
  | { readonly status: 'wrong-kind'; readonly recordId: string; readonly kind: string }
  | { readonly status: 'unreadable'; readonly recordId: string; readonly message: string };

/** The canonical state classification of the body record. */
export interface BodyDetailClassification {
  readonly stateKind: CanonicalStateKind;
  readonly treatment: CockpitTruthTreatment;
  readonly stateLabel: string;
}

/** The complete `/bodies/:id` view model. */
export interface BodyDetailViewModel {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalLabel: string;
  readonly roleSwitch: CockpitRoleSwitch;
  readonly lens: BodyStudioRoleLens;
  readonly recordId: string;
  /** Honest title (demo projector first; record id otherwise). */
  readonly title: string;
  readonly summary: string;
  readonly classification: BodyDetailClassification;
  /** The full body-ui studio card (identity + composition + possession matrix). */
  readonly card: ReturnType<typeof buildBodyStudioCard>;
  /** Certification claims whose subject is EXACTLY this body's current version. */
  readonly claims: readonly CertificationClaimCard[];
  /** Claims scoped to other compositions (rendered as such — never attached). */
  readonly otherClaims: readonly CertificationClaimCard[];
  /** The composition-scoped comparison outcome for this body's possessions. */
  readonly comparison: SubstrateComparisonOutcome;
  /** Base href for role-switch links (`/bodies/:id` session, `/demo/bodies/:id` demo). */
  readonly roleHrefBase: string;
  readonly readAt: number;
  readonly demo: {
    readonly isDemo: boolean;
    readonly corpusHash?: string;
  };
}

export interface ResolveBodyDetailOptions {
  readonly mode: 'session' | 'demo';
  readonly facts: CockpitSessionFacts;
  readonly port: CockpitReadPort;
  /** The record id from the route (`/bodies/:id`). */
  readonly recordId: string;
  /** Explicit query-state role request (`?role=`). */
  readonly requestedRoleId?: string;
  readonly defaultRoleId?: RoleId;
  readonly corpusHash?: string;
}

/**
 * Resolve the body detail. The record is read through the canonical read
 * port; a missing record, a non-body record or an unreadable record
 * resolves to its OWN honest outcome — never a guessed body. A body read
 * of a different tenant cannot appear here (the read path is
 * tenant-scoped by the session).
 */
export async function resolveBodyDetail(
  options: ResolveBodyDetailOptions,
): Promise<BodyDetailOutcome> {
  const isDemo = options.mode === 'demo';
  const roleHrefBase = isDemo
    ? `/demo/bodies/${encodeURIComponent(options.recordId)}`
    : `/bodies/${encodeURIComponent(options.recordId)}`;

  let read;
  try {
    read = await options.port.read(options.recordId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: unknown } | null)?.code;
    // The read path's typed not-found vocabulary (B005 READ_MODEL_* / demo
    // DemoError codes), honestly distinguished from other failures (fail
    // closed either way).
    const isNotFound =
      (typeof code === 'string' && code.includes('RECORD_NOT_FOUND')) ||
      message.includes('RECORD_NOT_FOUND') ||
      message.includes('record not found');
    if (isNotFound) {
      return { status: 'not-found', recordId: options.recordId };
    }
    return { status: 'unreadable', recordId: options.recordId, message };
  }
  if (read.kind !== 'agent-body') {
    return { status: 'wrong-kind', recordId: options.recordId, kind: read.kind };
  }

  const card = buildBodyStudioCard(read);

  // Role lens resolution (the cockpit resolver — granted-role truthfulness).
  const resolution = resolveActiveRole({
    grantedRoleIds: options.facts.grantedRoleIds,
    ...(options.requestedRoleId !== undefined ? { requested: options.requestedRoleId } : {}),
    defaultRoleId: options.defaultRoleId ?? DEFAULT_STUDIO_ROLE,
  });
  const lens = bodyStudioRoleLens(
    resolution.status === 'granted' ? resolution.roleId : resolution.fallbackRoleId,
  );
  const roleSwitch: CockpitRoleSwitch = Object.freeze({
    grantedRoleIds: Object.freeze([...options.facts.grantedRoleIds]),
    activeRoleId: lens.roleId,
    ...(options.requestedRoleId !== undefined && options.requestedRoleId.length > 0
      ? { requestedRoleId: options.requestedRoleId }
      : {}),
    denied: resolution.status === 'not-granted',
    ...(resolution.status === 'not-granted' ? { deniedRequested: resolution.requested } : {}),
  });

  // Honest title/summary/classification (demo projector first).
  const data =
    typeof read.data === 'object' && read.data !== null && !Array.isArray(read.data)
      ? (read.data as Readonly<Record<string, unknown>>)
      : {};
  let title = options.recordId;
  let summary = `${read.kind} record (schema v${String(read.sourceVersion)}, revision ${String(read.sourceRevision)}) read through the canonical read path.`;
  let stateKind: CanonicalStateKind = classifyDatum(data).kind;
  if (isDemo) {
    try {
      const demoSummary = describeDemoRecord(read);
      title = demoSummary.title;
      summary = demoSummary.summary;
      stateKind = {
        'verified-fact': 'verified-fact',
        evidence: 'evidence',
        'expert-judgment': 'expert-judgment',
        'model-output': 'model-output',
        'simulation-replay': 'simulation-replay',
        'evaluation-result': 'evaluation-result',
        certification: 'certification',
        suggestion: 'suggestion-hypothesis',
      }[demoSummary.truth] as CanonicalStateKind;
    } catch (error) {
      if (!(error instanceof DemoError)) throw error;
    }
  }
  const classified = classifyDatum({ stateKind });

  // Claims: read the certification scroll and match EXACTLY.
  const claimsPage = await options.port.scroll('certification');
  const claims: CertificationClaimCard[] = [];
  for (const claimRead of claimsPage.records) {
    // The read path returned certification records; project them. A
    // malformed claim record is impossible here (kind-filtered scroll),
    // and the card builder's kind assertion holds by construction.
    claims.push(buildCertificationClaimCardSafe(claimRead));
  }
  const identity = {
    bodyId: card.identity.bodyId,
    version: card.identity.versioning.currentVersion,
  };
  const matched = claims.filter((claim) => certificationAppliesToBody(claim, identity));
  const other = claims.filter((claim) => !certificationAppliesToBody(claim, identity));

  const comparison = buildSubstrateComparison({
    basis: { suite: undefined, environment: undefined },
    arms: possessionRowsToComparisonArms(card.possessionMatrix.rows),
  });

  return {
    status: 'body',
    view: Object.freeze({
      mode: options.mode,
      tenantId: options.facts.tenantId,
      workspaceId: options.facts.workspaceId,
      principalLabel: options.facts.principalLabel,
      roleSwitch,
      lens: Object.freeze(lens),
      recordId: options.recordId,
      title,
      summary,
      classification: Object.freeze({
        stateKind: classified.kind,
        treatment: truthTreatment(classified.kind),
        stateLabel: classified.label,
      }),
      card,
      claims: Object.freeze(matched),
      otherClaims: Object.freeze(other),
      comparison,
      roleHrefBase,
      readAt: read.readAt,
      demo: Object.freeze({
        isDemo,
        ...(isDemo && options.corpusHash !== undefined
          ? { corpusHash: options.corpusHash }
          : {}),
      }),
    } satisfies BodyDetailViewModel),
  };
}

/**
 * Project a certification read into a claim card, tolerating a wrong-kind
 * record by returning an honest unknown-subject claim (the read path is
 * kind-filtered; this guard only exists so a future read-model surprise
 * degrades honestly instead of throwing mid-render).
 */
function buildCertificationClaimCardSafe(read: {
  readonly kind: string;
  readonly recordId: string;
}): CertificationClaimCard {
  if (read.kind === 'certification') {
    return buildCertificationClaimCard(read as Parameters<typeof buildCertificationClaimCard>[0]);
  }
  return Object.freeze({
    viewVersion: 1,
    recordId: read.recordId,
    certificationId: undefined,
    subject: undefined,
    verdict: undefined,
    certificationKind: undefined,
    basis: undefined,
    certifiedAt: undefined,
    scopeNote: 'A certification claim applies to the tested composition, never the bare model.',
    unknownFields: Object.freeze(['kind (record is not a certification read)']),
  } satisfies CertificationClaimCard);
}
