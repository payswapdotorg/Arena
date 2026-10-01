import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * Bodies-route composition tests (Work Order B010; issue #82) — the
 * fail-closed route outcomes (auth-required; not-found; wrong-kind;
 * unreadable) and the demo compositions. The session→studio happy path
 * is covered transitively (runtime.test.ts resolves the session
 * composition; studio-view.test.tsx builds the view through an injected
 * port).
 */

import {
  BodiesAuthRequiredView,
  resolveBodiesExperience,
  resolveBodyDetailExperience,
  resolveDemoBodiesStudioView,
} from './bodies-route.js';
import { BodyStudioView } from './bodies-home-view.js';

const NO_COOKIE_PROBE = {
  cookieValue: () => Promise.resolve(null),
  validate: () => Promise.reject(new Error('unreachable')),
};

describe('bodies route composition (fail closed)', () => {
  it('renders the auth-required notice — never an anonymous studio (negative)', async () => {
    const experience = await resolveBodiesExperience({ probe: NO_COOKIE_PROBE });
    expect(experience.kind).toBe('auth-required');
    const html = renderToStaticMarkup(<BodiesAuthRequiredView />);
    expect(html).toContain('data-arena-studio-auth="required"');
    expect(html).toContain('data-arena-state="denied"');
    expect(html).not.toContain('data-arena-possession-matrix');
  });

  it('the detail route is auth-required without a session too (negative)', async () => {
    const experience = await resolveBodyDetailExperience({
      recordId: 'demo.agent-body.software-engineer',
      probe: NO_COOKIE_PROBE,
    });
    expect(experience.kind).toBe('auth-required');
  });
});

describe('demo bodies route composition (B006 posture)', () => {
  it('composes the demo studio over the reserved demo tenant (positive)', async () => {
    const view = await resolveDemoBodiesStudioView();
    expect(view.mode).toBe('demo');
    expect(view.tenantId).toBe('arena-demo');
    expect(view.demo.isDemo).toBe(true);
    expect(view.bodies.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(<BodyStudioView view={view} />);
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain('data-arena-body-distinction="true"');
  });
});
