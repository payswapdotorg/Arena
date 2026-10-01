/**
 * Cockpit home view-model composition (Work Order B007; issue #78;
 * apps/web/src/cockpit). SERVER-ONLY.
 *
 * Builds the fully-renderable cockpit home view model: the resolved role
 * lens (explicit query state, granted-role truthfulness), the "what am I
 * doing" data cards read through the canonical read path with their
 * product-truth classification on EVERY datum, the "what can I do next"
 * actions, the role-emphasized contextual navigation and the read-model
 * activity summary.
 *
 * Determinism: the builder is a pure function of its inputs + reads. In
 * demo mode the underlying reads are frozen at the narrative epoch, so
 * two builds are byte-identical; in session mode `readAt` reflects the
 * live read-model stamps (reload drift is detectable, never cached).
 */

import { CORE_NAV_ITEMS } from '../app/_lib/nav.js';
import { describeDemoRecord } from '@arena/demo';
import { DemoError } from '@arena/demo';
import type { DemoRecordSummary } from '@arena/demo';
import type {
  CanonicalRead,
  KindInventory,
  ReadModelKind,
} from '../../../../packages/read-model/src/index.js';
import { classifyDatum, DEMO_LABEL_TO_CANONICAL_KIND, truthTreatment } from './state-mark.js';
import type { CockpitTruthTreatment } from './state-mark.js';
import {
  cockpitRoleLens,
  resolveActiveRole,
} from './role-lens.js';
import type { CockpitNextAction, CockpitRoleLens } from './role-lens.js';
import type { CockpitReadPort, CockpitSessionFacts } from './runtime.js';
import type { RoleId } from '../../../../packages/role-context/src/index.js';
import type { CanonicalStateKind } from '../../../../packages/role-context/src/index.js';

/** One canonical datum rendered by the cockpit, truthfully classified. */
export interface CockpitDatumCard {
  readonly recordId: string;
  readonly kind: string;
  readonly title: string;
  readonly summary: string;
  /** The canonical product-truth classification (B003 taxonomy) — never collapsed. */
  readonly stateKind: CanonicalStateKind;
  /** The distinct UI treatment of that classification. */
  readonly treatment: CockpitTruthTreatment;
  readonly stateLabel: string;
  readonly sourceVersion: number;
  readonly sourceRevision: number;
  /** Rendered under the demo labelling contract (demo mode only). */
  readonly demo: boolean;
}

/** One role-emphasized navigation entry (emphasis only — the route is a capability of the shell). */
export interface CockpitNavItem {
  readonly href: string;
  readonly label: string;
  readonly emphasized: boolean;
}

/** The resolved role switch for rendering. */
export interface CockpitRoleSwitch {
  readonly grantedRoleIds: readonly RoleId[];
  readonly activeRoleId: RoleId;
  readonly requestedRoleId?: string;
  /** True when an explicitly requested role is NOT granted — rendered as a truthful denial, never a fake authorization. */
  readonly denied: boolean;
  readonly deniedRequested?: string;
}

/** The complete cockpit home view model. */
export interface CockpitHomeViewModel {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalLabel: string;
  readonly roleSwitch: CockpitRoleSwitch;
  readonly lens: CockpitRoleLens;
  readonly doing: {
    readonly heading: string;
    readonly intro: string;
    readonly cards: readonly CockpitDatumCard[];
    /** Kinds the lens reads that returned no records (honest empty states). */
    readonly emptyKinds: readonly string[];
  };
  readonly next: {
    readonly actions: readonly CockpitNextAction[];
  };
  readonly nav: readonly CockpitNavItem[];
  /** Base href for role-switch links ('/' session, '/demo/cockpit' demo). */
  readonly roleHrefBase: string;
  readonly inventory: KindInventory;
  /** The read-model activity stamp (max readAt across the reads — the honest freshness signal). */
  readonly readAt: number;
  readonly demo: {
    readonly isDemo: boolean;
    readonly corpusHash?: string;
  };
}

export interface BuildCockpitHomeViewOptions {
  readonly mode: 'session' | 'demo';
  readonly facts: CockpitSessionFacts;
  readonly port: CockpitReadPort;
  /** Explicit query-state role request (`?role=`); absent = deterministic default. */
  readonly requestedRoleId?: string;
  /** Default active role when no explicit request (must be granted; defaults per mode). */
  readonly defaultRoleId?: RoleId;
  /** Base href for role-switch links (default '/' session, '/demo/cockpit' demo). */
  readonly roleHrefBase?: string;
  /** Demo corpus hash (demo mode determinism stamp). */
  readonly corpusHash?: string;
}

/** The href of a role-switch link (explicit query state — B006 pattern). */
export function roleSwitchHref(base: string, roleId: RoleId): string {
  return `${base}?role=${roleId}`;
}

/** Pick an honest generic title from a canonical record payload (no fabricated claims). */
function genericTitle(data: Readonly<Record<string, unknown>>, recordId: string): string {
  for (const key of ['displayName', 'title', 'name', 'qualificationId', 'certificationId']) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return recordId;
}

/** One-line honest summary of a canonical record (structure, not narrative). */
function genericSummary(read: CanonicalRead): string {
  return `${read.kind} record (schema v${String(read.sourceVersion)}, revision ${String(read.sourceRevision)}) read through the canonical read path.`;
}

/**
 * Project ONE canonical read into a cockpit datum card.
 *
 * Classification order (truthful, never invented):
 *   1. demo mode: the B006 demo projector (`describeDemoRecord`) carries
 *      the corpus's own per-record product-truth labels;
 *   2. otherwise/otherwise-unclassifiable: the B003 total classifier over
 *      the record payload (`stateKind` field when present; `unknown`
 *      otherwise — rendered as unknown, never guessed).
 */
function toDatumCard(read: CanonicalRead, isDemo: boolean): CockpitDatumCard {
  const data =
    typeof read.data === 'object' && read.data !== null && !Array.isArray(read.data)
      ? (read.data as Readonly<Record<string, unknown>>)
      : {};
  let title = genericTitle(data, read.recordId);
  let summary = genericSummary(read);
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
  const classification = classifyDatum({ stateKind });
  return Object.freeze({
    recordId: read.recordId,
    kind: read.kind,
    title,
    summary,
    stateKind: classification.kind,
    treatment: truthTreatment(classification.kind),
    stateLabel: classification.label,
    sourceVersion: read.sourceVersion,
    sourceRevision: read.sourceRevision,
    demo: isDemo,
  });
}

/** Role-emphasized navigation: emphasis reorders + marks; nothing is removed. */
function buildNav(lens: CockpitRoleLens): readonly CockpitNavItem[] {
  const emphasized = new Set(lens.emphasizedRoutes);
  const indexed = CORE_NAV_ITEMS.map((item, index) => ({
    href: item.href,
    label: item.label,
    emphasized: emphasized.has(item.href),
    index,
  }));
  indexed.sort((a, b) => {
    if (a.emphasized !== b.emphasized) return a.emphasized ? -1 : 1;
    return a.index - b.index;
  });
  return Object.freeze(
    indexed.map(({ href, label, emphasized: isEmphasized }) =>
      Object.freeze({ href, label, emphasized: isEmphasized }),
    ),
  );
}

/**
 * Build the cockpit home view model. Every datum is read through the
 * injected port (the canonical read path) and carries its canonical state
 * classification; a requested-but-not-granted role resolves to a truthful
 * denial while the lens falls back to the deterministic default.
 */
export async function buildCockpitHomeView(
  options: BuildCockpitHomeViewOptions,
): Promise<CockpitHomeViewModel> {
  const isDemo = options.mode === 'demo';
  const roleHrefBase = options.roleHrefBase ?? (isDemo ? '/demo/cockpit' : '/');
  const resolution = resolveActiveRole({
    grantedRoleIds: options.facts.grantedRoleIds,
    ...(options.requestedRoleId !== undefined ? { requested: options.requestedRoleId } : {}),
    ...(options.defaultRoleId !== undefined || isDemo
      ? { defaultRoleId: options.defaultRoleId ?? 'owner' }
      : {}),
  });
  const lens = cockpitRoleLens(
    resolution.status === 'granted' ? resolution.roleId : resolution.fallbackRoleId,
  );

  // "What am I doing": one bounded scroll per lens-read kind.
  const cards: CockpitDatumCard[] = [];
  const emptyKinds: string[] = [];
  let readAt = 0;
  for (const kind of lens.primaryReadKinds) {
    const page = await options.port.scroll(kind as ReadModelKind);
    readAt = Math.max(readAt, page.readAt);
    if (page.records.length === 0) {
      emptyKinds.push(kind);
      continue;
    }
    for (const record of page.records) {
      cards.push(toDatumCard(record, isDemo));
      readAt = Math.max(readAt, record.readAt);
    }
  }
  const inventory = await options.port.inventory();

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
    doing: Object.freeze({
      heading: lens.doingHeading,
      intro: lens.doingIntro,
      cards: Object.freeze(cards),
      emptyKinds: Object.freeze(emptyKinds),
    }),
    next: Object.freeze({ actions: Object.freeze([...lens.nextActions]) }),
    nav: buildNav(lens),
    roleHrefBase,
    inventory,
    readAt,
    demo: Object.freeze({
      isDemo,
      ...(isDemo && options.corpusHash !== undefined ? { corpusHash: options.corpusHash } : {}),
    }),
  } satisfies CockpitHomeViewModel);
}
