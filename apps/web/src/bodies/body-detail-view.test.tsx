import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * Body detail view tests (Work Order B010; issue #82) — `/bodies/:id`
 * through the REAL demo runtime (canonical read of one body record),
 * plus fail-honest outcomes: not-found, wrong-kind, unreadable. The
 * presentational component renders to static markup for the
 * identity/versioning/matrix/claims/comparison assertions.
 */

import type {
  CanonicalRead,
  KindInventory,
  ReadPage,
} from '../../../../packages/read-model/src/index.js';
import { resolveBodyDetail } from './body-detail-view.js';
import { BodyDetailView } from './bodies-detail-view.js';
import { getDemoBodyStudioContext, resetDemoBodyStudioContext } from './runtime.js';
import type { CockpitReadPort } from './runtime.js';

function fakePort(records: readonly CanonicalRead[]): CockpitReadPort {
  const readAt = 1759286400000;
  return {
    read: async (recordId: string) => {
      const found = records.find((entry) => entry.recordId === recordId);
      if (found === undefined) {
        throw new Error('cockpit read failed (fail closed) [read-canonical]: RECORD_NOT_FOUND');
      }
      return found;
    },
    scroll: async (kind: string) =>
      ({
        recordVersion: 1,
        kind: 'by-kind',
        recordKind: kind,
        records: records.filter((entry) => entry.kind === kind),
        readAt,
      }) as ReadPage,
    inventory: async () =>
      ({ recordVersion: 1, kinds: [] }) as KindInventory,
  };
}

function record(kind: string, recordId: string, data: unknown): CanonicalRead {
  return {
    recordVersion: 1,
    recordId,
    tenantId: 'tenant-a',
    kind,
    sourceVersion: 1,
    sourceRevision: 1,
    data,
    provenance: { createdAt: 1, updatedAt: 1 },
    readAt: 1759286400000,
  } as CanonicalRead;
}

const SESSION_FACTS = {
  tenantId: 'tenant-a',
  workspaceId: 'tenant-a-ws',
  principalLabel: 'worker-1',
  grantedRoleIds: ['agent-builder', 'researcher'] as const,
};

describe('demo body detail (the /demo/bodies/:id composition)', () => {
  it('resolves and renders the full body detail over the canonical read path (positive)', async () => {
    resetDemoBodyStudioContext();
    const context = await getDemoBodyStudioContext();
    const outcome = await resolveBodyDetail({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      recordId: 'demo.agent-body.software-engineer',
      corpusHash: context.corpusHash,
    });
    expect(outcome.status).toBe('body');
    if (outcome.status !== 'body') return;
    expect(outcome.view.recordId).toBe('demo.agent-body.software-engineer');
    expect(outcome.view.card.identity.bodyId).toBe('body-software-engineer');
    expect(outcome.view.card.identity.versioning.currentVersion).toBe('1.1.0');
    expect(outcome.view.claims).toHaveLength(1);

    const html = renderToStaticMarkup(<BodyDetailView view={outcome.view} />);
    expect(html).toContain('data-arena-route="bodies-detail"');
    expect(html).toContain('data-arena-body-distinction="true"');
    expect(html).toContain('data-arena-version-current="1.1.0"');
    expect(html).toContain('data-arena-possession-body-version="body-software-engineer@1.1.0"');
    expect(html).toContain('data-arena-possession-substrate="workspace-mount"');
    expect(html).toContain('data-arena-binding="versioned-composition-binding"');
    expect(html).toContain('data-arena-claim-scope="body-software-engineer@1.1.0"');
    expect(html).toContain('data-arena-version-immutability="true"');
    // The honest comparison rejection for a single-possession body:
    expect(html).toContain('BODY_UI_INSUFFICIENT_ARMS');
    // Demo labelling contract:
    expect(html).toContain('data-arena-demo-banner="true"');
  });

  it('resolves not-found honestly for an unknown record id (negative)', async () => {
    resetDemoBodyStudioContext();
    const context = await getDemoBodyStudioContext();
    const outcome = await resolveBodyDetail({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      recordId: 'demo.agent-body.does-not-exist',
    });
    expect(outcome.status).toBe('not-found');
  });

  it('resolves wrong-kind honestly for a non-body record id (negative)', async () => {
    resetDemoBodyStudioContext();
    const context = await getDemoBodyStudioContext();
    const outcome = await resolveBodyDetail({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      recordId: 'demo.certification.software-engineer-v1-1-0',
    });
    expect(outcome.status).toBe('wrong-kind');
    if (outcome.status !== 'wrong-kind') return;
    expect(outcome.kind).toBe('certification');
  });

  it('is byte-identical across two resolutions (positive)', async () => {
    resetDemoBodyStudioContext();
    const context = await getDemoBodyStudioContext();
    const one = await resolveBodyDetail({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      recordId: 'demo.agent-body.software-engineer',
      corpusHash: context.corpusHash,
    });
    const two = await resolveBodyDetail({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      recordId: 'demo.agent-body.software-engineer',
      corpusHash: context.corpusHash,
    });
    if (one.status !== 'body' || two.status !== 'body') {
      expect.unreachable('both resolutions must be bodies');
      return;
    }
    expect(renderToStaticMarkup(<BodyDetailView view={one.view} />)).toBe(
      renderToStaticMarkup(<BodyDetailView view={two.view} />),
    );
  });
});

describe('session body detail (injected read port)', () => {
  const bodyPayload = {
    bodyId: 'body-x',
    displayName: 'Body X',
    lineage: { initialVersion: '1.0.0', currentVersion: '1.0.0' },
    manifestSummary: { skills: 2, knowledge: 1, tools: 1 },
    toolNames: ['tool-1'],
    substratePossessions: [
      { possessionId: 'p1', substrate: 'substrate-x', grantedTo: 'body-x@1.0.0', scope: 'composition-scoped' },
    ],
    environmentRequirements: { runtime: 'sandboxed', network: 'denied' },
  };

  it('resolves a body and applies the requested role lens (positive)', async () => {
    const port = fakePort([record('agent-body', 'body-1', bodyPayload)]);
    const outcome = await resolveBodyDetail({
      mode: 'session',
      facts: SESSION_FACTS,
      port,
      recordId: 'body-1',
      requestedRoleId: 'researcher',
    });
    expect(outcome.status).toBe('body');
    if (outcome.status !== 'body') return;
    expect(outcome.view.roleSwitch.activeRoleId).toBe('researcher');
    expect(outcome.view.lens.detailTitle).toBe('Compare');
  });

  it('resolves unreadable honestly when the read port fails closed (negative)', async () => {
    const failing: CockpitReadPort = {
      read: async () => {
        throw new Error('cockpit read failed (fail closed) [read-canonical]: READ_MODEL_UNAVAILABLE');
      },
      scroll: async () => ({ recordVersion: 1, kind: 'by-kind', recordKind: 'certification', records: [], readAt: 0 }) as ReadPage,
      inventory: async () => ({ recordVersion: 1, kinds: [] }) as KindInventory,
    };
    const outcome = await resolveBodyDetail({
      mode: 'session',
      facts: SESSION_FACTS,
      port: failing,
      recordId: 'body-1',
    });
    expect(outcome.status).toBe('unreadable');
    if (outcome.status !== 'unreadable') return;
    expect(outcome.message).toContain('READ_MODEL_UNAVAILABLE');
  });

  it('denies a not-granted role truthfully on the detail surface (negative)', async () => {
    const port = fakePort([record('agent-body', 'body-1', bodyPayload)]);
    const outcome = await resolveBodyDetail({
      mode: 'session',
      facts: SESSION_FACTS,
      port,
      recordId: 'body-1',
      requestedRoleId: 'operator',
    });
    expect(outcome.status).toBe('body');
    if (outcome.status !== 'body') return;
    expect(outcome.view.roleSwitch.denied).toBe(true);
    const html = renderToStaticMarkup(<BodyDetailView view={outcome.view} />);
    expect(html).toContain('data-arena-state="denied"');
  });
});
