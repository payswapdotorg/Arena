import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * Body Studio library view tests (Work Order B010; issue #82) — the house
 * style (B007 cockpit precedent): the async view model composes through
 * the REAL demo runtime (canonical reads over the deterministic corpus);
 * the presentational component renders to static markup for distinction,
 * versioning, possession-matrix, claim-scope, comparison and demo
 * labelling assertions. Session-mode lenses are covered through an
 * injected fake read port.
 */

import type {
  CanonicalRead,
  KindInventory,
  ReadPage,
} from '../../../../packages/read-model/src/index.js';
import { buildBodyStudioView } from './studio-view.js';
import { BodyStudioView } from './bodies-home-view.js';
import { getDemoBodyStudioContext, resetDemoBodyStudioContext } from './runtime.js';
import type { CockpitReadPort } from './runtime.js';

function fakePort(records: readonly CanonicalRead[]): CockpitReadPort {
  const byKind = (kind: string) => records.filter((record) => record.kind === kind);
  const readAt = 1759286400000;
  return {
    read: async (recordId: string) => {
      const found = records.find((record) => record.recordId === recordId);
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
        records: byKind(kind),
        readAt,
      }) as ReadPage,
    inventory: async () =>
      ({
        recordVersion: 1,
        kinds: records.map((record) => ({ kind: record.kind, count: 1 })),
      }) as KindInventory,
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

describe('demo body studio (the /demo/bodies composition)', () => {
  it('renders the studio over the deterministic corpus with unmistakable distinctions (positive)', async () => {
    resetDemoBodyStudioContext();
    const context = await getDemoBodyStudioContext();
    const view = await buildBodyStudioView({ mode: 'demo', facts: context.facts, port: context.port, corpusHash: context.corpusHash });
    const html = renderToStaticMarkup(<BodyStudioView view={view} />);

    // The studio exists and is visibly demo-labelled.
    expect(html).toContain('data-arena-route="bodies"');
    expect(html).toContain('data-arena-studio-mode="demo"');
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain('Demo mode');

    // THE core acceptance: the Body/Substrate/Possession distinction banner.
    expect(html).toContain('data-arena-body-distinction="true"');
    expect(html).toContain('Body ≠ model');
    expect(html).toContain('Substrate ≠ Body');
    expect(html).toContain('versioned composition binding');

    // Explicit versioning + immutability.
    expect(html).toContain('data-arena-version-current="1.1.0"');
    expect(html).toContain('data-arena-version-immutability="true"');
    expect(html).toContain('improvement creates a NEW version');

    // The possession matrix renders the versioned composition binding rows.
    expect(html).toContain('data-arena-possession-matrix="true"');
    expect(html).toContain('data-arena-binding="versioned-composition-binding"');
    expect(html).toContain('data-arena-possession-body-version="body-software-engineer@1.1.0"');
    expect(html).toContain('data-arena-possession-substrate="workspace-mount"');
    // Unknown components render as Unknown — never guessed.
    expect(html).toContain('data-arena-unknown="true"');

    // The composition listing is inspectable.
    expect(html).toContain('data-arena-composition="true"');
    expect(html).toContain('repo-navigator');
    expect(html).toContain('vcs-client');

    // Certification claims render as claims about the tested composition.
    expect(html).toContain('data-arena-claim-scope="body-software-engineer@1.1.0"');
    expect(html).toContain('tested composition');
    expect(html).toContain('never the bare model');

    // The comparison panel is composition-scoped; the demo corpus has ONE
    // possession per body so the honest typed rejection renders.
    expect(html).toContain('data-arena-compare-scope="composition-scoped"');
    expect(html).toContain('BODY_UI_INSUFFICIENT_ARMS');
  });

  it('is byte-identical across two compositions of the same lens (positive)', async () => {
    resetDemoBodyStudioContext();
    const context = await getDemoBodyStudioContext();
    const one = renderToStaticMarkup(
      <BodyStudioView
        view={await buildBodyStudioView({ mode: 'demo', facts: context.facts, port: context.port, corpusHash: context.corpusHash })}
      />,
    );
    const two = renderToStaticMarkup(
      <BodyStudioView
        view={await buildBodyStudioView({ mode: 'demo', facts: context.facts, port: context.port, corpusHash: context.corpusHash })}
      />,
    );
    expect(one).toBe(two);
  });

  it('switches lenses through explicit query state (positive)', async () => {
    resetDemoBodyStudioContext();
    const context = await getDemoBodyStudioContext();
    const researcher = await buildBodyStudioView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      requestedRoleId: 'researcher',
      corpusHash: context.corpusHash,
    });
    expect(researcher.roleSwitch.activeRoleId).toBe('researcher');
    expect(researcher.lens.libraryTitle).toBe('Study population');
    const builder = await buildBodyStudioView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      requestedRoleId: 'agent-builder',
      corpusHash: context.corpusHash,
    });
    expect(builder.roleSwitch.activeRoleId).toBe('agent-builder');
    expect(builder.lens.libraryTitle).toBe('Body library');
  });
});

describe('session body studio (injected read port)', () => {
  const facts = {
    tenantId: 'tenant-a',
    workspaceId: 'tenant-a-ws',
    principalLabel: 'worker-1',
    grantedRoleIds: ['agent-builder', 'researcher', 'owner'] as const,
  };

  const bodyPayload = {
    bodyId: 'body-x',
    displayName: 'Body X',
    lineage: { initialVersion: '1.0.0', currentVersion: '1.0.0', evolution: 'first release' },
    manifestSummary: { skills: 2, knowledge: 1, tools: 1, procedures: 1 },
    toolNames: ['tool-1'],
    substratePossessions: [
      { possessionId: 'p1', substrate: 'substrate-x', grantedTo: 'body-x@1.0.0', scope: 'composition-scoped' },
      { possessionId: 'p2', substrate: 'substrate-y', grantedTo: 'body-x@1.0.0', scope: 'composition-scoped' },
    ],
    environmentRequirements: { runtime: 'sandboxed', network: 'denied' },
  };

  it('compares two possessions of one body — a real composition-scoped comparison (positive)', async () => {
    const port = fakePort([
      record('agent-body', 'body-tenant-a-1', bodyPayload),
      record('certification', 'cert-1', {
        certificationId: 'cert-1',
        subject: { bodyId: 'body-x', bodyVersion: '1.0.0' },
        verdict: 'certified',
        basis: 'suite pass',
      }),
    ]);
    const view = await buildBodyStudioView({ mode: 'session', facts, port });
    expect(view.bodies).toHaveLength(1);
    expect(view.matrix).toHaveLength(2);
    // The claim matches the body's current version EXACTLY.
    expect(view.bodies[0]?.claims).toHaveLength(1);
    // The comparison over two same-body possessions SUCCEEDS.
    const comparison = view.comparisons[0];
    expect(comparison).toBeDefined();
    if (comparison === undefined) return;
    expect(comparison.outcome.kind).toBe('substrate-within-composition');
    if (comparison.outcome.kind === 'rejected') return;
    expect(comparison.outcome.rows.map((row) => row.substrate)).toEqual(['substrate-x', 'substrate-y']);
    for (const row of comparison.outcome.rows) {
      expect(`${row.bodyVersion.bodyId}@${row.bodyVersion.version}`).toBe('body-x@1.0.0');
    }
  });

  it('renders an honest empty state when no bodies exist (negative — no fabrication)', async () => {
    const view = await buildBodyStudioView({ mode: 'session', facts, port: fakePort([]) });
    expect(view.bodies).toHaveLength(0);
    expect(view.matrix).toHaveLength(0);
    expect(view.emptyKinds).toContain('agent-body');
    expect(view.emptyKinds).toContain('certification');
    const html = renderToStaticMarkup(<BodyStudioView view={view} />);
    expect(html).toContain('No Agent Bodies yet');
  });

  it('denies a requested-but-not-granted role truthfully (negative)', async () => {
    const port = fakePort([record('agent-body', 'body-tenant-a-1', bodyPayload)]);
    const view = await buildBodyStudioView({
      mode: 'session',
      facts,
      port,
      requestedRoleId: 'administrator',
    });
    expect(view.roleSwitch.denied).toBe(true);
    expect(view.roleSwitch.deniedRequested).toBe('administrator');
    // The lens falls back to a GRANTED role — never a fake authorization.
    expect(view.roleSwitch.activeRoleId).toBe('agent-builder');
    const html = renderToStaticMarkup(<BodyStudioView view={view} />);
    expect(html).toContain('data-arena-state="denied"');
    expect(html).toContain('administrator');
  });

  it('claims for OTHER compositions never attach to this body (negative)', async () => {
    const port = fakePort([
      record('agent-body', 'body-tenant-a-1', bodyPayload),
      record('certification', 'cert-other', {
        certificationId: 'cert-other',
        subject: { bodyId: 'body-other', bodyVersion: '9.9.9' },
        verdict: 'certified',
      }),
    ]);
    const view = await buildBodyStudioView({ mode: 'session', facts, port });
    expect(view.bodies[0]?.claims).toHaveLength(0);
    expect(view.bodies[0]?.otherClaims).toHaveLength(1);
  });
});
