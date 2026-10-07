/**
 * Body-marketplace service ports (Work Order C014) — the ONLY things
 * services/body-marketplace depends on besides the domain packages
 * (@arena/body-forge, @arena/certification, @arena/body-registry,
 * @arena/agent-body, @arena/escalation-validation, @arena/protocol-core).
 *
 * Mirroring the services-layer house pattern (C008/C009 precedent):
 * every sibling-surface seam is an INJECTED PORT — never an import of
 * another service (boundary rule B2):
 *
 *   - ValidatedEvidencePort      — THE C009 SEAM: only adjudications the
 *                                  escalation-validation surface ACCEPTED
 *                                  are admissible training evidence;
 *   - ImprovementCandidatePort    — THE C008 SEAM: body-improvement /
 *                                  tool-specification / knowledge
 *                                  candidates (MARKETPLACE_ARTIFACT and
 *                                  BODY_IMPROVEMENT feed stages);
 *   - ForgePort                   — THE A021 SEAM: pretraining runs
 *                                  PROPOSE new immutable BodyVersions
 *                                  through the forge's public port — a
 *                                  certified Body is never mutated (lock
 *                                  rule 5; AB1.0 Evolution law);
 *   - CertificationCandidatePort  — THE A023 SEAM: new versions enter
 *                                  the certification pipeline as
 *                                  candidates (suite runs, pass criteria,
 *                                  minimum evidence per EV1.0);
 *   - CertificationRecordStore    — digest-addressed read of A023
 *                                  records (the listing certification
 *                                  posture is RECORD-BACKED only);
 *   - BodyRegistryPort            — THE A024 SEAM: releases are
 *                                  registered/published through the
 *                                  registry; listings are typed views
 *                                  over registry releases;
 *   - Clock                       — time is INJECTED (never a wall-clock
 *                                  read; architecture-lock rule 17).
 *
 * Authority boundary (lock rule 16): this service OWNS request
 * compilation, forge proposals, listing lifecycle and grant records
 * only. It never judges domain outcomes beyond the typed guards (the
 * A023 engine owns certification verdicts; the A024 gate owns release
 * admission), never invents money truth (settlement stays with the
 * payments/economics surfaces — recorded as an architecture question)
 * and never mutates a certified Body.
 */

import type { BodyManifest, ForgePolicy, ForgeRecord, ForgeRecipe, ForgeResult } from '@arena/body-forge';
import type { BodyVersion } from '@arena/agent-body';
import type { CertificationRecord } from '@arena/certification';
import type {
  ReleaseCandidateInput,
  ReleasePublicationRecord,
  ReleaseRecord,
} from '@arena/body-registry';
import type {
  ImprovementCandidateView,
  ValidatedInterventionEvidenceView,
} from './pretraining.js';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

// ---------------------------------------------------------------------------
// THE C009 SEAM — validated intervention evidence
// ---------------------------------------------------------------------------

/**
 * THE C009 SEAM. Resolves intervention-evidence adjudications by digest,
 * tenant-scoped (cross-tenant reads return undefined). Hosts wire the
 * escalation-validation surface's ACCEPTED adjudications into this port.
 */
export interface ValidatedEvidencePort {
  resolve(digest: string, tenantId: string): Promise<ValidatedInterventionEvidenceView | undefined>;
}

// ---------------------------------------------------------------------------
// THE C008 SEAM — improvement candidates
// ---------------------------------------------------------------------------

/**
 * THE C008 SEAM. Resolves capability-improvement candidates by id,
 * tenant-scoped. Hosts wire the capability-improvement surface's
 * BODY_IMPROVEMENT_CANDIDATE / MARKETPLACE_ARTIFACT_CANDIDATE /
 * tool-specification / knowledge feed records into this port.
 */
export interface ImprovementCandidatePort {
  resolve(candidateId: string, tenantId: string): Promise<ImprovementCandidateView | undefined>;
}

// ---------------------------------------------------------------------------
// THE A021 SEAM — the forge (proposals of NEW immutable versions only)
// ---------------------------------------------------------------------------

/** One forge submission through the A021 public port. */
export interface ForgeSubmission {
  readonly manifest: BodyManifest;
  readonly policy: ForgePolicy;
  readonly recipe: ForgeRecipe;
  /** REQUIRED idempotency key — the forge execution address (lock rule 17). */
  readonly forgeKey: string;
  /** Free-form provenance notes recorded onto the ForgeRecord. */
  readonly notes?: string | null;
}

/** THE A021 SEAM. Proposes NEW immutable BodyVersions; never mutates one. */
export interface ForgePort {
  submit(submission: ForgeSubmission): Promise<ForgeResult>;
  /** Look up a forge record by digest (lineage reads). */
  getRecord(digest: string): Promise<ForgeRecord | undefined>;
}

// ---------------------------------------------------------------------------
// THE A023 SEAM — certification candidacy for the new version
// ---------------------------------------------------------------------------

/** The certification composition under test (the AB1.0 tested composition). */
export interface CertificationCandidateRequest {
  /** The NEW BodyVersion proposal the pretraining run produced. */
  readonly bodyVersion: BodyVersion;
  /** The certification suite digest; null lets the port use its default suite. */
  readonly suiteRef: string | null;
  readonly tenantId: string;
  readonly correlationId: string;
  /** REQUIRED idempotency key — the certification run address (lock rule 17). */
  readonly idempotencyKey: string;
  readonly executedAt: string;
}

/** The outcome of one certification-candidate run. */
export interface CertificationCandidateResult {
  /** The REAL A023 CertificationRecord (the only certification truth). */
  readonly record: CertificationRecord;
}

/**
 * THE A023 SEAM. New versions enter the certification pipeline as
 * CANDIDATES: suite runs, pass criteria, minimum evidence per EV1.0.
 * Certification applies to the tested composition, never the base model.
 */
export interface CertificationCandidatePort {
  runCertificationCandidate(request: CertificationCandidateRequest): Promise<CertificationCandidateResult>;
}

/** Digest-addressed read of A023 records (record-backed posture reads). */
export interface CertificationRecordStore {
  resolve(digest: string): Promise<CertificationRecord | undefined>;
}

// ---------------------------------------------------------------------------
// THE A024 SEAM — body-registry releases and publication
// ---------------------------------------------------------------------------

/** Registration options passed through to the A024 seam. */
export interface ReleaseRegistrationOptions {
  readonly releaseVersion: string;
  readonly channel: string;
  readonly tags?: readonly string[];
  readonly tenantId: string | null;
  readonly recordedAt: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly releasedBy: string;
  readonly notes: string | null;
}

/** Publication options passed through to the A024 seam. */
export interface ReleasePublicationOptions {
  readonly publisher: { readonly type: string; readonly tenant: string; readonly principalId: string };
  readonly rights: unknown;
  readonly publishedAt: string;
}

/** The resolved status of one release identity (A024 projection). */
export interface ReleaseStatusView {
  readonly state: 'registered' | 'superseded' | 'retired' | 'unknown';
  readonly visibility: 'published' | 'unpublished';
  readonly registration: ReleaseRecord | null;
  readonly publication: ReleasePublicationRecord | null;
}

/** THE A024 SEAM. Listings are typed views over registry releases. */
export interface BodyRegistryPort {
  /** Register one release candidate through the A024 admission gate. */
  register(candidate: ReleaseCandidateInput, options: ReleaseRegistrationOptions): Promise<ReleaseRecord>;
  /** Explicitly publish (or retract is NOT offered here — append-only via A024) one release. */
  publish(release: { readonly namespace: string; readonly name: string; readonly version: string }, options: ReleasePublicationOptions): Promise<ReleasePublicationRecord>;
  /** Resolve one release artifact identity's registration + publication state. */
  resolveStatus(release: { readonly namespace: string; readonly name: string; readonly version: string }): Promise<ReleaseStatusView>;
  /** Look up one release record by digest. */
  getRecord(digest: string): Promise<ReleaseRecord | undefined>;
}
