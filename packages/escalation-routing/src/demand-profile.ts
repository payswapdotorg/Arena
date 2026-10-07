/**
 * DemandProfile — the capability-demand compiler (Work Order C002; issue
 * #76; spec/expert-escalation-api.md ES1.0 "Routing"; spec/
 * escalation-reference-flow.md steps 1-3 "Triages the need / Resolves
 * required capabilities / Finds qualified available experts").
 *
 * The compiler turns an escalation request's capability need (+ expert
 * requirements, locale, tools demand, budget, deadline, privacy policy)
 * into a structured, versioned DemandProfile over the A004 capability
 * graph:
 *
 *   - the capability-need dot-path resolves deterministically by walking
 *     `decomposes-into` edges from a root domain node (segment 1) through
 *     each subsequent segment; single-segment needs resolve by kind
 *     precedence (domain, capability, sub-capability, skill);
 *   - required competencies are the competency-kind (capability /
 *     sub-capability / skill / expert-competency) descendants of every
 *     resolved anchor (the need anchor AND each
 *     expertRequirements.requiredCapabilities anchor), supersession-aware
 *     (latest non-superseded version wins) and deterministically sorted;
 *   - required tools are the `tool` nodes reachable via `requires` edges
 *     from the anchors and their descendants (ES1.0 "required tools");
 *   - the demand constraints (locales, jurisdictions, budget, deadline,
 *     privacy classification/PII policy, urgency, modes) are carried as
 *     typed data — never interpreted into commitments here.
 *
 * Typed CLOSED outcomes — never a bare boolean:
 *   - `compilable`               → the DemandProfile (content-addressed,
 *                                   deep-frozen);
 *   - `under-specified`          → closed reason list + the unresolved
 *                                   inputs (the request cannot produce a
 *                                   complete demand);
 *   - `not-derivable`            → the graph itself cannot answer
 *                                   (missing graph / inconsistent lookup).
 *
 * Pure + deterministic: the same (request view, graph, evaluatedAt) triple
 * ALWAYS compiles to the same digest. No clock reads — `evaluatedAt` is
 * injected (architecture-lock rule 17). QUALIFICATION IS DATA, NEVER
 * AN ACCESS GRANT (lock rule 9): the profile describes a DEMAND, and nothing
 * here grants, implies or records a permission.
 */

import { digestCanonical } from '@arena/protocol-core';
import {
  isCapabilityGraph,
  latestNodeVersion,
  getNode,
  outgoingEdgesOf,
  descendantsOf,
} from '@arena/capability-graph';
import type { CapabilityGraph, CapabilityNode, CapabilityNodeRef } from '@arena/capability-graph';
import { ESCALATION_ROUTING_ERROR_CODES, EscalationRoutingError } from './errors.js';
import type { JurisdictionView } from '@arena/expert-qualification';
import { isJurisdictionView } from '@arena/expert-qualification';

/** Wire version of the demand-profile record shape. */
export const DEMAND_PROFILE_VERSION = 1 as const;

/** The competency node kinds a demand may require (A004/A007 shared subset). */
export const DEMAND_COMPETENCY_NODE_KINDS = Object.freeze([
  'capability',
  'sub-capability',
  'skill',
  'expert-competency',
] as const);
export type DemandCompetencyNodeKind = (typeof DEMAND_COMPETENCY_NODE_KINDS)[number];

/** The tool node kind a demand may require. */
export const DEMAND_TOOL_NODE_KIND = 'tool' as const;

/**
 * CLOSED under-specification vocabulary — the request cannot produce a
 * complete demand (the caller can repair these by fixing the request).
 */
export const UNDER_SPECIFIED_REASONS = Object.freeze([
  'capability-need-unresolved',
  'required-capability-unresolved',
  'required-capabilities-missing',
  'jurisdiction-malformed',
  'locale-malformed',
  'budget-malformed',
  'deadline-malformed',
] as const);
export type UnderSpecifiedReason = (typeof UNDER_SPECIFIED_REASONS)[number];

/**
 * CLOSED not-derivable vocabulary — the capability graph cannot answer.
 */
export const NOT_DERIVABLE_REASONS = Object.freeze([
  'graph-missing',
  'graph-lookup-failed',
] as const);
export type NotDerivableReason = (typeof NOT_DERIVABLE_REASONS)[number];

/** ES1.0 privacy classification ordering (clearance must cover the demand). */
export const PRIVACY_CLASSIFICATION_RANK: Readonly<Record<string, number>> = Object.freeze({
  public: 1,
  internal: 2,
  confidential: 3,
});

/**
 * The demand-side view of one escalation request — STRUCTURALLY compatible
 * with @arena/escalation's EscalationRequest (the compiler consumes
 * requests as DATA through this view; it never imports a service).
 */
export interface RoutingDemandInput {
  readonly tenantId: string;
  readonly clientAppId: string;
  readonly capabilityNeed: string;
  readonly requiredCapabilities: readonly string[];
  readonly preferredLocales?: readonly string[];
  readonly jurisdictions?: readonly string[];
  readonly locale: string;
  readonly budget: { readonly amountMinorUnits: number; readonly currency: string };
  readonly deadline: string;
  readonly createdAt: string;
  readonly urgency: string;
  readonly privacyPolicy: {
    readonly dataClassification: string;
    readonly pii: string;
  };
  readonly escalationModes: readonly string[];
}

/** The digest-free view — exactly what the DemandProfile digest commits to. */
export interface DemandProfileView {
  readonly profileVersion: typeof DEMAND_PROFILE_VERSION;
  readonly tenantId: string;
  readonly clientAppId: string;
  readonly capabilityNeed: string;
  readonly domainRef?: CapabilityNodeRef;
  readonly requiredCompetencyRefs: readonly CapabilityNodeRef[];
  readonly requiredToolRefs: readonly CapabilityNodeRef[];
  readonly locales: readonly string[];
  readonly jurisdictions: readonly JurisdictionView[];
  readonly budget: { readonly amountMinorUnits: number; readonly currency: string };
  readonly deadlineMs: number;
  readonly createdAtMs: number;
  readonly urgency: string;
  readonly privacyPolicy: { readonly dataClassification: string; readonly pii: string };
  readonly escalationModes: readonly string[];
  readonly evaluatedAt: string;
}

/** A frozen, content-addressed demand profile: view + digest. */
export interface DemandProfile extends DemandProfileView {
  readonly digest: string;
}

/** The typed compiler outcome (never a bare boolean). */
export type DemandCompilationResult =
  | { readonly outcome: 'compilable'; readonly profile: DemandProfile }
  | {
      readonly outcome: 'under-specified';
      readonly reasons: readonly UnderSpecifiedReason[];
      /** The concrete unresolved inputs, in input order (machine-readable). */
      readonly unresolved: readonly string[];
    }
  | { readonly outcome: 'not-derivable'; readonly reason: NotDerivableReason };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const REGION_PATTERN = /^[A-Za-z0-9]{1,3}$/;

function logicalKey(ref: { readonly kind: string; readonly id: string }): string {
  return `${ref.kind}/${ref.id}`;
}

function compareRefs(a: CapabilityNodeRef, b: CapabilityNodeRef): number {
  const keyA = logicalKey(a);
  const keyB = logicalKey(b);
  if (keyA !== keyB) return keyA < keyB ? -1 : 1;
  return a.version < b.version ? -1 : a.version > b.version ? 1 : 0;
}

function isDemandCompetencyKind(kind: string): boolean {
  return (DEMAND_COMPETENCY_NODE_KINDS as readonly string[]).includes(kind);
}

/** Parse a request jurisdiction string ("CC" or "CC-REGION") into a typed view. */
function parseJurisdiction(value: string): JurisdictionView | null {
  const match = /^([A-Z]{2})(?:-([A-Za-z0-9]{1,3}))?$/.exec(value);
  if (match === null) return null;
  const country = match[1];
  const region = match[2];
  if (country === undefined) return null;
  if (region !== undefined && !REGION_PATTERN.test(region)) return null;
  const candidate = region === undefined ? { jurisdictionVersion: 1, country } : { jurisdictionVersion: 1, country, region };
  if (!isJurisdictionView(candidate)) return null;
  return candidate;
}

interface AnchorResolution {
  readonly anchor: CapabilityNode;
  readonly root: CapabilityNode;
}

/**
 * Resolve one capability dot-path over the graph by walking
 * `decomposes-into` edges. Multi-segment paths MUST start at a domain
 * node (the taxonomy root discipline); single-segment paths resolve by
 * kind precedence. Returns null when the path cannot be resolved.
 */
function resolveCapabilityPath(
  graph: CapabilityGraph,
  path: string,
): AnchorResolution | null {
  const segments = path.split('.');
  if (segments.length === 0) return null;
  const first = segments[0];
  if (first === undefined || first.length === 0) return null;

  const rootKindOrder: readonly string[] =
    segments.length > 1
      ? ['domain']
      : ['domain', 'capability', 'sub-capability', 'skill'];
  let root: CapabilityNode | null = null;
  for (const kind of rootKindOrder) {
    const node = latestNodeVersion(graph, { kind: kind as CapabilityNode['kind'], id: first });
    if (node !== null) {
      root = node;
      break;
    }
  }
  if (root === null) return null;

  let current = root;
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined || segment.length === 0) return null;
    const edges = outgoingEdgesOf(graph, current, ['decomposes-into']);
    let next: CapabilityNode | null = null;
    for (const edge of edges) {
      if (edge.target.id !== segment) continue;
      const node = getNode(graph, edge.target);
      if (node === null) continue;
      if (next === null || node.version > next.version) next = node;
    }
    if (next === null) return null;
    current = next;
  }
  return { anchor: current, root };
}

/**
 * Competency refs for one anchor: the anchor itself (when competency-kind)
 * plus its competency-kind `decomposes-into` descendants — supersession-
 * aware (descendantsOf walks current graph state).
 */
function competencyRefsOf(graph: CapabilityGraph, anchor: CapabilityNode): CapabilityNodeRef[] {
  const refs: CapabilityNodeRef[] = [];
  if (isDemandCompetencyKind(anchor.kind)) {
    refs.push({ kind: anchor.kind, id: anchor.id, version: anchor.version, digest: anchor.digest });
  }
  for (const ref of descendantsOf(graph, anchor)) {
    if (!isDemandCompetencyKind(ref.kind)) continue;
    refs.push(ref);
  }
  return refs;
}

/** Tool refs required by an anchor's subtree (`requires` edges → tool nodes). */
function toolRefsOf(graph: CapabilityGraph, anchor: CapabilityNode): CapabilityNodeRef[] {
  const subtree: CapabilityNode[] = [anchor, ...descendantsOf(graph, anchor).map((ref) => getNode(graph, ref)).filter((node): node is CapabilityNode => node !== null)];
  const tools: CapabilityNodeRef[] = [];
  for (const node of subtree) {
    for (const edge of outgoingEdgesOf(graph, node, ['requires'])) {
      if (edge.target.kind !== DEMAND_TOOL_NODE_KIND) continue;
      const tool = getNode(graph, edge.target);
      if (tool === null) continue;
      tools.push({ kind: tool.kind, id: tool.id, version: tool.version, digest: tool.digest });
    }
  }
  return tools;
}

function mergeRefs(groups: readonly (readonly CapabilityNodeRef[])[]): CapabilityNodeRef[] {
  const byLogical = new Map<string, CapabilityNodeRef>();
  for (const group of groups) {
    for (const ref of group) {
      const key = logicalKey(ref);
      const existing = byLogical.get(key);
      if (existing === undefined || ref.version > existing.version) {
        byLogical.set(key, ref);
      }
    }
  }
  return [...byLogical.values()].sort(compareRefs);
}

// ---------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------

/**
 * Compile one escalation request view into a typed DemandProfile over the
 * injected A004 capability graph. Deterministic: identical inputs compile
 * to identical digests. Never throws for semantic mismatches — every
 * failure is a TYPED closed outcome.
 */
export async function compileDemandProfile(
  input: RoutingDemandInput,
  graph: CapabilityGraph,
  options: { readonly evaluatedAt: string },
): Promise<DemandCompilationResult> {
  if (typeof input !== 'object' || input === null) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_DEMAND_INPUT, {
      message: 'demand input must be an object',
    });
  }
  if (!isCapabilityGraph(graph)) {
    return { outcome: 'not-derivable', reason: 'graph-missing' };
  }

  const reasons: UnderSpecifiedReason[] = [];
  const unresolved: string[] = [];

  // --- capability need resolution -----------------------------------------
  const needResolution = resolveCapabilityPath(graph, input.capabilityNeed);
  if (needResolution === null) {
    reasons.push('capability-need-unresolved');
    unresolved.push(input.capabilityNeed);
  }

  // --- required capabilities resolution ------------------------------------
  if (!Array.isArray(input.requiredCapabilities) || input.requiredCapabilities.length === 0) {
    reasons.push('required-capabilities-missing');
  }
  const anchors: CapabilityNode[] = [];
  if (needResolution !== null) anchors.push(needResolution.anchor);
  for (const capability of input.requiredCapabilities) {
    const resolution = resolveCapabilityPath(graph, capability);
    if (resolution === null) {
      reasons.push('required-capability-unresolved');
      unresolved.push(capability);
      continue;
    }
    anchors.push(resolution.anchor);
  }

  // --- locales ---------------------------------------------------------------
  if (typeof input.locale !== 'string' || !LOCALE_PATTERN.test(input.locale)) {
    reasons.push('locale-malformed');
    unresolved.push(String(input.locale));
  }
  const locales: string[] = [];
  if (typeof input.locale === 'string' && LOCALE_PATTERN.test(input.locale)) {
    locales.push(input.locale);
  }
  for (const preferred of input.preferredLocales ?? []) {
    if (typeof preferred !== 'string' || !LOCALE_PATTERN.test(preferred)) {
      reasons.push('locale-malformed');
      unresolved.push(String(preferred));
      continue;
    }
    if (!locales.includes(preferred)) locales.push(preferred);
  }

  // --- jurisdictions ----------------------------------------------------------
  const jurisdictions: JurisdictionView[] = [];
  for (const value of input.jurisdictions ?? []) {
    const parsed = typeof value === 'string' ? parseJurisdiction(value) : null;
    if (parsed === null) {
      reasons.push('jurisdiction-malformed');
      unresolved.push(String(value));
      continue;
    }
    jurisdictions.push(parsed);
  }

  // --- budget -----------------------------------------------------------------
  const amountMinorUnits = input.budget?.amountMinorUnits;
  if (
    typeof amountMinorUnits !== 'number' ||
    !Number.isInteger(amountMinorUnits) ||
    amountMinorUnits < 0 ||
    amountMinorUnits > Number.MAX_SAFE_INTEGER ||
    typeof input.budget?.currency !== 'string' ||
    !CURRENCY_PATTERN.test(input.budget.currency)
  ) {
    reasons.push('budget-malformed');
  }

  // --- deadline ------------------------------------------------------------------
  const deadlineMs = typeof input.deadline === 'string' ? Date.parse(input.deadline) : Number.NaN;
  if (!Number.isFinite(deadlineMs)) {
    reasons.push('deadline-malformed');
    unresolved.push(String(input.deadline));
  }

  if (reasons.length > 0) {
    return { outcome: 'under-specified', reasons: Object.freeze([...reasons]), unresolved: Object.freeze([...unresolved]) };
  }

  // --- graph derivation (need + required capabilities) -----------------------------
  const competencyGroups = anchors.map((anchor) => competencyRefsOf(graph, anchor));
  const toolGroups = anchors.map((anchor) => toolRefsOf(graph, anchor));
  const requiredCompetencyRefs = mergeRefs(competencyGroups);
  const requiredToolRefs = mergeRefs(toolGroups);

  // Integrity guard: every derived ref must resolve in the graph.
  for (const ref of [...requiredCompetencyRefs, ...requiredToolRefs]) {
    if (getNode(graph, ref) === null) {
      return { outcome: 'not-derivable', reason: 'graph-lookup-failed' };
    }
  }

  const domainRef =
    needResolution !== null && needResolution.root.kind === 'domain'
      ? ({ kind: needResolution.root.kind, id: needResolution.root.id, version: needResolution.root.version, digest: needResolution.root.digest } satisfies CapabilityNodeRef)
      : undefined;

  const view: DemandProfileView = {
    profileVersion: DEMAND_PROFILE_VERSION,
    tenantId: input.tenantId,
    clientAppId: input.clientAppId,
    capabilityNeed: input.capabilityNeed,
    ...(domainRef !== undefined ? { domainRef } : {}),
    requiredCompetencyRefs: Object.freeze([...requiredCompetencyRefs]),
    requiredToolRefs: Object.freeze([...requiredToolRefs]),
    locales: Object.freeze([...locales]),
    jurisdictions: Object.freeze([...jurisdictions]),
    budget: Object.freeze({
      amountMinorUnits: amountMinorUnits as number,
      currency: input.budget.currency,
    }),
    deadlineMs,
    createdAtMs: Date.parse(input.createdAt),
    urgency: input.urgency,
    privacyPolicy: Object.freeze({
      dataClassification: input.privacyPolicy.dataClassification,
      pii: input.privacyPolicy.pii,
    }),
    escalationModes: Object.freeze([...input.escalationModes]),
    evaluatedAt: options.evaluatedAt,
  };

  const digest = await digestCanonical(view);
  const profile: DemandProfile = Object.freeze({ ...view, digest });
  return { outcome: 'compilable', profile };
}

/** Structural (non-throwing) guard for a DemandProfile-shaped value. */
export function isDemandProfile(value: unknown): value is DemandProfile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['profileVersion'] === DEMAND_PROFILE_VERSION &&
    typeof candidate['tenantId'] === 'string' &&
    typeof candidate['capabilityNeed'] === 'string' &&
    Array.isArray(candidate['requiredCompetencyRefs']) &&
    Array.isArray(candidate['requiredToolRefs']) &&
    Array.isArray(candidate['locales']) &&
    typeof candidate['digest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['digest'])
  );
}

/** The digest-free view of a profile (what the digest commits to). */
export function demandProfileView(profile: DemandProfile): DemandProfileView {
  const { digest: _digest, ...view } = profile;
  return view;
}

/**
 * Recompute the profile digest over the digest-free view and compare.
 * Throws ESCALATION_ROUTING_TAMPERED on any mismatch.
 */
export async function recomputeDemandProfileDigest(
  profile: DemandProfile,
  expectedDigest?: string,
): Promise<string> {
  if (!isDemandProfile(profile)) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_PROFILE, {
      message: 'profile digest recomputation requires a structurally valid demand profile',
    });
  }
  const actual = await digestCanonical(demandProfileView(profile));
  if (actual !== profile.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.TAMPERED, {
      message: `demand profile digest mismatch: expected ${expectedDigest ?? profile.digest}, got ${actual}`,
      details: {
        capabilityNeed: profile.capabilityNeed,
        expected: expectedDigest ?? profile.digest,
        actual,
      },
    });
  }
  return actual;
}
