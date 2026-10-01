/**
 * Body Studio library view-model composition (Work Order B010; issue #82;
 * apps/web/src/bodies). SERVER-ONLY.
 *
 * Builds the fully-renderable `/bodies` view model: the resolved role
 * lens (explicit query state, granted-role truthfulness — reused from the
 * B007 cockpit resolver), the body cards read through the canonical read
 * path (each projected with the @arena/body-ui view model: explicit
 * versioning, inspectable composition, possession matrix), the
 * certification claims matched EXACTLY to each body version, the
 * workspace possession matrix, and the composition-scoped comparison
 * outcomes (honest typed rejections included). Every datum carries its
 * canonical state classification (B003 taxonomy through the B007
 * state-mark pattern); demo mode honours the B006 labelling contract.
 */

import { describeDemoRecord, DemoError } from '@arena/demo';
import type { DemoRecordSummary } from '@arena/demo';
import type { ReadModelKind } from '../../../../packages/read-model/src/index.js';
import {
  buildBodyStudioCard,
  buildCertificationClaimCard,
  buildSubstrateComparison,
  certificationAppliesToBody,
  COMPARISON_SCOPE_CONTRACT,
  possessionRowsToComparisonArms,
  bodyIdentityLabel,
} from '../../../../packages/body-ui/src/index.js';
import type {
  BodyStudioCard,
  CertificationClaimCard,
  PossessionMatrixRow,
  SubstrateComparisonOutcome,
} from '../../../../packages/body-ui/src/index.js';
import type { CanonicalRead } from '../../../../packages/read-model/src/index.js';
import { classifyDatum, DEMO_LABEL_TO_CANONICAL_KIND, truthTreatment } from '../cockpit/state-mark.js';
import type { CockpitTruthTreatment } from '../cockpit/state-mark.js';
import { resolveActiveRole } from '../cockpit/role-lens.js';
import type { CockpitRoleSwitch } from '../cockpit/cockpit-view.js';
import type { CockpitReadPort, CockpitSessionFacts } from './runtime.js';
import { bodyStudioRoleLens } from './role-lens.js';
import type { BodyStudioRoleLens } from './role-lens.js';
import type { CanonicalStateKind, RoleId } from '../../../../packages/role-context/src/index.js';

/** The canonical state classification of one studio datum (B003 + B007 treatment). */
export interface BodyStudioClassification {
  readonly stateKind: CanonicalStateKind;
  readonly treatment: CockpitTruthTreatment;
  readonly stateLabel: string;
}

/** One studio body card: the body half + its possession matrix + matched claims. */
export interface StudioBodyCard {
  readonly recordId: string;
  /** Honest title (demo projector first; identity label otherwise). */
  readonly title: string;
  readonly summary: string;
  readonly classification: BodyStudioClassification;
  readonly card: BodyStudioCard;
  /** Certification claims whose subject is EXACTLY this body's current version. */
  readonly claims: readonly CertificationClaimCard[];
  /** Claims that exist but are scoped to OTHER compositions (rendered as scoped elsewhere). */
  readonly otherClaims: readonly CertificationClaimCard[];
  readonly demo: boolean;
}

/** One possession-matrix entry flattened across the workspace. */
export interface StudioPossessionEntry {
  readonly bodyRecordId: string;
  readonly bodyTitle: string;
  readonly row: PossessionMatrixRow;
}

/** The complete `/bodies` view model. */
export interface BodyStudioViewModel {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalLabel: string;
  readonly roleSwitch: CockpitRoleSwitch;
  readonly lens: BodyStudioRoleLens;
  readonly bodies: readonly StudioBodyCard[];
  /** The workspace possession matrix (every possession row, every body). */
  readonly matrix: readonly StudioPossessionEntry[];
  readonly claimsTotal: number;
  /** The composition-scoped comparison scope contract (rendered verbatim). */
  readonly comparisonScope: typeof COMPARISON_SCOPE_CONTRACT;
  /** Per-body comparison outcomes — compared tables OR honest typed rejections. */
  readonly comparisons: readonly {
    readonly bodyRecordId: string;
    readonly outcome: SubstrateComparisonOutcome;
  }[];
  /** Kinds the studio reads that returned no records (honest empty states). */
  readonly emptyKinds: readonly string[];
  /** Base href for role-switch links ('/bodies' session, '/demo/bodies' demo). */
  readonly roleHrefBase: string;
  /** The read-model activity stamp (max readAt across the reads). */
  readonly readAt: number;
  readonly demo: {
    readonly isDemo: boolean;
    readonly corpusHash?: string;
  };
}

export interface BuildBodyStudioViewOptions {
  readonly mode: 'session' | 'demo';
  readonly facts: CockpitSessionFacts;
  readonly port: CockpitReadPort;
  /** Explicit query-state role request (`?role=`); absent = deterministic default. */
  readonly requestedRoleId?: string;
  /** Default active role when no explicit request (must be granted; defaults 'agent-builder' — RC1.0 makes the Body Studio the builder's primary surface). */
  readonly defaultRoleId?: RoleId;
  /** Demo corpus hash (demo mode determinism stamp). */
  readonly corpusHash?: string;
}

/** The default studio lens role: the Agent Builder (RC1.0 primary surface). */
const DEFAULT_STUDIO_ROLE: RoleId = 'agent-builder';

/** Honest title/summary/classification of one canonical read (demo projector first, B003 classifier otherwise). */
function classifyStudioDatum(read: CanonicalRead, isDemo: boolean): {
  readonly title: string;
  readonly summary: string;
  readonly classification: BodyStudioClassification;
} {
  const data =
    typeof read.data === 'object' && read.data !== null && !Array.isArray(read.data)
      ? (read.data as Readonly<Record<string, unknown>>)
      : {};
  let title = read.recordId;
  let summary = `${read.kind} record (schema v${String(read.sourceVersion)}, revision ${String(read.sourceRevision)}) read through the canonical read path.`;
  let stateKind: CanonicalStateKind = classifyDatum(data).kind;
  if (isDemo) {
    try {
      const demoSummary: DemoRecordSummary = describeDemoRecord(read);
      title = demoSummary.title;
      summary = demoSummary.summary;
      stateKind = DEMO_LABEL_TO_CANONICAL_KIND[demoSummary.truth];
    } catch (error) {
      // Outside the demo corpus vocabulary: keep the honest generic
      // classification (unknown stays unknown — never guessed).
      if (!(error instanceof DemoError)) throw error;
    }
  }
  const classified = classifyDatum({ stateKind });
  return {
    title,
    summary,
    classification: Object.freeze({
      stateKind: classified.kind,
      treatment: truthTreatment(classified.kind),
      stateLabel: classified.label,
    }),
  };
}

/**
 * Build the `/bodies` view model. Every body is read through the injected
 * port (the canonical read path) and projected through @arena/body-ui;
 * claims are matched to bodies EXACTLY by bodyId@version; comparison
 * outcomes are the honest result of the composition-scoped model
 * (including typed rejections). A requested-but-not-granted role resolves
 * to a truthful denial while the lens falls back to the deterministic
 * default.
 */
export async function buildBodyStudioView(
  options: BuildBodyStudioViewOptions,
): Promise<BodyStudioViewModel> {
  const isDemo = options.mode === 'demo';
  const roleHrefBase = isDemo ? '/demo/bodies' : '/bodies';
  const resolution = resolveActiveRole({
    grantedRoleIds: options.facts.grantedRoleIds,
    ...(options.requestedRoleId !== undefined ? { requested: options.requestedRoleId } : {}),
    defaultRoleId: options.defaultRoleId ?? DEFAULT_STUDIO_ROLE,
  });
  const lens = bodyStudioRoleLens(
    resolution.status === 'granted' ? resolution.roleId : resolution.fallbackRoleId,
  );

  // Canonical reads: the body library + the certification claims.
  const bodiesPage = await options.port.scroll('agent-body' as ReadModelKind);
  const claimsPage = await options.port.scroll('certification' as ReadModelKind);
  const emptyKinds: string[] = [];
  if (bodiesPage.records.length === 0) emptyKinds.push('agent-body');
  if (claimsPage.records.length === 0) emptyKinds.push('certification');

  const claims: CertificationClaimCard[] = [];
  for (const read of claimsPage.records) {
    claims.push(buildCertificationClaimCard(read));
  }

  const bodies: StudioBodyCard[] = [];
  const matrix: StudioPossessionEntry[] = [];
  const comparisons: { bodyRecordId: string; outcome: SubstrateComparisonOutcome }[] = [];
  let readAt = Math.max(bodiesPage.readAt, claimsPage.readAt);

  for (const read of bodiesPage.records) {
    const card = buildBodyStudioCard(read);
    readAt = Math.max(readAt, read.readAt);
    const { title, summary, classification } = classifyStudioDatum(read, isDemo);
    const identity = {
      bodyId: card.identity.bodyId,
      version: card.identity.versioning.currentVersion,
    };
    const matched = claims.filter((claim) => certificationAppliesToBody(claim, identity));
    const other = claims.filter((claim) => !certificationAppliesToBody(claim, identity));
    bodies.push(
      Object.freeze({
        recordId: read.recordId,
        title,
        summary,
        classification,
        card,
        claims: Object.freeze(matched),
        otherClaims: Object.freeze(other),
        demo: isDemo,
      } satisfies StudioBodyCard),
    );
    for (const row of card.possessionMatrix.rows) {
      matrix.push(
        Object.freeze({
          bodyRecordId: read.recordId,
          bodyTitle: title,
          row,
        } satisfies StudioPossessionEntry),
      );
    }
    // The composition-scoped comparison over this body's possessions —
    // the honest outcome whatever it is (compared table or typed
    // rejection; the demo corpus yields INSUFFICIENT_ARMS truthfully).
    comparisons.push(
      Object.freeze({
        bodyRecordId: read.recordId,
        outcome: buildSubstrateComparison({
          basis: { suite: undefined, environment: undefined },
          arms: possessionRowsToComparisonArms(card.possessionMatrix.rows),
        }),
      }),
    );
  }

  const roleSwitch: CockpitRoleSwitch = Object.freeze({
    grantedRoleIds: Object.freeze([...options.facts.grantedRoleIds]),
    activeRoleId: lens.roleId,
    ...(options.requestedRoleId !== undefined && options.requestedRoleId.length > 0
      ? { requestedRoleId: options.requestedRoleId }
      : {}),
    denied: resolution.status === 'not-granted',
    ...(resolution.status === 'not-granted' ? { deniedRequested: resolution.requested } : {}),
  });

  return Object.freeze({
    mode: options.mode,
    tenantId: options.facts.tenantId,
    workspaceId: options.facts.workspaceId,
    principalLabel: options.facts.principalLabel,
    roleSwitch,
    lens: Object.freeze(lens),
    bodies: Object.freeze(bodies),
    matrix: Object.freeze(matrix),
    claimsTotal: claims.length,
    comparisonScope: COMPARISON_SCOPE_CONTRACT,
    comparisons: Object.freeze(comparisons),
    emptyKinds: Object.freeze(emptyKinds),
    roleHrefBase,
    readAt,
    demo: Object.freeze({
      isDemo,
      ...(isDemo && options.corpusHash !== undefined ? { corpusHash: options.corpusHash } : {}),
    }),
  } satisfies BodyStudioViewModel);
}

/** The honest one-line identity label of a studio body card (never a substrate name). */
export function studioBodyLabel(body: StudioBodyCard): string {
  return bodyIdentityLabel(body.card.identity);
}
