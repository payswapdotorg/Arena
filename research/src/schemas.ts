/**
 * The in-package research schema registry (Work Order A030):
 * versioned SchemaRef data for every research object, disclosed in the
 * package and in the PR. Follows the pattern of @arena/evaluation's
 * EVALUATION_SCHEMAS -- schemas are in-package data (this standalone
 * package is not a workspace member, so it does not feed the root
 * contracts/ generation; parity with the A012 registry SHAPE is
 * asserted by the parity suite instead).
 */

import type { SchemaRef } from '@arena/protocol-core';

export const RESEARCH_SCHEMA_VERSION = '1.0.0' as const;

/** The closed set of research schema names. */
export const RESEARCH_SCHEMAS = {
  'research/scoring-methodology': RESEARCH_SCHEMA_VERSION,
  'research/benchmark-descriptor': RESEARCH_SCHEMA_VERSION,
  'research/benchmark-result': RESEARCH_SCHEMA_VERSION,
  'research/leaderboard': RESEARCH_SCHEMA_VERSION,
} as const;

export type ResearchSchemaName = keyof typeof RESEARCH_SCHEMAS;

export function researchSchemaRef(name: ResearchSchemaName): SchemaRef {
  const version = RESEARCH_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new Error(`unknown research schema: ${String(name)}`);
  }
  return { namespace, name: schemaName, version };
}

/** The research schema registry (disclosed in the PR; parity-tested). */
export const RESEARCH_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...RESEARCH_SCHEMAS,
});
