/**
 * Rights/consent gating for human-data deliverables (Work Order C012;
 * issue #118). THE WALL (spec/security.md "Data rights"; architecture-lock
 * rules 11, 18, 31; EES1.0 session completion):
 *
 *   - a deliverable carries an EXPLICIT consent/rights statement — the
 *     EES1.0-shaped { granted, statement } record structurally mirrored
 *     from @arena/expert-session's session-submission consent field
 *     (a domain package may not be reimplemented — the SHAPE is mirrored
 *     byte-equal and validated here);
 *   - a deliverable WITHOUT GRANTED consent can NEVER enter a dataset
 *     bundle — `requireGrantedConsent` is the structural gate every bundle
 *     assembly path funnels through (tested adversarially: fail closed);
 *   - rights metadata (license/commercialUse/redistribution/customerData/
 *     professionalLimitations) is validated through the REUSED A002
 *     toRightsMetadata — never reimplemented here;
 *   - customer data is never used cross-tenant (the tenant scope of the
 *     commission, the deliverable and the dataset must agree — enforced
 *     in bundles.ts and the reference service).
 */

import type { RightsMetadata } from '@arena/artifact-protocol';
import { toRightsMetadata } from '@arena/artifact-protocol';
import { HUMAN_DATA_ERROR_CODES, HumanDataError } from './errors.js';

/** Maximum consent statement length (the EES1.0 bound). */
export const CONSENT_STATEMENT_MAX_LENGTH = 4096;

/**
 * The explicit consent/rights statement (EES1.0 shape, structurally
 * mirrored): `granted` + the human-readable statement of what was
 * consented to and under which terms.
 */
export interface ConsentRightsStatement {
  readonly granted: boolean;
  readonly statement: string;
}

export function isConsentRightsStatement(value: unknown): value is ConsentRightsStatement {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['granted'] === 'boolean' &&
    typeof candidate['statement'] === 'string' &&
    candidate['statement'].length > 0 &&
    candidate['statement'].length <= CONSENT_STATEMENT_MAX_LENGTH
  );
}

/** Validate and freeze a consent/rights statement (fail-closed). */
export function toConsentRightsStatement(value: unknown): ConsentRightsStatement {
  if (!isConsentRightsStatement(value)) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.CONSENT_WALL, {
      message: `consentRightsStatement { granted, statement } is REQUIRED (EES1.0 mirror): received ${JSON.stringify(value)}`,
      details: { statementMaxLength: CONSENT_STATEMENT_MAX_LENGTH },
    });
  }
  return Object.freeze({ granted: value.granted, statement: value.statement });
}

/**
 * THE RIGHTS WALL — require GRANTED consent for `what`. A non-granted or
 * malformed statement fails closed with HUMAN_DATA_CONSENT_WALL: no
 * deliverable without explicit granted rights may enter a dataset bundle.
 */
export function requireGrantedConsent(
  statement: ConsentRightsStatement | unknown,
  what: string,
): ConsentRightsStatement {
  const validated = toConsentRightsStatement(statement);
  if (!validated.granted) {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.CONSENT_WALL, {
      message: `${what} carries a consent/rights statement that is NOT granted — the rights wall rejects it (a deliverable without explicit granted consent can never enter a dataset bundle)`,
      details: { granted: false },
    });
  }
  return validated;
}

/** Validate rights posture through the REUSED A002 guard (never reimplemented). */
export function toRightsPosture(value: unknown): RightsMetadata {
  return toRightsMetadata(value);
}

/**
 * Consequence exposure for the studio builder: the machine-readable
 * consequences of a rights/retention declaration the customer is about to
 * make (the ERF1.0 learning-state law — operational delivery is separate
 * from training-data rights, so the declaration is explicit, never implied).
 */
export function rightsDeclarationConsequences(rights: RightsMetadata): readonly string[] {
  return Object.freeze([
    `license: ${rights.license}`,
    `commercial use: ${rights.commercialUse}`,
    `redistribution: ${rights.redistribution}`,
    `customer data exposure: ${rights.customerData}`,
    ...(rights.professionalLimitations !== undefined && rights.professionalLimitations.length > 0
      ? [`professional limitations: ${rights.professionalLimitations.join('; ')}`]
      : []),
  ]);
}
