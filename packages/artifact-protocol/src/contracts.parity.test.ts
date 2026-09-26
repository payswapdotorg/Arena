/**
 * Contract parity tests — bind the generated contracts
 * (contracts/artifacts/*.json, produced by
 * packages/artifact-protocol/scripts/generate-contracts.mjs) to the
 * TypeScript surface of @arena/artifact-protocol.
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and the drift suite (drift.test.ts) fails when
 * the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift, exactly like the A001 convention.
 */

import { describe, expect, it } from 'vitest';
import artifactErrorSchema from '../../../contracts/artifacts/artifact-error.v1.json' with { type: 'json' };
import artifactIdentitySchema from '../../../contracts/artifacts/artifact-identity.v1.json' with { type: 'json' };
import artifactRefSchema from '../../../contracts/artifacts/artifact-ref.v1.json' with { type: 'json' };
import contentDigestSchema from '../../../contracts/artifacts/content-digest.v1.json' with { type: 'json' };
import materialArtifactSchema from '../../../contracts/artifacts/material-artifact.v1.json' with { type: 'json' };
import principalSchema from '../../../contracts/artifacts/principal.v1.json' with { type: 'json' };
import publicationLedgerSchema from '../../../contracts/artifacts/publication-ledger.v1.json' with { type: 'json' };
import publicationSchema from '../../../contracts/artifacts/publication.v1.json' with { type: 'json' };
import publishCommandSchema from '../../../contracts/artifacts/publish-artifact-command.v1.json' with { type: 'json' };
import registrySchema from '../../../contracts/artifacts/artifacts-schema-registry.v1.json' with { type: 'json' };
import retractCommandSchema from '../../../contracts/artifacts/retract-publication-command.v1.json' with { type: 'json' };
import rightsSchema from '../../../contracts/artifacts/rights.v1.json' with { type: 'json' };
import timestampSchema from '../../../contracts/artifacts/timestamp.v1.json' with { type: 'json' };
import {
  ARTIFACT_ERROR_CODES,
  ARTIFACT_ERROR_CATEGORIES,
} from './errors.js';
import {
  ARTIFACT_NAME_PATTERN_SOURCE,
  ARTIFACT_NAMESPACE_PATTERN_SOURCE,
  ARTIFACT_VERSION_PATTERN_SOURCE,
} from './identity.js';
import { CONTENT_DIGEST_PATTERN_SOURCE } from './content-digest.js';
import { ARTIFACT_TIMESTAMP_PATTERN_SOURCE } from './timestamp.js';
import { PRINCIPAL_ID_PATTERN_SOURCE, PRINCIPAL_TYPES } from './principal.js';
import {
  COMMERCIAL_USE_POLICIES,
  CUSTOMER_DATA_POLICIES,
  LICENSE_PATTERN_SOURCE,
  REDISTRIBUTION_POLICIES,
} from './rights.js';
import {
  PUBLICATION_ACTIONS,
  PUBLICATION_RECORD_VERSION,
} from './publication.js';
import { ARTIFACT_SCHEMAS, artifactSchemaRef } from './envelopes.js';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

describe('generated contract parity — artifact-protocol (positive)', () => {
  it('artifact identity schema mirrors the identity patterns', () => {
    expect(sorted(artifactIdentitySchema.required as string[])).toEqual(
      sorted(['namespace', 'name', 'version']),
    );
    expect(artifactIdentitySchema.properties.namespace.pattern).toBe(
      ARTIFACT_NAMESPACE_PATTERN_SOURCE,
    );
    expect(artifactIdentitySchema.properties.name.pattern).toBe(ARTIFACT_NAME_PATTERN_SOURCE);
    expect(artifactIdentitySchema.properties.version.pattern).toBe(
      ARTIFACT_VERSION_PATTERN_SOURCE,
    );
    expect(artifactIdentitySchema.additionalProperties).toBe(false);
  });

  it('artifact ref schema adds the content digest pattern', () => {
    expect(sorted(artifactRefSchema.required as string[])).toEqual(
      sorted(['namespace', 'name', 'version', 'digest']),
    );
    expect(artifactRefSchema.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(contentDigestSchema.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
  });

  it('material artifact schema mirrors the artifact wire shape', () => {
    expect(sorted(materialArtifactSchema.required as string[])).toEqual(
      sorted(['identity', 'refs', 'content', 'digest']),
    );
    expect(materialArtifactSchema.additionalProperties).toBe(false);
    expect(materialArtifactSchema.$defs.artifactIdentity.properties.namespace.pattern).toBe(
      ARTIFACT_NAMESPACE_PATTERN_SOURCE,
    );
  });

  it('principal schema enumerates exactly the TS principal types', () => {
    expect(sorted(principalSchema.properties.type.enum as string[])).toEqual(
      sorted([...PRINCIPAL_TYPES]),
    );
    expect(principalSchema.properties.principalId.pattern).toBe(PRINCIPAL_ID_PATTERN_SOURCE);
    expect(principalSchema.properties.tenant.pattern).toBe(ARTIFACT_NAMESPACE_PATTERN_SOURCE);
    expect(sorted(principalSchema.required as string[])).toEqual(
      sorted(['type', 'tenant', 'principalId']),
    );
  });

  it('rights schema mirrors the policy enums', () => {
    expect(sorted(rightsSchema.properties.commercialUse.enum as string[])).toEqual(
      sorted([...COMMERCIAL_USE_POLICIES]),
    );
    expect(sorted(rightsSchema.properties.redistribution.enum as string[])).toEqual(
      sorted([...REDISTRIBUTION_POLICIES]),
    );
    expect(sorted(rightsSchema.properties.customerData.enum as string[])).toEqual(
      sorted([...CUSTOMER_DATA_POLICIES]),
    );
    expect(rightsSchema.properties.license.pattern).toBe(LICENSE_PATTERN_SOURCE);
  });

  it('timestamp schema mirrors the UTC millisecond pattern', () => {
    expect(timestampSchema.pattern).toBe(ARTIFACT_TIMESTAMP_PATTERN_SOURCE);
  });

  it('publication schema mirrors actions, version and timestamps', () => {
    expect(sorted(publicationSchema.properties.action.enum as string[])).toEqual(
      sorted([...PUBLICATION_ACTIONS]),
    );
    expect(publicationSchema.properties.recordVersion.const).toBe(PUBLICATION_RECORD_VERSION);
    expect(publicationSchema.properties.publishedAt.pattern).toBe(
      ARTIFACT_TIMESTAMP_PATTERN_SOURCE,
    );
    expect(publicationSchema.properties.supersedes.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(sorted(publicationSchema.required as string[])).toEqual(
      sorted(['recordVersion', 'action', 'artifact', 'publisher', 'rights', 'publishedAt']),
    );
  });

  it('publication ledger is an array of publication records', () => {
    expect(publicationLedgerSchema.type).toBe('array');
    expect(publicationLedgerSchema.uniqueItems).toBe(true);
    expect(publicationLedgerSchema.items.$ref).toBe('publication.v1.json');
  });

  it('artifact error schema enumerates exactly the TS taxonomy', () => {
    expect(sorted(artifactErrorSchema.properties.code.enum as string[])).toEqual(
      sorted(Object.values(ARTIFACT_ERROR_CODES)),
    );
    expect(sorted(artifactErrorSchema.properties.category.enum as string[])).toEqual(
      sorted([...ARTIFACT_ERROR_CATEGORIES]),
    );
    expect(artifactErrorSchema.additionalProperties).toBe(false);
  });

  it('command payload schemas require their full payload shape', () => {
    expect(sorted(publishCommandSchema.required as string[])).toEqual(
      sorted(['artifact', 'publisher', 'rights']),
    );
    expect(sorted(retractCommandSchema.required as string[])).toEqual(
      sorted(['publicationDigest', 'publisher']),
    );
    expect(retractCommandSchema.properties.publicationDigest.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
  });

  it('schema registry enumerates exactly the artifact-protocol schemas', () => {
    const expected = sorted(
      Object.keys(ARTIFACT_SCHEMAS).map((name) =>
        `arena:schema/${name.replace('/', '/')}@${(ARTIFACT_SCHEMAS as Record<string, string>)[name]}`,
      ),
    );
    expect(sorted(registrySchema.enum as string[])).toEqual(expected);
  });

  it('contract $ids are the formatted artifact schema refs', () => {
    expect(artifactIdentitySchema.$id).toBe(
      'arena:schema/artifacts/artifact-identity@1.0.0',
    );
    expect(publicationSchema.$id).toBe('arena:schema/artifacts/publication@1.0.0');
    expect(artifactErrorSchema.$id).toBe('arena:schema/artifacts/artifact-error@1.0.0');
    // Spot-check via the formatter for every registry entry.
    for (const name of Object.keys(ARTIFACT_SCHEMAS)) {
      if (name === 'artifacts/schema-registry') {
        expect(registrySchema.$id).toBe(
          `arena:schema/artifacts/schema-registry@${(ARTIFACT_SCHEMAS as Record<string, string>)[name]}`,
        );
        continue;
      }
      expect(artifactSchemaRef(name as keyof typeof ARTIFACT_SCHEMAS).namespace).toBe('artifacts');
    }
  });

  it('contracts target JSON Schema draft 2020-12', () => {
    const schemas = [
      artifactIdentitySchema,
      artifactRefSchema,
      contentDigestSchema,
      materialArtifactSchema,
      principalSchema,
      rightsSchema,
      timestampSchema,
      publicationSchema,
      publicationLedgerSchema,
      artifactErrorSchema,
      publishCommandSchema,
      retractCommandSchema,
      registrySchema,
    ];
    for (const schema of schemas) {
      expect(schema.$schema).toBe(DRAFT);
    }
  });
});

describe('generated contract parity — artifact-protocol (negative — drift must not pass silently)', () => {
  it('a hypothetical extra principal type would not match the contract enum', () => {
    const hypothetical = sorted([...PRINCIPAL_TYPES, 'model']);
    expect(hypothetical).not.toEqual(sorted(principalSchema.properties.type.enum as string[]));
  });

  it('a hypothetical extra error code would not match the contract enum', () => {
    const hypothetical = sorted([...Object.values(ARTIFACT_ERROR_CODES), 'ARTIFACT_MADE_UP']);
    expect(hypothetical).not.toEqual(sorted(artifactErrorSchema.properties.code.enum as string[]));
  });

  it('a hypothetical unknown artifact schema would not match the registry enum', () => {
    const registry = registrySchema.enum as string[];
    expect(registry).not.toContain('arena:schema/artifacts/does-not-exist@1.0.0');
    expect(registry).not.toContain('arena:schema/provenance/provenance-record@1.0.0');
  });

  it('publication wire version 1 is the only const accepted by the contract', () => {
    expect(publicationSchema.properties.recordVersion.const).toBe(1);
    expect(publicationSchema.properties.recordVersion.const).not.toBe(2);
  });
});
