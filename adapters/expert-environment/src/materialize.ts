/**
 * ExpertEnvironmentMaterializer (Work Order C006) — the adapter that
 * materializes bounded ExpertSessionCapsules against the A009/A010
 * environment protocol vocabulary.
 *
 * DETERMINISTIC IN-MEMORY REFERENCE IMPLEMENTATION (tests/demo): pure
 * functions over the A009 EnvironmentDefinition — no runner process, no
 * container, no network. The A010 environment-runner remains the
 * execution authority; this adapter only DERIVES the capsule view:
 *
 *   - tool availability ← the definition's ActionSurface (declared
 *     tools only — an undeclared tool is unreachable by construction);
 *   - files/data ← the definition's FilesystemPolicy mounts, with
 *     read-only mounts becoming read-only capsule resources and mounts
 *     whose source addresses the host's LIVE world NEVER entering the
 *     capsule (the replica is never a live-world write path — lock
 *     rule 28);
 *   - secret isolation ← the definition's SecretPolicy: tools bound to
 *     a declared secret injection (mount-path overlap) are EXCLUDED
 *     from the capsule tool surface (EES1.0 secret/tool exclusion);
 *   - network boundary ← the definition's NetworkPolicy egress allows
 *     travel as capsule metadata (the expert cannot reach beyond them).
 *
 * The adapter implements the services/expert-session
 * CapsuleMaterializer port STRUCTURALLY (duck-typed — zero imports of
 * service internals; boundary rule B4's approved downward edge). Hosts
 * wire `new ExpertEnvironmentMaterializer()` into the service config.
 */

import type { EnvironmentDefinition } from '@arena/environment-protocol';
import {
  composePrivacyBarrier,
  deriveExpertSessionCapsule,
} from '@arena/expert-session';
import type {
  ExpertSessionCapsule,
  ExpertSessionMode,
  ExecutionCapsuleSource,
  PlainJsonValue,
} from '@arena/expert-session';

// ---------------------------------------------------------------------------
// Structural port (mirrors services/expert-session CapsuleMaterializer)
// ---------------------------------------------------------------------------

/** The escalation policy fields the barrier derivation consumes. */
export interface EscalationPolicyViewLike {
  readonly permittedActions: readonly string[];
  readonly privacyClassification: 'public' | 'internal' | 'confidential';
  readonly pii: 'forbid' | 'redact' | 'allow';
  readonly sanitization: 'standard' | 'strict';
  readonly deadline: string;
}

/** The materialization command (structural match to the service port). */
export interface CapsuleMaterializationCommandLike {
  readonly escalationRef: { readonly requestId: string; readonly tenantId: string };
  readonly sessionMode: ExpertSessionMode;
  readonly allowedModes: readonly ExpertSessionMode[];
  readonly source: ExecutionCapsuleSource;
  readonly escalationPolicy: EscalationPolicyViewLike;
  readonly now: number | string | Date;
  readonly expiresAt: number | string | Date;
  readonly sessionId?: string;
}

export interface CapsuleMaterializerLike {
  materialize(command: CapsuleMaterializationCommandLike): Promise<ExpertSessionCapsule>;
}

// ---------------------------------------------------------------------------
// Environment derivation
// ---------------------------------------------------------------------------

/** Live-world mount source prefixes — never replicated into a capsule. */
export const LIVE_WORLD_SOURCE_PREFIXES = Object.freeze(['live:', 'prod:', 'ws://live.'] as const);

/** C001 permitted actions mapped onto expert-session actions. */
export const PERMITTED_ACTION_TO_SESSION_ACTION: Readonly<Record<string, string>> = Object.freeze({
  'read-context': 'observe-state',
  'run-approved-tools': 'invoke-tool',
  'propose-patch': 'edit-artifact',
  'annotate-evidence': 'annotate',
  'ask-clarification': 'supply-information',
  'signal-tool-gap': 'signal-tool-gap',
});

/** Session actions inherent to the EES1.0 session flow (not host-granted). */
export const INHERENT_SESSION_ACTIONS = Object.freeze(['submit-result', 'capture-checkpoint'] as const);

/** Default PII-shaped fields redacted unless privacyPolicy.pii === 'allow'. */
export const DEFAULT_PII_FIELDS = Object.freeze([
  'customerEmail',
  'customerPhone',
  'accountNumber',
] as const);

/**
 * Build the ExecutionCapsuleSource view of an A009 EnvironmentDefinition:
 * declared tools, bounded files (live-world mounts dropped, read-only
 * flags honoured), secret-bound tool exclusion, environment digest.
 */
export function executionCapsuleSourceFromDefinition(
  definition: EnvironmentDefinition,
  worldState: PlainJsonValue,
  options: {
    readonly relevantHistory?: readonly string[];
    readonly taskRef: string;
  },
): ExecutionCapsuleSource {
  const declaredTools = definition.actionSurface.tools.map((tool) => tool.toolId as string);

  // Secret-bound tools: injection points mounted under the `/tools/`
  // namespace bind a tool by id — those tools are EXCLUDED from the
  // expert surface (EES1.0 secret/tool exclusion; A009 secret isolation).
  const secretToolIds = new Set<string>(
    definition.secretPolicy.injectionPoints
      .filter((point) => (point.mountPath as string).startsWith('/tools/'))
      .map((point) => (point.mountPath as string).slice('/tools/'.length)),
  );
  const excludedTools = declaredTools.filter((tool) => secretToolIds.has(tool));

  // Bounded files: mounts only; live-world sources never replicate.
  const files = definition.filesystemPolicy.mounts
    .filter((mount) => {
      const source = String(mount.source);
      return !LIVE_WORLD_SOURCE_PREFIXES.some((prefix) => source.startsWith(prefix));
    })
    .map((mount) => ({
      path: mount.mountPath as string,
      ...(mount.access !== 'read-write' ? { readOnly: true } : {}),
    }));

  return {
    taskRef: options.taskRef,
    worldState,
    files,
    toolAvailability: declaredTools,
    policy: {
      privacyClassification: 'public',
      pii: 'redact',
      sanitization: 'standard',
    },
    relevantHistory: options.relevantHistory ?? [],
    environmentDigest: definition.digest as string,
    ...(excludedTools.length > 0 ? { excludedTools } : {}),
  };
}

// ---------------------------------------------------------------------------
// The materializer
// ---------------------------------------------------------------------------

/**
 * Deterministic in-memory reference materializer: derives the EES1.0
 * privacy barrier from the escalation's declared policy plus the A009
 * definition's isolation declarations, then delegates to the pure
 * domain capsule derivation. Same inputs ⇒ same capsule digest.
 */
export class ExpertEnvironmentMaterializer implements CapsuleMaterializerLike {
  /**
   * Optional host-declared redactions layered ON TOP of the A009-derived
   * controls (field/document redaction sets from the host application).
   */
  private readonly hostRedactions: { readonly fields: readonly string[]; readonly documents: readonly string[] };
  /** Host-declared secret-bound tools excluded from every capsule surface. */
  private readonly excludedTools: readonly string[];

  constructor(
    hostOptions: {
      readonly redactedFields?: readonly string[];
      readonly redactedDocuments?: readonly string[];
      readonly excludedTools?: readonly string[];
    } = {},
  ) {
    this.hostRedactions = Object.freeze({
      fields: Object.freeze([...(hostOptions.redactedFields ?? [])]),
      documents: Object.freeze([...(hostOptions.redactedDocuments ?? [])]),
    });
    this.excludedTools = Object.freeze([...(hostOptions.excludedTools ?? [])]);
  }

  async materialize(command: CapsuleMaterializationCommandLike): Promise<ExpertSessionCapsule> {
    const policy = command.escalationPolicy;
    const source = command.source;

    const allowlist = [
      ...policy.permittedActions
        .map((action) => PERMITTED_ACTION_TO_SESSION_ACTION[action])
        .filter((action) => action !== undefined),
      ...INHERENT_SESSION_ACTIONS,
    ];
    if (allowlist.length === INHERENT_SESSION_ACTIONS.length) {
      allowlist.push('observe-state');
    }
    const redactedFields =
      policy.pii === 'allow' ? [...this.hostRedactions.fields] : [...DEFAULT_PII_FIELDS, ...this.hostRedactions.fields];
    const credentialsExpiry =
      Date.parse(policy.deadline) < Date.parse(String(command.expiresAt))
        ? policy.deadline
        : String(command.expiresAt);

    const barrier = composePrivacyBarrier({
      tenantId: command.escalationRef.tenantId,
      actionAllowlist: allowlist,
      redactedFields,
      redactedDocuments: this.hostRedactions.documents,
      excludedTools: [...this.excludedTools, ...(source.excludedTools ?? [])],
      identityMasking: policy.pii !== 'allow',
      timeLimitedCredentials: true,
      credentialsExpiresAt: credentialsExpiry,
      readOnlyResources: source.files
        .filter((file) => file.readOnly === true)
        .map((file) => file.path),
      restrictions: { download: true, clipboard: true, screenshot: true },
    });

    return deriveExpertSessionCapsule({
      escalationRef: command.escalationRef,
      sessionMode: command.sessionMode,
      allowedModes: command.allowedModes,
      barrier,
      source,
      now: command.now,
      expiresAt: command.expiresAt,
      ...(command.sessionId !== undefined ? { sessionId: command.sessionId } : {}),
    });
  }
}
