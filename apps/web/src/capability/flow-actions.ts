/**
 * Guided flow ACTIONS (Work Order B008; issue #80; apps/web/src/capability).
 * SERVER-ONLY.
 *
 * The start/continue affordances of the capability surfaces, executed as
 * plain HTML form POSTs (the house JavaScript-free posture; the B006
 * /demo/reset precedent) against route-handler mounts. Every action:
 *
 *   1. ORIGIN-CHECKS the request (the B004 CSRF posture — absent or
 *      foreign Origin is a 403 boundary rejection);
 *   2. flows through the @arena/product-flows runtime (canonical A005
 *      transitions over the B002 repository port — never a parallel
 *      write path);
 *   3. redirects back to the surface with the resulting record id, or
 *      with the TYPED error surfaced honestly (?flowError=<code> —
 *      canonical CAPABILITY_CASE_* codes render truthfully; nothing is
 *      swallowed or re-coded into a fake success).
 *
 * The guided START form collects the canonical case framing directly
 * (every §5 field is user-visible and user-editable; the defaults shown
 * in the form are the disclosed reference framing, never silently
 * fabricated). The continue forms collect exactly the fields the step
 * needs (definitions.inputNote).
 */

import type { CapabilityFlowRuntime } from './runtime.js';
import type { StartCaseInput } from '../../../../packages/product-flows/src/index.js';
import { checkOriginAllowed } from '../auth/csrf.js';

/** A parsed guided action request. */
export type GuidedAction =
  | { readonly kind: 'start'; readonly framing: StartCaseInput }
  | {
      readonly kind: 'continue';
      readonly stepId: string;
      readonly caseId: string;
      readonly note?: string;
      readonly resolution?: string;
      readonly evidence?: readonly { readonly digest: string; readonly description: string }[];
    };

/** The typed outcome of executing one guided action. */
export type GuidedActionOutcome =
  | { readonly status: 'done'; readonly recordId: string; readonly stepId: string }
  | {
      /** The typed failure surfaced honestly (canonical or flow code). */
      readonly status: 'rejected';
      readonly code: string;
      readonly message: string;
    }
  | { readonly status: 'origin-rejected'; readonly message: string };

export interface ExecuteGuidedActionOptions {
  readonly request: Request;
  /** The tenant the action runs under (from the VALIDATED session/demo context). */
  readonly tenantId: string;
  /** The acting principal (from the session/demo context — never the client). */
  readonly actor: { readonly type: string; readonly tenant: string; readonly principalId: string };
  /** The product-flows runtime (canonical transitions over the B002 port). */
  readonly flow: CapabilityFlowRuntime;
  /** Allowed origins beyond same-origin (composition seam). */
  readonly allowedOrigins?: readonly string[];
}

/** The reference framing the start form pre-fills (disclosed, editable). */
export function referenceFraming(tenantId: string): StartCaseInput {
  return {
    identity: { tenant: tenantId, caseId: 'case-your-first-gap' },
    version: '1.0.0',
    source: { type: 'user', tenant: tenantId, principalId: 'analyst-1' },
    problemStatement:
      'Describe the capability gap you observed: what does your agent fail to do, and where did you see it fail?',
    targetCapability: {
      kind: 'capability',
      id: 'the-target-capability',
      version: '1.0.0',
      digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    domain: {
      kind: 'domain',
      id: 'the-domain',
      version: '1.0.0',
      digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
    context: 'Where the agent runs and what it can touch when the failure happens.',
    observedFailure: {
      summary: 'The observed failure, in one sentence.',
      observedAt: '2026-10-01T09:00:00.000Z',
      reproduction: 'How to reproduce the failure.',
    },
    evidence: [
      {
        digest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        description: 'The evidence artifact behind the observed failure (sha256-addressed).',
      },
    ],
    unknowns: ['What you do not yet know about the failure (an honest case carries known unknowns)'],
    desiredOutcome: 'The outcome you need once the capability exists.',
    expertRequirements: {
      competencies: [
        {
          kind: 'expert-competency',
          id: 'the-expert-competency',
          version: '1.0.0',
          digest: '1212121212121212121212121212121212121212121212121212121212121212',
        },
      ],
      qualifications: ['the-qualification'],
    },
    environmentRequirements: {
      environments: [
        {
          namespace: tenantId,
          name: 'the-sandbox-environment',
          version: '1.0.0',
          digest: '3434343434343434343434343434343434343434343434343434343434343434',
        },
      ],
      constraints: ['No live-world writes'],
    },
    taskRequirements: {
      objectives: ['The objective the task must achieve'],
      constraints: ['Use only the sandbox'],
      allowedTools: [
        {
          namespace: tenantId,
          name: 'the-allowed-tool',
          version: '1.0.0',
          digest: '5656565656565656565656565656565656565656565656565656565656565656',
        },
      ],
      forbiddenShortcuts: ['The shortcut that would fake success'],
      successConditions: ['The observable success condition'],
      evidenceCriteria: ['The evidence the run must produce'],
      difficulty: 'standard',
    },
    evaluationRequirements: {
      evaluators: [
        {
          kind: 'evaluator',
          id: 'the-evaluator',
          version: '1.0.0',
          digest: '7878787878787878787878787878787878787878787878787878787878787878',
        },
      ],
      criteria: ['The criterion a good result satisfies'],
    },
    verificationRequirements: {
      verifiers: [
        {
          kind: 'verifier',
          id: 'the-verifier',
          version: '1.0.0',
          digest: '9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a',
        },
      ],
      evidenceStandards: ['The proof standard verification requires'],
    },
    provenance: { recordDigest: 'bc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1d' },
    priority: 'normal',
    risk: 'moderate',
    createdAt: '2026-10-01T09:00:00.000Z',
  };
}

function field(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function listField(form: FormData, key: string): string[] {
  const raw = field(form, key);
  if (raw === undefined) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function typedError(error: unknown): { code: string; message: string } {
  const code = (error as { code?: unknown } | null)?.code;
  return {
    code: typeof code === 'string' ? code : 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Parse a guided-action form POST. The start form carries the full
 * canonical framing (the reference framing's fixed structural fields +
 * the editable narrative fields); the continue form carries the
 * step-specific fields.
 */
export function parseGuidedAction(
  form: FormData,
  context: { readonly tenantId: string; readonly principalLabel: string },
): GuidedAction {
  const intent = field(form, 'intent') ?? 'continue';
  if (intent === 'start') {
    const base = referenceFraming(context.tenantId);
    const caseId = field(form, 'caseId') ?? base.identity.caseId;
    const problemStatement = field(form, 'problemStatement') ?? base.problemStatement;
    const observedSummary = field(form, 'observedFailureSummary') ?? base.observedFailure.summary;
    const reproduction = field(form, 'reproduction') ?? base.observedFailure.reproduction;
    const unknowns = listField(form, 'unknowns');
    const desiredOutcome = field(form, 'desiredOutcome') ?? base.desiredOutcome;
    const context_ = field(form, 'context') ?? base.context;
    const evidenceDigest = field(form, 'evidenceDigest') ?? base.evidence[0]?.digest;
    const evidenceDescription =
      field(form, 'evidenceDescription') ?? base.evidence[0]?.description;
    const priority = field(form, 'priority') ?? base.priority;
    const risk = field(form, 'risk') ?? base.risk;
    return {
      kind: 'start',
      framing: {
        ...base,
        identity: { tenant: context.tenantId, caseId },
        source: { type: 'user', tenant: context.tenantId, principalId: context.principalLabel },
        problemStatement,
        context: context_,
        observedFailure: {
          ...base.observedFailure,
          summary: observedSummary,
          ...(reproduction !== undefined ? { reproduction } : {}),
        },
        evidence: [
          ...(evidenceDigest !== undefined && evidenceDescription !== undefined
            ? [{ digest: evidenceDigest, description: evidenceDescription }]
            : []),
        ],
        unknowns: unknowns.length > 0 ? unknowns : base.unknowns,
        desiredOutcome,
        priority,
        risk,
      },
    };
  }
  const stepId = field(form, 'stepId');
  const caseId = field(form, 'caseId');
  if (stepId === undefined || caseId === undefined) {
    throw new Error('a continue action requires stepId and caseId');
  }
  const note = field(form, 'note');
  const resolution = field(form, 'resolution');
  const evidenceDigest = field(form, 'evidenceDigest');
  const evidenceDescription = field(form, 'evidenceDescription');
  return {
    kind: 'continue',
    stepId,
    caseId,
    ...(note !== undefined ? { note } : {}),
    ...(resolution !== undefined ? { resolution } : {}),
    ...(evidenceDigest !== undefined && evidenceDescription !== undefined
      ? { evidence: [{ digest: evidenceDigest, description: evidenceDescription }] }
      : {}),
  };
}

/**
 * Execute one guided action through the product-flows runtime:
 * origin-check → parse → canonical transition → typed outcome.
 */
export async function executeGuidedAction(
  options: ExecuteGuidedActionOptions,
): Promise<GuidedActionOutcome> {
  // 1) Origin check (B004 CSRF posture — strict).
  const rejection = checkOriginAllowed(
    options.request,
    options.allowedOrigins ?? [],
  );
  if (rejection !== null) {
    return { status: 'origin-rejected', message: rejection.message };
  }

  let form: FormData;
  try {
    form = await options.request.formData();
  } catch {
    return { status: 'rejected', code: 'PRODUCT_FLOW_MALFORMED_INPUT', message: 'the action requires a form body' };
  }

  let action: GuidedAction;
  try {
    action = parseGuidedAction(form, {
      tenantId: options.tenantId,
      principalLabel: options.actor.principalId,
    });
  } catch (error) {
    return { status: 'rejected', ...typedError(error) };
  }

  try {
    if (action.kind === 'start') {
      await options.flow.startCase(action.framing);
      return {
        status: 'done',
        recordId: `case.${options.tenantId}.${action.framing.identity.caseId}`,
        stepId: 'start-case',
      };
    }
    await options.flow.continueCase({
      stepId: action.stepId,
      identity: { tenant: options.tenantId, caseId: action.caseId },
      actor: options.actor,
      at: new Date().toISOString(),
      ...(action.note !== undefined ? { note: action.note } : {}),
      ...(action.resolution !== undefined ? { resolution: action.resolution } : {}),
      ...(action.evidence !== undefined ? { evidence: action.evidence } : {}),
    });
    return {
      status: 'done',
      recordId: `case.${options.tenantId}.${action.caseId}`,
      stepId: action.stepId,
    };
  } catch (error) {
    // Typed failures surface VERBATIM (canonical CAPABILITY_CASE_* /
    // PERSISTENCE_* / PRODUCT_FLOW_* codes) — never a fake success.
    return { status: 'rejected', ...typedError(error) };
  }
}
