/**
 * Expert-service listing view models (Work Order B013; issue #88;
 * packages/marketplace-ui).
 *
 * An expert-service listing projects the A031 marketplace card shape
 * honestly: identity, the qualification evidence chain (provenance under
 * the evidence class), engagement terms + professional limitations (the
 * rights posture), qualification proof status (verification under its own
 * class), certification presence (ALWAYS not-certified for expert services —
 * an expert qualification is a distinct concept from a certification), and
 * the entitlement state (explicitly unknown — expert access is governed by
 * engagement records, never implied by ownership).
 */

import { buildCertificationPresence } from './certification.js';
import type { CertificationPresence } from './certification.js';
import { noGrantEntitlement } from './entitlement.js';
import type { EntitlementStateView } from './entitlement.js';
import { readProvenanceRef } from './provenance.js';
import type { ProvenanceSummary } from './provenance.js';
import { buildRightsPosture } from './rights.js';
import type { RightsPosture } from './rights.js';
import {
  asRecord,
  deepFreezeView,
  EXPERT_QUALIFICATION_NOT_CERTIFICATION_NOTE,
  MARKETPLACE_UI_VIEW_VERSION,
  readCount,
  readNumber,
  readString,
  readStringArray,
} from './shared.js';
import { buildVerificationStatus } from './verification.js';
import type { VerificationStatus } from './verification.js';

/** One commercial offer of an expert listing (honest reads). */
export interface ExpertOfferView {
  readonly offerId: string | undefined;
  readonly kind: string | undefined;
  readonly headline: string | undefined;
  readonly currency: string | undefined;
  readonly amountMinor: number | undefined;
  readonly unit: string | undefined;
}

/** One qualification proof of an expert listing (the A007 gate view). */
export interface QualificationProofView {
  readonly claimRef: string | undefined;
  readonly recordRef: string | undefined;
  readonly status: string | undefined;
  readonly inForce: boolean | undefined;
  readonly validUntil: string | undefined;
}

/** The expert-service listing card. */
export interface ExpertListingCard {
  readonly viewVersion: typeof MARKETPLACE_UI_VIEW_VERSION;
  readonly family: 'expert-service';
  readonly listingId: string | undefined;
  readonly listingRef: string | undefined;
  readonly tenant: string | undefined;
  readonly expertId: string | undefined;
  readonly headline: string | undefined;
  readonly description: string | undefined;
  readonly capabilities: readonly string[];
  readonly domains: readonly string[];
  readonly jurisdictions: readonly string[];
  readonly qualificationProofs: readonly QualificationProofView[];
  readonly offers: readonly ExpertOfferView[];
  readonly engagements: number | undefined;
  readonly completed: number | undefined;
  readonly reviews: number | undefined;
  readonly averageRating: number | undefined;
  readonly publishedAt: string | undefined;
  readonly provenance: ProvenanceSummary;
  readonly rights: RightsPosture;
  readonly verification: VerificationStatus;
  readonly certification: CertificationPresence;
  readonly entitlement: EntitlementStateView;
  readonly unknownFields: readonly string[];
}

/** The qualification-chain scope note (evidence, never certification). */
const QUALIFICATION_PROVENANCE_NOTE =
  'The qualification evidence chain (A007): the claimed capability, its work-product evidence digests and the gate record. Evidence — never a certification and never a verified claim.';

const EXPERT_ENTITLEMENT_NOTE =
  'No entitlement grant backs an expert-service listing: expert access is governed by engagement records (requested → accepted → completed), rendered separately — never implied by ownership.';

/**
 * Build the provenance summary from an A007 qualification record shape
 * (expertId, capability ref, evidence digests, evaluatedAt) — projected as
 * the listing's evidence chain.
 */
export function buildQualificationProvenance(record: unknown): ProvenanceSummary {
  const data = asRecord(record);
  const unknownFields: string[] = [];
  const tenant = readString(data, 'tenant');
  const expertId = readString(data, 'expertId');
  const capability = asRecord(data['capability']);
  const capName = readString(capability, 'id');
  const capVersion = readString(capability, 'version');
  const capDigest = readString(capability, 'digest');
  const evaluatedAt = readString(data, 'evaluatedAt');

  const artifact =
    capName !== undefined || capDigest !== undefined
      ? readProvenanceRef({
          namespace: tenant,
          name: capName,
          version: capVersion,
          digest: capDigest,
        })
      : undefined;
  if (artifact === undefined) unknownFields.push('capability ref');
  const creator =
    expertId !== undefined && tenant !== undefined
      ? Object.freeze({
          type: 'expert' as const,
          tenant,
          principalId: expertId,
        })
      : undefined;
  if (creator === undefined) unknownFields.push('expert identity');
  if (evaluatedAt === undefined) unknownFields.push('evaluatedAt');

  const addresses: string[] = [];
  const evidenceValue = data['evidence'];
  if (!Array.isArray(evidenceValue)) {
    unknownFields.push('evidence');
  } else {
    for (const digest of evidenceValue) {
      if (typeof digest === 'string' && digest.length > 0 && !addresses.includes(digest)) {
        addresses.push(digest);
      }
    }
  }
  if (artifact?.digest !== undefined) addresses.unshift(artifact.digest);

  return deepFreezeView({
    viewVersion: MARKETPLACE_UI_VIEW_VERSION,
    truthClass: 'evidence',
    artifact,
    creator,
    createdAt: evaluatedAt,
    recordedAt: evaluatedAt,
    parents: Object.freeze([]),
    transformation: undefined,
    verificationRefs: Object.freeze([]),
    evidenceAddresses: Object.freeze(addresses),
    scopeNote: QUALIFICATION_PROVENANCE_NOTE,
    unknownFields: Object.freeze(unknownFields),
  } satisfies ProvenanceSummary);
}

function readOffers(value: unknown, unknownFields: string[]): readonly ExpertOfferView[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const offers: ExpertOfferView[] = [];
  value.forEach((entry, index) => {
    const data = asRecord(entry);
    const rate = asRecord(data['rate']);
    const offer = {
      offerId: readString(data, 'offerId'),
      kind: readString(data, 'kind'),
      headline: readString(data, 'headline'),
      currency: readString(rate, 'currency') ?? readString(data, 'currency'),
      amountMinor: readCount(rate, 'amountMinor') ?? readCount(data, 'amountMinor'),
      unit: readString(rate, 'unit') ?? readString(data, 'unit'),
    };
    if (offer.offerId === undefined && offer.headline === undefined) {
      unknownFields.push(`offers[${String(index)}] (malformed)`);
      return;
    }
    offers.push(Object.freeze(offer));
  });
  return Object.freeze(offers);
}

function readProofs(
  value: unknown,
  unknownFields: string[],
): readonly QualificationProofView[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const proofs: QualificationProofView[] = [];
  value.forEach((entry, index) => {
    const data = asRecord(entry);
    const inForceValue = data['inForce'];
    const proof = {
      claimRef: readString(data, 'claimRef'),
      recordRef: readString(data, 'recordRef'),
      status: readString(data, 'status') ?? readString(data, 'recordStatus'),
      inForce: typeof inForceValue === 'boolean' ? inForceValue : undefined,
      validUntil: readString(data, 'validUntil'),
    };
    if (proof.claimRef === undefined && proof.recordRef === undefined) {
      unknownFields.push(`qualificationProofs[${String(index)}] (malformed)`);
      return;
    }
    proofs.push(Object.freeze(proof));
  });
  return Object.freeze(proofs);
}

/**
 * Build the expert-service listing card from an A031 card-shaped payload
 * (identity, proofs, offers, stats) plus the composed evidence-chain input
 * (qualificationRecord, engagement terms + limitations as `rights`,
 * evaluatedAt). Honest: every missing field degrades to unknown (listed).
 */
export function buildExpertListingCard(listing: unknown): ExpertListingCard {
  const data = asRecord(listing);
  const unknownFields: string[] = [];

  const listingId = readString(data, 'listingId');
  if (listingId === undefined) unknownFields.push('listingId');
  const listingRef = readString(data, 'listingRef');
  const tenant = readString(data, 'tenant');
  if (tenant === undefined) unknownFields.push('tenant');
  const expertId = readString(data, 'expertId');
  if (expertId === undefined) unknownFields.push('expertId');
  const headline = readString(data, 'headline');
  if (headline === undefined) unknownFields.push('headline');
  const description = readString(data, 'description');
  const capabilities = readStringArray(data, 'capabilities') ?? Object.freeze([]);
  const domains = readStringArray(data, 'domains') ?? Object.freeze([]);
  const jurisdictions = readStringArray(data, 'jurisdictions') ?? Object.freeze([]);
  const qualificationProofs = readProofs(data['qualificationProofs'], unknownFields);
  const offers = readOffers(data['offers'], unknownFields);
  const engagements = readCount(data, 'engagements');
  const completed = readCount(data, 'completed');
  const reviews = readCount(data, 'reviews');
  const averageRating = readNumber(data, 'averageRating');
  const publishedAt = readString(data, 'publishedAt');

  const provenance = buildQualificationProvenance(data['qualificationRecord']);

  // Engagement terms + professional limitations project as the rights
  // posture (evidence class): the runtime composes an A002-shaped rights
  // block from the listing's terms; absent input degrades to unknown.
  const rights = buildRightsPosture(data['rights']);

  // Qualification proofs decide the verification status (own class):
  // an in-force gate record is a decided pass; anything else is undecided.
  const verification = buildVerificationStatus(
    qualificationProofs.map((proof) => ({
      kind: 'qualification',
      digest: proof.recordRef ?? proof.claimRef,
      outcome: proof.inForce === true ? 'pass' : 'unknown',
    })),
  );

  // An expert qualification is never a certification — rendered explicitly.
  const certification = deepFreezeView({
    ...buildCertificationPresence(undefined),
    scopeNote: EXPERT_QUALIFICATION_NOT_CERTIFICATION_NOTE,
  });

  // No entitlement grant backs an expert service — explicit, never implied.
  const entitlement = deepFreezeView({
    ...noGrantEntitlement(),
    scopeNote: EXPERT_ENTITLEMENT_NOTE,
  });

  return deepFreezeView({
    viewVersion: MARKETPLACE_UI_VIEW_VERSION,
    family: 'expert-service',
    listingId,
    listingRef,
    tenant,
    expertId,
    headline,
    description,
    capabilities,
    domains,
    jurisdictions,
    qualificationProofs,
    offers,
    engagements,
    completed,
    reviews,
    averageRating,
    publishedAt,
    provenance,
    rights,
    verification,
    certification,
    entitlement,
    unknownFields: Object.freeze(unknownFields),
  } satisfies ExpertListingCard);
}
