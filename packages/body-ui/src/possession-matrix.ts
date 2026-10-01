/**
 * The Possession matrix (Work Order B010; issue #82; packages/body-ui).
 *
 * One row per possession: the VERSIONED COMPOSITION BINDING that binds a
 * Body Version to a Cognitive Substrate under a runtime/environment/policy
 * (architecture-lock rules 2, 3). The row is STRUCTURED so the distinction
 * is unmistakable:
 *   - `bodyVersion` is the BODY half (parsed from the binding's own
 *     `grantedTo` body@version reference — never from the substrate);
 *   - `substrate` is the SUBSTRATE half (a component of the binding —
 *     never the body's identity, never "the body runs model X");
 *   - `binding` is the frozen literal `versioned-composition-binding`.
 *
 * Components the payload does not carry render as `undefined` + listed in
 * the row's `unknownFields` — pending/unknown stay pending/unknown. A
 * possession entry that is not a readable object is reported in
 * `malformedEntries` with its reason, NEVER guessed into a row.
 */

import type { CanonicalRead } from '@arena/read-model';

import { assertReadKind } from './errors.js';
import {
  asRecord,
  BODY_UI_VIEW_VERSION,
  deepFreezeView,
  POSSESSION_BINDING_NOTE,
  readString,
} from './shared.js';

/** The binding kind of every possession row (frozen literal — never a model alias). */
export const POSSESSION_BINDING_KIND = 'versioned-composition-binding' as const;

/** One possession matrix row: a versioned composition binding, projected honestly. */
export interface PossessionMatrixRow {
  readonly viewVersion: typeof BODY_UI_VIEW_VERSION;
  /** The canonical record the possession was projected from. */
  readonly recordId: string;
  /** The possession's own id, when carried. */
  readonly possessionId: string | undefined;
  /** The BODY half: the exact body version the binding grants (body@version). */
  readonly bodyVersion: { readonly bodyId: string; readonly version: string } | undefined;
  /** The SUBSTRATE half: the cognitive substrate bound into the composition. */
  readonly substrate: string | undefined;
  /** The runtime component of the binding, when carried. */
  readonly runtime: string | undefined;
  /** The environment component of the binding, when carried. */
  readonly environment: string | undefined;
  /** The policy component of the binding, when carried. */
  readonly policy: string | undefined;
  /** The binding's declared scope, when carried (e.g. `composition-scoped`). */
  readonly scope: string | undefined;
  /** Frozen literal: this row IS a versioned composition binding. */
  readonly binding: typeof POSSESSION_BINDING_KIND;
  /** Components the payload did not carry — rendered as unknown. */
  readonly unknownFields: readonly string[];
  /** The binding truth (lock rule 3), carried as data. */
  readonly bindingNote: string;
}

/** One unreadable possession entry, reported honestly (never guessed into a row). */
export interface MalformedPossessionEntry {
  readonly viewVersion: typeof BODY_UI_VIEW_VERSION;
  readonly recordId: string;
  readonly possessionIndex: number;
  readonly reason: string;
}

/** The projected possession matrix of one canonical `agent-body` read. */
export interface PossessionMatrix {
  readonly viewVersion: typeof BODY_UI_VIEW_VERSION;
  readonly recordId: string;
  readonly rows: readonly PossessionMatrixRow[];
  readonly malformedEntries: readonly MalformedPossessionEntry[];
}

/**
 * Parse a possession's `grantedTo` body@version reference. Returns
 * `undefined` when the reference is absent or not parseable — the body
 * half of the binding then renders as unknown (never inferred from the
 * substrate).
 */
export function parseGrantedTo(
  grantedTo: string | undefined,
): { readonly bodyId: string; readonly version: string } | undefined {
  if (grantedTo === undefined) return undefined;
  const separator = grantedTo.lastIndexOf('@');
  if (separator <= 0 || separator === grantedTo.length - 1) return undefined;
  const bodyId = grantedTo.slice(0, separator);
  const version = grantedTo.slice(separator + 1);
  if (bodyId.length === 0 || version.length === 0) return undefined;
  return Object.freeze({ bodyId, version });
}

/**
 * Build the possession matrix from one canonical `agent-body` read.
 * TYPED REJECTION (`BODY_UI_KIND_MISMATCH`) for any other kind. A payload
 * without a `substratePossessions` array projects an EMPTY matrix plus an
 * honest `substratePossessions` unknown marker carried by the studio card
 * (see studio.ts) — an empty matrix is a fact, not an error.
 */
export function buildPossessionMatrix(read: CanonicalRead): PossessionMatrix {
  assertReadKind(read.kind, 'agent-body', read.recordId);
  const data = asRecord(read.data);
  const environment = asRecord(data['environmentRequirements']);
  const bodyRuntime = readString(environment, 'runtime');

  const rows: PossessionMatrixRow[] = [];
  const malformed: MalformedPossessionEntry[] = [];
  const rawPossessions = data['substratePossessions'];

  if (Array.isArray(rawPossessions)) {
    rawPossessions.forEach((entry: unknown, index: number) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        malformed.push(
          Object.freeze({
            viewVersion: BODY_UI_VIEW_VERSION,
            recordId: read.recordId,
            possessionIndex: index,
            reason: 'possession entry is not a JSON object',
          }) satisfies MalformedPossessionEntry,
        );
        return;
      }
      const possession = asRecord(entry);
      const unknownFields: string[] = [];
      const possessionId = readString(possession, 'possessionId');
      if (possessionId === undefined) unknownFields.push('possessionId');
      const grantedTo = readString(possession, 'grantedTo');
      const bodyVersion = parseGrantedTo(grantedTo);
      if (bodyVersion === undefined) unknownFields.push('grantedTo (body@version)');
      const substrate = readString(possession, 'substrate');
      if (substrate === undefined) unknownFields.push('substrate');
      const runtime = readString(possession, 'runtime') ?? bodyRuntime;
      if (runtime === undefined) unknownFields.push('runtime');
      const environmentId = readString(possession, 'environment');
      if (environmentId === undefined) unknownFields.push('environment');
      const policy = readString(possession, 'policy');
      if (policy === undefined) unknownFields.push('policy');
      const scope = readString(possession, 'scope');
      if (scope === undefined) unknownFields.push('scope');

      rows.push(
        deepFreezeView({
          viewVersion: BODY_UI_VIEW_VERSION,
          recordId: read.recordId,
          possessionId,
          bodyVersion,
          substrate,
          runtime,
          environment: environmentId,
          policy,
          scope,
          binding: POSSESSION_BINDING_KIND,
          unknownFields: Object.freeze(unknownFields),
          bindingNote: POSSESSION_BINDING_NOTE,
        } satisfies PossessionMatrixRow),
      );
    });
  }

  return deepFreezeView({
    viewVersion: BODY_UI_VIEW_VERSION,
    recordId: read.recordId,
    rows: Object.freeze(rows),
    malformedEntries: Object.freeze(malformed),
  } satisfies PossessionMatrix);
}

/**
 * The one-line label of a possession row — the full composition identity,
 * never a bare model name: `bodyId@version × substrate (runtime, environment)`.
 */
export function possessionRowLabel(row: PossessionMatrixRow): string {
  const body =
    row.bodyVersion !== undefined
      ? `${row.bodyVersion.bodyId}@${row.bodyVersion.version}`
      : 'body version unknown';
  const substrate = row.substrate ?? 'substrate unknown';
  const runtime = row.runtime ?? 'runtime unknown';
  const environment = row.environment ?? 'environment unknown';
  return `${body} × ${substrate} (runtime ${runtime}, environment ${environment})`;
}
