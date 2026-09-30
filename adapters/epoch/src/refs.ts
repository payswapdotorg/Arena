/**
 * EPI1.0 Arena-output refs (Work Order A026; spec/epoch-integration.md
 * "Arena outputs").
 *
 * The spec lists ELEVEN Arena output ref kinds. (The dispatch brief said
 * "twelve"; the repository spec is the source of truth — the discrepancy
 * is disclosed in the A026 PR.) Each ref is content-addressed per the
 * A002 discipline: the (kind, digest) pair is the identity; `address`
 * carries the Arena-side addressable identity string (e.g. the A005
 * `arena:case/<tenant>/<caseId>@<semver>#<sha256>` form or the A003
 * `<tenant>/<name>@<version>#<digest>` body form).
 *
 * Three kinds are resolvable through the A025 public read surface
 * (@arena/arena-sdk): agent-body-version, compatibility-report and
 * certification — the query-kind map below is the closed bridge.
 */

import { isContentDigestValue } from '@arena/arena-sdk';
import { formatCaseVersionRef, caseVersionRef } from '@arena/capability-case';
import type { CapabilityCase } from '@arena/capability-case';
import { EPOCH_ADAPTER_ERROR_CODES, EpochAdapterError } from './errors.js';

export const EPOCH_OUTPUT_REF_VERSION = 1 as const;

/** The closed EPI1.0 Arena-output ref vocabulary (exactly the spec's eleven). */
export const EPOCH_OUTPUT_REF_KINDS = Object.freeze([
  'capability-case',
  'task-spec',
  'environment',
  'expert-work',
  'trajectory-set',
  'evaluator',
  'verifier',
  'skill-artifact',
  'agent-body-version',
  'compatibility-report',
  'certification',
] as const);

export type EpochOutputRefKind = (typeof EPOCH_OUTPUT_REF_KINDS)[number];

export function isEpochOutputRefKind(value: unknown): value is EpochOutputRefKind {
  return (
    typeof value === 'string' &&
    (EPOCH_OUTPUT_REF_KINDS as readonly string[]).includes(value)
  );
}

/** Arena-side addressable identity charset (covers A005/A003/A024 ref forms). */
export const EPOCH_OUTPUT_REF_ADDRESS_PATTERN_SOURCE =
  '^[a-z0-9][a-z0-9:._/@#-]{0,511}$';

const ADDRESS_PATTERN = new RegExp(EPOCH_OUTPUT_REF_ADDRESS_PATTERN_SOURCE);

export interface EpochOutputRef {
  readonly refVersion: typeof EPOCH_OUTPUT_REF_VERSION;
  readonly kind: EpochOutputRefKind;
  /** sha256 content digest of the referenced Arena artifact (64 lowercase hex). */
  readonly digest: string;
  /** The Arena-side addressable identity (content-addressed, A002 discipline). */
  readonly address: string;
}

export function isEpochOutputRef(value: unknown): value is EpochOutputRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['refVersion'] === EPOCH_OUTPUT_REF_VERSION &&
    isEpochOutputRefKind(candidate['kind']) &&
    typeof candidate['digest'] === 'string' &&
    isContentDigestValue(candidate['digest']) &&
    typeof candidate['address'] === 'string' &&
    ADDRESS_PATTERN.test(candidate['address'])
  );
}

/** Validate and freeze an EPI1.0 output ref (fail-closed, closed shape). */
export function toEpochOutputRef(value: unknown): EpochOutputRef {
  if (typeof value !== 'object' || value === null) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REF, {
      message: 'epoch output ref must be a plain object',
      details: { received: typeof value },
    });
  }
  const candidate = value as Record<string, unknown>;
  const required = ['refVersion', 'kind', 'digest', 'address'];
  for (const key of Object.keys(candidate)) {
    if (!required.includes(key)) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REF, {
        message: `epoch output ref carries unknown field ${JSON.stringify(key)} (closed shape)`,
        details: { field: key },
      });
    }
  }
  for (const key of required) {
    if (!(key in candidate)) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REF, {
        message: `epoch output ref is missing required field ${JSON.stringify(key)}`,
        details: { field: key },
      });
    }
  }
  if (candidate['refVersion'] !== EPOCH_OUTPUT_REF_VERSION) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION, {
      message: `epoch output ref version must be ${EPOCH_OUTPUT_REF_VERSION} (received ${JSON.stringify(candidate['refVersion'])})`,
      details: { supported: EPOCH_OUTPUT_REF_VERSION },
    });
  }
  if (!isEpochOutputRefKind(candidate['kind'])) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REF, {
      message: `unknown epoch output ref kind: ${JSON.stringify(candidate['kind'])}`,
      details: { supported: EPOCH_OUTPUT_REF_KINDS },
    });
  }
  if (
    typeof candidate['digest'] !== 'string' ||
    !isContentDigestValue(candidate['digest'])
  ) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REF, {
      message: `epoch output ref digest must be 64 lowercase hex chars (received ${JSON.stringify(candidate['digest'])})`,
      details: { field: 'digest', pattern: '^[0-9a-f]{64}$' },
    });
  }
  if (
    typeof candidate['address'] !== 'string' ||
    !ADDRESS_PATTERN.test(candidate['address'])
  ) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REF, {
      message: `epoch output ref address must match the Arena addressable-identity charset (received ${JSON.stringify(candidate['address'])})`,
      details: { field: 'address', pattern: EPOCH_OUTPUT_REF_ADDRESS_PATTERN_SOURCE },
    });
  }
  const ref: EpochOutputRef = {
    refVersion: EPOCH_OUTPUT_REF_VERSION,
    kind: candidate['kind'],
    digest: candidate['digest'],
    address: candidate['address'],
  };
  return Object.freeze(ref);
}

/** Stable content-addressed identity key: `epoch-output/<kind>#<digest>`. */
export function epochOutputRefKey(ref: EpochOutputRef): string {
  return `epoch-output/${ref.kind}#${ref.digest}`;
}

/** Cite an A005 capability case as the EPI1.0 CapabilityCaseRef. */
export function epochOutputRefFromCapabilityCase(
  caseRecord: CapabilityCase,
): EpochOutputRef {
  const ref = caseVersionRef(caseRecord);
  return toEpochOutputRef({
    refVersion: EPOCH_OUTPUT_REF_VERSION,
    kind: 'capability-case',
    digest: caseRecord.digest,
    address: formatCaseVersionRef(ref),
  });
}

/** Cite an A003 body version ref as the EPI1.0 AgentBodyVersionRef. */
export function epochOutputRefFromBodyVersion(value: {
  readonly tenant: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}): EpochOutputRef {
  return toEpochOutputRef({
    refVersion: EPOCH_OUTPUT_REF_VERSION,
    kind: 'agent-body-version',
    digest: value.digest,
    address: `${value.tenant}/${value.name}@${value.version}#${value.digest}`,
  });
}

/**
 * The closed bridge from EPI1.0 ref kinds to A025 public read-surface
 * query kinds. Only these three Arena outputs are resolvable through the
 * current Arena API surface; other refs are carried validated + frozen,
 * awaiting a future read surface (disclosed limitation).
 */
export const EPOCH_REF_QUERY_KINDS: Readonly<
  Record<'agent-body-version' | 'compatibility-report' | 'certification', string>
> = Object.freeze({
  'agent-body-version': 'get-body-version',
  'compatibility-report': 'get-compatibility-record',
  certification: 'get-certification-record',
});

export function isQueryableEpochOutputRefKind(
  kind: EpochOutputRefKind,
): kind is 'agent-body-version' | 'compatibility-report' | 'certification' {
  return kind in EPOCH_REF_QUERY_KINDS;
}
