/**
 * The IntakeProfile output contract (Work Order C003) — the structured
 * proposal the interview produces:
 *
 *   - the A006 registry FIELD GROUPS the expert declared (identity refs,
 *     competencies, availability windows, domain scope, jurisdictions,
 *     locales) shaped for the registry's proposal surface;
 *   - qualification CLAIM CANDIDATES with evidence pointers for A007 —
 *     each candidate pairs a capability ref + declared proficiency with
 *     at least one digest-addressed evidence pointer of a closed A007
 *     evidence kind.
 *
 * CLAIMS ARE INPUT TO QUALIFICATION, NEVER AN ACCESS GRANT (lock rules
 * 9/35): the profile carries declaration DATA only. A recursive screen
 * rejects authority-shaped and PII-shaped FIELD NAMES at any depth
 * (mirroring @arena/expert-registry's authority-screen discipline), so
 * intake output can never smuggle a permission-shaped record into the
 * registry. Content-addressed: same declarations ⇒ same digest.
 */

import { digestCanonical } from '@arena/protocol-core';
import { toCapabilityNodeRefView, capabilityNodeRefViewKey } from '@arena/expert-qualification';
import type {
  AvailabilityWindowView,
  CapabilityNodeRefView,
  JurisdictionView,
  ProficiencyLevel,
  QualificationEvidenceKind,
} from '@arena/expert-qualification';
import { EXPERT_INTAKE_ERROR_CODES, ExpertIntakeError } from './errors.js';
import { answeredEntries } from './session.js';
import type { InterviewSession } from './session.js';
import { deepFreeze, toIntakeTimestamp } from './shared.js';

// ---------------------------------------------------------------------------
// Evidence pointers
// ---------------------------------------------------------------------------

/** One digest-addressed evidence pointer of a closed A007 evidence kind. */
export interface EvidencePointer {
  readonly evidenceKind: QualificationEvidenceKind;
  readonly digest: string;
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Competency claim candidates (A007 input shape)
// ---------------------------------------------------------------------------

export const INTAKE_PROFILE_VERSION = 1 as const;

export interface CompetencyClaimCandidate {
  /** The claimed capability node (content-addressed matching). */
  readonly capability: CapabilityNodeRefView;
  /** The declared proficiency (DATA, never a certification claim). */
  readonly proficiency: ProficiencyLevel;
  /** The evidence pointers backing the claim (>= 1 — else not a claim). */
  readonly evidence: readonly EvidencePointer[];
  /** The interview item that elicited the proficiency declaration. */
  readonly declaredVia: string;
}

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

export interface IntakeProfileView {
  readonly profileVersion: typeof INTAKE_PROFILE_VERSION;
  readonly sessionId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly identityRefs: readonly string[];
  readonly competencyClaims: readonly CompetencyClaimCandidate[];
  readonly availabilityWindows: readonly AvailabilityWindowView[];
  readonly locales: readonly string[];
  readonly jurisdictions: readonly JurisdictionView[];
  readonly domainScope?: {
    readonly domainRef: CapabilityNodeRefView;
    readonly limitations: readonly string[];
  };
  readonly privacy: {
    readonly dataClassification: string;
    readonly pii: string;
    readonly transcriptRetentionConsent: boolean;
  };
  readonly declaredAt: string;
  readonly submittedAt: string;
  readonly assessedAt: string;
}

export interface IntakeProfile extends IntakeProfileView {
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Authority / PII field-name screen (lock rule 9 — masquerade defense)
// ---------------------------------------------------------------------------

const AUTHORITY_KEY_STEMS = [
  'authorit',
  'authoriz',
  'admin',
  'permission',
  'privileg',
  'entitle',
  'grant',
  'superuser',
  'impersonat',
  'accesslevel',
  'systemrole',
  'systemright',
  'mandate',
  'clearance',
] as const;

const PII_KEY_STEMS = ['email', 'phone', 'legalname', 'dateofbirth', 'address', 'ssn', 'passport'] as const;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Reject authority-shaped / PII-shaped FIELD NAMES at any depth of the
 * profile data. Declaration DATA is allowed; permission-shaped records
 * are not — intake output consumed as an access grant must fail closed
 * at the earliest boundary (the data itself).
 */
export function screenProfileFieldNames(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => screenProfileFieldNames(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const normalized = normalizeKey(key);
    for (const stem of AUTHORITY_KEY_STEMS) {
      if (normalized.includes(stem)) {
        throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.PRIVACY_VIOLATION, {
          message: `intake profile field '${path}.${key}' is authority-shaped — intake output carries declaration DATA only, never an access grant (lock rule 9)`,
          details: { path: `${path}.${key}`, stem },
        });
      }
    }
    for (const stem of PII_KEY_STEMS) {
      if (normalized.includes(stem)) {
        throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.PRIVACY_VIOLATION, {
          message: `intake profile field '${path}.${key}' is PII-shaped — minimal-PII capture rejects it by construction`,
          details: { path: `${path}.${key}`, stem },
        });
      }
    }
    screenProfileFieldNames((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
}

// ---------------------------------------------------------------------------
// Profile construction (pure over the submitted session)
// ---------------------------------------------------------------------------

/**
 * Build the structured IntakeProfile from a submitted session's declared
 * answers. Deterministic: the same transcript produces the same profile
 * digest. Throws INVALID_PROFILE when a competency claim candidate lacks
 * evidence pointers (an evidence-free claim is structurally not a claim —
 * the A007 discipline) or when the declarations fail the field-name
 * screen.
 */
export async function buildIntakeProfile(
  session: InterviewSession,
  options: { readonly assessedAt: string },
): Promise<IntakeProfile> {
  const answered = answeredEntries(session);

  const identityRefs: string[] = [...session.identityRefs];
  const claimsByTarget = new Map<string, CompetencyClaimCandidate>();
  const availabilityWindows: AvailabilityWindowView[] = [];
  const locales: string[] = [];
  const jurisdictions: JurisdictionView[] = [];
  let domainRef: CapabilityNodeRefView | undefined;
  const limitations: string[] = [];
  let transcriptRetentionConsent = false;
  const evidenceByTarget = new Map<string, EvidencePointer[]>();

  for (const { item, answer } of answered) {
    switch (answer.answerKind) {
      case 'proficiency-selection': {
        if (item.target === undefined) break;
        claimsByTarget.set(capabilityNodeRefViewKey(item.target), {
          capability: item.target,
          proficiency: answer.proficiency,
          evidence: [],
          declaredVia: item.itemId,
        });
        break;
      }
      case 'evidence-pointer': {
        if (item.target === undefined) break;
        const key = capabilityNodeRefViewKey(item.target);
        const pointers = evidenceByTarget.get(key) ?? [];
        pointers.push({
          evidenceKind: answer.evidenceKind,
          digest: answer.evidenceDigest,
          ...(answer.description !== undefined ? { description: answer.description } : {}),
        });
        evidenceByTarget.set(key, pointers);
        break;
      }
      case 'availability-window': {
        availabilityWindows.push(...answer.windows);
        break;
      }
      case 'locale-declaration': {
        for (const locale of answer.locales) {
          if (!locales.includes(locale)) locales.push(locale);
        }
        break;
      }
      case 'jurisdiction-declaration': {
        jurisdictions.push(...answer.jurisdictions);
        break;
      }
      case 'scenario-response': {
        if (item.routingInput === 'scenario' && item.target !== undefined) {
          domainRef = item.target;
          limitations.push(answer.response.slice(0, 512));
        }
        break;
      }
      case 'privacy-consent': {
        transcriptRetentionConsent = answer.transcriptRetentionConsent;
        break;
      }
      case 'years-experience': {
        break;
      }
      default:
        break;
    }
  }

  const competencyClaims: CompetencyClaimCandidate[] = [];
  for (const [key, claim] of claimsByTarget) {
    const evidence = evidenceByTarget.get(key) ?? [];
    if (evidence.length === 0) {
      throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_PROFILE, {
        message: `competency claim candidate for ${key} carries no evidence pointer — an evidence-free proficiency claim is not a claim (A007 discipline, R7)`,
        details: { capability: key },
      });
    }
    competencyClaims.push(Object.freeze({ ...claim, evidence: Object.freeze([...evidence]) }));
  }
  competencyClaims.sort((a, b) =>
    capabilityNodeRefViewKey(a.capability) < capabilityNodeRefViewKey(b.capability) ? -1 : 1,
  );

  if (locales.length === 0) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_PROFILE, {
      message: 'an intake profile requires at least one declared locale (routing input)',
    });
  }
  if (availabilityWindows.length === 0) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_PROFILE, {
      message: 'an intake profile requires at least one declared availability window (routing input)',
    });
  }

  const assessedAt = toIntakeTimestamp(options.assessedAt, 'intake profile assessedAt');
  const view: IntakeProfileView = deepFreeze({
    profileVersion: INTAKE_PROFILE_VERSION,
    sessionId: session.sessionId,
    tenant: session.tenant,
    expertId: session.expertId,
    identityRefs: Object.freeze([...new Set(identityRefs)]),
    competencyClaims: Object.freeze([...competencyClaims]),
    availabilityWindows: Object.freeze([...availabilityWindows]),
    locales: Object.freeze([...locales]),
    jurisdictions: Object.freeze([...jurisdictions]),
    ...(domainRef !== undefined ? { domainScope: Object.freeze({ domainRef, limitations: Object.freeze([...limitations]) }) } : {}),
    privacy: Object.freeze({
      dataClassification: session.privacyPolicy.dataClassification,
      pii: session.privacyPolicy.pii,
      transcriptRetentionConsent,
    }),
    declaredAt: session.createdAt,
    submittedAt: session.lastTransitionedAt,
    assessedAt,
  });

  screenProfileFieldNames(view, 'intakeProfile');
  const digest = await digestCanonical(profileDigestView(view));
  return deepFreeze({ ...view, digest }) as IntakeProfile;
}

/** The digest-free view of a profile (what the digest commits to). */
export function profileDigestView(profile: IntakeProfileView): Record<string, unknown> {
  const { digest: _digest, ...view } = profile as IntakeProfile;
  return { ...view } as unknown as Record<string, unknown>;
}

/** Recompute the profile digest and compare; TAMPERED on mismatch. */
export async function recomputeIntakeProfileDigest(profile: IntakeProfile): Promise<string> {
  const actual = await digestCanonical(profileDigestView(profile));
  if (actual !== profile.digest) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.TAMPERED, {
      message: `intake profile digest mismatch for session ${profile.sessionId}`,
      details: { sessionId: profile.sessionId, expected: profile.digest, actual },
    });
  }
  return actual;
}

// ---------------------------------------------------------------------------
// The A006/A007 handoff views (DATA ONLY — the ports are injected upstream)
// ---------------------------------------------------------------------------

/**
 * The A007 claim-candidate tuples: exactly the input shape
 * @arena/expert-qualification's createCompetencyClaim consumes (expertId,
 * tenant, capability, proficiency, evidence digests, declaredAt). Pure
 * data mapping — no registry or qualification state is touched here.
 */
export function toQualificationClaimInputs(profile: IntakeProfileView): readonly {
  expertId: string;
  tenant: string;
  capability: { kind: string; id: string; version: string; digest: string };
  proficiency: string;
  evidence: readonly string[];
  declaredAt: string;
}[] {
  return Object.freeze(
    profile.competencyClaims.map((claim) => ({
      expertId: profile.expertId,
      tenant: profile.tenant,
      capability: {
        kind: claim.capability.kind,
        id: claim.capability.id,
        version: claim.capability.version,
        digest: claim.capability.digest,
      },
      proficiency: claim.proficiency,
      evidence: Object.freeze([...claim.evidence.map((pointer) => pointer.digest)]),
      declaredAt: profile.declaredAt,
    })),
  );
}

/**
 * The A006 registry-field-group proposal: the §8 field groups the expert
 * declared during intake, shaped for the registry's proposal surface.
 * Pure data mapping — the registry itself owns profile construction.
 */
export function toRegistryProposal(profile: IntakeProfileView): {
  expertId: string;
  tenant: string;
  identityRefs: readonly string[];
  competencies: readonly {
    capability: { kind: string; id: string; version: string; digest: string };
    proficiency: string;
    evidenceRefs: readonly { evidenceKind: string; digest: string }[];
  }[];
  availabilityWindows: readonly AvailabilityWindowView[];
  locales: readonly string[];
  jurisdictions: readonly JurisdictionView[];
  domainScope?: { domainRef: { kind: string; id: string; version: string; digest: string }; limitations: readonly string[] };
  privacyPolicy: { dataClassification: string; pii: string; transcriptRetentionConsent: boolean };
} {
  const proposal = {
    expertId: profile.expertId,
    tenant: profile.tenant,
    identityRefs: profile.identityRefs,
    competencies: Object.freeze(
      profile.competencyClaims.map((claim) => ({
        capability: {
          kind: claim.capability.kind,
          id: claim.capability.id,
          version: claim.capability.version,
          digest: claim.capability.digest,
        },
        proficiency: claim.proficiency,
        evidenceRefs: Object.freeze(
          claim.evidence.map((pointer) => ({ evidenceKind: pointer.evidenceKind, digest: pointer.digest })),
        ),
      })),
    ),
    availabilityWindows: profile.availabilityWindows,
    locales: profile.locales,
    jurisdictions: profile.jurisdictions,
    ...(profile.domainScope !== undefined
      ? {
          domainScope: Object.freeze({
            domainRef: {
              kind: profile.domainScope.domainRef.kind,
              id: profile.domainScope.domainRef.id,
              version: profile.domainScope.domainRef.version,
              digest: profile.domainScope.domainRef.digest,
            },
            limitations: profile.domainScope.limitations,
          }),
        }
      : {}),
    privacyPolicy: profile.privacy,
  };
  screenProfileFieldNames(proposal, 'registryProposal');
  return deepFreeze(proposal);
}

// Re-exported for the convenience of profile consumers building refs.
export { toCapabilityNodeRefView };
