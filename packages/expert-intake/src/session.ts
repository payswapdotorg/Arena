/**
 * Interview session lifecycle + the append-only transcript (Work Order
 * C003).
 *
 * Lifecycle: CREATED → IN_PROGRESS → SUBMITTED → ASSESSED with explicit
 * ABANDONED / TIMED_OUT terminal states (every transition validated
 * against a closed table; terminal states are final — LIFECYCLE_CONFLICT
 * otherwise).
 *
 * The transcript is APPEND-ONLY and digest-chained: each entry commits to
 * the previous entry's digest, and the session commits to the chain head.
 * It records exactly what the expert was ASKED (the rendered question, the
 * adapter id) and what the expert DECLARED (the typed answer) — never
 * hidden model reasoning. Entries are immutable once answered (a changed
 * answer is a new item round, not an edit); `verifyTranscriptIntegrity`
 * recomputes the chain and fails closed with TAMPERED.
 *
 * Answers are validated against the item's expected answer schema AND the
 * minimal-PII screen: free-text fields are neutral-printable and MUST NOT
 * smuggle email/phone/card-shaped personal data beyond the declared
 * privacy policy (PRIVACY_VIOLATION, fail closed).
 */

import { digestCanonical } from '@arena/protocol-core';
import { isNeutralExpertId } from '@arena/expert-qualification';
import type { AvailabilityWindowView, JurisdictionView, ProficiencyLevel, QualificationEvidenceKind } from '@arena/expert-qualification';
import { EXPERT_INTAKE_ERROR_CODES, ExpertIntakeError } from './errors.js';
import { deepFreeze, expectFields, toIntakeSessionId, toIntakeTimestamp, isIntakeContentDigest, toIntakeContentDigest } from './shared.js';
import type { IntakeSessionId, IntakeTimestamp } from './shared.js';
import {
  buildInterviewCatalog,
  catalogItemById,
  catalogFromDemandProfile,
  toInterviewCatalogSeed,
} from './items.js';
import type { InterviewCatalogSeed, InterviewItem } from './items.js';
import type { DemandProfileView } from '@arena/escalation-routing';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const INTERVIEW_SESSION_VERSION = 1 as const;

export const INTERVIEW_STATES = Object.freeze([
  'CREATED',
  'IN_PROGRESS',
  'SUBMITTED',
  'ASSESSED',
  'ABANDONED',
  'TIMED_OUT',
] as const);
export type InterviewState = (typeof INTERVIEW_STATES)[number];

export const TERMINAL_INTERVIEW_STATES = Object.freeze(['ASSESSED', 'ABANDONED', 'TIMED_OUT'] as const);

const INTERVIEW_TRANSITIONS: Readonly<Record<InterviewState, readonly InterviewState[]>> = Object.freeze({
  CREATED: Object.freeze(['IN_PROGRESS', 'ABANDONED', 'TIMED_OUT'] as const),
  IN_PROGRESS: Object.freeze(['SUBMITTED', 'ABANDONED', 'TIMED_OUT'] as const),
  SUBMITTED: Object.freeze(['ASSESSED'] as const),
  ASSESSED: Object.freeze([] as const),
  ABANDONED: Object.freeze([] as const),
  TIMED_OUT: Object.freeze([] as const),
});

function assertTransition(session: InterviewSession, to: InterviewState): void {
  const allowed = INTERVIEW_TRANSITIONS[session.state];
  if (!allowed.includes(to)) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.LIFECYCLE_CONFLICT, {
      message: `interview session ${session.sessionId} cannot transition ${session.state} → ${to}`,
      details: { sessionId: session.sessionId, from: session.state, to, allowed: [...allowed] },
    });
  }
}

// ---------------------------------------------------------------------------
// Declared answers (typed union — the closed answer vocabulary)
// ---------------------------------------------------------------------------

export type DeclaredAnswer =
  | { readonly answerKind: 'proficiency-selection'; readonly proficiency: ProficiencyLevel }
  | { readonly answerKind: 'years-experience'; readonly years: number }
  | {
      readonly answerKind: 'evidence-pointer';
      readonly evidenceKind: QualificationEvidenceKind;
      readonly evidenceDigest: string;
      readonly description?: string;
    }
  | { readonly answerKind: 'scenario-response'; readonly response: string }
  | { readonly answerKind: 'locale-declaration'; readonly locales: readonly string[] }
  | { readonly answerKind: 'jurisdiction-declaration'; readonly jurisdictions: readonly JurisdictionView[] }
  | { readonly answerKind: 'availability-window'; readonly windows: readonly AvailabilityWindowView[] }
  | {
      readonly answerKind: 'privacy-consent';
      readonly consentGranted: boolean;
      readonly transcriptRetentionConsent: boolean;
    };

// ---------------------------------------------------------------------------
// Minimal-PII screen (free text — fail closed)
// ---------------------------------------------------------------------------

const EMAIL_SHAPE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/;
const PHONE_SHAPE = /\+?\d(?:[\d\s().-]{7,}\d)/;
const LONG_DIGIT_RUN = /\d{16,}/;

/**
 * Screen free-text declarations for smuggled personal data (email, phone,
 * card-shaped digit runs) — minimal-PII capture under the declared policy.
 * Structural minimization does the heavy lifting elsewhere (neutral ids,
 * closed enums); this is the lexical backstop for the two free-text fields.
 */
export function screenFreeText(text: string, field: string): void {
  if (EMAIL_SHAPE.test(text) || PHONE_SHAPE.test(text) || LONG_DIGIT_RUN.test(text)) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.PRIVACY_VIOLATION, {
      message: `${field}: free-text declaration appears to smuggle personal data (email/phone/card-shaped) beyond the declared privacy policy`,
      details: { field, policy: 'minimal-PII capture — neutral declarations only' },
    });
  }
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

export const TRANSCRIPT_ENTRY_VERSION = 1 as const;

export interface TranscriptAnswer {
  readonly answeredAt: IntakeTimestamp;
  readonly answer: DeclaredAnswer;
}

export interface TranscriptEntry {
  readonly entryVersion: typeof TRANSCRIPT_ENTRY_VERSION;
  readonly seq: number;
  readonly itemId: string;
  readonly itemVersion: number;
  readonly kind: string;
  readonly modelId: string;
  readonly question: string;
  readonly askedAt: IntakeTimestamp;
  readonly answer?: TranscriptAnswer;
  /** Digest over this entry (digest-free fields) + prevEntryDigest (chain). */
  readonly entryDigest: string;
  /** The previous entry's digest (null for the first entry). */
  readonly prevEntryDigest: string | null;
}

function entryView(entry: TranscriptEntry): Record<string, unknown> {
  const { entryDigest: _entryDigest, ...view } = entry;
  return { ...view } as Record<string, unknown>;
}

async function computeEntryDigest(entry: Omit<TranscriptEntry, 'entryDigest'>): Promise<string> {
  return digestCanonical(entryView({ ...entry, entryDigest: '' }) as unknown as TranscriptEntry);
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface IntakePrivacyPolicy {
  /** ES1.0 privacy classification of the material the expert will see. */
  readonly dataClassification: 'public' | 'internal' | 'confidential';
  /** Declared PII capture scope (minimal by construction). */
  readonly pii: 'none' | 'minimal';
}

export interface InterviewSessionView {
  readonly sessionVersion: typeof INTERVIEW_SESSION_VERSION;
  readonly sessionId: IntakeSessionId;
  readonly tenant: string;
  readonly expertId: string;
  readonly catalog: readonly InterviewItem[];
  readonly selectionSeed: string;
  readonly state: InterviewState;
  readonly privacyPolicy: IntakePrivacyPolicy;
  readonly identityRefs: readonly string[];
  readonly transcript: readonly TranscriptEntry[];
  readonly createdAt: IntakeTimestamp;
  readonly lastTransitionedAt: IntakeTimestamp;
  /** Digest-chain head (null before the first question). */
  readonly transcriptHead: string | null;
}

export interface InterviewSession extends InterviewSessionView {
  /** Content digest over the digest-free session view. */
  readonly digest: string;
}

export interface CreateInterviewSessionInput {
  readonly sessionId?: string;
  readonly tenant: string;
  readonly expertId: string;
  /** Either an explicit catalog seed or a compiled C002 DemandProfile. */
  readonly catalogSeed?: InterviewCatalogSeed | DemandProfileView;
  readonly selectionSeed: string;
  readonly privacyPolicy: { readonly dataClassification: string; readonly pii: string };
  readonly identityRefs?: readonly string[];
  readonly createdAt: string;
}

const DATA_CLASSIFICATIONS = Object.freeze(['public', 'internal', 'confidential'] as const);
const PII_SCOPES = Object.freeze(['none', 'minimal'] as const);

function toPrivacyPolicy(value: { dataClassification: string; pii: string }): IntakePrivacyPolicy {
  if (!(DATA_CLASSIFICATIONS as readonly string[]).includes(value.dataClassification)) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_SESSION, {
      message: `invalid intake privacy dataClassification: ${JSON.stringify(value.dataClassification)} (known: ${DATA_CLASSIFICATIONS.join(', ')})`,
    });
  }
  if (!(PII_SCOPES as readonly string[]).includes(value.pii)) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_SESSION, {
      message: `invalid intake privacy pii scope: ${JSON.stringify(value.pii)} (known: ${PII_SCOPES.join(', ')})`,
    });
  }
  return Object.freeze({ dataClassification: value.dataClassification, pii: value.pii } as IntakePrivacyPolicy);
}

/** Create a session in the CREATED state (deterministic catalog build). */
export async function createInterviewSession(input: CreateInterviewSessionInput): Promise<InterviewSession> {
  const record = expectFields(
    input,
    ['tenant', 'expertId', 'selectionSeed', 'privacyPolicy', 'createdAt'],
    ['sessionId', 'catalogSeed', 'identityRefs'],
    EXPERT_INTAKE_ERROR_CODES.INVALID_SESSION,
    'interview session',
  );
  const sessionId = toIntakeSessionId(
    typeof record['sessionId'] === 'string' ? record['sessionId'] : `intake-${Date.now().toString(36)}`,
    'interview session sessionId',
  );
  if (typeof record['tenant'] !== 'string' || !/^[a-z][a-z0-9-]{1,62}$/.test(record['tenant'])) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_SESSION, {
      message: 'interview session tenant must be a tenant-scope string',
    });
  }
  if (typeof record['expertId'] !== 'string' || !isNeutralExpertId(record['expertId'])) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_SESSION, {
      message: 'interview session expertId must be a neutral expert id (email/phone-shaped strings are rejected by construction)',
    });
  }
  if (typeof record['selectionSeed'] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(record['selectionSeed'])) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_SEED, {
      message: 'interview session selectionSeed must match the deterministic seed charset',
    });
  }
  const privacyPolicyRaw = record['privacyPolicy'] as { dataClassification: string; pii: string };
  const privacyPolicy = toPrivacyPolicy(privacyPolicyRaw);
  const createdAt = toIntakeTimestamp(record['createdAt'] as string, 'interview session createdAt');

  const seedRaw = record['catalogSeed'];
  let catalogSeed: InterviewCatalogSeed;
  if (seedRaw === undefined) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_SESSION, {
      message: 'interview session requires a catalog seed or a compiled demand profile',
    });
  } else if (typeof seedRaw === 'object' && seedRaw !== null && 'requiredCompetencyRefs' in seedRaw) {
    catalogSeed = catalogFromDemandProfile(seedRaw as DemandProfileView);
  } else {
    catalogSeed = toInterviewCatalogSeed(seedRaw);
  }
  const catalog = buildInterviewCatalog(catalogSeed);

  const identityRefs = Object.freeze([...((record['identityRefs'] as readonly string[] | undefined) ?? [])]);
  for (const ref of identityRefs) {
    if (typeof ref !== 'string' || !isNeutralExpertId(ref)) {
      throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_SESSION, {
        message: `identity ref ${JSON.stringify(ref)} is not a neutral locator (minimal-PII capture)`,
      });
    }
  }

  const view: InterviewSessionView = deepFreeze({
    sessionVersion: INTERVIEW_SESSION_VERSION,
    sessionId,
    tenant: record['tenant'],
    expertId: record['expertId'],
    catalog,
    selectionSeed: record['selectionSeed'],
    state: 'CREATED',
    privacyPolicy,
    identityRefs,
    transcript: Object.freeze([]),
    createdAt,
    lastTransitionedAt: createdAt,
    transcriptHead: null,
  });
  const digest = await digestCanonical(sessionDigestView(view));
  return deepFreeze({ ...view, digest }) as InterviewSession;
}

/** The digest-free session view (what the session digest commits to). */
export function sessionDigestView(session: InterviewSessionView): Record<string, unknown> {
  const { digest: _digest, ...view } = session as InterviewSession;
  void _digest;
  return { ...view } as unknown as Record<string, unknown>;
}

/**
 * Recompute the session digest over the digest-free view and compare.
 * Throws EXPERT_INTAKE_TAMPERED on any mismatch.
 */
export async function recomputeSessionDigest(session: InterviewSession): Promise<string> {
  const actual = await digestCanonical(sessionDigestView(session));
  if (actual !== session.digest) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.TAMPERED, {
      message: `interview session digest mismatch for ${session.sessionId}`,
      details: { sessionId: session.sessionId, expected: session.digest, actual },
    });
  }
  return actual;
}

/**
 * Verify the full transcript digest chain (entry by entry, head included).
 * Throws EXPERT_INTAKE_TAMPERED on any mismatch or reorder.
 */
export async function verifyTranscriptIntegrity(session: InterviewSession): Promise<void> {
  let previous: string | null = null;
  for (let index = 0; index < session.transcript.length; index += 1) {
    const entry = session.transcript[index];
    if (entry === undefined) throw new Error('unreachable');
    if (entry.seq !== index || entry.prevEntryDigest !== previous) {
      throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.TAMPERED, {
        message: `transcript entry ${index} is out of chain order in session ${session.sessionId}`,
        details: { sessionId: session.sessionId, seq: entry.seq, expectedSeq: index },
      });
    }
    const recomputed = await computeEntryDigest(entry);
    if (recomputed !== entry.entryDigest) {
      throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.TAMPERED, {
        message: `transcript entry ${entry.itemId} digest mismatch in session ${session.sessionId}`,
        details: { sessionId: session.sessionId, itemId: entry.itemId, expected: entry.entryDigest, actual: recomputed },
      });
    }
    previous = entry.entryDigest;
  }
  if (session.transcriptHead !== previous) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.TAMPERED, {
      message: `transcript chain head mismatch in session ${session.sessionId}`,
      details: { sessionId: session.sessionId },
    });
  }
}

// ---------------------------------------------------------------------------
// Mutations (append-only; every mutation returns a NEW frozen session)
// ---------------------------------------------------------------------------

async function resealed(view: InterviewSessionView): Promise<InterviewSession> {
  const digest = await digestCanonical(sessionDigestView(view));
  return deepFreeze({ ...view, digest }) as InterviewSession;
}

/** Append one asked question to the transcript (CREATED → IN_PROGRESS). */
export async function appendQuestion(
  session: InterviewSession,
  item: InterviewItem,
  question: string,
  modelId: string,
  askedAt: string,
): Promise<InterviewSession> {
  const at = toIntakeTimestamp(askedAt, 'transcript askedAt');
  if (session.transcript.some((entry) => entry.itemId === item.itemId)) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.LIFECYCLE_CONFLICT, {
      message: `item ${item.itemId} was already asked in session ${session.sessionId} (transcript is append-only — no re-asks)`,
      details: { sessionId: session.sessionId, itemId: item.itemId },
    });
  }
  const base: Omit<TranscriptEntry, 'entryDigest'> = {
    entryVersion: TRANSCRIPT_ENTRY_VERSION,
    seq: session.transcript.length,
    itemId: item.itemId,
    itemVersion: item.itemVersion,
    kind: item.kind,
    modelId,
    question,
    askedAt: at,
    prevEntryDigest: session.transcriptHead,
  };
  const entryDigest = await computeEntryDigest(base);
  const entry: TranscriptEntry = deepFreeze({ ...base, entryDigest });
  return resealed({
    ...session,
    state: session.state === 'CREATED' ? 'IN_PROGRESS' : session.state,
    transcript: Object.freeze([...session.transcript, entry]),
    transcriptHead: entryDigest,
    lastTransitionedAt: session.state === 'CREATED' ? at : session.lastTransitionedAt,
  });
}

function validateDeclaredAnswer(item: InterviewItem, answer: unknown): DeclaredAnswer {
  const expected = item.expected;
  if (typeof answer !== 'object' || answer === null) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
      message: 'declared answer must be an object',
      details: { itemId: item.itemId },
    });
  }
  const candidate = answer as Record<string, unknown>;
  if (candidate['answerKind'] !== expected.answerKind) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
      message: `answer kind ${JSON.stringify(candidate['answerKind'])} does not match the expected schema ${expected.answerKind} for item ${item.itemId}`,
      details: { itemId: item.itemId, expected: expected.answerKind },
    });
  }
  switch (expected.answerKind) {
    case 'proficiency-selection': {
      const record = expectFields(candidate, ['answerKind', 'proficiency'], [], EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, 'proficiency answer');
      if (!expected.allowedLevels.includes(record['proficiency'] as ProficiencyLevel)) {
        throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
          message: `proficiency ${JSON.stringify(record['proficiency'])} is not an allowed level for item ${item.itemId}`,
          details: { itemId: item.itemId, allowed: [...expected.allowedLevels] },
        });
      }
      return { answerKind: 'proficiency-selection', proficiency: record['proficiency'] as ProficiencyLevel };
    }
    case 'years-experience': {
      const record = expectFields(candidate, ['answerKind', 'years'], [], EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, 'years answer');
      const years = record['years'];
      if (typeof years !== 'number' || !Number.isInteger(years) || years < expected.minimumYears || years > expected.maximumYears) {
        throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
          message: `years must be an integer in [${expected.minimumYears}, ${expected.maximumYears}] for item ${item.itemId}`,
          details: { itemId: item.itemId, years },
        });
      }
      return { answerKind: 'years-experience', years };
    }
    case 'evidence-pointer': {
      const record = expectFields(candidate, ['answerKind', 'evidenceKind', 'evidenceDigest'], ['description'], EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, 'evidence answer');
      if (!expected.allowedEvidenceKinds.includes(record['evidenceKind'] as QualificationEvidenceKind)) {
        throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
          message: `evidence kind ${JSON.stringify(record['evidenceKind'])} is not allowed for item ${item.itemId}`,
          details: { itemId: item.itemId, allowed: [...expected.allowedEvidenceKinds] },
        });
      }
      const evidenceDigest = toIntakeContentDigest(
        typeof record['evidenceDigest'] === 'string' ? record['evidenceDigest'] : '',
        'evidence pointer digest',
      );
      let description: string | undefined;
      if (record['description'] !== undefined) {
        const text = record['description'] as string;
        if (typeof text !== 'string' || text.length > 2048) {
          throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
            message: 'evidence description must be bounded neutral text',
          });
        }
        screenFreeText(text, 'evidence description');
        description = text;
      }
      return deepFreeze({
        answerKind: 'evidence-pointer',
        evidenceKind: record['evidenceKind'] as QualificationEvidenceKind,
        evidenceDigest,
        ...(description !== undefined ? { description } : {}),
      });
    }
    case 'scenario-response': {
      const record = expectFields(candidate, ['answerKind', 'response'], [], EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, 'scenario answer');
      const response = record['response'];
      if (typeof response !== 'string' || response.length === 0 || response.length > expected.maximumLength) {
        throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
          message: `scenario response must be 1..${expected.maximumLength} characters for item ${item.itemId}`,
          details: { itemId: item.itemId },
        });
      }
      screenFreeText(response, 'scenario response');
      return { answerKind: 'scenario-response', response };
    }
    case 'locale-declaration': {
      const record = expectFields(candidate, ['answerKind', 'locales'], [], EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, 'locale answer');
      const locales = record['locales'];
      if (!Array.isArray(locales) || locales.length === 0 || locales.length > expected.maximumLocales) {
        throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
          message: `locale declaration must list 1..${expected.maximumLocales} locales for item ${item.itemId}`,
        });
      }
      for (const locale of locales) {
        if (typeof locale !== 'string' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
          throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
            message: `locale ${JSON.stringify(locale)} is not a BCP-47-style tag for item ${item.itemId}`,
          });
        }
      }
      return { answerKind: 'locale-declaration', locales: Object.freeze([...locales]) };
    }
    case 'jurisdiction-declaration': {
      const record = expectFields(candidate, ['answerKind', 'jurisdictions'], [], EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, 'jurisdiction answer');
      const jurisdictions = record['jurisdictions'];
      if (!Array.isArray(jurisdictions) || jurisdictions.length === 0 || jurisdictions.length > expected.maximumJurisdictions) {
        throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
          message: `jurisdiction declaration must list 1..${expected.maximumJurisdictions} jurisdictions for item ${item.itemId}`,
        });
      }
      const views: JurisdictionView[] = [];
      for (const jurisdiction of jurisdictions) {
        if (
          typeof jurisdiction !== 'object' ||
          jurisdiction === null ||
          (jurisdiction as Record<string, unknown>)['country'] === undefined
        ) {
          throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
            message: `jurisdiction entry must carry an ISO 3166-1 alpha-2 country for item ${item.itemId}`,
          });
        }
        const entry = jurisdiction as { country: unknown; region?: unknown };
        if (typeof entry.country !== 'string' || !/^[A-Z]{2}$/.test(entry.country)) {
          throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
            message: `jurisdiction country ${JSON.stringify(entry.country)} is not ISO 3166-1 alpha-2`,
          });
        }
        if (entry.region !== undefined && (typeof entry.region !== 'string' || !/^[A-Z0-9]{1,3}$/.test(entry.region))) {
          throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
            message: `jurisdiction region ${JSON.stringify(entry.region)} is not ISO 3166-2 shaped`,
          });
        }
        views.push(
          Object.freeze({
            jurisdictionVersion: 1 as const,
            country: entry.country,
            ...(entry.region !== undefined ? { region: entry.region as string } : {}),
          }),
        );
      }
      return { answerKind: 'jurisdiction-declaration', jurisdictions: Object.freeze([...views]) };
    }
    case 'availability-window': {
      const record = expectFields(candidate, ['answerKind', 'windows'], [], EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, 'availability answer');
      const windows = record['windows'];
      if (!Array.isArray(windows) || windows.length === 0) {
        throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
          message: `availability declaration must list at least one window for item ${item.itemId}`,
        });
      }
      const views: AvailabilityWindowView[] = [];
      for (const window of windows) {
        if (
          typeof window !== 'object' ||
          window === null ||
          typeof (window as Record<string, unknown>)['startUtc'] !== 'string'
        ) {
          throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
            message: `availability window must be an AvailabilityWindowView for item ${item.itemId}`,
          });
        }
        const candidateWindow = window as Record<string, unknown>;
        const recurrence = candidateWindow['recurrence'];
        if (typeof recurrence !== 'string' || !expected.requiredRecurrences.includes(recurrence as never)) {
          throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
            message: `availability recurrence ${JSON.stringify(recurrence)} is not allowed for item ${item.itemId}`,
            details: { allowed: [...expected.requiredRecurrences] },
          });
        }
        if (
          candidateWindow['windowVersion'] !== 1 ||
          typeof candidateWindow['startUtc'] !== 'string' ||
          typeof candidateWindow['endUtc'] !== 'string' ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(candidateWindow['startUtc']) ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(candidateWindow['endUtc']) ||
          candidateWindow['startUtc'] >= candidateWindow['endUtc']
        ) {
          throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
            message: `availability window times must be UTC HH:MM with end after start for item ${item.itemId}`,
          });
        }
        if (recurrence === 'weekly' && (typeof candidateWindow['dayOfWeek'] !== 'number' || candidateWindow['dayOfWeek'] < 1 || candidateWindow['dayOfWeek'] > 7)) {
          throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
            message: `weekly availability window requires dayOfWeek 1..7 for item ${item.itemId}`,
          });
        }
        if (recurrence === 'one-time' && (typeof candidateWindow['date'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(candidateWindow['date']))) {
          throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
            message: `one-time availability window requires a calendar date for item ${item.itemId}`,
          });
        }
        views.push(
          Object.freeze({
            windowVersion: 1 as const,
            recurrence: recurrence as AvailabilityWindowView['recurrence'],
            ...(candidateWindow['dayOfWeek'] !== undefined ? { dayOfWeek: candidateWindow['dayOfWeek'] as number } : {}),
            startUtc: candidateWindow['startUtc'] as string,
            endUtc: candidateWindow['endUtc'] as string,
            ...(candidateWindow['date'] !== undefined ? { date: candidateWindow['date'] as string } : {}),
          }),
        );
      }
      return { answerKind: 'availability-window', windows: Object.freeze([...views]) };
    }
    case 'privacy-consent': {
      const record = expectFields(candidate, ['answerKind', 'consentGranted', 'transcriptRetentionConsent'], [], EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, 'consent answer');
      if (typeof record['consentGranted'] !== 'boolean' || typeof record['transcriptRetentionConsent'] !== 'boolean') {
        throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
          message: `consent declaration must carry explicit boolean decisions for item ${item.itemId}`,
        });
      }
      return {
        answerKind: 'privacy-consent',
        consentGranted: record['consentGranted'],
        transcriptRetentionConsent: record['transcriptRetentionConsent'],
      };
    }
    default:
      throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
        message: `unsupported answer schema for item ${item.itemId}`,
      });
  }
}

/**
 * Record the expert's DECLARED answer for one asked item. The entry must
 * exist and be unanswered (answers are append-only — no edits, no
 * re-answers). Validated against the expected schema + minimal-PII screen.
 */
export async function recordDeclaredAnswer(
  session: InterviewSession,
  itemId: string,
  answer: unknown,
  answeredAt: string,
): Promise<InterviewSession> {
  const at = toIntakeTimestamp(answeredAt, 'transcript answeredAt');
  const index = session.transcript.findIndex((entry) => entry.itemId === itemId);
  if (index === -1) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.NOT_FOUND, {
      message: `item ${JSON.stringify(itemId)} has not been asked in session ${session.sessionId}`,
      details: { sessionId: session.sessionId, itemId },
    });
  }
  const entry = session.transcript[index];
  if (entry === undefined) throw new Error('unreachable');
  if (entry.answer !== undefined) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.LIFECYCLE_CONFLICT, {
      message: `item ${itemId} already carries a declared answer in session ${session.sessionId} (answers are append-only)`,
      details: { sessionId: session.sessionId, itemId },
    });
  }
  if (session.state !== 'IN_PROGRESS') {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.LIFECYCLE_CONFLICT, {
      message: `answers can only be recorded while the interview is IN_PROGRESS (session ${session.sessionId} is ${session.state})`,
      details: { sessionId: session.sessionId, state: session.state },
    });
  }
  const item = catalogItemById(session.catalog, itemId);
  const declared = validateDeclaredAnswer(item, answer);
  const answered: TranscriptAnswer = Object.freeze({ answeredAt: at, answer: declared });
  const base: Omit<TranscriptEntry, 'entryDigest'> = { ...entry, answer: answered };
  const entryDigest = await computeEntryDigest(base);
  const sealed: TranscriptEntry = deepFreeze({ ...base, entryDigest });
  const transcript = session.transcript.map((candidate, position) => (position === index ? sealed : candidate));
  return resealed({ ...session, transcript: Object.freeze([...transcript]), transcriptHead: entryDigest });
}

/** Transition to SUBMITTED (the expert declared the interview complete). */
export async function markSubmitted(session: InterviewSession, at: string): Promise<InterviewSession> {
  assertTransition(session, 'SUBMITTED');
  const time = toIntakeTimestamp(at, 'submit at');
  return resealed({ ...session, state: 'SUBMITTED', lastTransitionedAt: time });
}

/** Transition to ABANDONED (explicit abandon — terminal). */
export async function markAbandoned(session: InterviewSession, at: string): Promise<InterviewSession> {
  assertTransition(session, 'ABANDONED');
  const time = toIntakeTimestamp(at, 'abandon at');
  return resealed({ ...session, state: 'ABANDONED', lastTransitionedAt: time });
}

/** Transition to TIMED_OUT (deadline lapse — terminal). */
export async function markTimedOut(session: InterviewSession, at: string): Promise<InterviewSession> {
  assertTransition(session, 'TIMED_OUT');
  const time = toIntakeTimestamp(at, 'timeout at');
  return resealed({ ...session, state: 'TIMED_OUT', lastTransitionedAt: time });
}

/** Transition to ASSESSED (the typed outcome is attached by the engine). */
export async function markAssessed(session: InterviewSession, at: string): Promise<InterviewSession> {
  assertTransition(session, 'ASSESSED');
  const time = toIntakeTimestamp(at, 'assess at');
  return resealed({ ...session, state: 'ASSESSED', lastTransitionedAt: time });
}

/** The answered entries only (declaration view for assessment). */
export function answeredEntries(session: InterviewSessionView): readonly { entry: TranscriptEntry; item: InterviewItem; answer: DeclaredAnswer }[] {
  const resolved: { entry: TranscriptEntry; item: InterviewItem; answer: DeclaredAnswer }[] = [];
  for (const entry of session.transcript) {
    if (entry.answer === undefined) continue;
    const item = session.catalog.find((candidate) => candidate.itemId === entry.itemId);
    if (item === undefined) continue;
    resolved.push(Object.freeze({ entry, item, answer: entry.answer.answer }));
  }
  return Object.freeze([...resolved]);
}

export { isIntakeContentDigest };
