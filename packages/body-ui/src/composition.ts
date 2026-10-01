/**
 * Skill / knowledge / tool composition listing (Work Order B010; issue #82;
 * packages/body-ui).
 *
 * The composition listing is the INSPECTABLE half of the studio: WHAT the
 * body is composed of — skills, knowledge, tools, procedures, capabilities
 * and the evaluation/verification suite refs that will later certify a
 * possession of it. Counts and named listings are carried AS STORED; any
 * component the payload does not carry is `undefined` and listed in
 * `unknownFields` (rendered as unknown — the UI never invents a
 * composition component).
 */

import type { CanonicalRead } from '@arena/read-model';

import { assertReadKind } from './errors.js';
import {
  asRecord,
  BODY_UI_VIEW_VERSION,
  BODY_NOT_MODEL_NOTE,
  deepFreezeView,
  readCount,
  readString,
  readStringArray,
} from './shared.js';

/** The manifest counts a body composition listing carries (as stored). */
export interface CompositionCounts {
  readonly skills: number | undefined;
  readonly knowledge: number | undefined;
  readonly tools: number | undefined;
  readonly procedures: number | undefined;
  readonly capabilities: number | undefined;
  readonly evaluationSuites: number | undefined;
  readonly verificationSuites: number | undefined;
}

/** The composition listing view model (pure projection, inspectable). */
export interface CompositionListing {
  readonly viewVersion: typeof BODY_UI_VIEW_VERSION;
  readonly recordId: string;
  /** Manifest component counts, as stored. */
  readonly counts: CompositionCounts;
  /** Named tool components, when the payload carries them. */
  readonly toolNames: readonly string[];
  /** Environment requirements the body declares (runtime/network), when carried. */
  readonly environmentRequirements: {
    readonly runtime: string | undefined;
    readonly network: string | undefined;
  };
  /** Payload fields the read did not carry — rendered as unknown. */
  readonly unknownFields: readonly string[];
  /** The composition truth (body ≠ model), carried as data. */
  readonly compositionNote: string;
}

/**
 * Build the composition listing from one canonical `agent-body` read.
 * TYPED REJECTION (`BODY_UI_KIND_MISMATCH`) for any other kind.
 */
export function buildCompositionListing(read: CanonicalRead): CompositionListing {
  assertReadKind(read.kind, 'agent-body', read.recordId);
  const data = asRecord(read.data);
  const manifest = asRecord(data['manifestSummary']);
  const environment = asRecord(data['environmentRequirements']);

  const unknownFields: string[] = [];
  const counts: CompositionCounts = Object.freeze({
    skills: readCount(manifest, 'skills'),
    knowledge: readCount(manifest, 'knowledge'),
    tools: readCount(manifest, 'tools'),
    procedures: readCount(manifest, 'procedures'),
    capabilities: readCount(manifest, 'capabilities'),
    evaluationSuites: readCount(manifest, 'evaluationSuites'),
    verificationSuites: readCount(manifest, 'verificationSuites'),
  });
  for (const key of Object.keys(counts) as readonly (keyof CompositionCounts)[]) {
    if (counts[key] === undefined) unknownFields.push(`manifestSummary.${key}`);
  }
  const toolNames = readStringArray(data, 'toolNames');
  if (toolNames === undefined) unknownFields.push('toolNames');
  const runtime = readString(environment, 'runtime');
  if (runtime === undefined) unknownFields.push('environmentRequirements.runtime');
  const network = readString(environment, 'network');
  if (network === undefined) unknownFields.push('environmentRequirements.network');

  return deepFreezeView({
    viewVersion: BODY_UI_VIEW_VERSION,
    recordId: read.recordId,
    counts,
    toolNames: toolNames ?? Object.freeze([]),
    environmentRequirements: Object.freeze({ runtime, network }),
    unknownFields: Object.freeze(unknownFields),
    compositionNote: BODY_NOT_MODEL_NOTE,
  } satisfies CompositionListing);
}
