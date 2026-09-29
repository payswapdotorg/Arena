/**
 * Certification verdict semantics (Work Order A023; spec AB1.0 design law —
 * Arena certifies statements of the form "Agent Body B, version V, possessed
 * by Cognitive Substrate M, under Environment E and Runtime Profile R,
 * satisfied Certification Suite S at revision X"; spec/quality-model.md
 * "Certification levels"; architecture-lock rule 4 — certification claims
 * apply to the composition under test, never to the underlying model in
 * isolation).
 *
 * The verdict vocabulary is CLOSED and totals exactly four members:
 *
 *   pass              — every required component (evaluation, verification,
 *                       compatibility) of the suite produced a `pass`
 *                       verdict AND no constraint was declared;
 *   conditional-pass  — every required component produced a `pass` verdict,
 *                       BUT at least one component declared a constraint the
 *                       consumer MUST honor when invoking the certified
 *                       composition (spec/quality-model.md "CONDITIONAL —
 *                       passes with declared constraints");
 *   fail              — at least one component produced a `fail` verdict;
 *   unknown           — at least one component produced an `unknown` verdict
 *                       OR the suite is misconfigured (zero components of
 *                       every kind — a suite that declares no checks can
 *                       never establish satisfaction).
 *
 * There is deliberately NO fifth outcome, NO numeric member and NO graded
 * member: a quantitative quality label is impossible by construction (the
 * verdict is DERIVED from the component-verdict summary by
 * deriveCertificationVerdict — a pure total function — and never accepted
 * from callers). The certification surface NEVER emits an unscoped
 * "unscoped-professional-claim" claim (the design law); the canonical CertificationRecord
 * carries a SCOPED CertificationStatement bound to the exact Body×Substrate×
 * Environment×RuntimeProfile×Suite composition under test.
 *
 * VerdictSemantics (per-suite): every CertificationSuiteDescriptor must
 * declare, in its own words, what pass / conditional-pass / fail / unknown
 * MEAN for that particular suite — all four declarations are mandatory,
 * non-empty neutral text.
 *
 * Unknown reasons (closed taxonomy): an `unknown` verdict MUST record WHY —
 *
 *   unverifiable-component  — at least one declared component produced an
 *                             `unknown` verdict (the suite cannot decide
 *                             satisfaction when one of its checks cannot);
 *   suite-misconfiguration  — the suite declares zero components of every
 *                             kind (a suite with no evaluations, no
 *                             verifications and no compatibility checks can
 *                             never establish satisfaction).
 *
 * Precedence when both unknown causes coexist: unverifiable-component >
 * suite-misconfiguration (deterministic, so the derived reason is a pure
 * function of the component summary).
 *
 * Component verdicts (the per-component input to derivation): CLOSED
 * three-member enum mirroring A012/A013 — `pass | fail | unknown`. There
 * is deliberately no quantitative or graded component verdict (lock rule 7).
 */

import { CERTIFICATION_ERROR_CODES, CertificationError } from './errors.js';
import {
  deepFreeze,
  expectEnumMember,
  expectFields,
  isContentDigest,
  isNeutralText,
  toNeutralText,
} from './shared.js';
import type { ContentDigest, NeutralText } from './shared.js';
import { isComponentKind, toComponentKind } from './component-kind.js';
import type { ComponentKind } from './component-kind.js';

/** The CLOSED certification verdict vocabulary — totals exactly four members. */
export const CERTIFICATION_VERDICTS = Object.freeze([
  'pass',
  'conditional-pass',
  'fail',
  'unknown',
] as const);

export type CertificationVerdict = (typeof CERTIFICATION_VERDICTS)[number];

/** Structural (non-throwing) check for the closed verdict enum. */
export function isCertificationVerdict(
  value: unknown,
): value is CertificationVerdict {
  return (
    typeof value === 'string' &&
    (CERTIFICATION_VERDICTS as readonly string[]).includes(value)
  );
}

/** Validate a certification verdict against the closed enum. */
export function toCertificationVerdict(
  value: string,
  context: string,
): CertificationVerdict {
  return expectEnumMember(
    value,
    CERTIFICATION_VERDICTS,
    'verdict',
    CERTIFICATION_ERROR_CODES.INVALID_VERDICT,
    context,
  );
}

// ---------------------------------------------------------------------------
// Component verdicts (per-suite-component inputs)
// ---------------------------------------------------------------------------

/** The CLOSED per-component verdict vocabulary — mirrors A012/A013 outcomes. */
export const COMPONENT_VERDICTS = Object.freeze(['pass', 'fail', 'unknown'] as const);

export type ComponentVerdict = (typeof COMPONENT_VERDICTS)[number];

/** Structural (non-throwing) check for the closed component-verdict enum. */
export function isComponentVerdict(value: unknown): value is ComponentVerdict {
  return (
    typeof value === 'string' &&
    (COMPONENT_VERDICTS as readonly string[]).includes(value)
  );
}

/** Validate a component verdict against the closed enum. */
export function toComponentVerdict(value: string, context: string): ComponentVerdict {
  return expectEnumMember(
    value,
    COMPONENT_VERDICTS,
    'verdict',
    CERTIFICATION_ERROR_CODES.INVALID_COMPONENT_VERDICT,
    context,
  );
}

// ---------------------------------------------------------------------------
// Component verdict summary — the per-component inputs to derivation
// ---------------------------------------------------------------------------

/**
 * One component's verdict within a certification run. A component is one
 * declared evaluation / verification / compatibility reference from the
 * suite; the engine resolves each ref against the supplied component
 * results, then derivation aggregates them into the certification verdict.
 *
 * `constraints` carries optional declared constraints a `pass` component
 * produced (a `conditional-pass` certification carries the union of all
 * such constraints — spec/quality-model.md "CONDITIONAL — passes with
 * declared constraints"). MUST be null when the verdict is not `pass`
 * (constraints are not permitted on `fail` or `unknown` components).
 */
export interface ComponentVerdictEntry {
  /** Which kind of sibling protocol the ref points to (closed enum). */
  readonly refKind: ComponentKind;
  /** sha256 content digest of the referenced sibling descriptor/record. */
  readonly refDigest: ContentDigest;
  /** The closed per-component verdict. */
  readonly verdict: ComponentVerdict;
  /** Declared constraints (a `pass` component may carry zero or more). */
  readonly constraints: readonly NeutralText[] | null;
  /** Optional free-form notes (method, capture context). */
  readonly notes: NeutralText | null;
}

/** Stable field list for one component verdict entry (tests + contracts mirror it). */
export const COMPONENT_VERDICT_ENTRY_FIELDS = Object.freeze([
  'refKind',
  'refDigest',
  'verdict',
  'constraints',
  'notes',
] as const) as readonly string[];

/** The component-verdict summary: one entry per declared suite component. */
export type ComponentVerdictSummary = readonly ComponentVerdictEntry[];

/** Structural (non-throwing) check for one component verdict entry. */
export function isComponentVerdictEntry(value: unknown): value is ComponentVerdictEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !isComponentKind(candidate['refKind']) ||
    !isContentDigest(candidate['refDigest']) ||
    !isComponentVerdict(candidate['verdict'])
  ) {
    return false;
  }
  const constraints = candidate['constraints'];
  if (constraints === null) {
    // null constraints are only allowed when the verdict is not 'pass'.
    if (candidate['verdict'] === 'pass') return false;
  } else if (Array.isArray(constraints)) {
    if (candidate['verdict'] !== 'pass') return false;
    for (const c of constraints) {
      if (!isNeutralText(c)) return false;
    }
  } else {
    return false;
  }
  const notes = candidate['notes'];
  return notes === null || isNeutralText(notes);
}

/** Structural (non-throwing) check for a non-empty summary of valid entries. */
export function isComponentVerdictSummary(value: unknown): value is ComponentVerdictSummary {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((entry) => isComponentVerdictEntry(entry));
}

/**
 * Validate and freeze a full component-verdict summary: non-empty, valid
 * entries, no unknown fields, unique (refKind, refDigest) keys. Same-key
 * duplicates are rejected as DUPLICATE_COMPONENT.
 */
export function toComponentVerdictSummary(value: unknown): ComponentVerdictSummary {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_COMPONENT_VERDICT, {
      message: 'a component-verdict summary must be a non-empty array of component verdict entries',
    });
  }
  const entries = value.map((entry, index) => toComponentVerdictEntry(entry, index));
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.refKind}:${entry.refDigest}`;
    if (seen.has(key)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.DUPLICATE_COMPONENT, {
        message: `duplicate component ref ${JSON.stringify(key)} in component-verdict summary`,
        details: { refKind: entry.refKind, refDigest: entry.refDigest },
      });
    }
    seen.add(key);
  }
  return Object.freeze(entries);
}

function toComponentVerdictEntry(value: unknown, index: number): ComponentVerdictEntry {
  const record = expectFields(
    value,
    ['refKind', 'refDigest', 'verdict', 'constraints', 'notes'],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_COMPONENT_VERDICT,
    `component verdict ${String(index + 1)}`,
  );
  const refKind = toComponentKind(
    typeof record['refKind'] === 'string' ? record['refKind'] : '',
    `component verdict ${String(index + 1)}`,
  );
  const refDigest = record['refDigest'];
  if (typeof refDigest !== 'string' || !isContentDigest(refDigest)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_DIGEST, {
      message: `component verdict ${String(index + 1)}: refDigest must be a content digest`,
    });
  }
  const verdict = toComponentVerdict(
    typeof record['verdict'] === 'string' ? record['verdict'] : '',
    `component verdict ${String(index + 1)}`,
  );
  const constraintsRaw = record['constraints'];
  if (constraintsRaw === null) {
    if (verdict === 'pass') {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_COMPONENT_VERDICT, {
        message: `component verdict ${String(index + 1)}: a 'pass' component must carry a constraints array (use [] for no constraints)`,
      });
    }
  } else if (!Array.isArray(constraintsRaw)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_COMPONENT_VERDICT, {
      message: `component verdict ${String(index + 1)}: constraints must be null or an array of neutral text`,
    });
  } else {
    if (verdict !== 'pass') {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_COMPONENT_VERDICT, {
        message: `component verdict ${String(index + 1)}: constraints are only permitted on 'pass' components (got verdict ${JSON.stringify(verdict)})`,
      });
    }
    for (const c of constraintsRaw) {
      if (!isNeutralText(c)) {
        throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_COMPONENT_VERDICT, {
          message: `component verdict ${String(index + 1)}: every constraint must be neutral text`,
        });
      }
    }
  }
  const notesRaw = record['notes'];
  if (notesRaw !== null && typeof notesRaw !== 'string') {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_COMPONENT_VERDICT, {
      message: `component verdict ${String(index + 1)}: notes must be neutral text or null`,
    });
  }
  return deepFreeze({
    refKind,
    refDigest: refDigest as ContentDigest,
    verdict,
    constraints:
      constraintsRaw === null
        ? null
        : Object.freeze((constraintsRaw as unknown[]).map((c) => c as NeutralText)),
    notes: notesRaw === null ? null : (notesRaw as NeutralText),
  });
}

// ---------------------------------------------------------------------------
// Declared per-suite verdict semantics (mirrors A013's OutcomeSemantics)
// ---------------------------------------------------------------------------

/**
 * The declared meaning of each verdict for THIS suite (spec AB1.0 design
 * law: a suite declares what each verdict establishes). All four are
 * mandatory non-empty neutral text — a descriptor that leaves any verdict's
 * meaning undeclared is rejected at construction.
 */
export interface VerdictSemantics {
  /** What `pass` establishes for this suite. */
  readonly pass: NeutralText;
  /** What `conditional-pass` establishes for this suite. */
  readonly 'conditional-pass': NeutralText;
  /** What `fail` establishes for this suite. */
  readonly fail: NeutralText;
  /** What `unknown` establishes for this suite. */
  readonly unknown: NeutralText;
}

/** Stable field list for verdict semantics (tests + contracts mirror it). */
export const VERDICT_SEMANTICS_FIELDS = Object.freeze([
  'pass',
  'conditional-pass',
  'fail',
  'unknown',
] as const) as readonly string[];

export interface VerdictSemanticsInput {
  readonly pass: string;
  readonly 'conditional-pass': string;
  readonly fail: string;
  readonly unknown: string;
}

/** Structural (non-throwing) check for declared verdict semantics. */
export function isVerdictSemantics(value: unknown): value is VerdictSemantics {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralText(candidate['pass']) &&
    isNeutralText(candidate['conditional-pass']) &&
    isNeutralText(candidate['fail']) &&
    isNeutralText(candidate['unknown'])
  );
}

/** Validate and freeze declared verdict semantics. */
export function toVerdictSemantics(value: unknown): VerdictSemantics {
  const record = expectFields(
    value,
    ['pass', 'conditional-pass', 'fail', 'unknown'],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_VERDICT,
    'suite verdict semantics',
  );
  return deepFreeze({
    pass: toNeutralText(
      typeof record['pass'] === 'string' ? record['pass'] : '',
      'verdict semantics pass',
    ),
    'conditional-pass': toNeutralText(
      typeof record['conditional-pass'] === 'string' ? record['conditional-pass'] : '',
      'verdict semantics conditional-pass',
    ),
    fail: toNeutralText(
      typeof record['fail'] === 'string' ? record['fail'] : '',
      'verdict semantics fail',
    ),
    unknown: toNeutralText(
      typeof record['unknown'] === 'string' ? record['unknown'] : '',
      'verdict semantics unknown',
    ),
  });
}

// ---------------------------------------------------------------------------
// Unknown reasons (closed taxonomy)
// ---------------------------------------------------------------------------

/** The CLOSED reason taxonomy for `unknown` verdicts. */
export const UNKNOWN_REASONS = Object.freeze([
  'unverifiable-component',
  'suite-misconfiguration',
] as const);

export type UnknownReason = (typeof UNKNOWN_REASONS)[number];

/** Stable field list for a derived unknown cause. */
export const UNKNOWN_CAUSE_FIELDS = Object.freeze(['reason', 'detail'] as const) as readonly string[];

/** The structured WHY of an `unknown` verdict (mandatory on unknown records). */
export interface UnknownCause {
  /** The closed reason taxonomy member. */
  readonly reason: UnknownReason;
  /** Deterministic detail: the component refs driving this cause, in summary order. */
  readonly detail: NeutralText;
}

/** Structural (non-throwing) check for the closed unknown-reason enum. */
export function isUnknownReason(value: unknown): value is UnknownReason {
  return (
    typeof value === 'string' &&
    (UNKNOWN_REASONS as readonly string[]).includes(value)
  );
}

/** Structural (non-throwing) check for a structured unknown cause. */
export function isUnknownCause(value: unknown): value is UnknownCause {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isUnknownReason(candidate['reason']) && isNeutralText(candidate['detail']);
}

// ---------------------------------------------------------------------------
// The pure verdict derivation (total by construction)
// ---------------------------------------------------------------------------

/**
 * Derive the certification verdict AND its structured unknown cause PURELY
 * from the component-verdict summary — the total heart of the protocol:
 *
 *   any component `unknown`            → unknown / unverifiable-component
 *   suite declares zero components     → unknown / suite-misconfiguration
 *   any component `fail`               → fail
 *   any pass component declares a      → conditional-pass
 *     constraint
 *   else (all pass, no constraints)    → pass
 *
 * Every possible summary maps to EXACTLY one verdict (totality property
 * test), and the verdict is one of the four closed members — there is no
 * input for which this function produces, or could produce, a numerical,
 * graded or unscoped professional-claim value. The unknown cause's detail
 * lists the component refs driving the selected reason, in summary order
 * (deterministic).
 *
 * The function NEVER returns a `pass` (or `conditional-pass`) for a summary
 * that carries an `unknown` or `fail` component — the design-law scope is
 * preserved by construction: a Body+Substrate+Environment+RuntimeProfile+
 * Suite composition only "satisfied" the suite when EVERY component
 * produced a positive (pass) verdict, optionally with declared constraints.
 */
export function deriveCertificationVerdict(
  summary: ComponentVerdictSummary,
): {
  readonly verdict: CertificationVerdict;
  readonly unknownCause: UnknownCause | null;
} {
  if (!isComponentVerdictSummary(summary)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_COMPONENT_VERDICT, {
      message: 'verdict derivation requires a structurally valid component-verdict summary',
    });
  }
  if (summary.length === 0) {
    // A suite with zero components — explicit suite-misconfiguration.
    return {
      verdict: 'unknown',
      unknownCause: deepFreeze({
        reason: 'suite-misconfiguration',
        detail: 'suite-misconfiguration: the suite declares zero components of every kind (no evaluation, verification or compatibility ref)' as NeutralText,
      }),
    };
  }
  // Precedence 1: ANY `unknown` component ⇒ unknown / unverifiable-component.
  const unverifiable = summary.filter((entry) => entry.verdict === 'unknown');
  if (unverifiable.length > 0) {
    return {
      verdict: 'unknown',
      unknownCause: deepFreeze({
        reason: 'unverifiable-component',
        detail: `unverifiable-component: ${unverifiable
          .map((entry) => `${entry.refKind}:${entry.refDigest.slice(0, 12)}`)
          .join(', ')}` as NeutralText,
      }),
    };
  }
  // Precedence 2: ANY `fail` component ⇒ fail.
  if (summary.some((entry) => entry.verdict === 'fail')) {
    return { verdict: 'fail', unknownCause: null };
  }
  // All `pass` now. Conditional-pass iff any component declares a constraint.
  const constrained = summary.filter(
    (entry) => entry.constraints !== null && entry.constraints.length > 0,
  );
  if (constrained.length > 0) {
    return { verdict: 'conditional-pass', unknownCause: null };
  }
  return { verdict: 'pass', unknownCause: null };
}
