/**
 * CertificationStatement — the SCOPED statement form mandated by the
 * design law (Work Order A023; spec AB1.0 design law: "Arena certifies
 * statements of the form: Agent Body B, version V, possessed by Cognitive
 * Substrate M, under Environment E and Runtime Profile R, satisfied
 * Certification Suite S at revision X. Arena does NOT certify that M
 * alone an unscoped professional scope claim.").
 *
 * The statement is a STRUCTURED OBJECT, not a free-form string: every
 * field is content-addressed or strictly validated, every ref resolves to
 * an A002/A003/A012/A013/A022 artifact/descriptor/record the engine
 * resolved before issuing the statement, and the scope is TOTAL: the
 * statement carries Body×Substrate×Environment×RuntimeProfile×Suite+Rev
 * — NEVER an unscoped professional claim, NEVER a "M is a software
 * engineer" / "M an unscoped structural-engineer claim" claim (the design law).
 *
 * Statement verdict form: the statement carries the derived certification
 * verdict (`pass | conditional-pass | fail | unknown`) for THE EXACT
 * composition under test — i.e. "satisfied" iff verdict === 'pass' OR
 * verdict === 'conditional-pass' (with declared constraints), and
 * otherwise the statement records the verdict (failed / could-not-decide)
 * honestly.
 *
 * A statement object is DERIVED PURELY from a CertificationRecord at the
 * record constructor's call site; there is NO mutation API and NO
 * caller-supplied statement input. The canonical-form JSON of a statement
 * is what the engine embeds into the record view for digest stability.
 */

import { CERTIFICATION_ERROR_CODES, CertificationError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  isContentDigest,
  isNeutralText,
  toContentDigest,
  toNeutralText,
  toSuiteRevision,
} from './shared.js';
import type { ContentDigest, NeutralText, SuiteRevision } from './shared.js';
import type { CertificationVerdict } from './verdict.js';
import { isCertificationVerdict } from './verdict.js';

/** The closed statement verdict vocabulary — same as CertificationVerdict. */
export const STATEMENT_VERDICTS = Object.freeze([
  'pass',
  'conditional-pass',
  'fail',
  'unknown',
] as const);

/**
 * The SCOPED certification statement (the design law): the design-law
 * statement form, captured as a structured object — Body×Substrate×
 * Environment×RuntimeProfile×Suite+Rev×Verdict — never an unscoped
 * "unscoped-professional-claim" claim.
 */
export interface CertificationStatement {
  /** Body B version V — the digest of the A003 BodyVersion under test. */
  readonly bodyVersionRef: ContentDigest;
  /** Cognitive Substrate M — the digest of the A003 CognitiveSubstrate. */
  readonly substrateRef: ContentDigest;
  /** Environment E — the digest of the A009 EnvironmentDefinition. */
  readonly environmentRef: ContentDigest;
  /** Runtime Profile R — the digest of the A003 runtime profile view. */
  readonly runtimeProfileRef: ContentDigest;
  /** The A003 Possession digest binding B+M+E+R+policies+artifacts together. */
  readonly possessionRef: ContentDigest;
  /** Certification Suite S — the digest of the suite descriptor. */
  readonly suiteRef: ContentDigest;
  /** The suite's content-addressed revision (= suiteRef; named per the design law). */
  readonly suiteRevision: SuiteRevision;
  /** The derived certification verdict for this composition. */
  readonly verdict: CertificationVerdict;
  /**
   * The rendered, scoped statement form. ALWAYS carries the full Body×
   * Substrate×Environment×RuntimeProfile×Suite+Rev scope — an unscoped
   * professional claim (e.g. "M an unscoped software-engineer claim") is structurally
   * impossible (the design-law negative; see hygiene suite).
   */
  readonly statementText: NeutralText;
  /** Declared constraints when verdict === 'conditional-pass'; [] otherwise. */
  readonly constraints: readonly NeutralText[];
}

/** Stable field list for a statement (tests + contracts mirror it). */
export const CERTIFICATION_STATEMENT_FIELDS = Object.freeze([
  'bodyVersionRef',
  'substrateRef',
  'environmentRef',
  'runtimeProfileRef',
  'possessionRef',
  'suiteRef',
  'suiteRevision',
  'verdict',
  'statementText',
  'constraints',
] as const) as readonly string[];

/** Structural (non-throwing) check for a statement. */
export function isCertificationStatement(
  value: unknown,
): value is CertificationStatement {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !isContentDigest(candidate['bodyVersionRef']) ||
    !isContentDigest(candidate['substrateRef']) ||
    !isContentDigest(candidate['environmentRef']) ||
    !isContentDigest(candidate['runtimeProfileRef']) ||
    !isContentDigest(candidate['possessionRef']) ||
    !isContentDigest(candidate['suiteRef']) ||
    !isContentDigest(candidate['suiteRevision']) ||
    !isCertificationVerdict(candidate['verdict']) ||
    !isNeutralText(candidate['statementText']) ||
    !Array.isArray(candidate['constraints'])
  ) {
    return false;
  }
  for (const c of candidate['constraints'] as unknown[]) {
    if (!isNeutralText(c)) return false;
  }
  return true;
}

/**
 * The closed design-law statement template. Substituted with the actual
 * refs at record-construction time. The template MUST carry all six scope
 * fields; the substitution is deterministic (digests are sha256 hex).
 *
 * Placeholders (substituted in this order):
 *   {bodyVersionRef} {substrateRef} {environmentRef} {runtimeProfileRef}
 *   {suiteRef} {suiteRevision} {verdict}
 */
export const STATEMENT_TEMPLATE =
  'Agent Body B, version V (digest {bodyVersionRef}), possessed by Cognitive ' +
  'Substrate M (digest {substrateRef}), under Environment E (digest {environmentRef}) ' +
  'and Runtime Profile R (digest {runtimeProfileRef}), satisfied Certification Suite S ' +
  '(digest {suiteRef}) at revision X ({suiteRevision}); verdict: {verdict}.';

/**
 * Render the scoped statement text from a tuple of refs + verdict.
 * Pure deterministic; the template carries every design-law field.
 */
export function renderStatementText(input: {
  readonly bodyVersionRef: string;
  readonly substrateRef: string;
  readonly environmentRef: string;
  readonly runtimeProfileRef: string;
  readonly possessionRef: string;
  readonly suiteRef: string;
  readonly suiteRevision: string;
  readonly verdict: CertificationVerdict;
}): NeutralText {
  for (const [name, value] of Object.entries({
    bodyVersionRef: input.bodyVersionRef,
    substrateRef: input.substrateRef,
    environmentRef: input.environmentRef,
    runtimeProfileRef: input.runtimeProfileRef,
    possessionRef: input.possessionRef,
    suiteRef: input.suiteRef,
    suiteRevision: input.suiteRevision,
  })) {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STATEMENT, {
        message: `statement rendering requires a content digest in '${name}'; got ${JSON.stringify(value)}`,
        details: { field: name },
      });
    }
  }
  const text = STATEMENT_TEMPLATE
    .replace('{bodyVersionRef}', input.bodyVersionRef)
    .replace('{substrateRef}', input.substrateRef)
    .replace('{environmentRef}', input.environmentRef)
    .replace('{runtimeProfileRef}', input.runtimeProfileRef)
    .replace('{suiteRef}', input.suiteRef)
    .replace('{suiteRevision}', input.suiteRevision)
    .replace('{verdict}', input.verdict);
  // Verify the rendered text is well-formed neutral text.
  return toNeutralText(text, 'rendered certification statement text');
}

/** The statement verdict the design law uses to phrase "satisfied". */
export function statementVerdictFor(
  verdict: string,
): CertificationVerdict {
  if (!isCertificationVerdict(verdict)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_VERDICT, {
      message: `statement verdict requires a closed certification verdict, got ${JSON.stringify(verdict)}`,
    });
  }
  return verdict;
}

/**
 * Build a deep-frozen CertificationStatement from the design-law tuple +
 * derived verdict + optional constraints list. Pure: same inputs ⇒ same
 * statement. The statement text is RENDERED here, not caller-supplied —
 * a caller cannot inject an unscoped professional claim.
 */
export function buildCertificationStatement(input: {
  readonly bodyVersionRef: string;
  readonly substrateRef: string;
  readonly environmentRef: string;
  readonly runtimeProfileRef: string;
  readonly possessionRef: string;
  readonly suiteRef: string;
  readonly suiteRevision: string;
  readonly verdict: CertificationVerdict;
  readonly constraints: readonly string[];
}): CertificationStatement {
  const record = expectFields(
    input,
    [
      'bodyVersionRef',
      'substrateRef',
      'environmentRef',
      'runtimeProfileRef',
      'possessionRef',
      'suiteRef',
      'suiteRevision',
      'verdict',
      'constraints',
    ],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_STATEMENT,
    'certification statement',
  );
  const bodyVersionRef = toContentDigest(
    typeof record['bodyVersionRef'] === 'string' ? record['bodyVersionRef'] : '',
    'statement bodyVersionRef',
  );
  const substrateRef = toContentDigest(
    typeof record['substrateRef'] === 'string' ? record['substrateRef'] : '',
    'statement substrateRef',
  );
  const environmentRef = toContentDigest(
    typeof record['environmentRef'] === 'string' ? record['environmentRef'] : '',
    'statement environmentRef',
  );
  const runtimeProfileRef = toContentDigest(
    typeof record['runtimeProfileRef'] === 'string' ? record['runtimeProfileRef'] : '',
    'statement runtimeProfileRef',
  );
  const possessionRef = toContentDigest(
    typeof record['possessionRef'] === 'string' ? record['possessionRef'] : '',
    'statement possessionRef',
  );
  const suiteRef = toContentDigest(
    typeof record['suiteRef'] === 'string' ? record['suiteRef'] : '',
    'statement suiteRef',
  );
  const suiteRevision = toSuiteRevision(
    typeof record['suiteRevision'] === 'string' ? record['suiteRevision'] : '',
    'statement suiteRevision',
  );
  const verdict = statementVerdictFor(
    typeof record['verdict'] === 'string' ? record['verdict'] : '',
  );
  const constraintsRaw = record['constraints'];
  if (!Array.isArray(constraintsRaw)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STATEMENT, {
      message: 'statement constraints must be an array of neutral text',
    });
  }
  // Conditional-pass requires constraints is permissive here (a constraint
  // list of length 0 is also valid; the verdict-derivation total function
  // decides conditional-pass when at least one component declared a
  // constraint — the statement carries the union here).
  const constraints = constraintsRaw.map((c, i) =>
    toNeutralText(
      typeof c === 'string' ? c : '',
      `statement constraint ${String(i + 1)}`,
    ),
  );
  const statementText = renderStatementText({
    bodyVersionRef,
    substrateRef,
    environmentRef,
    runtimeProfileRef,
    possessionRef,
    suiteRef,
    suiteRevision,
    verdict,
  });
  return deepFreeze({
    bodyVersionRef,
    substrateRef,
    environmentRef,
    runtimeProfileRef,
    possessionRef,
    suiteRef,
    suiteRevision,
    verdict,
    statementText,
    constraints: Object.freeze(constraints),
  }) as CertificationStatement;
}
