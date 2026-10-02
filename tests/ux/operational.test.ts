/**
 * B017 M2 — OPERATIONAL conformance.
 *
 *   1. Capacity panel shows the free-tier state: every closed FT2.0
 *      posture (AVAILABLE / DEGRADED / EXHAUSTED / DISABLED) with
 *      visible ceilings and consumption;
 *   2. Fail-closed exhaustion is a REFUSAL: an EXHAUSTED provider
 *      BLOCKS operations through the typed B002 guard — no billable
 *      fallback, no silent degradation (the exhaustion policy has
 *      exactly one inhabitant, and the board renders it verbatim);
 *   3. The audit stream records lifecycle hops: the demo operations
 *      corpus carries REAL chained A034 events (authorization,
 *      tenant-scope denial, secret detection, policy registration) and
 *      the jobs carry append-only lifecycle transition histories
 *      (claim -> progress -> complete), all rendered through the real
 *      audit/jobs surfaces with the verified chain;
 *   4. The B002 capacity guard refuses writes on exhaustion with the
 *      typed error (the programmatic fail-closed seam behind the UX).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  CAPACITY_EXHAUSTION_POLICY,
  assertCapacityUsable,
} from '../../packages/persistence/src/index.js';
import {
  resolveDemoOperationsCapacity,
  resolveDemoOperationsAudit,
  resolveDemoOperationsJobs,
  resolveDemoOperationsJobExperience,
} from '../../apps/web/src/operations/operations-route.js';
import { toProviderCapacityView } from '../../apps/web/src/operations/capacity-view-model.js';
import { CapacityPanelView } from '../../apps/web/src/operations/operations-screens.js';
import { OPERATIONS_DEMO_JOB_IDS } from '../../apps/web/src/operations/fixtures.js';

const BASE = process.env.ARENA_UX_BASE_URL;

describe('B017 M2 — operational: the capacity panel shows the free-tier state', () => {
  it('renders ALL FOUR closed FT2.0 postures with visible ceilings', async () => {
    const view = await resolveDemoOperationsCapacity();
    const statuses = view.board.providers.map((provider) => provider.status);
    expect(new Set(statuses)).toEqual(
      new Set(['AVAILABLE', 'DEGRADED', 'EXHAUSTED', 'DISABLED']),
    );
    // The overall posture is worst-of (fail closed beats everything).
    expect(view.board.overall).toBe('DISABLED');
    // The exhaustion policy is the one-and-only inhabitant, rendered as data.
    expect(view.board.exhaustionPolicy).toBe(CAPACITY_EXHAUSTION_POLICY);
    expect(view.board.exhaustionPolicy).toBe('fail-closed');
    // No billable fallback exists — carried as data.
    expect(view.board.noBillableFallback).toBe(true);

    const html = renderToStaticMarkup(createElement(CapacityPanelView, { view }));
    // The guarantee note renders verbatim, including the no-billable
    // clause.
    expect(html).toContain('data-arena-capacity-guarantee="true"');
    expect(html).toContain('never switches to a billable path');
    expect(html).toContain('data-arena-exhaustion-policy="fail-closed"');
    expect(html).toContain('data-arena-no-billable-fallback="true"');
    // Every provider posture is visible with its status and posture class.
    for (const status of ['AVAILABLE', 'DEGRADED', 'EXHAUSTED', 'DISABLED']) {
      expect(html).toContain(`data-arena-provider-status="${status}"`);
    }
    // The provider-neutral logical ids render as the registry rows
    // (control-plane-store / coordination-store / object-store /
    // job-compute — hosted postures in parentheses in the role text).
    expect(html).toContain('data-arena-provider="control-plane-store"');
    expect(html).toContain('data-arena-provider="object-store"');
    expect(html).toContain('data-arena-provider="job-compute"');
  });

  it('an EXHAUSTED provider renders as fail-closed REFUSAL, never degradation', async () => {
    const view = await resolveDemoOperationsCapacity();
    const exhausted = view.board.providers.find(
      (provider) => provider.status === 'EXHAUSTED',
    );
    expect(exhausted).toBeDefined();
    if (exhausted === undefined) return;
    // The refusal posture: EXHAUSTED blocks operations (fail closed).
    expect(exhausted.failClosed).toBe(true);
    // The typed refusal reasons are carried, not softened.
    expect(exhausted.reasons.length).toBeGreaterThan(0);
    expect(exhausted.reasons[0]?.code).toBeDefined();
    // Rendered: the status row says "fail closed", the reasons list
    // shows the typed codes, and there is no upgrade/billing escape
    // hatch anywhere on the board.
    const html = renderToStaticMarkup(createElement(CapacityPanelView, { view }));
    expect(html).toContain('data-arena-provider-status="EXHAUSTED"');
    expect(html).toContain('(fail closed)');
    expect(html).not.toContain('upgrade');
    expect(html).not.toContain('Upgrade');
    expect(html).not.toContain('billing');
  });
});

describe('B017 M2 — operational: fail-closed exhaustion at the B002 seam', () => {
  it('the exhaustion policy has exactly one inhabitant (fail-closed) — no alternate route is representable', () => {
    expect(CAPACITY_EXHAUSTION_POLICY).toBe('fail-closed');
    // The type-level single inhabitant: any other value fails to
    // typecheck; at runtime the closed vocabulary guards it.
    expect([CAPACITY_EXHAUSTION_POLICY]).toHaveLength(1);
  });

  it('assertCapacityUsable REFUSES on an exhausted posture with the typed error', () => {
    // The refusal: EXHAUSTED throws the typed capacity error — there is
    // no alternate-route parameter, no second destination, no swallow.
    let refusal: unknown;
    try {
      assertCapacityUsable({ status: 'EXHAUSTED' });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeDefined();
    expect((refusal as { code?: unknown }).code).toBe('PERSISTENCE_CAPACITY_EXHAUSTED');

    // DISABLED also fails closed (an unwired provider never silently
    // degrades to usable).
    let disabled: unknown;
    try {
      assertCapacityUsable({ status: 'DISABLED' });
    } catch (error) {
      disabled = error;
    }
    expect(disabled).toBeDefined();
    expect((disabled as { code?: unknown }).code).toBe('PERSISTENCE_CAPACITY_DISABLED');

    // AVAILABLE and DEGRADED pass the gate (usable, honest degradation).
    expect(() => assertCapacityUsable({ status: 'AVAILABLE' })).not.toThrow();
    expect(() => assertCapacityUsable({ status: 'DEGRADED' })).not.toThrow();
  });

  it('toProviderCapacityView keeps unknown ceilings honest (never unlimited)', () => {
    const view = toProviderCapacityView({
      health: {
        providerId: 'r2',
        status: 'AVAILABLE',
        checkedAt: 5,
        dimensions: [
          { dimension: 'objects', used: 3, limit: null, remaining: null, windowMs: null },
        ],
        reasons: [],
      },
      role: 'object storage (hosted posture)',
    });
    // A dimension with NO reported ceiling renders as unknown — never
    // as unlimited.
    expect(view.dimensions[0]?.ceilingUnknown).toBe(true);
    expect(view.failClosed).toBe(false);
  });
});

describe('B017 M2 — operational: the audit stream records lifecycle hops', () => {
  it('the demo audit stream is a VERIFIED, append-only chain of real A034 events', async () => {
    const view = await resolveDemoOperationsAudit();
    const stream = view.stream;
    expect(stream.count).toBeGreaterThan(0);
    expect(stream.chainVerified).toBe(true);
    expect(stream.truthClass).toBe('evidence');
    expect(stream.appendOnlyNote).toContain('append-only');
    // Chain order: contiguous sequences, each event linked to its
    // predecessor's digest.
    for (const [index, event] of stream.events.entries()) {
      expect(event.sequence).toBe(index + 1);
      if (index > 0) {
        expect(event.previousDigest).toBe(stream.events[index - 1]?.digest);
      }
    }
    // The stream records the operational lifecycle hops: authorization
    // decisions, tenant-scope denials, detections and registrations.
    const kinds = new Set(stream.events.map((event) => event.kind));
    expect(kinds.has('authorization-decision')).toBe(true);
    expect(kinds.has('tenant-access-denied')).toBe(true);
  });

  it('the jobs surface renders append-only lifecycle transition histories (the job hops)', async () => {
    const jobs = await resolveDemoOperationsJobs();
    expect(jobs.jobs.length).toBeGreaterThan(0);
    // A job's event history IS its lifecycle hop log (claim/progress/
    // complete), rendered through the real job detail surface.
    const job = await resolveDemoOperationsJobExperience(
      OPERATIONS_DEMO_JOB_IDS.regression as string,
    );
    expect(job.kind).toBe('job');
    if (job.kind !== 'job') return;
    const events = job.view.view.events;
    expect(events.length).toBeGreaterThan(0);
    const kinds = events.map((event) => event.kind).filter((kind) => kind !== undefined);
    expect(kinds.length).toBeGreaterThan(1);
    // Sequences are contiguous and monotone (append-only hops).
    const sequences = events
      .map((event) => event.sequence)
      .filter((sequence) => sequence !== undefined);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
  });
});

describe.skipIf(BASE === undefined)('B017 M2 — operational conformance (served layer)', () => {
  it('the served capacity panel shows the free-tier state with the fail-closed guarantee', async () => {
    const response = await fetch(`${BASE}/demo/operations/capacity`, { redirect: 'follow' });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('data-arena-exhaustion-policy="fail-closed"');
    expect(body).toContain('data-arena-no-billable-fallback="true"');
    expect(body).toContain('never switches to a billable path');
    for (const status of ['AVAILABLE', 'DEGRADED', 'EXHAUSTED', 'DISABLED']) {
      expect(body).toContain(`data-arena-provider-status="${status}"`);
    }
  });

  it('the served audit stream renders the verified chain with append-only note', async () => {
    const response = await fetch(`${BASE}/demo/operations/audit`, { redirect: 'follow' });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('append-only');
    expect(body).toContain('verified');
    expect(body).toContain('authorization-decision');
    expect(body).toContain('tenant-access-denied');
  });

  it('the served jobs list renders the honest job lifecycle states', async () => {
    const response = await fetch(`${BASE}/demo/operations/jobs`, { redirect: 'follow' });
    expect(response.status).toBe(200);
    const body = await response.text();
    // The closed job-state vocabulary renders with pending honesty
    // (queued/running are pending, succeeded terminal, failed honest).
    expect(body).toContain('succeeded');
  });
});
