/**
 * Epoch's DECLARED integration posture (Work Order C019).
 *
 * The escalation request's environment-session policy and privacy policy
 * come from Epoch's declared posture (spec/human-escalation-work-items.md
 * C019 row), supplied by the Epoch host at composition time — the trigger
 * event itself carries only the per-incident data. The posture also
 * carries the authorization identity (clientAppId + tenantId) that every
 * trigger's authorization metadata must match: a mismatch is the typed
 * AUTHORIZATION_MISMATCH failure (the cross-tenant adversarial case).
 *
 * Parsing is CLOSED-SHAPE: unknown fields fail closed (EPI1.0 discipline
 * — see trigger.ts); every field is validated against the vocabulary of
 * the real ES1.0 request constructor it feeds.
 */

import { EPOCH_ESCALATION_ERROR_CODES, EpochEscalationError } from './errors.js';

/** Epoch escalation posture wire version. */
export const EPOCH_ESCALATION_POSTURE_VERSION = 1 as const;

/** Closed session-mode vocabulary (mirrors @arena/escalation SESSION_MODES). */
export const EPOCH_SESSION_MODES = Object.freeze(['none', 'bounded-replica'] as const);
export type EpochSessionMode = (typeof EPOCH_SESSION_MODES)[number];

export const EPOCH_SANITIZATIONS = Object.freeze(['standard', 'strict'] as const);
export type EpochSanitization = (typeof EPOCH_SANITIZATIONS)[number];

export const EPOCH_DATA_CLASSIFICATIONS = Object.freeze(['public', 'internal', 'confidential'] as const);
export type EpochDataClassification = (typeof EPOCH_DATA_CLASSIFICATIONS)[number];

export const EPOCH_PII_POLICIES = Object.freeze(['forbid', 'redact', 'allow'] as const);
export type EpochPiiPolicy = (typeof EPOCH_PII_POLICIES)[number];

export const EPOCH_RETENTION_DISPOSITIONS = Object.freeze(['retain', 'purge'] as const);
export type EpochRetentionDisposition = (typeof EPOCH_RETENTION_DISPOSITIONS)[number];

/** Closed permitted-actions vocabulary (mirrors @arena/escalation PERMITTED_ACTIONS). */
export const EPOCH_PERMITTED_ACTIONS = Object.freeze([
  'read-context',
  'run-approved-tools',
  'propose-patch',
  'annotate-evidence',
  'ask-clarification',
  'signal-tool-gap',
] as const);
export type EpochPermittedAction = (typeof EPOCH_PERMITTED_ACTIONS)[number];

export interface EpochIntegrationPosture {
  readonly postureVersion: typeof EPOCH_ESCALATION_POSTURE_VERSION;
  /** Arena-registered client application id (the authorization identity). */
  readonly clientAppId: string;
  /** Arena tenant the escalation runs under (tenant isolation, lock rule 11). */
  readonly tenantId: string;
  /** Default locale for escalations filed under this posture. */
  readonly locale: string;
  readonly environmentSessionPolicy: {
    readonly sessionMode: EpochSessionMode;
    readonly sanitization: EpochSanitization;
  };
  readonly privacyPolicy: {
    readonly dataClassification: EpochDataClassification;
    readonly pii: EpochPiiPolicy;
  };
  readonly permittedActions: readonly EpochPermittedAction[];
  readonly learningPermissions: {
    readonly allowKnowledgeCapture: boolean;
    readonly allowToolGapSignals: boolean;
    readonly allowArtifactReuse: boolean;
    readonly requireApproval: boolean;
  };
  readonly retentionPolicy: {
    readonly retentionMs: number;
    readonly disposition: EpochRetentionDisposition;
  };
}

/** The exact closed field set of the posture (unknown-field fail-closed). */
const POSTURE_FIELDS = Object.freeze([
  'postureVersion',
  'clientAppId',
  'tenantId',
  'locale',
  'environmentSessionPolicy',
  'privacyPolicy',
  'permittedActions',
  'learningPermissions',
  'retentionPolicy',
] as const);

const ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;
const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  known: readonly string[],
  what: string,
): void {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) {
      throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.UNKNOWN_FIELD, {
        message: `${what} carries unknown field ${JSON.stringify(key)} (closed shape — fail closed)`,
        details: { field: key, known },
      });
    }
  }
}

/**
 * Parse and freeze Epoch's declared integration posture (closed shape,
 * fail-closed on every field and on unknown fields).
 */
export function parseEpochIntegrationPosture(value: unknown): EpochIntegrationPosture {
  if (!isRecord(value)) {
    throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.INVALID_POSTURE, {
      message: 'Epoch integration posture must be an object',
    });
  }
  rejectUnknownFields(value, POSTURE_FIELDS, 'Epoch integration posture');
  if (value['postureVersion'] !== EPOCH_ESCALATION_POSTURE_VERSION) {
    throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.INVALID_POSTURE, {
      message: `postureVersion must be ${EPOCH_ESCALATION_POSTURE_VERSION}: ${JSON.stringify(value['postureVersion'])}`,
    });
  }
  if (typeof value['clientAppId'] !== 'string' || !ID_PATTERN.test(value['clientAppId'])) {
    throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.INVALID_POSTURE, {
      message: `clientAppId is invalid: ${JSON.stringify(value['clientAppId'])}`,
    });
  }
  if (typeof value['tenantId'] !== 'string' || !ID_PATTERN.test(value['tenantId'])) {
    throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.INVALID_POSTURE, {
      message: `tenantId is invalid: ${JSON.stringify(value['tenantId'])}`,
    });
  }
  if (typeof value['locale'] !== 'string' || !LOCALE_PATTERN.test(value['locale'])) {
    throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.INVALID_POSTURE, {
      message: `locale is invalid: ${JSON.stringify(value['locale'])}`,
    });
  }

  const session = value['environmentSessionPolicy'];
  if (
    !isRecord(session) ||
    Object.keys(session).length !== 2 ||
    !(EPOCH_SESSION_MODES as readonly string[]).includes(String(session['sessionMode'])) ||
    !(EPOCH_SANITIZATIONS as readonly string[]).includes(String(session['sanitization']))
  ) {
    throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.INVALID_POSTURE, {
      message: `environmentSessionPolicy is invalid: ${JSON.stringify(session)}`,
    });
  }

  const privacy = value['privacyPolicy'];
  if (
    !isRecord(privacy) ||
    Object.keys(privacy).length !== 2 ||
    !(EPOCH_DATA_CLASSIFICATIONS as readonly string[]).includes(String(privacy['dataClassification'])) ||
    !(EPOCH_PII_POLICIES as readonly string[]).includes(String(privacy['pii']))
  ) {
    throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.INVALID_POSTURE, {
      message: `privacyPolicy is invalid: ${JSON.stringify(privacy)}`,
    });
  }

  const actions = value['permittedActions'];
  if (
    !Array.isArray(actions) ||
    actions.length === 0 ||
    actions.some((entry) => !(EPOCH_PERMITTED_ACTIONS as readonly string[]).includes(String(entry))) ||
    new Set(actions.map(String)).size !== actions.length
  ) {
    throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.INVALID_POSTURE, {
      message: `permittedActions is invalid: ${JSON.stringify(actions)}`,
    });
  }

  const learning = value['learningPermissions'];
  if (
    !isRecord(learning) ||
    Object.keys(learning).length !== 4 ||
    !['allowKnowledgeCapture', 'allowToolGapSignals', 'allowArtifactReuse', 'requireApproval'].every(
      (key) => typeof learning[key] === 'boolean',
    )
  ) {
    throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.INVALID_POSTURE, {
      message: `learningPermissions is invalid: ${JSON.stringify(learning)}`,
    });
  }

  const retention = value['retentionPolicy'];
  if (
    !isRecord(retention) ||
    Object.keys(retention).length !== 2 ||
    typeof retention['retentionMs'] !== 'number' ||
    !Number.isInteger(retention['retentionMs']) ||
    retention['retentionMs'] < 0 ||
    !(EPOCH_RETENTION_DISPOSITIONS as readonly string[]).includes(String(retention['disposition']))
  ) {
    throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.INVALID_POSTURE, {
      message: `retentionPolicy is invalid: ${JSON.stringify(retention)}`,
    });
  }

  const posture: EpochIntegrationPosture = Object.freeze({
    postureVersion: EPOCH_ESCALATION_POSTURE_VERSION,
    clientAppId: value['clientAppId'],
    tenantId: value['tenantId'],
    locale: value['locale'],
    environmentSessionPolicy: Object.freeze({
      sessionMode: session['sessionMode'] as EpochSessionMode,
      sanitization: session['sanitization'] as EpochSanitization,
    }),
    privacyPolicy: Object.freeze({
      dataClassification: privacy['dataClassification'] as EpochDataClassification,
      pii: privacy['pii'] as EpochPiiPolicy,
    }),
    permittedActions: Object.freeze([...actions] as readonly EpochPermittedAction[]),
    learningPermissions: Object.freeze({
      allowKnowledgeCapture: learning['allowKnowledgeCapture'] as boolean,
      allowToolGapSignals: learning['allowToolGapSignals'] as boolean,
      allowArtifactReuse: learning['allowArtifactReuse'] as boolean,
      requireApproval: learning['requireApproval'] as boolean,
    }),
    retentionPolicy: Object.freeze({
      retentionMs: retention['retentionMs'] as number,
      disposition: retention['disposition'] as EpochRetentionDisposition,
    }),
  });
  return posture;
}

/** Structural guard for already-typed postures. */
export function isEpochIntegrationPosture(value: unknown): value is EpochIntegrationPosture {
  try {
    return parseEpochIntegrationPosture(value) !== null;
  } catch {
    return false;
  }
}
