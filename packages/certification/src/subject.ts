/**
 * CertificationSubject — the COMPOSITION UNDER TEST (Work Order A023;
 * requirements R21, R43, R44; architecture-lock rule 4; the README
 * design law).
 *
 * Arena certifies statements of the form: "Agent Body B, version V,
 * possessed by Cognitive Substrate M, under Environment E and Runtime
 * Profile R, satisfied Certification Suite S at revision X." The subject
 * IS the B/V/M/E/R half of that statement — every component is REQUIRED
 * and a subject missing any component is rejected by construction
 * (CERTIFICATION_INVALID_SUBJECT). There is NO API through which a
 * caller could certify a substrate in isolation: the design law is
 * enforced by the shape itself (R46 — prevent professional
 * qualification inference from substrate certification alone).
 *
 * Components:
 *   - `bodyVersionRef` — the A003 BodyVersionRef (tenant, name, version,
 *     digest) — reused from @arena/agent-body, never redefined;
 *   - `substrateRef` — the neutral substrate reference: substrateId +
 *     substrateVersion + the content digest of the substrate
 *     declaration (the cognitive substrate M of the statement);
 *   - `environmentRef` — the A003 EnvironmentProfileView (environmentId,
 *     environmentVersion, constraints) — the environment E;
 *   - `runtimeProfile` — the A003 RuntimeProfileView (runtimeId,
 *     runtimeVersion, closed scalar configuration) — the runtime R;
 *   - `possessionRef` — optional digest of the A003 Possession binding
 *     the exact body×substrate×environment×runtime composition (null
 *     when the certification is run before a possession is issued);
 *   - `tenantId` / `workspaceId` — tenant/workspace scoping (lock rule
 *     11; recorded onto every derived record; null for platform-level
 *     runs).
 */

import { isBodyVersionRef, isEnvironmentProfileView, isRuntimeProfileView } from '@arena/agent-body';
import type {
  BodyVersionRef,
  EnvironmentProfileView,
  RuntimeProfileView,
} from '@arena/agent-body';
import { CERTIFICATION_ERROR_CODES, CertificationError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  isCertificationVersion,
  isContentDigest,
  isNeutralId,
  isTenantId,
  isWorkspaceId,
  toCertificationVersion,
  toContentDigest,
  toNeutralId,
  toOptionalContentDigest,
  toOptionalTenantId,
  toOptionalWorkspaceId,
} from './shared.js';
import type {
  ContentDigest,
  NeutralId,
  TenantId,
  WorkspaceId,
} from './shared.js';

/** The neutral cognitive-substrate reference (component M of the statement). */
export interface SubstrateRef {
  readonly substrateId: NeutralId;
  readonly substrateVersion: string;
  /** Content digest of the substrate declaration (the exact M under test). */
  readonly digest: ContentDigest;
}

/** Stable field list for a substrate ref (tests + contracts mirror it). */
export const SUBSTRATE_REF_FIELDS = Object.freeze([
  'substrateId',
  'substrateVersion',
  'digest',
] as const) as readonly string[];

/** Structural (non-throwing) check for a substrate ref. */
export function isSubstrateRef(value: unknown): value is SubstrateRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['substrateId']) &&
    isCertificationVersion(candidate['substrateVersion']) &&
    isContentDigest(candidate['digest'])
  );
}

function toSubstrateRef(value: unknown): SubstrateRef {
  const record = expectFields(
    value,
    ['substrateId', 'substrateVersion', 'digest'],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_SUBJECT,
    'certification subject substrateRef',
  );
  return deepFreeze({
    substrateId: toNeutralId(
      typeof record['substrateId'] === 'string' ? record['substrateId'] : '',
      'certification subject substrateRef substrateId',
    ),
    substrateVersion: toCertificationVersion(
      typeof record['substrateVersion'] === 'string' ? record['substrateVersion'] : '',
      'certification subject substrateRef substrateVersion',
    ),
    digest: toContentDigest(
      typeof record['digest'] === 'string' ? record['digest'] : '',
      'certification subject substrateRef digest',
    ),
  });
}

/** The composition under test — B/V + M + E + R (every component REQUIRED). */
export interface CertificationSubject {
  readonly bodyVersionRef: BodyVersionRef;
  readonly substrateRef: SubstrateRef;
  readonly environmentRef: EnvironmentProfileView;
  readonly runtimeProfile: RuntimeProfileView;
  readonly possessionRef: ContentDigest | null;
  readonly tenantId: TenantId | null;
  readonly workspaceId: WorkspaceId | null;
}

/** Stable field list for the subject (tests + contracts mirror it). */
export const CERTIFICATION_SUBJECT_FIELDS = Object.freeze([
  'bodyVersionRef',
  'substrateRef',
  'environmentRef',
  'runtimeProfile',
  'possessionRef',
  'tenantId',
  'workspaceId',
] as const) as readonly string[];

/** Structural (non-throwing) check for the subject — every component required. */
export function isCertificationSubject(value: unknown): value is CertificationSubject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isBodyVersionRef(candidate['bodyVersionRef']) &&
    isSubstrateRef(candidate['substrateRef']) &&
    isEnvironmentProfileView(candidate['environmentRef']) &&
    isRuntimeProfileView(candidate['runtimeProfile']) &&
    (candidate['possessionRef'] === null || isContentDigest(candidate['possessionRef'])) &&
    (candidate['tenantId'] === null || isTenantId(candidate['tenantId'])) &&
    (candidate['workspaceId'] === null || isWorkspaceId(candidate['workspaceId']))
  );
}

/**
 * Create a validated, deep-frozen certification subject. Rejects any
 * input missing a scope component or carrying unknown fields — a
 * substrate-only or environment-less subject is unrepresentable.
 */
export function createCertificationSubject(input: {
  readonly bodyVersionRef: BodyVersionRef;
  readonly substrateRef: {
    readonly substrateId: string;
    readonly substrateVersion: string;
    readonly digest: string;
  };
  readonly environmentRef: EnvironmentProfileView;
  readonly runtimeProfile: RuntimeProfileView;
  readonly possessionRef?: string | null;
  readonly tenantId?: string | null;
  readonly workspaceId?: string | null;
}): CertificationSubject {
  const record = expectFields(
    input,
    [
      'bodyVersionRef',
      'substrateRef',
      'environmentRef',
      'runtimeProfile',
      'possessionRef',
      'tenantId',
      'workspaceId',
    ],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_SUBJECT,
    'certification subject',
  );
  if (!isBodyVersionRef(record['bodyVersionRef'])) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUBJECT, {
      message: 'certification subject: a valid A003 BodyVersionRef is required (the Agent Body B, version V of the statement)',
    });
  }
  if (
    !isEnvironmentProfileView(record['environmentRef']) ||
    !isRuntimeProfileView(record['runtimeProfile'])
  ) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUBJECT, {
      message: 'certification subject: the composition under test requires valid A003 environment and runtime profile components (the E and R of the statement)',
    });
  }
  const subject: CertificationSubject = deepFreeze({
    bodyVersionRef: record['bodyVersionRef'],
    substrateRef: toSubstrateRef(record['substrateRef']),
    environmentRef: record['environmentRef'],
    runtimeProfile: record['runtimeProfile'],
    possessionRef: toOptionalContentDigest(
      record['possessionRef'],
      'certification subject possessionRef',
    ),
    tenantId: toOptionalTenantId(record['tenantId'], 'certification subject tenantId'),
    workspaceId: toOptionalWorkspaceId(record['workspaceId'], 'certification subject workspaceId'),
  });
  if (!isCertificationSubject(subject)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUBJECT, {
      message: 'certification subject: the composition under test requires environment and runtime profile components (the E and R of the statement)',
    });
  }
  return subject;
}

/** The subject scope key — B@V × M@V × E@V × R@V (uniqueness/dedup key). */
export function certificationSubjectKey(subject: CertificationSubject): string {
  return [
    `body:${subject.bodyVersionRef.tenant}/${subject.bodyVersionRef.name}@${subject.bodyVersionRef.version}#${subject.bodyVersionRef.digest}`,
    `substrate:${subject.substrateRef.substrateId}@${subject.substrateRef.substrateVersion}#${subject.substrateRef.digest}`,
    `environment:${subject.environmentRef.environmentId}@${subject.environmentRef.environmentVersion}`,
    `runtime:${subject.runtimeProfile.runtimeId}@${subject.runtimeProfile.runtimeVersion}`,
  ].join(' | ');
}
