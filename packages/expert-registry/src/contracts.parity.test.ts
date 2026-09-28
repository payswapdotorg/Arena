/**
 * Contract parity tests (Work Order A006 gate 10) — bind the generated
 * contracts (contracts/expert/*.json, produced by
 * packages/expert-registry/scripts/generate-contracts.mjs) to the
 * TypeScript surface of @arena/expert-registry.
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and the drift suite (drift.test.ts) fails when
 * the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift, exactly like the A001/A002/A004/A005
 * convention.
 */

import { describe, expect, it } from 'vitest';
import expertRefSchema from '../../../contracts/expert/expert-ref.v1.json' with { type: 'json' };
import evidenceRefSchema from '../../../contracts/expert/evidence-ref.v1.json' with { type: 'json' };
import principalSchema from '../../../contracts/expert/principal.v1.json' with { type: 'json' };
import identityRefSchema from '../../../contracts/expert/identity-ref.v1.json' with { type: 'json' };
import credentialRefSchema from '../../../contracts/expert/credential-ref.v1.json' with { type: 'json' };
import competencySchema from '../../../contracts/expert/competency.v1.json' with { type: 'json' };
import qualificationSchema from '../../../contracts/expert/qualification.v1.json' with { type: 'json' };
import jurisdictionSchema from '../../../contracts/expert/jurisdiction.v1.json' with { type: 'json' };
import limitationSchema from '../../../contracts/expert/limitation.v1.json' with { type: 'json' };
import domainScopeSchema from '../../../contracts/expert/domain-scope.v1.json' with { type: 'json' };
import taskRecordRefSchema from '../../../contracts/expert/task-record-ref.v1.json' with { type: 'json' };
import reliabilityEntrySchema from '../../../contracts/expert/reliability-entry.v1.json' with { type: 'json' };
import reliabilityMetricsSchema from '../../../contracts/expert/reliability-metrics.v1.json' with { type: 'json' };
import availabilitySchema from '../../../contracts/expert/availability.v1.json' with { type: 'json' };
import privacyPolicySchema from '../../../contracts/expert/privacy-policy.v1.json' with { type: 'json' };
import domainPackSchema from '../../../contracts/expert/domain-pack.v1.json' with { type: 'json' };
import publicViewSchema from '../../../contracts/expert/public-view.v1.json' with { type: 'json' };
import profileSchema from '../../../contracts/expert/profile.v1.json' with { type: 'json' };
import lifecycleEventSchema from '../../../contracts/expert/lifecycle-event.v1.json' with { type: 'json' };
import registrationRecordSchema from '../../../contracts/expert/registration-record.v1.json' with { type: 'json' };
import errorSchema from '../../../contracts/expert/expert-error.v1.json' with { type: 'json' };
import registerCommandSchema from '../../../contracts/expert/register-expert-command.v1.json' with { type: 'json' };
import publishCommandSchema from '../../../contracts/expert/publish-profile-command.v1.json' with { type: 'json' };
import retireCommandSchema from '../../../contracts/expert/retire-profile-command.v1.json' with { type: 'json' };
import supersedeCommandSchema from '../../../contracts/expert/supersede-profile-command.v1.json' with { type: 'json' };
import attachEvidenceCommandSchema from '../../../contracts/expert/attach-evidence-command.v1.json' with { type: 'json' };
import recordTaskCommandSchema from '../../../contracts/expert/record-task-command.v1.json' with { type: 'json' };
import recordReliabilityCommandSchema from '../../../contracts/expert/record-reliability-command.v1.json' with { type: 'json' };
import registeredEventSchema from '../../../contracts/expert/expert-registered-event.v1.json' with { type: 'json' };
import packPublishedEventSchema from '../../../contracts/expert/domain-pack-published-event.v1.json' with { type: 'json' };
import registrySchema from '../../../contracts/expert/expert-schema-registry.v1.json' with { type: 'json' };
import {
  EXPERT_ERROR_CATEGORIES,
  EXPERT_ERROR_CODES,
} from './errors.js';
import {
  CAPABILITY_NODE_KINDS,
  CONTENT_DIGEST_PATTERN_SOURCE,
  NEUTRAL_LOCATOR_PATTERN_SOURCE,
  PRINCIPAL_ID_PATTERN_SOURCE,
  PRINCIPAL_TYPES,
  TENANT_PATTERN_SOURCE,
  EXPERT_VERSION_PATTERN_SOURCE,
  CAPABILITY_NODE_ID_PATTERN_SOURCE,
} from './shared.js';
import {
  EXPERT_ID_PATTERN_SOURCE,
  IDENTITY_REF_KINDS,
  IDENTITY_REF_VERSION,
} from './identity.js';
import {
  COMPETENCY_NODE_KINDS,
  DOMAIN_COMPETENCY_TYPE_PATTERN_SOURCE,
  PROFICIENCY_LEVELS,
} from './competencies.js';
import {
  CREDENTIAL_KINDS,
  QUALIFICATION_STATUSES,
} from './qualifications.js';
import {
  COUNTRY_CODE_PATTERN_SOURCE,
  LIMITATION_CLASSES,
  REGION_CODE_PATTERN_SOURCE,
} from './domain-scope.js';
import { TASK_RECORD_TYPES } from './task-history.js';
import { RELIABILITY_EVENT_KINDS } from './reliability.js';
import {
  AVAILABILITY_RECURRENCES,
  TIME_OF_DAY_PATTERN_SOURCE,
} from './availability.js';
import {
  FIELD_VISIBILITIES,
  PUBLIC_VIEW_FIELD_GROUPS,
} from './privacy-policy.js';
import { DOMAIN_PACK_ID_PATTERN_SOURCE } from './domain-pack.js';
import {
  EXPERT_LIFECYCLE_EVENT_KINDS,
  EXPERT_STATUSES,
  EXPERT_TERMINAL_STATUSES,
} from './lifecycle.js';
import { EXPERT_PROFILE_RECORD_VERSION } from './profile.js';
import { EXPERT_TIMESTAMP_PATTERN_SOURCE } from './timestamp.js';
import { EXPERT_SCHEMAS, EXPERT_SCHEMA_VERSION } from './envelopes.js';
import { formatSchemaRef } from '@arena/protocol-core';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

// JSON imports are structurally typed; index access needs the right shapes.
type PropShape = {
  pattern?: string;
  enum?: string[];
  const?: number;
  type?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  items?: { $ref?: string; type?: string; pattern?: string; enum?: string[] };
  properties?: Record<string, PropShape>;
  required?: string[];
  $ref?: string;
};
type JsonSchema = {
  $schema: string;
  $id: string;
  type?: string;
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, PropShape>;
  $defs?: Record<string, PropShape>;
  enum?: string[];
  pattern?: string;
};

const asSchema = (value: unknown): JsonSchema => value as unknown as JsonSchema;

describe('generated contract parity — expert-registry (positive)', () => {
  it('the expert-ref schema mirrors the TS identity and digest patterns', () => {
    const json = asSchema(expertRefSchema);
    expect(json.$schema).toBe(DRAFT);
    expect(json.$id).toBe('arena:schema/expert/expert-ref@1.0.0');
    expect(json.properties?.tenant?.pattern).toBe(TENANT_PATTERN_SOURCE);
    expect(json.properties?.expertId?.pattern).toBe(EXPERT_ID_PATTERN_SOURCE);
    expect(json.properties?.version?.pattern).toBe(EXPERT_VERSION_PATTERN_SOURCE);
    expect(json.properties?.digest?.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(json.required).toContain('expertId');
  });

  it('the principal schema mirrors the closed principal vocabulary', () => {
    const json = asSchema(principalSchema);
    expect(json.properties?.type?.enum).toEqual([...PRINCIPAL_TYPES]);
    expect(json.properties?.tenant?.pattern).toBe(TENANT_PATTERN_SOURCE);
    expect(json.properties?.principalId?.pattern).toBe(PRINCIPAL_ID_PATTERN_SOURCE);
  });

  it('the evidence-ref schema mirrors digest + description', () => {
    const json = asSchema(evidenceRefSchema);
    expect(json.properties?.digest?.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(json.properties?.description?.minLength).toBe(1);
  });

  it('the identity-ref schema mirrors PII-minimized declared identity refs', () => {
    const json = asSchema(identityRefSchema);
    expect(json.properties?.refVersion?.const).toBe(IDENTITY_REF_VERSION);
    expect(json.properties?.kind?.enum).toEqual([...IDENTITY_REF_KINDS]);
    expect(json.properties?.locator?.pattern).toBe(NEUTRAL_LOCATOR_PATTERN_SOURCE);
    expect(json.properties?.digest?.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
  });

  it('the credential-ref schema mirrors the professional credential kinds', () => {
    const json = asSchema(credentialRefSchema);
    expect(json.properties?.kind?.enum).toEqual([...CREDENTIAL_KINDS]);
    expect(json.properties?.reference?.pattern).toBe(NEUTRAL_LOCATOR_PATTERN_SOURCE);
    expect(json.properties?.issuer?.maxLength).toBe(255);
  });

  it('the competency schema mirrors proficiencies, node kinds and domain extension', () => {
    const json = asSchema(competencySchema);
    expect(json.properties?.proficiency?.enum).toEqual([...PROFICIENCY_LEVELS]);
    expect(json.properties?.capability?.properties?.kind?.enum).toEqual([
      ...COMPETENCY_NODE_KINDS,
    ]);
    expect(json.properties?.domainType?.pattern).toBe(DOMAIN_COMPETENCY_TYPE_PATTERN_SOURCE);
    expect(json.properties?.proficiencyEvidence?.minItems).toBe(1);
    expect(json.$defs?.evidenceRef?.properties?.digest?.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
    expect(json.properties?.competencyVersion?.const).toBe(1);
  });

  it('the qualification schema mirrors statuses and evidence digests', () => {
    const json = asSchema(qualificationSchema);
    expect(json.properties?.status?.enum).toEqual([...QUALIFICATION_STATUSES]);
    expect(json.properties?.evidence?.type).toBe('array');
    expect(json.properties?.qualificationVersion?.const).toBe(1);
    expect(json.$defs?.credentialRef?.properties?.kind?.enum).toEqual([...CREDENTIAL_KINDS]);
  });

  it('the jurisdiction + limitation schemas mirror lock rule 23 metadata', () => {
    const jurisdiction = asSchema(jurisdictionSchema);
    expect(jurisdiction.properties?.country?.pattern).toBe(COUNTRY_CODE_PATTERN_SOURCE);
    expect(jurisdiction.properties?.region?.pattern).toBe(REGION_CODE_PATTERN_SOURCE);
    const limitation = asSchema(limitationSchema);
    expect(limitation.properties?.class?.enum).toEqual([...LIMITATION_CLASSES]);
    expect(limitation.properties?.statement?.maxLength).toBe(2000);
  });

  it('the domain-scope schema requires >= 1 domains and >= 1 limitations', () => {
    const json = asSchema(domainScopeSchema);
    expect(json.properties?.domains?.minItems).toBe(1);
    expect(json.properties?.limitations?.minItems).toBe(1);
    expect(json.properties?.jurisdictions?.type).toBe('array');
    expect(json.$defs?.capabilityNodeRef?.properties?.kind?.enum).toEqual([
      ...CAPABILITY_NODE_KINDS,
    ]);
    expect(json.$defs?.capabilityNodeRef?.properties?.id?.pattern).toBe(
      CAPABILITY_NODE_ID_PATTERN_SOURCE,
    );
  });

  it('the task-record-ref schema mirrors the closed record vocabulary', () => {
    const json = asSchema(taskRecordRefSchema);
    expect(json.properties?.kind?.enum).toEqual([...TASK_RECORD_TYPES]);
    expect(json.properties?.occurredAt?.pattern).toBe(EXPERT_TIMESTAMP_PATTERN_SOURCE);
  });

  it('the reliability schemas mirror the event-sourced measurement contract', () => {
    const entry = asSchema(reliabilityEntrySchema);
    expect(entry.properties?.kind?.enum).toEqual([...RELIABILITY_EVENT_KINDS]);
    expect(entry.properties?.sequence?.minimum).toBe(1);
    expect(entry.properties?.recordedBy?.$ref).toBe('#/$defs/principal');
    const metrics = asSchema(reliabilityMetricsSchema);
    expect(metrics.required).toEqual([
      'metricsVersion',
      'tasksCompleted',
      'tasksFailed',
      'noResponse',
      'totalEvents',
    ]);
    expect(metrics.properties?.noResponse?.minimum).toBe(0);
  });

  it('the availability schema mirrors typed windows', () => {
    const json = asSchema(availabilitySchema);
    expect(json.properties?.windows?.minItems).toBe(1);
    const window = json.$defs?.availabilityWindow;
    expect(window?.properties?.recurrence?.enum).toEqual([...AVAILABILITY_RECURRENCES]);
    expect(window?.properties?.startUtc?.pattern).toBe(TIME_OF_DAY_PATTERN_SOURCE);
    expect(window?.properties?.dayOfWeek?.minimum).toBe(1);
    expect(window?.properties?.dayOfWeek?.maximum).toBe(7);
  });

  it('the privacy-policy schema mirrors the explicit per-group marking', () => {
    const json = asSchema(privacyPolicySchema);
    const visibility = json.properties?.visibility;
    expect(sorted(visibility?.required ?? [])).toEqual(sorted(PUBLIC_VIEW_FIELD_GROUPS));
    for (const group of PUBLIC_VIEW_FIELD_GROUPS) {
      expect(visibility?.properties?.[group]?.enum).toEqual([...FIELD_VISIBILITIES]);
    }
    expect(json.$defs).toBeUndefined();
  });

  it('the domain-pack schema mirrors the R37 additive extension surface', () => {
    const json = asSchema(domainPackSchema);
    expect(json.properties?.id?.pattern).toBe(DOMAIN_PACK_ID_PATTERN_SOURCE);
    expect(json.properties?.competencyTypes?.minItems).toBe(1);
    expect(json.required).not.toContain('lifecycle');
    expect(json.required).not.toContain('statuses');
    expect(json.required).not.toContain('transitions');
  });

  it('the public-view schema mirrors the derived privacy view', () => {
    const json = asSchema(publicViewSchema);
    expect(json.required).toContain('sourceDigest');
    expect(json.required).toContain('derivedAt');
    expect(json.properties?.status?.enum).toEqual([...EXPERT_STATUSES]);
    // Structurally never public:
    expect(json.properties?.evidence).toBeUndefined();
    expect(json.properties?.taskHistory).toBeUndefined();
    expect(json.properties?.reliability).toBeUndefined();
    expect(json.properties?.lifecycle).toBeUndefined();
  });

  it('the profile schema mirrors the full §8 surface + digest', () => {
    const json = asSchema(profileSchema);
    expect(json.properties?.recordVersion?.const).toBe(EXPERT_PROFILE_RECORD_VERSION);
    expect(sorted(json.required ?? [])).toEqual(
      sorted([
        'recordVersion',
        'identity',
        'identityRefs',
        'version',
        'status',
        'competencies',
        'qualifications',
        'evidence',
        'taskHistory',
        'reliability',
        'availability',
        'domainScope',
        'privacyPolicy',
        'lifecycle',
        'declaredAt',
        'digest',
      ]),
    );
    expect(json.properties?.competencies?.minItems).toBe(1);
    expect(json.properties?.evidence?.minItems).toBe(1);
    expect(json.properties?.status?.enum).toEqual([...EXPERT_STATUSES]);
    expect(json.properties?.supersedes?.$ref).toBe('#/$defs/expertRef');
    // Every §8 field group is declared.
    for (const field of [
      'identity',
      'identityRefs',
      'competencies',
      'qualifications',
      'evidence',
      'taskHistory',
      'reliability',
      'availability',
      'domainScope',
    ]) {
      expect(json.properties?.[field]).toBeDefined();
    }
  });

  it('the lifecycle-event schema mirrors the append-only event surface', () => {
    const json = asSchema(lifecycleEventSchema);
    expect(json.properties?.kind?.enum).toEqual([...EXPERT_LIFECYCLE_EVENT_KINDS]);
    expect(json.properties?.fromStatus?.enum).toEqual([...EXPERT_STATUSES]);
    expect(json.properties?.toStatus?.enum).toEqual([...EXPERT_STATUSES]);
    expect(json.properties?.supersededBy?.$ref).toBe('#/$defs/expertRef');
  });

  it('the registration-record schema mirrors the admission log', () => {
    const json = asSchema(registrationRecordSchema);
    expect(json.properties?.sequence?.minimum).toBe(1);
    expect(json.properties?.profile?.$ref).toBe('#/$defs/profile');
    expect(json.properties?.supersedes?.$ref).toBe('#/$defs/expertRef');
  });

  it('the error schema mirrors the closed taxonomy (incl. the lock-rule-9 screens)', () => {
    const json = asSchema(errorSchema);
    expect(sorted(json.properties?.code?.enum ?? [])).toEqual(
      sorted(Object.values(EXPERT_ERROR_CODES)),
    );
    expect(json.properties?.category?.enum).toEqual([...EXPERT_ERROR_CATEGORIES]);
    expect(json.properties?.code?.enum).toContain('EXPERT_AUTHORITY_FIELD_REJECTED');
    expect(json.properties?.code?.enum).toContain('EXPERT_PII_FIELD_REJECTED');
    expect(EXPERT_ERROR_CODES.AUTHORITY_FIELD_REJECTED).toBe(
      'EXPERT_AUTHORITY_FIELD_REJECTED',
    );
    expect(EXPERT_TERMINAL_STATUSES).toEqual(['retired']);
  });

  it('the command schemas mirror required idempotent intent payloads', () => {
    const register = asSchema(registerCommandSchema);
    expect(register.properties?.profile?.$ref).toBe('#/$defs/profile');
    expect(register.properties?.registrar?.$ref).toBe('#/$defs/principal');
    const retire = asSchema(retireCommandSchema);
    expect(retire.required).toContain('note');
    const supersede = asSchema(supersedeCommandSchema);
    expect(supersede.properties?.superseding?.$ref).toBe('#/$defs/expertRef');
    const attach = asSchema(attachEvidenceCommandSchema);
    expect(attach.properties?.evidence?.minItems).toBe(1);
    const recordTask = asSchema(recordTaskCommandSchema);
    expect(recordTask.properties?.records?.minItems).toBe(1);
    const recordReliability = asSchema(recordReliabilityCommandSchema);
    const entry = recordReliability.properties?.entry as unknown as
      | { required?: string[]; properties?: Record<string, { enum?: string[] }> }
      | undefined;
    expect(entry?.required).not.toContain('sequence');
    expect(entry?.properties?.kind?.enum).toEqual([...RELIABILITY_EVENT_KINDS]);
    const publish = asSchema(publishCommandSchema);
    expect(publish.properties?.currentStateDigest?.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
  });

  it('the event schemas carry the resulting profile + lifecycle event', () => {
    const registered = asSchema(registeredEventSchema);
    expect(registered.properties?.profile?.$ref).toBe('#/$defs/profile');
    expect(registered.properties?.event?.$ref).toBe('#/$defs/lifecycleEvent');
    const packEvent = asSchema(packPublishedEventSchema);
    expect(packEvent.properties?.pack?.$ref).toBe('#/$defs/domainPack');
  });

  it('the schema-registry contract mirrors EXPERT_SCHEMAS exactly', () => {
    const json = asSchema(registrySchema);
    const expected = Object.entries(EXPERT_SCHEMAS).map(([name, version]) =>
      formatSchemaRef({
        namespace: 'expert',
        name: name.split('/')[1] ?? '',
        version,
      }),
    );
    expect(sorted(json.enum ?? [])).toEqual(sorted(expected));
    expect(EXPERT_SCHEMA_VERSION).toBe('1.0.0');
    expect(Object.keys(EXPERT_SCHEMAS)).toHaveLength(41);
  });
});

describe('generated contract parity (negative — drift tripwires)', () => {
  it('a mirrored enum that lost sync with the TS surface would fail this probe', () => {
    // Positive control of the comparison style itself: the exact lists match.
    const json = asSchema(errorSchema);
    expect(sorted(json.properties?.code?.enum ?? [])).toEqual(
      sorted(Object.values(EXPERT_ERROR_CODES)),
    );
    // And a tampered copy does NOT match (the same property the drift suite
    // asserts at the file level).
    const tampered = [...(json.properties?.code?.enum ?? [])];
    tampered.push('EXPERT_FAKE_CODE');
    expect(sorted(tampered)).not.toEqual(sorted(Object.values(EXPERT_ERROR_CODES)));
  });

  it('every generated $id is a well-formed expert SchemaRef at 1.0.0', () => {
    for (const schema of [
      expertRefSchema,
      evidenceRefSchema,
      principalSchema,
      identityRefSchema,
      credentialRefSchema,
      competencySchema,
      qualificationSchema,
      jurisdictionSchema,
      limitationSchema,
      domainScopeSchema,
      taskRecordRefSchema,
      reliabilityEntrySchema,
      reliabilityMetricsSchema,
      availabilitySchema,
      privacyPolicySchema,
      domainPackSchema,
      publicViewSchema,
      profileSchema,
      lifecycleEventSchema,
      registrationRecordSchema,
      errorSchema,
      registerCommandSchema,
      publishCommandSchema,
      retireCommandSchema,
      supersedeCommandSchema,
      attachEvidenceCommandSchema,
      recordTaskCommandSchema,
      recordReliabilityCommandSchema,
      registeredEventSchema,
      packPublishedEventSchema,
      registrySchema,
    ]) {
      const json = asSchema(schema);
      expect(json.$id).toMatch(/^arena:schema\/expert\/[a-z0-9-]+@1\.0\.0$/);
    }
  });
});
