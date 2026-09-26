/**
 * PrincipalRef — the tenant-scoped principal that created or acted on an
 * artifact (docs/architecture.md §15: "source/creator"; lock rules 10, 23).
 *
 * A principal is NEVER a raw provider identity: the closed `type` enum has no
 * model/provider member (a Cognitive Substrate is not an actor — it is
 * possessed by bodies; see AGENTS.md "Agent Body principle"), and the
 * principal identifier charset excludes `@`, `:`, `/`, whitespace and every
 * other character that provider identity shapes (emails, account URLs,
 * key-like strings) require. Provider details stay behind adapters.
 */

import { ARTIFACT_ERROR_CODES, ArtifactError } from './errors.js';
import type { ArtifactNamespace } from './identity.js';
import { isArtifactNamespace, toArtifactNamespace } from './identity.js';
import type { Brand } from '@arena/protocol-core';

export type PrincipalId = Brand<string, 'PrincipalId'>;

/** Closed set of principal types that may appear in artifact records. */
export const PRINCIPAL_TYPES = [
  'agent-body',
  'expert',
  'user',
  'service',
  'system',
] as const;

export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

/**
 * Exact pattern source for principal identifiers. Deliberately the same
 * identifier charset family as @arena/protocol-core's correlation ids: no
 * `@`, `:`, `/`, `%` or spaces — raw provider identity strings cannot match.
 */
export const PRINCIPAL_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

const PRINCIPAL_ID_PATTERN = new RegExp(PRINCIPAL_ID_PATTERN_SOURCE);

export interface PrincipalRef {
  readonly type: PrincipalType;
  readonly tenant: ArtifactNamespace;
  readonly principalId: PrincipalId;
}

export function isPrincipalType(value: unknown): value is PrincipalType {
  return (
    typeof value === 'string' && (PRINCIPAL_TYPES as readonly string[]).includes(value)
  );
}

export function isPrincipalId(value: unknown): value is PrincipalId {
  return typeof value === 'string' && PRINCIPAL_ID_PATTERN.test(value);
}

export function isPrincipalRef(value: unknown): value is PrincipalRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isPrincipalType(candidate['type']) &&
    isArtifactNamespace(candidate['tenant']) &&
    isPrincipalId(candidate['principalId'])
  );
}

/**
 * Validate and freeze a principal reference. Unknown principal types
 * (including any model/provider notion) are rejected with
 * ARTIFACT_INVALID_PRINCIPAL.
 */
export function toPrincipalRef(value: {
  type: string;
  tenant: string;
  principalId: string;
}): PrincipalRef {
  if (!isPrincipalType(value.type)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_PRINCIPAL, {
      message: `unknown principal type: ${JSON.stringify(value.type)} (known: ${PRINCIPAL_TYPES.join(', ')})`,
      details: { known: [...PRINCIPAL_TYPES] },
    });
  }
  if (!isPrincipalId(value.principalId)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_PRINCIPAL, {
      message: `invalid principal id: ${JSON.stringify(value.principalId)} (raw provider identities are not principal identifiers)`,
      details: { pattern: PRINCIPAL_ID_PATTERN_SOURCE },
    });
  }
  const principal: PrincipalRef = Object.freeze({
    type: value.type,
    tenant: toArtifactNamespace(value.tenant),
    principalId: value.principalId,
  });
  return principal;
}
