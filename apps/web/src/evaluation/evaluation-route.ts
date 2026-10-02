/**
 * Evaluation-route composition (Work Order B012; issue #87;
 * apps/web/src/evaluation). SERVER-ONLY.
 *
 * Mirrors the B007/B010 route patterns:
 *   - `/evaluation` and its detail routes probe the browser session FIRST
 *     (fail closed — an unauthenticated visitor gets the auth-required
 *     notice, NEVER an anonymous surface), then compose the view through
 *     the canonical read path + the public protocol-package reads;
 *   - `/demo/evaluation/**` composes over the shared B006 demo runtime
 *     (zero credentials, deterministic corpus, reserved demo tenant) with
 *     the deterministic B012 protocol corpus, under the demo labelling
 *     contract.
 *
 * Every experience carries its truth classes (B003 taxonomy through the
 * B012 state marks); the session posture's empty sections are HONEST
 * empty states — no evaluation runs are recorded in the local posture,
 * and nothing is fabricated to fill the space.
 */

import type { ReadModelKind } from '../../../../packages/read-model/src/index.js';
import type {
  CanonicalRead,
  CanonicalReadModel,
} from '../../../../packages/read-model/src/index.js';
import { toEvaluationReportView } from './evaluation-view-model.js';
import type { EvaluationReportView } from './evaluation-view-model.js';
import { toVerificationDetailView } from './verification-view-model.js';
import type { VerificationDetailView } from './verification-view-model.js';
import { toCertificationClaimSummary, toCertificationDetailView } from './certification-view-model.js';
import type {
  CertificationClaimSummary,
  CertificationDetailView,
} from './certification-view-model.js';
import { buildEvaluationDemoCorpus, EVALUATION_DEMO_IDS } from './fixtures.js';
import type { EvaluationDemoCorpus } from './fixtures.js';
import {
  EVALUATION_DISTINCTION_NOTE,
  truthClassLegend,
} from './state-mark.js';
import type { TruthClassMark } from './state-mark.js';
import {
  getDemoEvaluationContext,
  resolveSessionEvaluation,
} from './runtime.js';
import type { CockpitReadPort, CockpitSessionFacts } from './runtime.js';

// ---------------------------------------------------------------------------
// The /evaluation home view model
// ---------------------------------------------------------------------------

/** The complete `/evaluation` view model. */
export interface EvaluationHomeViewModel {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalLabel: string;
  /** Evaluation reports (protocol objects; empty in the local session posture). */
  readonly reports: readonly EvaluationReportView[];
  /** Verification records (protocol objects; empty in the local session posture). */
  readonly verifications: readonly VerificationDetailView[];
  /** Certification runs (protocol objects; empty in the local session posture). */
  readonly certifications: readonly CertificationDetailView[];
  /** Certification claims read through the canonical B005 read path. */
  readonly claims: readonly CertificationClaimSummary[];
  /** The persistent evaluation ≠ verification ≠ certification distinction. */
  readonly distinctionNote: string;
  /** The truth-class legend (the teaching UI). */
  readonly legend: readonly TruthClassMark[];
  /** Sections whose reads returned no records — honest empty states. */
  readonly emptySections: readonly string[];
  /** Base href for report links ('/evaluation' session, '/demo/evaluation' demo). */
  readonly reportHrefBase: string;
  /** Base href for verification links. */
  readonly verificationHrefBase: string;
  /** Base href for certification links. */
  readonly certificationHrefBase: string;
  /** The read-model activity stamp (max readAt across the reads). */
  readonly readAt: number;
  readonly demo: {
    readonly isDemo: boolean;
    readonly corpusHash?: string;
  };
}

/** What `/evaluation` renders: the auth-required notice, or the surface home. */
export type EvaluationExperience =
  | { readonly kind: 'auth-required' }
  | { readonly kind: 'home'; readonly view: EvaluationHomeViewModel };

export interface ResolveEvaluationExperienceOptions {
  /** Session probe override (test seam); default: the B004 session boundary. */
  readonly probe?: NonNullable<Parameters<typeof resolveSessionEvaluation>[0]>['probe'];
  /** Read-model override (composition seam); default: local-parity fake-backed service. */
  readonly readModel?: CanonicalReadModel;
}

/** Scroll the certification claims through the canonical read path. */
async function readClaims(
  port: CockpitReadPort,
): Promise<{ claims: CertificationClaimSummary[]; readAt: number }> {
  const page = await port.scroll('certification' as ReadModelKind);
  const claims: CertificationClaimSummary[] = [];
  for (const read of page.records as readonly CanonicalRead[]) {
    claims.push(toCertificationClaimSummary(read));
  }
  return { claims, readAt: page.readAt };
}

/** Build the home view model over the demo corpus (the deterministic posture). */
async function buildDemoHomeView(): Promise<EvaluationHomeViewModel> {
  const context = await getDemoEvaluationContext();
  const corpus: EvaluationDemoCorpus = context.corpus;
  const { claims, readAt } = await readClaims(context.port);

  const reports: EvaluationReportView[] = [
    toEvaluationReportView({
      record: corpus.evaluationRecord,
      criteria: corpus.criteria,
      descriptor: corpus.evaluator,
      reportId: EVALUATION_DEMO_IDS.report,
    }),
  ];
  const verifications: VerificationDetailView[] = [
    toVerificationDetailView({
      record: corpus.verificationRecord,
      descriptor: corpus.verifier,
      verificationId: EVALUATION_DEMO_IDS.verification,
    }),
  ];
  const certifications: CertificationDetailView[] = [
    toCertificationDetailView({
      record: corpus.certificationRunA,
      suite: corpus.suite,
      supersededRunDigests: [corpus.certificationRunA.digest],
      revocations: [corpus.revocation],
      certificationId: EVALUATION_DEMO_IDS.certificationRunA,
    }),
    toCertificationDetailView({
      record: corpus.certificationRunB,
      suite: corpus.suite,
      supersededRunDigests: [corpus.certificationRunA.digest],
      revocations: [corpus.revocation],
      certificationId: EVALUATION_DEMO_IDS.certificationRunB,
    }),
  ];

  return Object.freeze({
    mode: 'demo',
    tenantId: context.facts.tenantId,
    workspaceId: context.facts.workspaceId,
    principalLabel: context.facts.principalLabel,
    reports: Object.freeze(reports),
    verifications: Object.freeze(verifications),
    certifications: Object.freeze(certifications),
    claims: Object.freeze(claims),
    distinctionNote: EVALUATION_DISTINCTION_NOTE,
    legend: truthClassLegend(),
    emptySections: Object.freeze(
      claims.length === 0 ? ['certification claims (canonical read path)'] : [],
    ),
    reportHrefBase: '/demo/evaluation/reports',
    verificationHrefBase: '/demo/evaluation/verification',
    certificationHrefBase: '/demo/evaluation/certification',
    readAt,
    demo: Object.freeze({
      isDemo: true,
      ...(context.corpusHash !== undefined ? { corpusHash: context.corpusHash } : {}),
    }),
  } satisfies EvaluationHomeViewModel);
}

/**
 * Resolve the `/evaluation` experience: probe the browser session (fail
 * closed — typed AUTH_* outcomes render the auth-required notice, never
 * an anonymous surface), then build the home view. In the local session
 * posture the protocol sections are HONESTLY empty: no evaluation runs
 * are recorded, and the certification claims read through the canonical
 * read path render whatever the record store actually holds.
 */
export async function resolveEvaluationExperience(
  options: ResolveEvaluationExperienceOptions = {},
): Promise<EvaluationExperience> {
  const outcome = await resolveSessionEvaluation({
    ...(options.probe !== undefined ? { probe: options.probe } : {}),
    ...(options.readModel !== undefined ? { readModel: options.readModel } : {}),
  });
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required' };
  }
  const facts: CockpitSessionFacts = outcome.facts;
  const { claims, readAt } = await readClaims(outcome.port);

  return {
    kind: 'home',
    view: Object.freeze({
      mode: 'session',
      tenantId: facts.tenantId,
      workspaceId: facts.workspaceId,
      principalLabel: facts.principalLabel,
      reports: Object.freeze([]),
      verifications: Object.freeze([]),
      certifications: Object.freeze([]),
      claims: Object.freeze(claims),
      distinctionNote: EVALUATION_DISTINCTION_NOTE,
      legend: truthClassLegend(),
      emptySections: Object.freeze([
        'evaluation reports',
        'verification records',
        'certification runs',
        ...(claims.length === 0 ? ['certification claims (canonical read path)'] : []),
      ]),
      reportHrefBase: '/evaluation/reports',
      verificationHrefBase: '/evaluation/verification',
      certificationHrefBase: '/evaluation/certification',
      readAt,
      demo: Object.freeze({ isDemo: false }),
    } satisfies EvaluationHomeViewModel),
  };
}

/** Resolve the DEMO `/demo/evaluation` home view (B006 posture, deterministic). */
export async function resolveDemoEvaluationHome(): Promise<EvaluationHomeViewModel> {
  return buildDemoHomeView();
}

// ---------------------------------------------------------------------------
// Detail experiences (report / verification / certification)
// ---------------------------------------------------------------------------

/** What an evaluation report detail renders: auth-required, honest not-found, or the report. */
export type EvaluationReportExperience =
  | { readonly kind: 'auth-required' }
  | { readonly kind: 'not-found'; readonly reportId: string }
  | { readonly kind: 'report'; readonly view: EvaluationReportView };

/** What a verification detail renders: auth-required, honest not-found, or the record. */
export type VerificationExperience =
  | { readonly kind: 'auth-required' }
  | { readonly kind: 'not-found'; readonly verificationId: string }
  | { readonly kind: 'verification'; readonly view: VerificationDetailView };

/** What a certification detail renders: auth-required, honest not-found, or the claim. */
export type CertificationExperience =
  | { readonly kind: 'auth-required' }
  | { readonly kind: 'not-found'; readonly certificationId: string }
  | { readonly kind: 'certification'; readonly view: CertificationDetailView };

export interface ResolveDetailExperienceOptions {
  /** Session probe override (test seam); default: the B004 session boundary. */
  readonly probe?: NonNullable<Parameters<typeof resolveSessionEvaluation>[0]>['probe'];
  /** Read-model override (composition seam). */
  readonly readModel?: CanonicalReadModel;
  readonly id: string;
}

/**
 * Resolve the `/evaluation/reports/:reportId` experience. The session
 * posture has no recorded evaluation runs, so an authenticated session
 * resolves the honest not-found outcome — never a fabricated report.
 */
export async function resolveEvaluationReportExperience(
  options: ResolveDetailExperienceOptions,
): Promise<EvaluationReportExperience> {
  const outcome = await resolveSessionEvaluation({
    ...(options.probe !== undefined ? { probe: options.probe } : {}),
    ...(options.readModel !== undefined ? { readModel: options.readModel } : {}),
  });
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required' };
  }
  return { kind: 'not-found', reportId: options.id };
}

/** Resolve the `/evaluation/verification/:verificationId` experience (honest not-found in the session posture). */
export async function resolveVerificationExperience(
  options: ResolveDetailExperienceOptions,
): Promise<VerificationExperience> {
  const outcome = await resolveSessionEvaluation({
    ...(options.probe !== undefined ? { probe: options.probe } : {}),
    ...(options.readModel !== undefined ? { readModel: options.readModel } : {}),
  });
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required' };
  }
  return { kind: 'not-found', verificationId: options.id };
}

/** Resolve the `/evaluation/certification/:certificationId` experience (honest not-found in the session posture). */
export async function resolveCertificationExperience(
  options: ResolveDetailExperienceOptions,
): Promise<CertificationExperience> {
  const outcome = await resolveSessionEvaluation({
    ...(options.probe !== undefined ? { probe: options.probe } : {}),
    ...(options.readModel !== undefined ? { readModel: options.readModel } : {}),
  });
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required' };
  }
  return { kind: 'not-found', certificationId: options.id };
}

/** Resolve the DEMO report detail (`/demo/evaluation/reports/:reportId`) over the deterministic corpus. */
export async function resolveDemoEvaluationReportExperience(
  reportId: string,
): Promise<EvaluationReportExperience> {
  if (reportId !== EVALUATION_DEMO_IDS.report) {
    return { kind: 'not-found', reportId };
  }
  const corpus = await demoCorpus();
  return {
    kind: 'report',
    view: toEvaluationReportView({
      record: corpus.evaluationRecord,
      criteria: corpus.criteria,
      descriptor: corpus.evaluator,
      reportId: EVALUATION_DEMO_IDS.report,
    }),
  };
}

/** Resolve the DEMO verification detail (`/demo/evaluation/verification/:verificationId`). */
export async function resolveDemoVerificationExperience(
  verificationId: string,
): Promise<VerificationExperience> {
  if (verificationId !== EVALUATION_DEMO_IDS.verification) {
    return { kind: 'not-found', verificationId };
  }
  const corpus = await demoCorpus();
  return {
    kind: 'verification',
    view: toVerificationDetailView({
      record: corpus.verificationRecord,
      descriptor: corpus.verifier,
      verificationId: EVALUATION_DEMO_IDS.verification,
    }),
  };
}

/** Resolve the DEMO certification detail (`/demo/evaluation/certification/:certificationId`). */
export async function resolveDemoCertificationExperience(
  certificationId: string,
): Promise<CertificationExperience> {
  const corpus = await demoCorpus();
  if (certificationId === EVALUATION_DEMO_IDS.certificationRunA) {
    return {
      kind: 'certification',
      view: toCertificationDetailView({
        record: corpus.certificationRunA,
        suite: corpus.suite,
        supersededRunDigests: [corpus.certificationRunA.digest],
        revocations: [corpus.revocation],
        certificationId: EVALUATION_DEMO_IDS.certificationRunA,
      }),
    };
  }
  if (certificationId === EVALUATION_DEMO_IDS.certificationRunB) {
    return {
      kind: 'certification',
      view: toCertificationDetailView({
        record: corpus.certificationRunB,
        suite: corpus.suite,
        supersededRunDigests: [corpus.certificationRunA.digest],
        revocations: [corpus.revocation],
        certificationId: EVALUATION_DEMO_IDS.certificationRunB,
      }),
    };
  }
  return { kind: 'not-found', certificationId };
}

/** The deterministic protocol corpus (composed once per process for demo routes). */
let corpusSingleton: Promise<EvaluationDemoCorpus> | undefined;

function demoCorpus(): Promise<EvaluationDemoCorpus> {
  corpusSingleton ??= buildEvaluationDemoCorpus();
  return corpusSingleton;
}

/** Hard reset of the corpus singleton (test seam). */
export function resetDemoCorpusSingleton(): void {
  corpusSingleton = undefined;
}
