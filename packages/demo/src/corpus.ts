/**
 * The deterministic demo seed corpus (Work Order B006; issue #73).
 *
 * A versioned, FROZEN corpus of canonical B002 ControlPlaneRecords under
 * the reserved demo tenant (`arena-demo`), derived from the published
 * constants of the A028 software-engineer and A029 structural-engineer
 * reference bodies (bodies/software-engineer, bodies/structural-engineer;
 * tenant `arena-reference`). Every record targets a B005
 * READ_MODEL_KINDS kind so demo reads flow THROUGH the canonical read
 * path — there is no parallel demo-only API.
 *
 * Determinism rules (tested):
 *   - ALL ids are derived deterministically: `demo.<kind>:<stable-slug>`;
 *   - NO randomness and NO wall-clock: `createdAt`/`updatedAt` are the
 *     fixed DEMO_NARRATIVE_EPOCH_MS provenance constant, and the only
 *     "time" inside data is the fixed DEMO_NARRATIVE_TIME_ISO constant;
 *   - the corpus HASH is computed over canonical JSON and exported, so
 *     two constructions must yield the identical hash;
 *   - outputs are deep-frozen (read discipline).
 */

import type { ControlPlaneRecord } from '@arena/persistence';
import { deepFreeze } from '@arena/persistence';
import { canonicalJson } from '@arena/protocol-core';

import { DEMO_NARRATIVE_EPOCH_MS, DEMO_NARRATIVE_TIME_ISO, DEMO_TENANT_ID } from './shared.js';

/** Version of the demo corpus (a corpus change is a version change). */
export const DEMO_CORPUS_VERSION = 1 as const;

/** Record schema version stamped on every demo corpus record. */
export const DEMO_CORPUS_RECORD_VERSION = 1 as const;

/** The record ids of the corpus, in canonical (recordId-ascending) order. */
export const DEMO_CORPUS_RECORD_IDS = Object.freeze([
  'demo.agent-body.software-engineer',
  'demo.agent-body.structural-engineer',
  'demo.capability-case.payments-reliability',
  'demo.certification.software-engineer-v1-1-0',
  'demo.expert-qualification.structural-review',
] as const);

/** One frozen corpus record (B002 record shape; B005 kind vocabulary). */
function record(
  recordId: string,
  kind: string,
  data: Record<string, unknown>,
): ControlPlaneRecord {
  return deepFreeze({
    recordId,
    tenantId: DEMO_TENANT_ID,
    kind,
    version: DEMO_CORPUS_RECORD_VERSION,
    revision: 1,
    data: deepFreeze(data),
    createdAt: DEMO_NARRATIVE_EPOCH_MS,
    updatedAt: DEMO_NARRATIVE_EPOCH_MS,
  }) as ControlPlaneRecord;
}

/**
 * Build the deterministic demo corpus. PURE: same call → byte-identical
 * records (no randomness, no clock, no state).
 */
export function buildDemoCorpus(): readonly ControlPlaneRecord[] {
  const softwareEngineer = record('demo.agent-body.software-engineer', 'agent-body', {
    demoTime: DEMO_NARRATIVE_TIME_ISO,
    derivedFrom: 'A028 reference body (bodies/software-engineer, tenant arena-reference)',
    displayName: 'Software Engineer (reference body)',
    bodyId: 'body-software-engineer',
    lineage: {
      initialVersion: '1.0.0',
      currentVersion: '1.1.0',
      evolution: 'uncited-skills-allowed under the reference forge policy',
    },
    manifestSummary: {
      skills: 5,
      knowledge: 4,
      tools: 6,
      procedures: 2,
      capabilities: 3,
      evaluationSuites: 1,
      verificationSuites: 1,
    },
    toolNames: [
      'repo-navigator',
      'file-editor',
      'test-runner',
      'build-runner',
      'code-search',
      'vcs-client',
    ],
    substratePossessions: [
      {
        possessionId: 'possession-repository-checkout',
        substrate: 'workspace-mount',
        grantedTo: 'body-software-engineer@1.1.0',
        scope: 'composition-scoped',
      },
    ],
    environmentRequirements: {
      runtime: 'sandboxed-workspace',
      network: 'denied-by-default',
    },
  });

  const structuralEngineer = record('demo.agent-body.structural-engineer', 'agent-body', {
    demoTime: DEMO_NARRATIVE_TIME_ISO,
    derivedFrom: 'A029 reference body (bodies/structural-engineer, tenant arena-reference)',
    displayName: 'Structural Engineer (reference body)',
    bodyId: 'body-structural-engineer',
    lineage: {
      initialVersion: '1.0.0',
      currentVersion: '1.0.0',
      evolution: 'first release; supersession allowed by policy',
    },
    manifestSummary: {
      skills: 5,
      knowledge: 4,
      tools: 6,
      procedures: 2,
      capabilities: 3,
      evaluationSuites: 1,
      verificationSuites: 1,
    },
    toolNames: [
      'structural-solver',
      'load-model-editor',
      'calculation-recorder',
      'code-reference-lookup',
      'drawing-spec-access',
      'compliance-reporter',
    ],
    substratePossessions: [
      {
        possessionId: 'possession-code-basement',
        substrate: 'standards-library',
        grantedTo: 'body-structural-engineer@1.0.0',
        scope: 'composition-scoped',
      },
    ],
    environmentRequirements: {
      runtime: 'sandboxed-workspace',
      network: 'denied-by-default',
    },
  });

  const capabilityCase = record('demo.capability-case.payments-reliability', 'capability-case', {
    demoTime: DEMO_NARRATIVE_TIME_ISO,
    caseId: 'case-payments-reliability',
    title: 'Payments reliability: eliminate the flaky refund timeout',
    summary:
      'A first-run walkthrough case: an Agent Body investigates a flaky refund timeout, replays its trajectory, is evaluated against its suite, and passes independent verification.',
    lifecycle: 'active',
    tasks: [
      {
        taskId: 'task-reproduce',
        title: 'Reproduce the refund timeout under load',
        state: 'completed',
      },
      {
        taskId: 'task-patch',
        title: 'Propose a minimal, reviewable fix',
        state: 'completed',
      },
      {
        taskId: 'task-review',
        title: 'Human review of the proposed change',
        state: 'in-review',
      },
    ],
    assignedBody: {
      bodyId: 'body-software-engineer',
      bodyVersion: '1.1.0',
    },
    trajectory: [
      {
        step: 1,
        type: 'observation',
        summary: 'Timeouts cluster around one retry path in the refunds adapter.',
      },
      {
        step: 2,
        type: 'action',
        summary: 'Search the repository for retry/backoff call sites.',
      },
      {
        step: 3,
        type: 'tool',
        tool: 'repo-navigator',
        summary: 'Located refunds/adapter.ts and its retry helper.',
      },
      {
        step: 4,
        type: 'result',
        summary: 'Retry helper uses a fixed 1s interval with no jitter; storms coincide with cron.',
      },
      {
        step: 5,
        type: 'model-output',
        summary:
          'Proposed change: replace the fixed interval with jittered exponential backoff and cap retries at three.',
      },
    ],
    evaluation: {
      suiteId: 'suite-software-engineer-evaluation',
      verdict: 'pass',
      summary: 'Suite green: regression tests added for jitter bounds and retry cap.',
      evaluatedAt: DEMO_NARRATIVE_TIME_ISO,
    },
    verification: {
      verifierKind: 'independent-verification',
      verdict: 'pass',
      checks: [
        'regression tests re-run in a clean environment',
        'change diff inspected by a second reviewer',
      ],
      verifiedAt: DEMO_NARRATIVE_TIME_ISO,
    },
    epoch: {
      epochId: 'epoch-1',
      summary:
        'The Epoch learning loop admits a skill draft only with experiment evidence; the suggestion below is a draft, not a learned skill.',
      suggestion: {
        suggestionId: 'suggestion-jittered-backoff',
        kind: 'skill-draft',
        text: 'When retrying under load, prefer jittered exponential backoff over fixed intervals.',
        status: 'suggested (not admitted)',
      },
    },
  });

  const certification = record('demo.certification.software-engineer-v1-1-0', 'certification', {
    demoTime: DEMO_NARRATIVE_TIME_ISO,
    certificationId: 'cert-software-engineer-1-1-0',
    subject: {
      bodyId: 'body-software-engineer',
      bodyVersion: '1.1.0',
    },
    certificationKind: 'body-release',
    verdict: 'certified',
    basis: 'evaluation pass + independent verification pass',
    certifiedAt: DEMO_NARRATIVE_TIME_ISO,
    note: 'Certification is a distinct concept from evaluation and from verification.',
  });

  const expertQualification = record('demo.expert-qualification.structural-review', 'expert-qualification', {
    demoTime: DEMO_NARRATIVE_TIME_ISO,
    qualificationId: 'qual-structural-review',
    expertId: 'expert-structural-001',
    domain: 'structural-engineering',
    scope: ['load-model review', 'code-basis compliance'],
    judgment: {
      kind: 'expert-judgment',
      summary:
        'The structural engineer body v1.0.0 load-model outputs are fit for review triage; final sign-off remains a human expert.',
      basis: 'A029 reference-body evaluation suite + expert review',
    },
    qualifiedAt: DEMO_NARRATIVE_TIME_ISO,
  });

  return Object.freeze([softwareEngineer, structuralEngineer, capabilityCase, certification, expertQualification]);
}

/**
 * Compute the demo corpus hash: a canonical-JSON digest over the ordered
 * corpus records (identity, tenancy, kind, versioning, data and the fixed
 * provenance constants are all covered). Two constructions of the corpus
 * MUST produce the identical hash — this is the testable determinism
 * contract.
 */
export function computeDemoCorpusHash(): string {
  const corpus = buildDemoCorpus();
  return canonicalJson(corpus);
}

/** The demo corpus hash as a fixed constant-length summary (hex-style digest of the canonical JSON). */
export function demoCorpusHashSummary(hash: string): string {
  // Deterministic, dependency-free summary: fold the canonical JSON into a
  // fixed unsigned 32-bit FNV-1a digest rendered as 8 hex characters.
  let digest = 0x811c9dc5;
  for (let index = 0; index < hash.length; index += 1) {
    digest ^= hash.charCodeAt(index);
    digest = Math.imul(digest, 0x01000193) >>> 0;
  }
  return digest.toString(16).padStart(8, '0');
}
