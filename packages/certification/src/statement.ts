/**
 * CertificationStatement — THE DESIGN LAW, enforced by construction
 * (Work Order A023; README "Design law"; requirements R21, R43, R46;
 * architecture-lock rules 4, 23).
 *
 * Arena certifies statements of the form:
 *
 *   "Agent Body B, version V, possessed by Cognitive Substrate M,
 *    under Environment E and Runtime Profile R, satisfied
 *    Certification Suite S at revision X."
 *
 * Arena does NOT certify that M alone is a professional (lock rule 4;
 * R46 — prevent professional qualification inference from substrate
 * certification alone). Enforcement:
 *
 *   - the statement carries ALL FIVE scope components (body, substrate,
 *     environment, runtime, suite) plus the suite revision (the suite
 *     digest) — renderCertificationStatement REFUSES to render when any
 *     component is missing (CERTIFICATION_UNSCOPED_STATEMENT), so an
 *     unscoped claim is unrepresentable;
 *   - the statement is DERIVED from the subject + suite + verdict by
 *     the record constructor — NEVER caller-supplied;
 *   - every statement carries the professional-limitations notice
 *     (lock rule 23; spec/quality-model.md "Professional limitations"),
 *     either the suite's declared notice or the mandated default;
 *   - the verdict qualifier renders the honest outcome: "satisfied" |
 *     "did not satisfy" | "could not be determined against".
 */

import { CERTIFICATION_ERROR_CODES, CertificationError } from './errors.js';
import type { CertificationLevel } from './level.js';
import type { CertificationSubject } from './subject.js';
import type { CertificationSuite } from './suite.js';
import { DEFAULT_CERTIFICATION_LIMITATIONS } from './suite.js';
import type { CertificationVerdict } from './outcome.js';
import { deepFreeze, isNeutralText, toNeutralText } from './shared.js';
import type { NeutralText } from './shared.js';

/** Wire version of the certification-statement shape. */
export const CERTIFICATION_STATEMENT_VERSION = 1 as const;

/** The verdict qualifier rendering (closed mapping verdict → text). */
export const VERDICT_QUALIFIERS = Object.freeze({
  satisfied: 'satisfied',
  'not-satisfied': 'did not satisfy',
  unknown: 'could not be determined against',
} as const) as Readonly<Record<CertificationVerdict, string>>;

/** The digest-free statement scope — all five components, always. */
export interface CertificationStatementScope {
  /** Agent Body identity: B (tenant/name). */
  readonly body: string;
  /** Agent Body version: V. */
  readonly bodyVersion: string;
  /** Cognitive Substrate identity: M. */
  readonly substrate: string;
  /** Cognitive Substrate version. */
  readonly substrateVersion: string;
  /** Environment identity: E. */
  readonly environment: string;
  /** Environment version. */
  readonly environmentVersion: string;
  /** Runtime Profile identity: R. */
  readonly runtime: string;
  /** Runtime Profile version. */
  readonly runtimeVersion: string;
  /** Certification Suite identity: S (suiteId). */
  readonly suite: string;
  /** Certification Suite version. */
  readonly suiteVersion: string;
}

/** Stable field list for the statement scope (tests + contracts mirror it). */
export const CERTIFICATION_STATEMENT_SCOPE_FIELDS = Object.freeze([
  'body',
  'bodyVersion',
  'substrate',
  'substrateVersion',
  'environment',
  'environmentVersion',
  'runtime',
  'runtimeVersion',
  'suite',
  'suiteVersion',
] as const) as readonly string[];

/** The full scoped certification statement. */
export interface CertificationStatement {
  readonly statementVersion: typeof CERTIFICATION_STATEMENT_VERSION;
  /** All five scope components + versions — the B/V/M/E/R/S of the law. */
  readonly scope: CertificationStatementScope;
  /** The suite revision X — the content digest of the exact suite. */
  readonly suiteRevision: string;
  /** The verdict qualifier (satisfied | did not satisfy | could not be determined against). */
  readonly verdictQualifier: string;
  /** The granted level (null when the run granted nothing). */
  readonly grantedLevel: CertificationLevel | null;
  /** The declared constraints (empty for unconditional). */
  readonly constraints: readonly string[];
  /** The professional-limitations notice (lock rule 23; never null). */
  readonly limitations: NeutralText;
  /** The rendered canonical statement text. */
  readonly text: string;
}

/** Stable field list for the statement (tests + contracts mirror it). */
export const CERTIFICATION_STATEMENT_FIELDS = Object.freeze([
  'statementVersion',
  'scope',
  'suiteRevision',
  'verdictQualifier',
  'grantedLevel',
  'constraints',
  'limitations',
  'text',
] as const) as readonly string[];

/** Structural (non-throwing) check for the statement scope — all five components. */
export function isCertificationStatementScope(
  value: unknown,
): value is CertificationStatementScope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  for (const field of CERTIFICATION_STATEMENT_SCOPE_FIELDS) {
    const component = candidate[field];
    if (typeof component !== 'string' || component.length === 0) return false;
  }
  return true;
}

/** Structural (non-throwing) check for the full statement. */
export function isCertificationStatement(value: unknown): value is CertificationStatement {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['statementVersion'] === CERTIFICATION_STATEMENT_VERSION &&
    isCertificationStatementScope(candidate['scope']) &&
    typeof candidate['suiteRevision'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['suiteRevision']) &&
    typeof candidate['verdictQualifier'] === 'string' &&
    candidate['verdictQualifier'].length > 0 &&
    (candidate['grantedLevel'] === null || typeof candidate['grantedLevel'] === 'string') &&
    Array.isArray(candidate['constraints']) &&
    typeof candidate['limitations'] === 'string' &&
    candidate['limitations'].length > 0 &&
    typeof candidate['text'] === 'string' &&
    candidate['text'].length > 0
  );
}

/**
 * DERIVE the scoped statement from the composition under test, the
 * suite and the derived verdict. Pure and total: the scope is read off
 * the subject + suite (every component already validated by their own
 * constructors); the verdict qualifier is the closed rendering; the
 * limitations notice is the suite's declared notice or the mandated
 * default; the text is the canonical sentence of the design law.
 *
 * This function takes NO free text from its caller — the only way to
 * produce a statement is from a fully-scoped subject and suite.
 */
export function deriveCertificationStatement(
  subject: CertificationSubject,
  suite: CertificationSuite,
  verdict: CertificationVerdict,
  grantedLevel: CertificationLevel | null,
): CertificationStatement {
  if (!subject || !suite) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.UNSCOPED_STATEMENT, {
      message: 'a certification statement requires both the composition under test and the certification suite (an unscoped statement is unrepresentable)',
    });
  }
  const qualifier = VERDICT_QUALIFIERS[verdict];
  if (qualifier === undefined) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_VERDICT, {
      message: `cannot render a certification statement for verdict ${JSON.stringify(verdict)} (closed vocabulary)`,
    });
  }
  const scope: CertificationStatementScope = {
    body: `${subject.bodyVersionRef.tenant}/${subject.bodyVersionRef.name}`,
    bodyVersion: subject.bodyVersionRef.version,
    substrate: subject.substrateRef.substrateId,
    substrateVersion: subject.substrateRef.substrateVersion,
    environment: subject.environmentRef.environmentId,
    environmentVersion: subject.environmentRef.environmentVersion,
    runtime: subject.runtimeProfile.runtimeId,
    runtimeVersion: subject.runtimeProfile.runtimeVersion,
    suite: suite.suiteId,
    suiteVersion: suite.version,
  };
  // The scope tripwire: every component must be present and non-empty —
  // a statement about M alone (or with any component absent) is
  // unrepresentable (the design law).
  for (const field of CERTIFICATION_STATEMENT_SCOPE_FIELDS) {
    const component = scope[field as keyof typeof scope] as unknown;
    if (typeof component !== 'string' || component.length === 0) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.UNSCOPED_STATEMENT, {
        message: `certification statement: scope component '${field}' is empty — Arena certifies the full composition, never a component in isolation`,
        details: { field },
      });
    }
  }
  const limitations = suite.limitations ?? DEFAULT_CERTIFICATION_LIMITATIONS;
  if (!isNeutralText(limitations)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_LIMITATIONS, {
      message: 'certification statement: the limitations notice must be neutral text',
    });
  }
  const constraintsText =
    suite.constraints.length > 0 ? ` (conditional: ${suite.constraints.join('; ')})` : '';
  const levelText = grantedLevel === null ? '' : ` Level granted: ${grantedLevel}.`;
  const text =
    `Agent Body ${scope.body}, version ${scope.bodyVersion}, possessed by Cognitive ` +
    `Substrate ${scope.substrate}, under Environment ${scope.environment} and Runtime ` +
    `Profile ${scope.runtime}, ${qualifier} Certification Suite ${scope.suite} at ` +
    `revision ${suite.digest}.${constraintsText}${levelText} ${limitations}`;
  const statement: CertificationStatement = {
    statementVersion: CERTIFICATION_STATEMENT_VERSION,
    scope,
    suiteRevision: suite.digest,
    verdictQualifier: qualifier,
    grantedLevel,
    constraints: Object.freeze([...suite.constraints]),
    limitations: toNeutralText(limitations, 'certification statement limitations'),
    text,
  };
  return deepFreeze(statement);
}

/** The canonical scope key of a statement (uniqueness/dedup). */
export function certificationStatementScopeKey(statement: CertificationStatement): string {
  return Object.values(statement.scope as unknown as Record<string, string>).join('|');
}
