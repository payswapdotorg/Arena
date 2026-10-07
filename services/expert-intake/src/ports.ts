/**
 * The injected PORTS of the expert-intake reference service (Work Order
 * C003; spec/service-boundaries.md).
 *
 * The service NEVER writes into another surface's state: submissions hand
 * the IntakeProfile to the A006/A007 PUBLIC ports declared here. The
 * ports are data-in/receipt-out seams — the real A006 registry and A007
 * qualification fabrics implement them; tests inject fakes.
 *
 * CLAIMS ARE INPUT TO QUALIFICATION, NEVER AN ACCESS GRANT (lock rules
 * 9/35): there is deliberately NO port method that grants, implies or
 * records a permission. An intake output consumed as an access grant has
 * no code path here at all.
 */

import type { AvailabilityWindowView, JurisdictionView } from '@arena/expert-qualification';

/** The A006 registry-field-group proposal (pure data from the IntakeProfile). */
export interface RegistryProposalData {
  readonly expertId: string;
  readonly tenant: string;
  readonly identityRefs: readonly string[];
  readonly competencies: readonly {
    readonly capability: { readonly kind: string; readonly id: string; readonly version: string; readonly digest: string };
    readonly proficiency: string;
    readonly evidenceRefs: readonly { readonly evidenceKind: string; readonly digest: string }[];
  }[];
  readonly availabilityWindows: readonly AvailabilityWindowView[];
  readonly locales: readonly string[];
  readonly jurisdictions: readonly JurisdictionView[];
  readonly domainScope?: {
    readonly domainRef: { readonly kind: string; readonly id: string; readonly version: string; readonly digest: string };
    readonly limitations: readonly string[];
  };
  readonly privacyPolicy: {
    readonly dataClassification: string;
    readonly pii: string;
    readonly transcriptRetentionConsent: boolean;
  };
}

/** The A006 port's receipt (data about the proposal outcome). */
export interface RegistryProposalReceipt {
  readonly accepted: boolean;
  /** Reference to the registry-side draft/profile record, when accepted. */
  readonly profileRef?: string;
  readonly reasons?: readonly string[];
}

/**
 * The A006 public port intake submits proposals against. Implementations
 * own profile construction, lifecycle and public-view derivation.
 */
export interface ExpertRegistryProposalPort {
  submitRegistryProposal(proposal: RegistryProposalData): Promise<RegistryProposalReceipt>;
}

/** One A007 qualification claim candidate (pure data from the IntakeProfile). */
export interface QualificationClaimCandidateData {
  readonly expertId: string;
  readonly tenant: string;
  readonly capability: { readonly kind: string; readonly id: string; readonly version: string; readonly digest: string };
  readonly proficiency: string;
  readonly evidence: readonly string[];
  readonly declaredAt: string;
}

/** The A007 port's receipt (data about the claim-candidate outcome). */
export interface QualificationClaimReceipt {
  readonly accepted: boolean;
  /** Digest of the registered claim, when accepted. */
  readonly claimRef?: string;
  readonly reasons?: readonly string[];
}

/**
 * The A007 public port intake submits claim candidates against.
 * Implementations own evidence validation and qualification records —
 * an accepted claim candidate is a CLAIM awaiting evidence evaluation,
 * never a qualification and never an access grant.
 */
export interface QualificationClaimPort {
  submitClaimCandidate(claim: QualificationClaimCandidateData): Promise<QualificationClaimReceipt>;
}
