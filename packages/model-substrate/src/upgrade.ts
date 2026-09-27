/**
 * SubstrateUpgrade — the R45 upgrade path between cognitive substrates
 * (Work Order A016; requirement R45; architecture-lock rule 22: versioned
 * artifacts cannot silently redefine identity).
 *
 * An upgrade is a DECLARATION: old substrate digest → new substrate digest,
 * with recertification REQUIRED — always. The type encodes this as the
 * literal `true` (`recertificationRequired: true`), so no value of this
 * type can ever claim a recertification-free upgrade.
 *
 * THE HARD INVARIANT (R45): an upgrade NEVER silently rebinds a Possession.
 * A new Possession version is required — enforced here at THREE levels:
 *
 *   1. TYPE level: SubstrateUpgrade has no possession field of any kind
 *      (compile-time absence — pinned by an @ts-expect-error test);
 *   2. CONSTRUCTION level: every possession-shaped or rebind-shaped input
 *      field is rejected with MODEL_SUBSTRATE_POSSESSION_REBIND_FORBIDDEN
 *      (closed shape + explicit deny list);
 *   3. API level: this package exports no function that rebinds, updates
 *      or mutates a Possession (asserted by the hygiene suite's export
 *      screening). Creating the new possession version is the agent-body
 *      protocol's job, done explicitly by its owner.
 */

import type { VersionedArtifactRef } from '@arena/agent-body';
import { MODEL_SUBSTRATE_ERROR_CODES, ModelSubstrateError } from './errors.js';
import {
  assertNoCredentialFields,
  assertNoPossessionRebindFields,
  assertProviderNeutralString,
  deepFreeze,
  isContentDigest,
  isNeutralId,
  isTimestampView,
  toContentDigest,
  toTimestampView,
  toVersionedArtifactRefView,
  isVersionedArtifactRefView,
} from './shared.js';

// ---------------------------------------------------------------------------
// SubstrateUpgrade
// ---------------------------------------------------------------------------

/** Wire version of the substrate upgrade shape. */
export const SUBSTRATE_UPGRADE_RECORD_VERSION = 1 as const;

/**
 * A declared substrate upgrade: `fromSubstrateDigest` →
 * `toSubstrateDigest`, recertification REQUIRED (literal true), optional
 * content-addressed adaptation artifacts (lock rule 22: versioned, never
 * silently mutating anything), and the declaration timestamp.
 *
 * There is NO possession field — by design (R45). An upgrade never
 * rebinds a Possession: a NEW possession version must be created
 * explicitly through the agent-body protocol.
 */
export interface SubstrateUpgrade {
  readonly recordVersion: typeof SUBSTRATE_UPGRADE_RECORD_VERSION;
  /** Neutral upgrade id (registry handle; the digests are the truth). */
  readonly upgradeId: string;
  /** Content address of the substrate being upgraded away from. */
  readonly fromSubstrateDigest: string;
  /** Content address of the substrate being upgraded to. */
  readonly toSubstrateDigest: string;
  /** Recertification is REQUIRED for every upgrade (R45) — always true. */
  readonly recertificationRequired: true;
  /** Optional content-addressed adaptation artifacts for the upgrade. */
  readonly adaptations: readonly VersionedArtifactRef[];
  /** UTC millisecond timestamp of the declaration. */
  readonly declaredAt: string;
}

export interface CreateSubstrateUpgradeInput {
  readonly upgradeId: string;
  readonly fromSubstrateDigest: string;
  readonly toSubstrateDigest: string;
  /**
   * Must be the literal `true`: no recertification-free upgrade exists
   * (R45). Passing `false` is a type error AND a runtime rejection.
   */
  readonly recertificationRequired: true;
  readonly adaptations?: readonly {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }[];
  readonly declaredAt?: string;
}

/** Exact field set of an upgrade input (unknown fields are rejected). */
export const SUBSTRATE_UPGRADE_INPUT_FIELDS = Object.freeze([
  'upgradeId',
  'fromSubstrateDigest',
  'toSubstrateDigest',
  'recertificationRequired',
  'adaptations',
  'declaredAt',
] as const);

function invalidUpgrade(message: string, details?: Record<string, unknown>): never {
  throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_UPGRADE, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

/**
 * Validate and freeze a substrate upgrade declaration. Enforces:
 *   - neutral upgrade id (no provider brand names, no credentials);
 *   - both digests are valid sha256 content addresses and DIFFERENT (a
 *     self-upgrade is not an upgrade);
 *   - `recertificationRequired` is the literal true (R45);
 *   - NO possession-shaped or rebind-shaped field anywhere in the input
 *     (an upgrade never silently rebinds a Possession — a new possession
 *     version is required);
 *   - adaptation artifacts are content-addressed and duplicate-free.
 */
export function createSubstrateUpgrade(input: CreateSubstrateUpgradeInput): SubstrateUpgrade {
  assertNoCredentialFields(input, 'substrateUpgrade');
  assertNoPossessionRebindFields(input as unknown as Record<string, unknown>);

  const knownFields = new Set<string>(SUBSTRATE_UPGRADE_INPUT_FIELDS);
  for (const key of Object.keys(input as unknown as Record<string, unknown>)) {
    if (!knownFields.has(key)) {
      invalidUpgrade(
        `unknown substrate upgrade field: ${JSON.stringify(key)} (closed shape; an upgrade is a declaration only — it never references or rebinds a Possession)`,
        { known: [...SUBSTRATE_UPGRADE_INPUT_FIELDS] },
      );
    }
  }

  if (typeof input.upgradeId !== 'string' || !isNeutralId(input.upgradeId)) {
    invalidUpgrade(
      `invalid upgrade id: ${JSON.stringify(input.upgradeId)} (lowercase neutral identifier required)`,
    );
  }
  assertProviderNeutralString(input.upgradeId, 'upgradeId');

  if (
    typeof input.fromSubstrateDigest !== 'string' ||
    !isContentDigest(input.fromSubstrateDigest)
  ) {
    invalidUpgrade(
      `invalid from-substrate digest: ${JSON.stringify(input.fromSubstrateDigest)} (expected lowercase sha256 hex)`,
    );
  }
  if (typeof input.toSubstrateDigest !== 'string' || !isContentDigest(input.toSubstrateDigest)) {
    invalidUpgrade(
      `invalid to-substrate digest: ${JSON.stringify(input.toSubstrateDigest)} (expected lowercase sha256 hex)`,
    );
  }
  if (input.fromSubstrateDigest === input.toSubstrateDigest) {
    invalidUpgrade(
      'from-substrate and to-substrate digests are identical: an upgrade must move to different content (a self-upgrade is not an upgrade)',
    );
  }

  if (input.recertificationRequired !== true) {
    invalidUpgrade(
      'recertificationRequired must be true: every substrate upgrade is subject to recertification (requirement R45) — no recertification-free upgrade exists',
    );
  }

  const adaptations: VersionedArtifactRef[] = [];
  const seen = new Set<string>();
  for (const ref of input.adaptations ?? []) {
    if (!isVersionedArtifactRefView(ref)) {
      invalidUpgrade(`invalid adaptation artifact: ${JSON.stringify(ref)}`);
    }
    const frozen = toVersionedArtifactRefView(ref);
    const key = `${frozen.namespace}/${frozen.name}@${frozen.version}#${frozen.digest}`;
    if (seen.has(key)) {
      invalidUpgrade(`duplicate adaptation artifact: ${key}`);
    }
    seen.add(key);
    adaptations.push(frozen);
  }

  const declaredAt = input.declaredAt ?? new Date().toISOString();
  if (!isTimestampView(declaredAt)) {
    invalidUpgrade(
      `invalid declaration timestamp: ${JSON.stringify(declaredAt)} (expected UTC ISO-8601 with exactly millisecond precision)`,
    );
  }

  return deepFreeze({
    recordVersion: SUBSTRATE_UPGRADE_RECORD_VERSION,
    upgradeId: input.upgradeId,
    fromSubstrateDigest: toContentDigest(input.fromSubstrateDigest),
    toSubstrateDigest: toContentDigest(input.toSubstrateDigest),
    recertificationRequired: true,
    adaptations: Object.freeze(adaptations),
    declaredAt: toTimestampView(declaredAt),
  });
}

/** Structural guard for a substrate upgrade. */
export function isSubstrateUpgrade(value: unknown): value is SubstrateUpgrade {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['recordVersion'] !== SUBSTRATE_UPGRADE_RECORD_VERSION ||
    typeof candidate['upgradeId'] !== 'string' ||
    !isNeutralId(candidate['upgradeId']) ||
    typeof candidate['fromSubstrateDigest'] !== 'string' ||
    !isContentDigest(candidate['fromSubstrateDigest']) ||
    typeof candidate['toSubstrateDigest'] !== 'string' ||
    !isContentDigest(candidate['toSubstrateDigest']) ||
    candidate['recertificationRequired'] !== true ||
    typeof candidate['declaredAt'] !== 'string' ||
    !isTimestampView(candidate['declaredAt'])
  ) {
    return false;
  }
  // The possession-rebind invariant is structural: a possession-shaped
  // field makes a value NOT an upgrade.
  for (const key of Object.keys(candidate)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (POSSESSION_SHAPE_KEYS.includes(normalized)) return false;
  }
  const adaptations = candidate['adaptations'];
  return (
    Array.isArray(adaptations) &&
    adaptations.every((ref) => isVersionedArtifactRefView(ref))
  );
}

const POSSESSION_SHAPE_KEYS = [
  'possession',
  'possessionid',
  'possessiondigest',
  'possessionref',
  'targetpossession',
  'rebind',
  'rebinds',
  'rebindpossession',
  'rebindstopossession',
  'silentlyrebind',
  'updatepossession',
  'replacepossession',
  'mutatepossession',
];
