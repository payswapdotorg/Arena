/**
 * Body Studio runtime composition (Work Order B010; issue #82;
 * apps/web/src/bodies). SERVER-ONLY surface.
 *
 * The studio reads through the SAME canonical paths as the B007 cockpit —
 * there is no second data model and no parallel demo API:
 *
 *   SESSION composition — the authenticated `/bodies` experience: the
 *   B004 session boundary validates FIRST (fail closed: typed AUTH_*
 *   outcomes, never an anonymous studio), and every canonical read goes
 *   through the B005 read-API boundary, tenant from the session.
 *
 *   DEMO composition — the B006 demo posture: the shared demo runtime
 *   (zero credentials, deterministic corpus, reserved demo tenant) with
 *   reads through the SAME canonical read path, visibly labelled per the
 *   demo labelling contract. Demo state is never customer state.
 *
 * The session composition is REUSED from the cockpit runtime
 * (`resolveSessionCockpit`) — a read-only import of the frozen B007
 * surface, so the two studios share one session/read wiring instead of
 * duplicating it. Workspace imports are RELATIVE (../..) because
 * apps/web's package manifest is B001-owned and stays untouched.
 */

import {
  ROLE_IDS,
  createPermissionPolicy,
  createWorkspaceContext,
  grantRole,
  grantedRoleIds,
} from '../../../../packages/role-context/src/index.js';
import type { WorkspaceContext } from '../../../../packages/role-context/src/index.js';
import { DEMO_NARRATIVE_TIME_ISO, isDemoTenant } from '@arena/demo';
import { resolveSessionCockpit } from '../cockpit/runtime.js';
import type {
  CockpitReadPort,
  CockpitSessionFacts,
  ResolveSessionCockpitOptions,
  SessionCockpitOutcome,
} from '../cockpit/runtime.js';
import { getDemoRuntime } from '../demo/runtime.js';

export type {
  CockpitReadPort,
  CockpitSessionFacts,
  SessionCockpitOutcome,
  SessionProbe,
} from '../cockpit/runtime.js';

// ---------------------------------------------------------------------------
// Session composition (fail closed through the B004 boundary)
// ---------------------------------------------------------------------------

/**
 * Resolve the session body studio: the browser session is probed FIRST
 * (fail closed — typed AUTH_* outcomes never produce an anonymous
 * studio), then the session facts + read port are exposed through the
 * B005 read-API boundary. This is the cockpit's `resolveSessionCockpit`
 * composition, reused read-only: one session wiring, two studios.
 */
export async function resolveSessionBodyStudio(
  options: ResolveSessionCockpitOptions = {},
): Promise<SessionCockpitOutcome> {
  return resolveSessionCockpit(options);
}

// ---------------------------------------------------------------------------
// Demo composition (B006 runtime; canonical reads; demo labelling)
// ---------------------------------------------------------------------------

/** The reserved demo workspace id (the demo tenant has exactly one). */
export const DEMO_BODY_STUDIO_WORKSPACE_ID = 'demo-workspace' as const;

/** The demo body-studio context: facts + reads + the determinism stamp. */
export interface DemoBodyStudioContext {
  readonly facts: CockpitSessionFacts;
  readonly port: CockpitReadPort;
  readonly corpusHash: string;
}

/**
 * Build the demo workspace context: the reserved demo tenant, an opaque
 * demo lens policy, and one demo-provenance grant per reference role.
 * These are DEMO LENS grants in the reserved demo tenant — deterministic
 * narrative state, never customer authorization.
 */
function buildDemoWorkspaceContext(): WorkspaceContext {
  const grants = ROLE_IDS.map((roleId) =>
    grantRole({
      grantId: `demo-grant-${roleId}`,
      identityId: 'demo-visitor',
      tenantId: 'arena-demo',
      roleId,
      policyId: 'demo-lens-policy',
      grantedBy: 'arena-demo-mode',
      grantedAt: DEMO_NARRATIVE_TIME_ISO,
      note: 'deterministic demo lens grant — never customer authorization',
      validFrom: DEMO_NARRATIVE_TIME_ISO,
    }),
  );
  return createWorkspaceContext({
    identityId: 'demo-visitor',
    tenantId: 'arena-demo',
    workspaceId: DEMO_BODY_STUDIO_WORKSPACE_ID,
    permissionPolicy: createPermissionPolicy({
      policyId: 'demo-lens-policy',
      tenantId: 'arena-demo',
      descriptor: {
        kind: 'demo-lens-policy',
        note: 'opaque demo descriptor — carried, never interpreted',
      },
      issuedAt: DEMO_NARRATIVE_TIME_ISO,
    }),
    grantedRoles: grants,
  });
}

let demoContext: Promise<DemoBodyStudioContext> | undefined;

/**
 * The demo body-studio context over the SHARED B006 demo runtime (module
 * singleton — deterministic, resettable through /demo/reset). Reads go
 * through the canonical read path over the deterministic demo corpus,
 * scoped to the reserved demo tenant.
 */
export function getDemoBodyStudioContext(): Promise<DemoBodyStudioContext> {
  demoContext ??= (async () => {
    const runtime = await getDemoRuntime();
    if (!isDemoTenant(runtime.session.tenantId)) {
      throw new Error('demo body studio requires the reserved demo tenant (fail closed)');
    }
    const workspace = buildDemoWorkspaceContext();
    return Object.freeze({
      facts: Object.freeze({
        tenantId: String(runtime.session.tenantId),
        workspaceId: DEMO_BODY_STUDIO_WORKSPACE_ID,
        principalLabel: 'demo-visitor',
        grantedRoleIds: Object.freeze([...grantedRoleIds(workspace)]),
      }),
      port: runtime.reads,
      corpusHash: runtime.corpusHash,
    });
  })();
  return demoContext;
}

/** Hard reset of the cached demo body-studio context (test seam; /demo/reset re-seeds the runtime itself). */
export function resetDemoBodyStudioContext(): void {
  demoContext = undefined;
}
