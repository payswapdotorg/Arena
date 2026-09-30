/**
 * Model data governance (Work Order A034; spec/security.md S1.0 "Model
 * data": "Input/output retention is configurable by tenant and task
 * policy" and "Secrets never enter generic trajectories").
 *
 * Two pieces:
 *
 *   1. ModelDataPolicy — per-tenant (+ optional per-task) input/output
 *      retention configuration and a default data classification, all
 *      closed vocabularies and structured retention (reusing the
 *      data-rights retention shapes);
 *   2. Secret discipline — pure detection/scrubbing of
 *      credential-shaped content. detectSecrets returns structured
 *      findings with a closed kind vocabulary; scrubSecrets returns a
 *      redacted copy plus the findings; assertNoSecretsForTrajectory
 *      throws typed SECURITY_SECRET_DETECTED — the fail-closed gate in
 *      front of generic trajectory storage.
 *
 * PUSH-PROTECTION DISCIPLINE: the detection PATTERNS here are regex
 * SOURCES (character classes and quantifiers — no literal secret
 * shapes), and every credential-shaped TEST FIXTURE in this repository
 * is assembled at RUNTIME from string fragments so no realistic secret
 * shape ever appears in committed source.
 */

import { SECURITY_ERROR_CODES, SecurityError } from './errors.js';
import { deepFreeze, expectEnumMember, expectFields, isEnumMember } from './shared.js';
import { toNeutralId, toTenantId } from './shared.js';
import type { NeutralId, TenantId } from './shared.js';
import { retentionExpiry, toRetentionPolicy } from './data-rights.js';
import type { RetentionPolicy } from './data-rights.js';

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** The closed model-data classification vocabulary. */
export const MODEL_DATA_CLASSIFICATIONS = Object.freeze([
  'public',
  'tenant-internal',
  'sensitive',
] as const);
export type ModelDataClassification = (typeof MODEL_DATA_CLASSIFICATIONS)[number];

/** The closed secret-kind vocabulary (detection findings). */
export const SECRET_KINDS = Object.freeze([
  'github-token',
  'api-key-prefix',
  'aws-access-key-id',
  'private-key-block',
  'generic-bearer',
] as const);
export type SecretKind = (typeof SECRET_KINDS)[number];

export function isModelDataClassification(value: unknown): value is ModelDataClassification {
  return isEnumMember(value, MODEL_DATA_CLASSIFICATIONS);
}

// ---------------------------------------------------------------------------
// Model data policy
// ---------------------------------------------------------------------------

/** Wire version of the model data policy shape. */
export const MODEL_DATA_POLICY_VERSION = 1 as const;

/**
 * Per-tenant (and optionally per-task) model data governance: input
 * retention, output retention and the default classification for model
 * interactions recorded under this policy. Retention modes reuse the
 * structured data-rights retention vocabulary ('none' is a legitimate,
 * explicit choice — no silent defaults).
 */
export interface ModelDataPolicy {
  readonly recordVersion: typeof MODEL_DATA_POLICY_VERSION;
  readonly policyId: NeutralId;
  readonly tenantId: TenantId;
  readonly taskPolicyRef: NeutralId | null;
  readonly inputRetention: RetentionPolicy;
  readonly outputRetention: RetentionPolicy;
  readonly defaultClassification: ModelDataClassification;
}

const POLICY_CONTEXT = 'ModelDataPolicy';

export function isModelDataPolicy(value: unknown): value is ModelDataPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== MODEL_DATA_POLICY_VERSION) return false;
  if (typeof record['policyId'] !== 'string') return false;
  if (typeof record['tenantId'] !== 'string') return false;
  if (record['taskPolicyRef'] !== null && typeof record['taskPolicyRef'] !== 'string') {
    return false;
  }
  if (!isModelDataClassification(record['defaultClassification'])) return false;
  return true;
}

export function toModelDataPolicy(value: unknown): ModelDataPolicy {
  const record = expectFields(
    value,
    [
      'recordVersion',
      'policyId',
      'tenantId',
      'taskPolicyRef',
      'inputRetention',
      'outputRetention',
      'defaultClassification',
    ],
    [],
    SECURITY_ERROR_CODES.INVALID_MODEL_DATA_POLICY,
    POLICY_CONTEXT,
  );
  if (record['recordVersion'] !== MODEL_DATA_POLICY_VERSION) {
    throw new SecurityError(SECURITY_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `${POLICY_CONTEXT}: unsupported recordVersion: ${String(record['recordVersion'])}`,
    });
  }
  const policyId = toNeutralId(String(record['policyId']), `${POLICY_CONTEXT}.policyId`);
  const tenantId = toTenantId(String(record['tenantId']), `${POLICY_CONTEXT}.tenantId`);
  const taskPolicyRef =
    record['taskPolicyRef'] === null || record['taskPolicyRef'] === undefined
      ? null
      : toNeutralId(String(record['taskPolicyRef']), `${POLICY_CONTEXT}.taskPolicyRef`);
  const inputRetention = toRetentionPolicy(record['inputRetention']);
  const outputRetention = toRetentionPolicy(record['outputRetention']);
  const defaultClassification = expectEnumMember(
    record['defaultClassification'],
    MODEL_DATA_CLASSIFICATIONS,
    'defaultClassification',
    SECURITY_ERROR_CODES.INVALID_MODEL_DATA_POLICY,
    POLICY_CONTEXT,
  );
  return deepFreeze({
    recordVersion: MODEL_DATA_POLICY_VERSION,
    policyId,
    tenantId,
    taskPolicyRef,
    inputRetention,
    outputRetention,
    defaultClassification,
  });
}

// ---------------------------------------------------------------------------
// Secret detection (pure; pattern SOURCES only — no literal secrets)
// ---------------------------------------------------------------------------

/**
 * Detection pattern sources. Each is a regex over character classes and
 * quantifiers; the credential PREFIXES are themselves assembled from
 * fragments at module load so that no realistic token-shaped literal is
 * present in the committed source (GitHub push protection discipline —
 * see the work-order rule; test fixtures go further and assemble full
 * fake credentials at RUNTIME).
 */
const GH_TOKEN_PREFIX = ['gh', 'p', '_'].join('');
const SK_KEY_PREFIX = ['sk', '-'].join('');
const OPENAI_KEY_PREFIX = ['sk', '-pro', 'j-'].join('');
const AWS_KEY_PREFIX = ['AK', 'IA'].join('');
const BEARER_PREFIX = ['Bea', 'rer '].join('');

interface SecretPattern {
  readonly kind: SecretKind;
  readonly pattern: RegExp;
}

/**
 * The closed detection pattern set. Thresholds are deliberately
 * conservative-but-meaningful (GitHub personal-access tokens are 20+
 * chars after the prefix by format; AWS access key ids are exactly 20
 * uppercase alphanumerics after the AKIA prefix).
 */
const SECRET_PATTERNS: readonly SecretPattern[] = Object.freeze(
  [
    {
      kind: 'github-token',
      pattern: new RegExp(`${GH_TOKEN_PREFIX}[A-Za-z0-9]{16,}`),
    },
    {
      kind: 'api-key-prefix',
      pattern: new RegExp(`(?:${SK_KEY_PREFIX}|${OPENAI_KEY_PREFIX})[A-Za-z0-9_-]{16,}`),
    },
    {
      kind: 'aws-access-key-id',
      pattern: new RegExp(`${AWS_KEY_PREFIX}[A-Z0-9]{18}`),
    },
    {
      kind: 'private-key-block',
      pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    },
    {
      kind: 'generic-bearer',
      pattern: new RegExp(`${BEARER_PREFIX}[A-Za-z0-9._~+/-]{16,}={0,2}`),
    },
  ] as const,
);

/** One structured secret finding (closed kind, redacted preview). */
export interface SecretFinding {
  readonly kind: SecretKind;
  /** The matched substring, REDACTED to its first 4 characters. */
  readonly preview: string;
  /** 0-based index of the match in the scanned text. */
  readonly index: number;
}

export function isSecretFinding(value: unknown): value is SecretFinding {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!isEnumMember(record['kind'], SECRET_KINDS)) return false;
  if (typeof record['preview'] !== 'string') return false;
  if (typeof record['index'] !== 'number') return false;
  return true;
}

/** Pure scan: every credential-shaped match in the text, redacted. */
export function detectSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const { kind, pattern } of SECRET_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, 'g'))) {
      const matched = match[0];
      const index = match.index ?? 0;
      findings.push(
        deepFreeze({
          kind,
          preview: `${matched.slice(0, 4)}[REDACTED:${String(matched.length - 4)}]`,
          index,
        }),
      );
    }
  }
  return findings.sort((a, b) => a.index - b.index);
}

/** True iff the text contains any credential-shaped content. */
export function containsSecrets(text: string): boolean {
  return detectSecrets(text).length > 0;
}

/** The redaction marker used by scrubSecrets. */
export const SECRET_REDACTION_MARKER = '[REDACTED-SECRET]';

/** Pure scrub: redact every credential-shaped match in the text. */
export function scrubSecrets(text: string): { readonly scrubbed: string; readonly findings: readonly SecretFinding[] } {
  let result = text;
  const findings = detectSecrets(text);
  for (const { pattern } of SECRET_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, 'g'), SECRET_REDACTION_MARKER);
  }
  return deepFreeze({ scrubbed: result, findings: Object.freeze([...findings]) });
}

/**
 * The fail-closed trajectory gate: throws typed SECURITY_SECRET_DETECTED
 * if the text contains any credential-shaped content. Secrets never
 * enter generic trajectories — this is the guard form of that law.
 */
export function assertNoSecretsForTrajectory(text: string, context: string): void {
  const findings = detectSecrets(text);
  if (findings.length > 0) {
    throw new SecurityError(SECURITY_ERROR_CODES.SECRET_DETECTED, {
      message: `${context}: ${String(findings.length)} credential-shaped finding(s) detected — secrets never enter generic trajectories (scrub first via scrubSecrets)`,
      details: {
        context,
        findings: findings.map((finding) => ({
          kind: finding.kind,
          index: finding.index,
        })),
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Model interaction classification
// ---------------------------------------------------------------------------

/** Wire version of the classified interaction shape. */
export const CLASSIFIED_INTERACTION_VERSION = 1 as const;

/** The classification result of one model input/output. */
export interface ClassifiedInteraction {
  readonly recordVersion: typeof CLASSIFIED_INTERACTION_VERSION;
  readonly classification: ModelDataClassification;
  readonly scrubbed: boolean;
  readonly findingKinds: readonly SecretKind[];
}

export function isClassifiedInteraction(value: unknown): value is ClassifiedInteraction {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== CLASSIFIED_INTERACTION_VERSION) return false;
  if (!isModelDataClassification(record['classification'])) return false;
  if (typeof record['scrubbed'] !== 'boolean') return false;
  if (!Array.isArray(record['findingKinds'])) return false;
  return true;
}

/**
 * Classify one model interaction against a policy: content bearing
 * credential shapes is ALWAYS 'sensitive' (and must be scrubbed before
 * trajectory storage); otherwise the policy's default classification
 * applies. Pure, total, never throws on content.
 */
export function classifyModelInteraction(
  policy: ModelDataPolicy,
  content: string,
): ClassifiedInteraction {
  const findings = detectSecrets(content);
  const kinds = [...new Set(findings.map((finding) => finding.kind))];
  const classification: ModelDataClassification =
    kinds.length > 0 ? 'sensitive' : policy.defaultClassification;
  return deepFreeze({
    recordVersion: CLASSIFIED_INTERACTION_VERSION,
    classification,
    scrubbed: kinds.length === 0,
    findingKinds: Object.freeze([...kinds]),
  });
}

/**
 * Retention projection for a model interaction: which retention policy
 * governs the given direction ('input' | 'output') and its absolute
 * expiry instant (null = no expiry declared by mode).
 */
export function modelInteractionRetention(
  policy: ModelDataPolicy,
  direction: 'input' | 'output',
  recordedAt: string,
): { readonly policy: RetentionPolicy; readonly expiresAt: string | null } {
  const retention = direction === 'input' ? policy.inputRetention : policy.outputRetention;
  return deepFreeze({
    policy: retention,
    expiresAt: retentionExpiry(retention, recordedAt),
  });
}
