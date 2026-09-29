/**
 * CertificationSuiteDescriptor — the content-addressed, versioned DECLARATION
 * of a certification suite (Work Order A023; spec AB1.0 design law — "Arena
 * certifies statements of the form: Agent Body B, version V, possessed by
 * Cognitive Substrate M, under Environment E and Runtime Profile R,
 * satisfied Certification Suite S at revision X."; spec/quality-model.md
 * "Certification levels"; architecture-lock rule 12 — public artifacts are
 * explicitly published and versioned; the assessor-versioning rule binds
 * suites identically: changing a suite requires a new version).
 *
 * A suite descriptor binds:
 *   - `suiteId` + `version` — the suite's own versioned identity.
 *     Because the descriptor is content-addressed, ANY change to ANY field
 *     changes the digest; registering a different descriptor under the
 *     same (suiteId, version) is an identity conflict in the reference
 *     registry (services/certification) — the enforcement point of "any
 *     change ⇒ a new version";
 *   - `title` — a short, human-readable label;
 *   - `scopeStatement` — the canonical text of the design-law statement
 *     form this suite certifies (the certification record's statement
 *     object is DERIVED from this template + the actual body/substrate/
 *     environment/runtime-profile/suite-revision tuple; the suite
 *     declaration itself pins the suite portion of the statement);
 *   - `evaluationRefs` — sha256 content digests of A012 EvaluatorDescriptor
 *     objects the suite composes (zero or more; the engine resolves each
 *     against the supplied component results — refs MUST be set-equal to
 *     the component summary's evaluation entries);
 *   - `verificationRefs` — sha256 content digests of A013
 *     VerifierDescriptor objects (zero or more; same set-equality rule);
 *   - `compatibilityRefs` — sha256 content digests of A022
 *     CompatibilityRecord objects (zero or more; same set-equality rule).
 *     At least ONE of {evaluationRefs, verificationRefs,
 *     compatibilityRefs} MUST be non-empty (a suite with zero components
 *     of every kind is suite-misconfiguration at derivation time, but the
 *     descriptor itself REJECTS this at construction);
 *   - `verdictSemantics` — the declared meaning of pass / conditional-pass
 *     / fail / unknown for THIS suite (all four mandatory);
 *   - `inputSchema` / `outputSchema` — versioned SchemaRefs naming the
 *     suite's input and output schemas (the reference fabric pins
 *     arena:schema/certification/certification-record@1.0.0 as output);
 *   - `provenance` — who authored the suite, when, with what notes.
 *
 * Content addressing: the sha256 digest is computed over the canonical
 * JSON of the digest-free view with @arena/protocol-core's
 * digestCanonical — NEVER reimplemented here. Same descriptor ⇒ same
 * digest; deep-frozen at creation — there is NO mutation API. The
 * descriptor's digest IS the "revision X" the design law names — the
 * suite's content-addressed revision.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { SchemaRef } from '@arena/protocol-core';
import { isSchemaRef } from '@arena/protocol-core';
import { CERTIFICATION_ERROR_CODES, CertificationError } from './errors.js';
import type { ComponentKind } from './component-kind.js';
import { isComponentKind, toComponentKind } from './component-kind.js';
import type { VerdictSemantics } from './verdict.js';
import { isVerdictSemantics, toVerdictSemantics } from './verdict.js';
import {
  deepFreeze,
  expectFields,
  isContentDigest,
  isNeutralId,
  isNeutralText,
  isCertificationTimestamp,
  isCertificationVersion,
  toContentDigest,
  toNeutralId,
  toNeutralText,
  toSchemaRefValue,
  toCertificationTimestamp,
  toCertificationVersion,
  isCertificationId,
} from './shared.js';
import type {
  ContentDigest,
  NeutralId,
  NeutralText,
  CertificationTimestamp,
  CertificationVersion,
  CertificationId,
} from './shared.js';

/** Wire version of the certification-suite shape. */
export const CERTIFICATION_SUITE_VERSION = 1 as const;

/** Identity charset for suite ids (closed, neutral). */
export const SUITE_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';

const SUITE_ID_PATTERN = new RegExp(SUITE_ID_PATTERN_SOURCE);

function toSuiteId(value: string): CertificationId {
  if (typeof value !== 'string' || !SUITE_ID_PATTERN.test(value)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `suite descriptor: invalid suite id: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { pattern: SUITE_ID_PATTERN_SOURCE },
    });
  }
  return value as CertificationId;
}

// ---------------------------------------------------------------------------
// Suite provenance
// ---------------------------------------------------------------------------

/** Provenance of the suite declaration (spec AB1.0 "provenance"). */
export interface SuiteProvenance {
  /** Neutral identity of the authoring principal (expert, org, pipeline). */
  readonly authoredBy: NeutralId;
  /** When the descriptor was authored (ms-precision UTC). */
  readonly submittedAt: CertificationTimestamp;
  /** Optional free-form notes (method, data sources, review state). */
  readonly notes: NeutralText | null;
}

/** Stable field list for suite provenance (tests + contracts mirror it). */
export const SUITE_PROVENANCE_FIELDS = Object.freeze([
  'authoredBy',
  'submittedAt',
  'notes',
] as const) as readonly string[];

/** Structural (non-throwing) check for suite provenance. */
export function isSuiteProvenance(value: unknown): value is SuiteProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['authoredBy']) &&
    isCertificationTimestamp(candidate['submittedAt']) &&
    (candidate['notes'] === null || isNeutralText(candidate['notes']))
  );
}

function toSuiteProvenance(value: unknown): SuiteProvenance {
  const record = expectFields(
    value,
    ['authoredBy', 'submittedAt', 'notes'],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_PROVENANCE,
    'suite provenance',
  );
  const notes = record['notes'];
  if (notes !== null && typeof notes !== 'string') {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'suite provenance: notes must be neutral text or null',
    });
  }
  return deepFreeze({
    authoredBy: toNeutralId(
      typeof record['authoredBy'] === 'string' ? record['authoredBy'] : '',
      'suite provenance authoredBy',
    ),
    submittedAt: toCertificationTimestamp(
      typeof record['submittedAt'] === 'string' ? record['submittedAt'] : '',
      'suite provenance submittedAt',
    ),
    notes: notes === null ? null : toNeutralText(notes, 'suite provenance notes'),
  });
}

// ---------------------------------------------------------------------------
// Suite component ref list (per-kind)
// ---------------------------------------------------------------------------

/** A typed list of component refs (one kind, zero or more digests). */
export interface SuiteComponentRefs {
  /** The closed component kind this list names. */
  readonly kind: ComponentKind;
  /** sha256 content digests of the referenced sibling descriptors/records. */
  readonly refs: readonly ContentDigest[];
}

/** Stable field list for a component ref list (tests + contracts mirror it). */
export const SUITE_COMPONENT_REFS_FIELDS = Object.freeze([
  'kind',
  'refs',
] as const) as readonly string[];

function toSuiteComponentRefs(
  value: unknown,
  index: number,
): SuiteComponentRefs {
  const record = expectFields(
    value,
    ['kind', 'refs'],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_SUITE,
    `suite component refs ${String(index + 1)}`,
  );
  const kind = toComponentKind(
    typeof record['kind'] === 'string' ? record['kind'] : '',
    `suite component refs ${String(index + 1)}`,
  );
  const refsRaw = record['refs'];
  if (!Array.isArray(refsRaw)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUITE, {
      message: `suite component refs ${String(index + 1)}: refs must be an array of content digests`,
    });
  }
  const seen = new Set<string>();
  const refs: ContentDigest[] = [];
  for (const r of refsRaw) {
    if (typeof r !== 'string' || !isContentDigest(r)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_DIGEST, {
        message: `suite component refs ${String(index + 1)}: every ref must be a content digest`,
      });
    }
    if (seen.has(r)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.DUPLICATE_COMPONENT, {
        message: `suite component refs ${String(index + 1)}: duplicate ref digest ${r}`,
        details: { ref: r },
      });
    }
    seen.add(r);
    refs.push(r);
  }
  return deepFreeze({ kind, refs: Object.freeze(refs) });
}

// ---------------------------------------------------------------------------
// CertificationSuiteDescriptor
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the descriptor digest commits to. */
export interface CertificationSuiteDescriptorView {
  readonly recordVersion: typeof CERTIFICATION_SUITE_VERSION;
  readonly suiteId: CertificationId;
  readonly version: CertificationVersion;
  readonly title: NeutralText;
  readonly scopeStatement: NeutralText;
  readonly components: readonly SuiteComponentRefs[];
  readonly verdictSemantics: VerdictSemantics;
  readonly inputSchema: SchemaRef;
  readonly outputSchema: SchemaRef;
  readonly provenance: SuiteProvenance;
}

/** A frozen, content-addressed suite descriptor: the view plus its sha256 digest. */
export interface CertificationSuiteDescriptor
  extends CertificationSuiteDescriptorView {
  readonly digest: ContentDigest;
}

/** Stable field list for the descriptor view (tests + contracts mirror it). */
export const CERTIFICATION_SUITE_DESCRIPTOR_FIELDS = Object.freeze([
  'recordVersion',
  'suiteId',
  'version',
  'title',
  'scopeStatement',
  'components',
  'verdictSemantics',
  'inputSchema',
  'outputSchema',
  'provenance',
] as const) as readonly string[];

export interface CreateCertificationSuiteInput {
  readonly suiteId: string;
  readonly version: string;
  readonly title: string;
  readonly scopeStatement: string;
  readonly components: readonly {
    readonly kind: string;
    readonly refs: readonly string[];
  }[];
  readonly verdictSemantics: {
    readonly pass: string;
    readonly 'conditional-pass': string;
    readonly fail: string;
    readonly unknown: string;
  };
  readonly inputSchema: SchemaRef;
  readonly outputSchema: SchemaRef;
  readonly provenance: {
    readonly authoredBy: string;
    readonly submittedAt: string;
    readonly notes: string | null;
  };
}

/** Structural (non-throwing) check for the digest-free view. */
export function isCertificationSuiteDescriptorView(
  value: unknown,
): value is CertificationSuiteDescriptorView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['recordVersion'] !== CERTIFICATION_SUITE_VERSION ||
    !isCertificationId(candidate['suiteId']) ||
    !isCertificationVersion(candidate['version']) ||
    !isNeutralText(candidate['title']) ||
    !isNeutralText(candidate['scopeStatement']) ||
    !Array.isArray(candidate['components']) ||
    !isVerdictSemantics(candidate['verdictSemantics']) ||
    !isSchemaRef(candidate['inputSchema']) ||
    !isSchemaRef(candidate['outputSchema']) ||
    !isSuiteProvenance(candidate['provenance'])
  ) {
    return false;
  }
  // Validate each component ref list structurally.
  for (const c of candidate['components'] as unknown[]) {
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return false;
    const rec = c as Record<string, unknown>;
    if (!isComponentKind(rec['kind'])) return false;
    if (!Array.isArray(rec['refs'])) return false;
    for (const r of rec['refs']) {
      if (!isContentDigest(r)) return false;
    }
  }
  return true;
}

/** Structural (non-throwing) check for the full descriptor (view + digest). */
export function isCertificationSuiteDescriptor(
  value: unknown,
): value is CertificationSuiteDescriptor {
  if (!isCertificationSuiteDescriptorView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed certification suite
 * descriptor. Rejects:
 *   - unknown component kinds (closed enum);
 *   - empty component lists (every list MUST carry at least one ref);
 *   - suites with zero total components (a suite that declares no checks
 *     can never establish satisfaction);
 *   - duplicate refs within or across lists;
 *   - incomplete verdict semantics (any of the four missing);
 *   - malformed schemas / provenance;
 *   - unknown fields — all with typed CertificationErrors.
 */
export async function createCertificationSuite(
  input: CreateCertificationSuiteInput,
): Promise<CertificationSuiteDescriptor> {
  const record = expectFields(
    input,
    [
      'suiteId',
      'version',
      'title',
      'scopeStatement',
      'components',
      'verdictSemantics',
      'inputSchema',
      'outputSchema',
      'provenance',
    ],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_SUITE,
    'certification suite descriptor',
  );

  // Validate components list (non-empty, every entry has ≥1 ref, unique kind+refs).
  const componentsRaw = record['components'];
  if (!Array.isArray(componentsRaw) || componentsRaw.length === 0) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUITE, {
      message: 'a certification suite must declare at least one component list (evaluation, verification, compatibility)',
    });
  }
  const components = componentsRaw.map((entry, index) =>
    toSuiteComponentRefs(entry, index),
  );

  // Cross-list validation: no duplicate kind, and total refs ≥ 1.
  const seenKinds = new Set<string>();
  const allRefs = new Set<string>();
  for (const c of components) {
    if (seenKinds.has(c.kind)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.DUPLICATE_COMPONENT, {
        message: `duplicate component kind ${JSON.stringify(c.kind)} in suite components list (each kind may appear at most once)`,
        details: { kind: c.kind },
      });
    }
    seenKinds.add(c.kind);
    if (c.refs.length === 0) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUITE, {
        message: `component list for kind ${JSON.stringify(c.kind)} is empty (a kind that appears must carry at least one ref)`,
      });
    }
    for (const r of c.refs) {
      if (allRefs.has(r)) {
        throw new CertificationError(CERTIFICATION_ERROR_CODES.DUPLICATE_COMPONENT, {
          message: `duplicate component ref digest ${r} across the suite components (the same sibling descriptor cannot be a member of two kinds)`,
        });
      }
      allRefs.add(r);
    }
  }

  // The scope statement MUST contain the suite's own identity somewhere
  // (lightweight check; the canonical statement template is provided by
  // the suite author and the engine substitutes the actual refs at record
  // time). We do not impose strict text matching; we only require it
  // be non-empty neutral text.
  const verdictSemantics = toVerdictSemantics(record['verdictSemantics']);

  const view: CertificationSuiteDescriptorView = {
    recordVersion: CERTIFICATION_SUITE_VERSION,
    suiteId: toSuiteId(
      typeof record['suiteId'] === 'string' ? record['suiteId'] : '',
    ),
    version: toCertificationVersion(
      typeof record['version'] === 'string' ? record['version'] : '',
      'certification suite version',
    ),
    title: toNeutralText(
      typeof record['title'] === 'string' ? record['title'] : '',
      'certification suite title',
    ),
    scopeStatement: toNeutralText(
      typeof record['scopeStatement'] === 'string' ? record['scopeStatement'] : '',
      'certification suite scopeStatement',
    ),
    components: Object.freeze(components.map((c) => deepFreeze({ ...c }))),
    verdictSemantics,
    inputSchema: toSchemaRefValue(
      (isSchemaRef(record['inputSchema'])
        ? record['inputSchema']
        : { namespace: '', name: '', version: '' }) as SchemaRef,
    ),
    outputSchema: toSchemaRefValue(
      (isSchemaRef(record['outputSchema'])
        ? record['outputSchema']
        : { namespace: '', name: '', version: '' }) as SchemaRef,
    ),
    provenance: toSuiteProvenance(record['provenance']),
  };
  const digest = toContentDigest(
    await digestCanonical(view),
    'certification suite descriptor digest',
  );
  return deepFreeze({ ...view, digest }) as CertificationSuiteDescriptor;
}

/** The digest-free view of a descriptor (what the digest commits to). */
export function certificationSuiteDescriptorView(
  descriptor: CertificationSuiteDescriptor,
): CertificationSuiteDescriptorView {
  const { digest: _digest, ...view } = descriptor;
  return deepFreeze({ ...view }) as CertificationSuiteDescriptorView;
}

/**
 * Recompute the descriptor digest over the digest-free view and compare
 * (optionally against an expected digest). Throws CERTIFICATION_TAMPERED
 * on any mismatch.
 */
export async function recomputeCertificationSuiteDigest(
  descriptor: CertificationSuiteDescriptor,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isCertificationSuiteDescriptor(descriptor)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUITE, {
      message: 'descriptor digest recomputation requires a structurally valid certification suite descriptor',
    });
  }
  const actual = await digestCanonical(
    certificationSuiteDescriptorView(descriptor),
  );
  if (
    actual !== descriptor.digest ||
    (expectedDigest !== undefined && actual !== expectedDigest)
  ) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.TAMPERED, {
      message: `certification suite descriptor digest mismatch: expected ${expectedDigest ?? descriptor.digest}, got ${actual}`,
      details: {
        suiteId: descriptor.suiteId,
        version: descriptor.version,
        expected: expectedDigest ?? descriptor.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed suite descriptor digest');
}

/**
 * The suite identity key — "suiteId@version". The reference registry
 * (services/certification) keys duplicate detection on this pair:
 * registering a DIFFERENT descriptor digest under the same identity is a
 * version conflict (spec/quality-model.md: changing a suite requires a new
 * version — same version, different bytes is a conflict, never a silent
 * improvement).
 */
export function certificationSuiteIdentityKey(
  descriptor: CertificationSuiteDescriptor,
): string {
  return `${descriptor.suiteId}@${descriptor.version}`;
}

/**
 * List every (kind, ref) tuple the suite declares, in declaration order.
 * Used by the engine to check set-equality between the suite's declared
 * refs and the supplied component-verdict summary.
 */
export function suiteComponentRefs(
  descriptor: CertificationSuiteDescriptor,
): ReadonlyArray<{ readonly kind: ComponentKind; readonly ref: ContentDigest }> {
  const out: Array<{ readonly kind: ComponentKind; readonly ref: ContentDigest }> = [];
  for (const list of descriptor.components) {
    for (const ref of list.refs) {
      out.push({ kind: list.kind, ref });
    }
  }
  return Object.freeze(out);
}
