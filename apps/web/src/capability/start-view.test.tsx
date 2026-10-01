import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * Guided start-form view tests (Work Order B008): the form renders the
 * DISCLOSED reference framing (visible, editable pre-fills), posts to the
 * right submit mount per mode, and surfaces a typed rejection honestly.
 */

import { StartCaseFormView } from './start-view.js';
import { CapabilitySignInGate, FlowErrorNotice } from './gate.js';
import { referenceFraming } from './flow-actions.js';

const TENANT = 'tenant-alpha';

describe('StartCaseFormView (the guided start form)', () => {
  it('renders the reference framing as visible, editable pre-fills', () => {
    const framing = referenceFraming(TENANT);
    const html = renderToStaticMarkup(
      <StartCaseFormView mode="session" framing={framing} />,
    );
    expect(html).toContain('data-arena-route="cases-start"');
    expect(html).toContain('data-arena-start-form="true"');
    expect(html).toContain(`value="${framing.identity.caseId}"`);
    expect(html).toContain(framing.problemStatement);
    expect(html).toContain(framing.observedFailure.summary);
    expect(html).toContain(framing.unknowns.join('\n'));
    expect(html).toContain('name="evidenceDigest"');
    expect(html).toContain('pattern="[0-9a-f]{64}"');
    // The structural-refs disclosure is stated, never hidden.
    expect(html).toContain('data-arena-start-disclosure="true"');
  });

  it('posts to the session submit mount (plain HTML form, no client JavaScript)', () => {
    const html = renderToStaticMarkup(
      <StartCaseFormView mode="session" framing={referenceFraming(TENANT)} />,
    );
    expect(html).toContain('action="/cases/start/submit"');
    expect(html).toContain('method="post"');
    expect(html).not.toContain('data-arena-demo-banner');
  });

  it('posts to the demo submit mount and renders the demo labelling banner', () => {
    const html = renderToStaticMarkup(
      <StartCaseFormView mode="demo" framing={referenceFraming('arena-demo')} />,
    );
    expect(html).toContain('action="/demo/cases/start/submit"');
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain('never customer state');
  });
});

describe('CapabilitySignInGate (fail closed)', () => {
  it('renders the honest gate with the typed AUTH code, never an anonymous surface', () => {
    const html = renderToStaticMarkup(
      <CapabilitySignInGate code="AUTH_SESSION_NOT_FOUND" surface="case list" />,
    );
    expect(html).toContain('data-arena-route="capability-gate"');
    expect(html).toContain('data-arena-auth-code="AUTH_SESSION_NOT_FOUND"');
    expect(html).toContain('fail closed');
    expect(html).toContain('href="/demo"');
    expect(html).not.toContain('data-arena-case-cards');
  });
});

describe('FlowErrorNotice (typed rejections surface verbatim)', () => {
  it('renders a typed rejection code honestly', () => {
    const html = renderToStaticMarkup(
      <FlowErrorNotice code="CAPABILITY_CASE_DUPLICATE_EVIDENCE" />,
    );
    expect(html).toContain('data-arena-flow-error="CAPABILITY_CASE_DUPLICATE_EVIDENCE"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('never bent');
  });

  it('renders nothing without a rejection (no fabricated errors)', () => {
    expect(renderToStaticMarkup(<FlowErrorNotice code={undefined} />)).toBe('');
    expect(renderToStaticMarkup(<FlowErrorNotice code="" />)).toBe('');
  });
});
