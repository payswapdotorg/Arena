/**
 * Typed interview items + the item catalog (Work Order C003).
 *
 * The catalog is SEEDED from the C002 DemandProfile vocabulary — the
 * required competency refs and required tool refs the demand compiler
 * derived over the A004 capability graph, plus the ES1.0 routing inputs
 * a routable expert needs (geography/locale, jurisdictions, availability,
 * privacy clearance). Every item is typed with a CLOSED kind (capability
 * probe, experience probe, evidence request, scenario item — the work
 * order's four) and an expected answer schema, so the interview elicits
 * STRUCTURED declarations rather than free prose wherever possible.
 *
 * Item ids are derived deterministically from (kind, target) — the same
 * catalog seed always produces the same items in the same order.
 */

import {
  PROFICIENCY_LEVELS,
  QUALIFICATION_EVIDENCE_KINDS,
  isCapabilityNodeRefView,
  toCapabilityNodeRefView,
  capabilityNodeRefViewKey,
} from '@arena/expert-qualification';
import type {
  AvailabilityRecurrence,
  CapabilityNodeRefView,
  ProficiencyLevel,
  QualificationEvidenceKind,
} from '@arena/expert-qualification';
import type { DemandProfileView } from '@arena/escalation-routing';
import { EXPERT_INTAKE_ERROR_CODES, ExpertIntakeError } from './errors.js';
import { expectFields } from './shared.js';

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** The four interview item kinds (work order C003 — CLOSED). */
export const INTERVIEW_ITEM_KINDS = Object.freeze([
  'capability-probe',
  'experience-probe',
  'evidence-request',
  'scenario-item',
] as const);
export type InterviewItemKind = (typeof INTERVIEW_ITEM_KINDS)[number];

/** The closed answer-kind vocabulary every expected schema draws from. */
export const ANSWER_KINDS = Object.freeze([
  'proficiency-selection',
  'years-experience',
  'evidence-pointer',
  'scenario-response',
  'locale-declaration',
  'jurisdiction-declaration',
  'availability-window',
  'privacy-consent',
] as const);
export type AnswerKind = (typeof ANSWER_KINDS)[number];

/** Target node kinds an item may point at (competency kinds + tool + domain). */
export const ITEM_TARGET_KINDS = Object.freeze([
  'capability',
  'sub-capability',
  'skill',
  'expert-competency',
  'tool',
  'domain',
] as const);
export type ItemTargetKind = (typeof ITEM_TARGET_KINDS)[number];

/** Which ES1.0 routing input the item elicits (inspectability + scoring). */
export const ROUTING_INPUT_TAGS = Object.freeze([
  'capability',
  'experience',
  'evidence',
  'scenario',
  'locale',
  'jurisdiction',
  'availability',
  'privacy',
  'tool',
] as const);
export type RoutingInputTag = (typeof ROUTING_INPUT_TAGS)[number];

// ---------------------------------------------------------------------------
// Expected answer schemas (one discriminated member per answer kind)
// ---------------------------------------------------------------------------

export type ExpectedAnswerSchema =
  | { readonly answerKind: 'proficiency-selection'; readonly allowedLevels: readonly ProficiencyLevel[] }
  | { readonly answerKind: 'years-experience'; readonly minimumYears: number; readonly maximumYears: number }
  | { readonly answerKind: 'evidence-pointer'; readonly allowedEvidenceKinds: readonly QualificationEvidenceKind[] }
  | { readonly answerKind: 'scenario-response'; readonly maximumLength: number }
  | { readonly answerKind: 'locale-declaration'; readonly maximumLocales: number }
  | { readonly answerKind: 'jurisdiction-declaration'; readonly maximumJurisdictions: number }
  | { readonly answerKind: 'availability-window'; readonly requiredRecurrences: readonly AvailabilityRecurrence[] }
  | { readonly answerKind: 'privacy-consent'; readonly retentionDays: number };

// ---------------------------------------------------------------------------
// The interview item
// ---------------------------------------------------------------------------

/** Wire version of the interview item record shape. */
export const INTERVIEW_ITEM_VERSION = 1 as const;

export interface InterviewItem {
  readonly itemVersion: typeof INTERVIEW_ITEM_VERSION;
  /** Deterministic id: '<kind-prefix>:<target-key>' (stable across sessions). */
  readonly itemId: string;
  readonly kind: InterviewItemKind;
  /** The capability-graph node this item probes (undefined for session-level items). */
  readonly target?: CapabilityNodeRefView;
  /** The expected answer schema — what a well-formed answer looks like. */
  readonly expected: ExpectedAnswerSchema;
  /** The ES1.0 routing input this item contributes to. */
  readonly routingInput: RoutingInputTag;
}

const KIND_PREFIX: Readonly<Record<InterviewItemKind, string>> = Object.freeze({
  'capability-probe': 'cap',
  'experience-probe': 'exp',
  'evidence-request': 'evi',
  'scenario-item': 'sce',
});

function itemOf(
  kind: InterviewItemKind,
  routingInput: RoutingInputTag,
  expected: ExpectedAnswerSchema,
  target?: CapabilityNodeRefView,
  suffix?: string,
): InterviewItem {
  const tail = suffix ?? (target === undefined ? 'session' : capabilityNodeRefViewKey(target));
  return Object.freeze({
    itemVersion: INTERVIEW_ITEM_VERSION,
    itemId: `${KIND_PREFIX[kind]}:${tail}`,
    kind,
    ...(target !== undefined ? { target } : {}),
    expected: Object.freeze({ ...expected }) as ExpectedAnswerSchema,
    routingInput,
  });
}

// ---------------------------------------------------------------------------
// Catalog seeds
// ---------------------------------------------------------------------------

/**
 * The catalog seed: capability/tool refs to probe plus the routing-input
 * declarations the interview must capture. Derived from a C002
 * DemandProfile by `catalogFromDemandProfile` (the C002 vocabulary is the
 * seed — capability refs come pre-resolved over the A004 graph).
 */
export interface InterviewCatalogSeed {
  /** Competency refs to probe (A007 competency kinds). */
  readonly competencyRefs: readonly CapabilityNodeRefView[];
  /** Tool refs to probe experience against (C002 DemandProfile tool refs). */
  readonly toolRefs?: readonly CapabilityNodeRefView[];
  /** Optional domain anchor for scenario items. */
  readonly domainRef?: CapabilityNodeRefView;
  /** Locales the demand named (empty → a locale declaration is still asked). */
  readonly demandLocales?: readonly string[];
  /** Whether to ask the privacy-consent item (default true — required). */
  readonly askPrivacyConsent?: boolean;
}

/** Validate one catalog seed structurally (fail closed on bad refs). */
export function toInterviewCatalogSeed(value: unknown): InterviewCatalogSeed {
  const record = expectFields(
    value,
    ['competencyRefs'],
    ['toolRefs', 'domainRef', 'demandLocales', 'askPrivacyConsent'],
    EXPERT_INTAKE_ERROR_CODES.INVALID_ITEM,
    'interview catalog seed',
  );
  if (!Array.isArray(record['competencyRefs']) || record['competencyRefs'].length === 0) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ITEM, {
      message: 'interview catalog seed requires at least one competency ref to probe',
    });
  }
  const competencyRefs = (record['competencyRefs'] as readonly unknown[]).map((ref) => {
    if (!isCapabilityNodeRefView(ref)) {
      throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_REF, {
        message: 'catalog seed competency refs must be capability-node-ref views',
      });
    }
    return ref;
  });
  const toolRefs =
    record['toolRefs'] === undefined
      ? undefined
      : (record['toolRefs'] as readonly unknown[]).map((ref) => {
          // Tool refs are outside @arena/expert-qualification's competency
          // kind guard (kind === 'tool') — validated structurally here.
          if (typeof ref !== 'object' || ref === null) {
            throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_REF, {
              message: 'catalog seed tool refs must be capability-node-ref views of kind "tool"',
            });
          }
          const entry = ref as Record<string, unknown>;
          if (
            entry['kind'] !== 'tool' ||
            typeof entry['id'] !== 'string' ||
            !/^[a-z][a-z0-9-]{0,127}$/.test(entry['id']) ||
            typeof entry['version'] !== 'string' ||
            !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.test(entry['version']) ||
            typeof entry['digest'] !== 'string' ||
            !/^[0-9a-f]{64}$/.test(entry['digest'])
          ) {
            throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_REF, {
              message: 'catalog seed tool refs must be capability-node-ref views of kind "tool"',
            });
          }
          return Object.freeze({ kind: 'tool', id: entry['id'], version: entry['version'], digest: entry['digest'] }) as CapabilityNodeRefView;
        });
  const domainRef =
    record['domainRef'] === undefined
      ? undefined
      : toCapabilityNodeRefView(record['domainRef'] as { kind: string; id: string; version: string; digest: string });
  const demandLocales = record['demandLocales'] === undefined ? undefined : [...(record['demandLocales'] as readonly string[])];
  return Object.freeze({
    competencyRefs: Object.freeze([...competencyRefs]),
    ...(toolRefs !== undefined ? { toolRefs: Object.freeze([...toolRefs]) } : {}),
    ...(domainRef !== undefined ? { domainRef } : {}),
    ...(demandLocales !== undefined ? { demandLocales: Object.freeze([...demandLocales]) } : {}),
    ...(record['askPrivacyConsent'] !== undefined ? { askPrivacyConsent: record['askPrivacyConsent'] as boolean } : {}),
  });
}

/**
 * Derive the catalog seed from a compiled C002 DemandProfile — the C002
 * capability vocabulary (requiredCompetencyRefs, requiredToolRefs,
 * domainRef, locales) is exactly what the interview elicits against.
 */
export function catalogFromDemandProfile(profile: DemandProfileView): InterviewCatalogSeed {
  return toInterviewCatalogSeed({
    competencyRefs: profile.requiredCompetencyRefs,
    ...(profile.requiredToolRefs.length > 0 ? { toolRefs: profile.requiredToolRefs } : {}),
    ...(profile.domainRef !== undefined ? { domainRef: profile.domainRef } : {}),
    demandLocales: profile.locales,
    askPrivacyConsent: true,
  });
}

// ---------------------------------------------------------------------------
// Catalog construction (deterministic: same seed → same items, same order)
// ---------------------------------------------------------------------------

const MIN_YEARS = 0;
const MAX_YEARS = 50;
const MAX_RESPONSE_LENGTH = 2048;
const MAX_LOCALES = 8;
const MAX_JURISDICTIONS = 8;
const ALL_RECURRENCES: readonly AvailabilityRecurrence[] = ['daily', 'weekly', 'one-time'];
const TRANSCRIPT_RETENTION_DAYS = 365;

/**
 * Build the typed interview item catalog from a seed. Deterministic and
 * order-stable: capability probes (proficiency, experience, evidence) for
 * every competency ref, tool experience probes, one domain scenario item,
 * then the routing-input declaration items (locale, jurisdiction,
 * availability, privacy consent).
 */
export function buildInterviewCatalog(seed: InterviewCatalogSeed): readonly InterviewItem[] {
  const items: InterviewItem[] = [];

  for (const ref of seed.competencyRefs) {
    items.push(
      itemOf('capability-probe', 'capability', { answerKind: 'proficiency-selection', allowedLevels: [...PROFICIENCY_LEVELS] }, ref),
    );
    items.push(
      itemOf('experience-probe', 'experience', { answerKind: 'years-experience', minimumYears: MIN_YEARS, maximumYears: MAX_YEARS }, ref),
    );
    items.push(
      itemOf(
        'evidence-request',
        'evidence',
        { answerKind: 'evidence-pointer', allowedEvidenceKinds: [...QUALIFICATION_EVIDENCE_KINDS] },
        ref,
      ),
    );
  }

  for (const tool of seed.toolRefs ?? []) {
    items.push(
      itemOf('experience-probe', 'tool', { answerKind: 'years-experience', minimumYears: MIN_YEARS, maximumYears: MAX_YEARS }, tool),
    );
  }

  if (seed.domainRef !== undefined) {
    items.push(
      itemOf('scenario-item', 'scenario', { answerKind: 'scenario-response', maximumLength: MAX_RESPONSE_LENGTH }, seed.domainRef),
    );
  }

  items.push(itemOf('capability-probe', 'locale', { answerKind: 'locale-declaration', maximumLocales: MAX_LOCALES }, undefined, 'locale'));
  items.push(
    itemOf('capability-probe', 'jurisdiction', { answerKind: 'jurisdiction-declaration', maximumJurisdictions: MAX_JURISDICTIONS }, undefined, 'jurisdiction'),
  );
  items.push(itemOf('experience-probe', 'availability', { answerKind: 'availability-window', requiredRecurrences: [...ALL_RECURRENCES] }, undefined, 'availability'));
  items.push(itemOf('scenario-item', 'privacy', { answerKind: 'privacy-consent', retentionDays: TRANSCRIPT_RETENTION_DAYS }, undefined, 'privacy-consent'));

  // Deterministic order: by item id (kind prefix order above is already stable).
  items.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.itemId)) {
      throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ITEM, {
        message: `duplicate interview item id after catalog build: ${item.itemId}`,
        details: { itemId: item.itemId },
      });
    }
    seen.add(item.itemId);
  }
  if (seed.askPrivacyConsent === false) {
    return Object.freeze(items.filter((item) => item.routingInput !== 'privacy'));
  }
  return Object.freeze(items);
}

/** Structural (non-throwing) guard for an interview item. */
export function isInterviewItem(value: unknown): value is InterviewItem {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['itemVersion'] !== INTERVIEW_ITEM_VERSION ||
    typeof candidate['itemId'] !== 'string' ||
    !(INTERVIEW_ITEM_KINDS as readonly string[]).includes(candidate['kind'] as string) ||
    !(ROUTING_INPUT_TAGS as readonly string[]).includes(candidate['routingInput'] as string) ||
    typeof candidate['expected'] !== 'object' ||
    candidate['expected'] === null
  ) {
    return false;
  }
  const expected = candidate['expected'] as Record<string, unknown>;
  return (ANSWER_KINDS as readonly string[]).includes(expected['answerKind'] as string);
}

/** Look up one catalog item by id (fail closed with NOT_FOUND). */
export function catalogItemById(
  catalog: readonly InterviewItem[],
  itemId: string,
): InterviewItem {
  const item = catalog.find((candidate) => candidate.itemId === itemId);
  if (item === undefined) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.NOT_FOUND, {
      message: `no interview item with id ${JSON.stringify(itemId)} in this session's catalog`,
      details: { itemId },
    });
  }
  return item;
}
