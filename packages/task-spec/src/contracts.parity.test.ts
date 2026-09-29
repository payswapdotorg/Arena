/**
 * Contract parity tests (Work Order A008) — bind the generated contracts
 * (contracts/task/*.json, produced by
 * packages/task-spec/scripts/generate-contracts.mjs) to the TypeScript
 * surface of @arena/task-spec.
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and the drift suite (drift.test.ts) fails when
 * the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift, exactly like the sibling convention.
 */

import { describe, expect, it } from 'vitest';
import taskSpecSchema from '../../../contracts/task/task-spec.v1.json' with { type: 'json' };
import taskClassSchema from '../../../contracts/task/task-class.v1.json' with { type: 'json' };
import compilationPolicySchema from '../../../contracts/task/compilation-policy.v1.json' with { type: 'json' };
import compilationRecordSchema from '../../../contracts/task/compilation-record.v1.json' with { type: 'json' };
import runCompilationCommandSchema from '../../../contracts/task/run-compilation-command.v1.json' with { type: 'json' };
import compilationRecordedEventSchema from '../../../contracts/task/compilation-recorded-event.v1.json' with { type: 'json' };
import errorSchema from '../../../contracts/task/task-spec-error.v1.json' with { type: 'json' };
import registrySchema from '../../../contracts/task/task-schema-registry.v1.json' with { type: 'json' };
import { TASK_SPEC_ERROR_CATEGORIES, TASK_SPEC_ERROR_CODES } from './errors.js';
import { TASK_CLASSES } from './task-class.js';
import { TASK_DIFFICULTY_CLASSES, TASK_DIFFICULTY_SCALES } from './difficulty.js';
import {
  QUALITY_PROVENANCE_SOURCES,
  TASK_QUALITY_DIMENSIONS,
} from './quality.js';
import { DATA_RIGHTS_CLASSIFICATIONS } from './data-rights.js';
import {
  TASK_SPEC_RECORD_VERSION,
  TASK_SPEC_FIELDS,
} from './spec.js';
import {
  COMPILATION_POLICY_FIELDS,
  COMPILATION_POLICY_VERSION,
  POLICY_COMPILABLE_CASE_STATUSES,
  CLASS_SELECTION_MATCHER_KINDS,
  POLICY_DIFFICULTY_MODES,
  OBJECTIVES_MAPPING_MODES,
  CONSTRAINTS_MAPPING_MODES,
  SHORTCUTS_MAPPING_MODES,
  TOOLS_MAPPING_MODES,
  OUTPUTS_MAPPING_MODES,
  INSTRUCTION_PLACEHOLDERS,
  ENVIRONMENT_SELECTION_MODES,
  EXPERT_QUALIFICATION_MODES,
} from './compilation-policy.js';
import {
  COMPILATION_RECORD_FIELDS,
  COMPILATION_RECORD_VERSION,
  COMPILATION_KEY_PATTERN_SOURCE,
} from './compilation-record.js';
import {
  TASK_SPEC_SCHEMAS,
  taskSpecSchemaRef,
} from './envelopes.js';
import {
  CAPABILITY_LABEL_PATTERN_SOURCE,
  CASE_ID_PATTERN_SOURCE,
  CONTENT_DIGEST_PATTERN_SOURCE,
  NEUTRAL_ID_PATTERN_SOURCE,
  TASK_ID_PATTERN_SOURCE,
  TASK_SPEC_TIMESTAMP_PATTERN_SOURCE,
  TASK_VERSION_PATTERN_SOURCE,
  TENANT_PATTERN_SOURCE,
  ARTIFACT_NAMESPACE_PATTERN_SOURCE,
  ARTIFACT_NAME_PATTERN_SOURCE,
  NODE_ID_PATTERN_SOURCE,
} from './shared.js';
import { COMPETENCY_NODE_KINDS } from './expert-qualification.js';

type JsonSchema = {
  $id?: string;
  properties?: Record<string, { pattern?: string; enum?: string[]; const?: unknown }>;
  required?: string[];
  additionalProperties?: boolean;
};

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

describe('schema ids + registry parity', () => {
  it('every contract carries the versioned SchemaRef $id in the task namespace', () => {
    for (const schema of [
      taskSpecSchema,
      taskClassSchema,
      compilationPolicySchema,
      compilationRecordSchema,
      runCompilationCommandSchema,
      compilationRecordedEventSchema,
      errorSchema,
      registrySchema,
    ]) {
      expect((schema as JsonSchema).$id).toMatch(/^arena:schema\/task\/[a-z-]+@1\.0\.0$/);
    }
  });

  it('the registry contract enumerates exactly the TS registry', () => {
    const registry = registrySchema as unknown as { enum: string[] };
    const expected = Object.keys(TASK_SPEC_SCHEMAS)
      .map((name) => {
        const ref = taskSpecSchemaRef(name as keyof typeof TASK_SPEC_SCHEMAS);
        return `arena:schema/task/${ref.name}@${ref.version}`;
      })
      .sort();
    expect(sorted(registry.enum)).toEqual(expected);
    expect(registry.enum).toHaveLength(8);
  });
});

describe('vocabulary parity', () => {
  it('task-class contract enum == TS TASK_CLASSES', () => {
    const schema = taskClassSchema as unknown as { enum: string[] };
    expect(schema.enum).toEqual([...TASK_CLASSES]);
  });

  it('task-spec contract difficulty + quality + data-rights enums match TS', () => {
    const props = (taskSpecSchema as JsonSchema).properties ?? {};
    const difficulty = props['difficulty'] as unknown as {
      properties: Record<string, { enum: string[] }>;
    };
    expect(difficulty.properties['scale']?.enum).toEqual([...TASK_DIFFICULTY_SCALES]);
    expect(difficulty.properties['class']?.enum).toEqual([...TASK_DIFFICULTY_CLASSES]);
    const quality = props['quality'] as unknown as {
      items: { properties: Record<string, { enum?: string[] }> };
    };
    expect(quality.items.properties['dimension']?.enum).toEqual([...TASK_QUALITY_DIMENSIONS]);
    const provenance = quality.items.properties['provenance'] as unknown as {
      properties: Record<string, { enum: string[] }>;
    };
    expect(provenance.properties['source']?.enum).toEqual([...QUALITY_PROVENANCE_SOURCES]);
    const dataRights = props['dataRights'] as unknown as {
      properties: Record<string, { enum: string[] }>;
    };
    expect(dataRights.properties['classification']?.enum).toEqual([
      ...DATA_RIGHTS_CLASSIFICATIONS,
    ]);
  });

  it('task-spec contract taskClass enum matches TS TASK_CLASSES', () => {
    const props = (taskSpecSchema as JsonSchema).properties ?? {};
    expect((props['taskClass'] as unknown as { enum: string[] }).enum).toEqual([
      ...TASK_CLASSES,
    ]);
  });

  it('error contract enums match the TS taxonomy', () => {
    const schema = errorSchema as unknown as {
      properties: Record<string, { enum: string[] }>;
    };
    expect(sorted(schema.properties['code']?.enum ?? [])).toEqual(
      sorted(Object.values(TASK_SPEC_ERROR_CODES)),
    );
    expect(sorted(schema.properties['category']?.enum ?? [])).toEqual(
      sorted([...TASK_SPEC_ERROR_CATEGORIES]),
    );
  });
});

describe('pattern parity', () => {
  it('task-spec contract patterns match the TS pattern sources', () => {
    const props = (taskSpecSchema as JsonSchema).properties ?? {};
    expect(props['version']?.pattern).toBe(TASK_VERSION_PATTERN_SOURCE);
    expect((props['digest'] as { pattern?: string }).pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
    const identity = props['identity'] as unknown as {
      properties: Record<string, { pattern?: string }>;
    };
    expect(identity.properties['tenant']?.pattern).toBe(TENANT_PATTERN_SOURCE);
    expect(identity.properties['taskId']?.pattern).toBe(TASK_ID_PATTERN_SOURCE);
    const labels = props['capabilityLabels'] as unknown as {
      items: { pattern?: string };
    };
    expect(labels.items.pattern).toBe(CAPABILITY_LABEL_PATTERN_SOURCE);
    const initialState = props['initialState'] as unknown as {
      properties: Record<string, unknown>;
    };
    const environment = initialState.properties['environment'] as unknown as {
      properties: Record<string, { pattern?: string }>;
    };
    expect(environment.properties['namespace']?.pattern).toBe(ARTIFACT_NAMESPACE_PATTERN_SOURCE);
    expect(environment.properties['name']?.pattern).toBe(ARTIFACT_NAME_PATTERN_SOURCE);
  });

  it('compilation-record contract patterns match TS', () => {
    const props = (compilationRecordSchema as JsonSchema).properties ?? {};
    expect(props['compilationKey']?.pattern).toBe(COMPILATION_KEY_PATTERN_SOURCE);
    expect(props['compiledAt']?.pattern).toBe(TASK_SPEC_TIMESTAMP_PATTERN_SOURCE);
  });
});

describe('shape parity (required lists + record versions)', () => {
  it('task-spec contract required == TASK_SPEC_FIELDS minus supersedes, plus digest', () => {
    const required = (taskSpecSchema as JsonSchema).required ?? [];
    const expected = sorted([
      ...TASK_SPEC_FIELDS.filter((field) => field !== 'supersedes'),
      'digest',
    ]);
    expect(sorted(required)).toEqual(expected);
  });

  it('compilation-policy contract required == COMPILATION_POLICY_FIELDS', () => {
    const required = (compilationPolicySchema as JsonSchema).required ?? [];
    expect(sorted(required)).toEqual(sorted([...COMPILATION_POLICY_FIELDS]));
  });

  it('compilation-record contract required == COMPILATION_RECORD_FIELDS', () => {
    const required = (compilationRecordSchema as JsonSchema).required ?? [];
    expect(sorted(required)).toEqual(sorted([...COMPILATION_RECORD_FIELDS]));
  });

  it('record versions are pinned as consts', () => {
    const specProps = (taskSpecSchema as JsonSchema).properties ?? {};
    expect(specProps['recordVersion']?.const).toBe(TASK_SPEC_RECORD_VERSION);
    const policyProps = (compilationPolicySchema as JsonSchema).properties ?? {};
    expect(policyProps['policyVersion']?.const).toBe(COMPILATION_POLICY_VERSION);
    const recordProps = (compilationRecordSchema as JsonSchema).properties ?? {};
    expect(recordProps['recordVersion']?.const).toBe(COMPILATION_RECORD_VERSION);
  });

  it('closed shapes (additionalProperties: false) everywhere', () => {
    for (const schema of [
      taskSpecSchema,
      compilationPolicySchema,
      compilationRecordSchema,
      runCompilationCommandSchema,
      compilationRecordedEventSchema,
      errorSchema,
    ]) {
      expect((schema as JsonSchema).additionalProperties).toBe(false);
    }
  });
});

describe('compilation-policy vocabulary parity', () => {
  it('policy sub-vocabularies match the TS constants', () => {
    const props = (compilationPolicySchema as JsonSchema).properties ?? {};
    const eligibility = props['eligibility'] as unknown as {
      properties: Record<string, unknown>;
    };
    const statuses = (eligibility.properties['compilableStatuses'] as unknown as {
      items: { enum: string[] };
    }).items.enum;
    expect(statuses).toEqual([...POLICY_COMPILABLE_CASE_STATUSES]);

    const classSelection = props['classSelection'] as unknown as {
      properties: Record<string, { items: { properties: Record<string, { enum?: string[] }> } }>;
    };
    const matcher = classSelection.properties['rules']?.items.properties['matcher'];
    expect(matcher?.enum).toEqual([...CLASS_SELECTION_MATCHER_KINDS]);

    const difficulty = props['difficulty'] as unknown as {
      properties: Record<string, { enum: string[] }>;
    };
    expect(difficulty.properties['mode']?.enum).toEqual([...POLICY_DIFFICULTY_MODES]);
    expect(difficulty.properties['scale']?.enum).toEqual([...TASK_DIFFICULTY_SCALES]);

    const fieldMapping = props['fieldMapping'] as unknown as {
      properties: Record<string, { properties: Record<string, { enum?: string[] }> }>;
    };
    expect(fieldMapping.properties['objectives']?.properties['mode']?.enum).toEqual([
      ...OBJECTIVES_MAPPING_MODES,
    ]);
    expect(fieldMapping.properties['constraints']?.properties['mode']?.enum).toEqual([
      ...CONSTRAINTS_MAPPING_MODES,
    ]);
    expect(fieldMapping.properties['prohibitedShortcuts']?.properties['mode']?.enum).toEqual([
      ...SHORTCUTS_MAPPING_MODES,
    ]);
    expect(fieldMapping.properties['permittedTools']?.properties['mode']?.enum).toEqual([
      ...TOOLS_MAPPING_MODES,
    ]);
    expect(fieldMapping.properties['expectedOutputs']?.properties['mode']?.enum).toEqual([
      ...OUTPUTS_MAPPING_MODES,
    ]);

    const environment = props['environment'] as unknown as {
      properties: Record<string, { enum: string[] }>;
    };
    expect(environment.properties['selection']?.enum).toEqual([
      ...ENVIRONMENT_SELECTION_MODES,
    ]);

    const expertQualification = props['expertQualification'] as unknown as {
      properties: Record<string, { enum: string[] }>;
    };
    expect(expertQualification.properties['mode']?.enum).toEqual([
      ...EXPERT_QUALIFICATION_MODES,
    ]);
  });

  it('instruction placeholders are documented in the contract description', () => {
    const props = (compilationPolicySchema as JsonSchema).properties ?? {};
    const instructions = (
      props['fieldMapping'] as unknown as {
        properties: Record<string, { properties: Record<string, { description?: string }> }>;
      }
    ).properties['instructions']?.properties['template'];
    for (const placeholder of INSTRUCTION_PLACEHOLDERS) {
      expect(instructions?.description).toContain(placeholder);
    }
  });

  it('competency node kinds match the TS constant', () => {
    const props = (taskSpecSchema as JsonSchema).properties ?? {};
    const reqs = props['expertQualificationRequirements'] as unknown as {
      properties: {
        competencies: {
          items: {
            allOf: [
              { properties: Record<string, unknown> },
              { properties: { kind: { enum: string[] } } },
            ];
          };
        };
      };
    };
    expect(reqs.properties.competencies.items.allOf[1]?.properties.kind.enum).toEqual([
      ...COMPETENCY_NODE_KINDS,
    ]);
  });

  it('case-id + neutral-id + node-id patterns are mirrored', () => {
    const derived = (taskSpecSchema as JsonSchema).properties?.['derivedFrom'] as unknown as {
      properties: {
        caseRef: { properties: Record<string, { pattern?: string }> };
        policyRef: { properties: Record<string, { pattern?: string }> };
      };
    };
    const caseIdPattern =
      'caseId' in derived.properties.caseRef.properties
        ? derived.properties.caseRef.properties['caseId']?.pattern
        : undefined;
    expect(caseIdPattern).toBe(CASE_ID_PATTERN_SOURCE);
    expect(derived.properties.policyRef.properties['policyId']?.pattern).toBe(
      NEUTRAL_ID_PATTERN_SOURCE,
    );
    const domain = (taskSpecSchema as JsonSchema).properties?.['domain'] as unknown as {
      allOf: [{ properties: Record<string, { pattern?: string }> }];
    };
    expect(domain.allOf[0]?.properties['id']?.pattern).toBe(NODE_ID_PATTERN_SOURCE);
  });
});
