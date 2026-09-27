/**
 * Contract parity tests (Work Order A005 gate 9) — bind the generated
 * contracts (contracts/capability-case/*.json, produced by
 * packages/capability-case/scripts/generate-contracts.mjs) to the
 * TypeScript surface of @arena/capability-case.
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and the drift suite (drift.test.ts) fails when
 * the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift, exactly like the A001/A002/A004 convention.
 */

import { describe, expect, it } from 'vitest';
import caseRefSchema from '../../../contracts/capability-case/case-ref.v1.json' with { type: 'json' };
import evidenceRefSchema from '../../../contracts/capability-case/evidence-ref.v1.json' with { type: 'json' };
import principalSchema from '../../../contracts/capability-case/principal.v1.json' with { type: 'json' };
import observedFailureSchema from '../../../contracts/capability-case/observed-failure.v1.json' with { type: 'json' };
import expertRequirementsSchema from '../../../contracts/capability-case/expert-requirements.v1.json' with { type: 'json' };
import environmentRequirementsSchema from '../../../contracts/capability-case/environment-requirements.v1.json' with { type: 'json' };
import taskRequirementsSchema from '../../../contracts/capability-case/task-requirements.v1.json' with { type: 'json' };
import evaluationRequirementsSchema from '../../../contracts/capability-case/evaluation-requirements.v1.json' with { type: 'json' };
import verificationRequirementsSchema from '../../../contracts/capability-case/verification-requirements.v1.json' with { type: 'json' };
import caseSchema from '../../../contracts/capability-case/case.v1.json' with { type: 'json' };
import lifecycleEventSchema from '../../../contracts/capability-case/lifecycle-event.v1.json' with { type: 'json' };
import compilationTargetSchema from '../../../contracts/capability-case/compilation-target.v1.json' with { type: 'json' };
import errorSchema from '../../../contracts/capability-case/capability-case-error.v1.json' with { type: 'json' };
import registerCommandSchema from '../../../contracts/capability-case/register-case-command.v1.json' with { type: 'json' };
import submitCommandSchema from '../../../contracts/capability-case/submit-case-command.v1.json' with { type: 'json' };
import triageCommandSchema from '../../../contracts/capability-case/triage-case-command.v1.json' with { type: 'json' };
import activateCommandSchema from '../../../contracts/capability-case/activate-case-command.v1.json' with { type: 'json' };
import resolveCommandSchema from '../../../contracts/capability-case/resolve-case-command.v1.json' with { type: 'json' };
import supersedeCommandSchema from '../../../contracts/capability-case/supersede-case-command.v1.json' with { type: 'json' };
import attachEvidenceCommandSchema from '../../../contracts/capability-case/attach-evidence-command.v1.json' with { type: 'json' };
import registeredEventSchema from '../../../contracts/capability-case/case-registered-event.v1.json' with { type: 'json' };
import submittedEventSchema from '../../../contracts/capability-case/case-submitted-event.v1.json' with { type: 'json' };
import triagedEventSchema from '../../../contracts/capability-case/case-triaged-event.v1.json' with { type: 'json' };
import activatedEventSchema from '../../../contracts/capability-case/case-activated-event.v1.json' with { type: 'json' };
import resolvedEventSchema from '../../../contracts/capability-case/case-resolved-event.v1.json' with { type: 'json' };
import supersededEventSchema from '../../../contracts/capability-case/case-superseded-event.v1.json' with { type: 'json' };
import evidenceAttachedEventSchema from '../../../contracts/capability-case/evidence-attached-event.v1.json' with { type: 'json' };
import targetDerivedEventSchema from '../../../contracts/capability-case/compilation-target-derived-event.v1.json' with { type: 'json' };
import registrySchema from '../../../contracts/capability-case/capability-case-schema-registry.v1.json' with { type: 'json' };
import {
  CAPABILITY_CASE_ERROR_CATEGORIES,
  CAPABILITY_CASE_ERROR_CODES,
} from './errors.js';
import {
  CAPABILITY_CASE_RECORD_VERSION,
  CASE_PRIORITIES,
  CASE_RISK_LEVELS,
} from './case.js';
import {
  CASE_ID_PATTERN_SOURCE,
  CASE_IDENTITY_PATTERN_SOURCE,
} from './identity.js';
import {
  CASE_STATUSES,
  CASE_TERMINAL_STATUSES,
  CASE_LIFECYCLE_EVENT_KINDS,
  CASE_LIFECYCLE_EVENT_VERSION,
} from './lifecycle.js';
import {
  COMPILABLE_CASE_STATUSES,
  TASK_COMPILATION_TARGET_VERSION,
} from './compilation.js';
import { TASK_DIFFICULTY_LEVELS } from './requirements.js';
import {
  ARTIFACT_NAME_PATTERN_SOURCE,
  ARTIFACT_NAMESPACE_PATTERN_SOURCE,
  CAPABILITY_NODE_ID_PATTERN_SOURCE,
  CAPABILITY_NODE_KINDS,
  CONTENT_DIGEST_PATTERN_SOURCE,
  PRINCIPAL_ID_PATTERN_SOURCE,
  PRINCIPAL_TYPES,
  TENANT_PATTERN_SOURCE,
} from './shared.js';
import {
  CAPABILITY_CASE_SCHEMAS,
  capabilityCaseSchemaRef,
} from './envelopes.js';
import { formatSchemaRef } from '@arena/protocol-core';
import { CAPABILITY_CASE_TIMESTAMP_PATTERN_SOURCE } from './timestamp.js';
import { CASE_VERSION_PATTERN_SOURCE } from './shared.js';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

// JSON imports are structurally typed; index access needs the right shapes.
type JsonSchema = {
  $schema: string;
  $id: string;
  type?: string;
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<
    string,
    {
      pattern?: string;
      enum?: string[];
      const?: number;
      type?: string;
      minLength?: number;
    }
  >;
  $defs?: Record<string, unknown>;
  enum?: string[];
  pattern?: string;
};

const asSchema = (value: unknown): JsonSchema => value as unknown as JsonSchema;

describe('generated contract parity — capability-case (positive)', () => {
  it('the case-ref schema mirrors the TS identity and digest patterns', () => {
    const json = asSchema(caseRefSchema);
    expect(json.$schema).toBe(DRAFT);
    expect(json.properties?.tenant?.pattern).toBe(TENANT_PATTERN_SOURCE);
    expect(json.properties?.caseId?.pattern).toBe(CASE_ID_PATTERN_SOURCE);
    expect(json.properties?.version?.pattern).toBe(CASE_VERSION_PATTERN_SOURCE);
    expect(json.properties?.digest?.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(sorted(json.required ?? [])).toEqual(
      sorted(['tenant', 'caseId', 'version', 'digest']),
    );
    expect(json.additionalProperties).toBe(false);
  });

  it('the evidence-ref schema mirrors the digest-addressed evidence ref', () => {
    const json = asSchema(evidenceRefSchema);
    expect(json.properties?.digest?.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(json.properties?.description?.minLength).toBe(1);
    expect(sorted(json.required ?? [])).toEqual(sorted(['digest', 'description']));
  });

  it('the principal schema mirrors the closed principal types and patterns', () => {
    const json = asSchema(principalSchema);
    expect(sorted(json.properties?.type?.enum ?? [])).toEqual(sorted([...PRINCIPAL_TYPES]));
    expect(json.properties?.tenant?.pattern).toBe(TENANT_PATTERN_SOURCE);
    expect(json.properties?.principalId?.pattern).toBe(PRINCIPAL_ID_PATTERN_SOURCE);
  });

  it('the observed-failure schema mirrors the TS record shape', () => {
    const json = asSchema(observedFailureSchema);
    expect(sorted(json.required ?? [])).toEqual(sorted(['summary', 'observedAt']));
    expect(json.properties?.observedAt?.pattern).toBe(
      CAPABILITY_CASE_TIMESTAMP_PATTERN_SOURCE,
    );
    expect(json.$defs).toBeDefined();
  });

  it('the five requirement schemas mirror their TS shapes and vocabularies', () => {
    const expert = asSchema(expertRequirementsSchema);
    expect(sorted(expert.required ?? [])).toEqual(
      sorted(['competencies', 'qualifications']),
    );
    const environment = asSchema(environmentRequirementsSchema);
    expect(sorted(environment.required ?? [])).toEqual(
      sorted(['environments', 'constraints']),
    );
    const task = asSchema(taskRequirementsSchema);
    expect(sorted(task.required ?? [])).toEqual(
      sorted([
        'objectives',
        'constraints',
        'allowedTools',
        'forbiddenShortcuts',
        'successConditions',
        'evidenceCriteria',
        'difficulty',
      ]),
    );
    expect(sorted(task.properties?.difficulty?.enum ?? [])).toEqual(
      sorted([...TASK_DIFFICULTY_LEVELS]),
    );
    const evaluation = asSchema(evaluationRequirementsSchema);
    expect(sorted(evaluation.required ?? [])).toEqual(sorted(['evaluators', 'criteria']));
    const verification = asSchema(verificationRequirementsSchema);
    expect(sorted(verification.required ?? [])).toEqual(
      sorted(['verifiers', 'evidenceStandards']),
    );
  });

  it('the case schema mirrors the full §5 + CC1.0 wire shape', () => {
    const json = asSchema(caseSchema);
    expect(json.properties?.recordVersion?.const).toBe(CAPABILITY_CASE_RECORD_VERSION);
    expect(sorted(json.properties?.status?.enum ?? [])).toEqual(sorted([...CASE_STATUSES]));
    expect(sorted(json.properties?.priority?.enum ?? [])).toEqual(sorted([...CASE_PRIORITIES]));
    expect(sorted(json.properties?.risk?.enum ?? [])).toEqual(sorted([...CASE_RISK_LEVELS]));
    expect(sorted(json.required ?? [])).toEqual(
      sorted([
        'recordVersion',
        'identity',
        'version',
        'status',
        'source',
        'problemStatement',
        'targetCapability',
        'domain',
        'context',
        'observedFailure',
        'evidence',
        'unknowns',
        'desiredOutcome',
        'expertRequirements',
        'environmentRequirements',
        'taskRequirements',
        'evaluationRequirements',
        'verificationRequirements',
        'provenance',
        'priority',
        'risk',
        'lifecycle',
        'digest',
      ]),
    );
    // optional §5 fields stay optional in the contract
    expect(json.required).not.toContain('currentBody');
    expect(json.required).not.toContain('currentSubstrate');
    expect(json.required).not.toContain('parent');
    expect(json.required).not.toContain('supersedes');
    expect(json.required).not.toContain('supersededBy');
    expect(json.additionalProperties).toBe(false);
  });

  it('the lifecycle-event schema mirrors the closed event vocabulary', () => {
    const json = asSchema(lifecycleEventSchema);
    expect(json.properties?.eventVersion?.const).toBe(CASE_LIFECYCLE_EVENT_VERSION);
    expect(sorted(json.properties?.kind?.enum ?? [])).toEqual(
      sorted([...CASE_LIFECYCLE_EVENT_KINDS]),
    );
    expect(sorted(json.properties?.fromStatus?.enum ?? [])).toEqual(
      sorted([...CASE_STATUSES]),
    );
    expect(sorted(json.properties?.toStatus?.enum ?? [])).toEqual(
      sorted([...CASE_STATUSES]),
    );
  });

  it('the compilation-target schema mirrors the A008 data contract', () => {
    const json = asSchema(compilationTargetSchema);
    expect(json.properties?.targetVersion?.const).toBe(TASK_COMPILATION_TARGET_VERSION);
    expect(sorted(json.required ?? [])).toEqual(
      sorted([
        'targetVersion',
        'caseRef',
        'domain',
        'targetCapability',
        'taskRequirements',
        'environmentRequirements',
        'evaluationRequirements',
        'verificationRequirements',
        'evidence',
        'derivedAt',
        'digest',
      ]),
    );
    expect(json.required).not.toContain('currentBody');
    expect(json.required).not.toContain('currentSubstrate');
  });

  it('the error schema mirrors the closed error taxonomy', () => {
    const json = asSchema(errorSchema);
    expect(sorted(json.properties?.code?.enum ?? [])).toEqual(
      sorted(Object.values(CAPABILITY_CASE_ERROR_CODES)),
    );
    expect(sorted(json.properties?.category?.enum ?? [])).toEqual(
      sorted([...CAPABILITY_CASE_ERROR_CATEGORIES]),
    );
  });

  it('command schemas require their specific extra fields', () => {
    const register = asSchema(registerCommandSchema);
    expect(sorted(register.required ?? [])).toEqual(
      sorted(['caseRecord', 'registrar']),
    );
    const submit = asSchema(submitCommandSchema);
    expect(sorted(submit.required ?? [])).toEqual(
      sorted(['currentStateDigest', 'at', 'actor']),
    );
    const triage = asSchema(triageCommandSchema);
    expect(sorted(triage.required ?? [])).toEqual(
      sorted(['currentStateDigest', 'at', 'actor', 'note']),
    );
    const resolve = asSchema(resolveCommandSchema);
    expect(sorted(resolve.required ?? [])).toEqual(
      sorted(['currentStateDigest', 'at', 'actor', 'resolution']),
    );
    const supersede = asSchema(supersedeCommandSchema);
    expect(sorted(supersede.required ?? [])).toEqual(
      sorted(['currentStateDigest', 'at', 'actor', 'superseding']),
    );
    const attach = asSchema(attachEvidenceCommandSchema);
    expect(sorted(attach.required ?? [])).toEqual(
      sorted(['currentStateDigest', 'at', 'actor', 'evidence']),
    );
    for (const json of [
      submit,
      triage,
      asSchema(activateCommandSchema),
      resolve,
      supersede,
      attach,
    ]) {
      expect(json.properties?.at?.pattern).toBe(CAPABILITY_CASE_TIMESTAMP_PATTERN_SOURCE);
      expect(json.properties?.currentStateDigest?.pattern).toBe(
        CONTENT_DIGEST_PATTERN_SOURCE,
      );
    }
  });

  it('event schemas carry the resulting case state + lifecycle event', () => {
    for (const json of [
      registeredEventSchema,
      submittedEventSchema,
      triagedEventSchema,
      activatedEventSchema,
      resolvedEventSchema,
      supersededEventSchema,
      evidenceAttachedEventSchema,
    ]) {
      const schema = asSchema(json);
      expect(sorted(schema.required ?? [])).toEqual(sorted(['caseRecord', 'event']));
    }
    const targetDerived = asSchema(targetDerivedEventSchema);
    expect(sorted(targetDerived.required ?? [])).toEqual(sorted(['target', 'derivedBy']));
  });

  it('the schema-registry contract enumerates EXACTLY the TS schema registry', () => {
    const json = asSchema(registrySchema);
    const expected = Object.keys(CAPABILITY_CASE_SCHEMAS).map((name) =>
      formatSchemaRef(capabilityCaseSchemaRef(name as keyof typeof CAPABILITY_CASE_SCHEMAS)),
    );
    expect(sorted(json.enum ?? [])).toEqual(sorted(expected));
    expect((json.enum ?? []).length).toBe(29);
  });

  it('every contract $id is the versioned SchemaRef of its schema', () => {
    const ids = [
      caseRefSchema,
      evidenceRefSchema,
      principalSchema,
      observedFailureSchema,
      expertRequirementsSchema,
      environmentRequirementsSchema,
      taskRequirementsSchema,
      evaluationRequirementsSchema,
      verificationRequirementsSchema,
      caseSchema,
      lifecycleEventSchema,
      compilationTargetSchema,
      errorSchema,
      registerCommandSchema,
      submitCommandSchema,
      triageCommandSchema,
      activateCommandSchema,
      resolveCommandSchema,
      supersedeCommandSchema,
      attachEvidenceCommandSchema,
      registeredEventSchema,
      submittedEventSchema,
      triagedEventSchema,
      activatedEventSchema,
      resolvedEventSchema,
      supersededEventSchema,
      evidenceAttachedEventSchema,
      targetDerivedEventSchema,
      registrySchema,
    ].map((schema) => (schema as unknown as { $id: string }).$id);
    expect(ids[0]).toBe('arena:schema/capability-case/case-ref@1.0.0');
    expect(ids[9]).toBe('arena:schema/capability-case/case@1.0.0');
    expect(ids[28]).toBe('arena:schema/capability-case/schema-registry@1.0.0');
    expect(new Set(ids).size).toBe(29);
  });

  it('cross-protocol pattern sources are the canonical sibling patterns', () => {
    // A002 artifact patterns (lock-parity with @arena/artifact-protocol)
    expect(ARTIFACT_NAMESPACE_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{1,62}$');
    expect(ARTIFACT_NAME_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{1,127}$');
    // A004 node kinds and ids
    expect(CAPABILITY_NODE_KINDS.length).toBe(11);
    expect(CAPABILITY_NODE_ID_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{0,127}$');
    // identity pattern sources
    expect(CASE_ID_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{0,127}$');
    expect(CASE_IDENTITY_PATTERN_SOURCE).toBe(
      '^arena:case/[a-z][a-z0-9-]{1,62}/[a-z][a-z0-9-]{0,127}$',
    );
    // terminal + compilable vocabularies
    expect(sorted(CASE_TERMINAL_STATUSES)).toEqual(['resolved', 'superseded']);
    expect(sorted(COMPILABLE_CASE_STATUSES)).toEqual(['active', 'triaged']);
  });
});

describe('generated contract parity (negative controls)', () => {
  it('the registry enum does NOT contain foreign schemas', () => {
    const json = asSchema(registrySchema);
    expect(json.enum).not.toContain('arena:schema/capability/node@1.0.0');
    expect(json.enum).not.toContain('arena:schema/protocol/envelope@1.0.0');
  });

  it('the case schema does NOT make the optional §5 fields required', () => {
    const json = asSchema(caseSchema);
    const required = json.required ?? [];
    expect(required).not.toContain('currentBody');
    expect(required).not.toContain('currentSubstrate');
  });
});
