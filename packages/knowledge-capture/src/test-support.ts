/**
 * Test support (Work Order C008) — deterministic fixtures built through
 * the REAL C006 constructors (createKnowledgeArtifact /
 * promoteKnowledgeArtifact) so every fixture stays valid vocabulary by
 * construction.
 */

import { createKnowledgeArtifact } from '@arena/expert-session';
import type { KnowledgeArtifact, KnowledgeTier } from '@arena/expert-session';
import type { KnowledgeScopeDeclaration } from './scope.js';

export const T0 = '2026-10-07T10:00:00.000Z';
export const T1 = '2026-10-07T10:00:01.000Z';
export const T2 = '2026-10-07T10:00:02.000Z';
export const T3 = '2026-10-07T10:00:03.000Z';
export const SESSION_ID = 'session-knowledge-fixture-01';
export const GRANTED = Object.freeze({
  granted: true,
  statement: 'Expert grants Arena reusable-learning rights for this statement.',
});
export const TASK_SCOPE = Object.freeze({ kind: 'task', ref: 'task-2026-1042' });
export const CASE_SCOPE = Object.freeze({ kind: 'case', ref: 'case-77' });
export const DOMAIN_SCOPE = Object.freeze({ kind: 'domain', ref: 'eu-vat-filing' });
export const JURISDICTION_SCOPE = Object.freeze({ kind: 'jurisdiction', ref: 'eu' });

export function makeArtifact(
  overrides: {
    tier?: KnowledgeTier;
    scope?: string;
    artifactId?: string;
    consent?: { granted: boolean; statement: string };
    validationRef?: string;
  } = {},
): KnowledgeArtifact {
  const tier = overrides.tier ?? 'scoped-reusable-knowledge';
  return createKnowledgeArtifact({
    tier,
    statement:
      'In this filing flow, the VAT reverse-charge box must be left empty when the customer is a non-EU business.',
    scope: overrides.scope ?? 'task:task-2026-1042',
    sessionId: SESSION_ID,
    expertRef: 'expert-042',
    now: T0,
    ...(overrides.validationRef !== undefined ? { validationRef: overrides.validationRef } : {}),
    ...((overrides.consent !== undefined
      ? { consent: overrides.consent }
      : tier !== 'task-specific-guidance'
        ? { consent: GRANTED }
        : {}) as { consent?: { granted: boolean; statement: string } }),
    ...(overrides.artifactId !== undefined ? { artifactId: overrides.artifactId } : {}),
  });
}

export function makeCaptureInput(
  artifact: KnowledgeArtifact,
  scope: KnowledgeScopeDeclaration,
) {
  return {
    artifact,
    scope,
    evidenceRefs: ['event/evt-annotation-0001', 'artifact/capsule-note-0007'],
    tenantId: 'tenant-alpha',
    interventionId: 'ivn_00000000000000000000000000000002',
    requestId: 'req_00000000000000000000000000000002',
    sessionId: SESSION_ID,
    expertRef: 'expert-042',
    correlationId: 'corr-c008-0002',
    captureKey: 'capture-key-0002',
    now: T1,
  };
}
