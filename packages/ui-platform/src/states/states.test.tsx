import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { STATE_KINDS, stateKindConfig } from '../tokens/tokens.js';

import { DemoDataBadge } from './DemoDataBadge.js';
import { DeniedState } from './DeniedState.js';
import { EmptyState } from './EmptyState.js';
import { ErrorState } from './ErrorState.js';
import { LoadingState } from './LoadingState.js';
import { StaleDataNotice } from './StaleDataNotice.js';
import { TruthBadge } from './TruthBadge.js';

const render = (element: React.ReactElement): string =>
  renderToStaticMarkup(element);

describe('LoadingState', () => {
  it('announces politely with the default label (positive)', () => {
    const html = render(<LoadingState />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-arena-state="loading"');
    expect(html).toContain('Loading…');
    expect(html).toContain('aria-hidden="true"');
  });

  it('renders a custom label (positive)', () => {
    expect(render(<LoadingState label="Loading cases…" />)).toContain(
      'Loading cases…',
    );
  });
});

describe('ErrorState', () => {
  it('alerts with the default title (positive)', () => {
    const html = render(<ErrorState />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-arena-state="error"');
    expect(html).toContain('Something went wrong');
  });

  it('renders detail and action when provided (positive)', () => {
    const html = render(
      <ErrorState
        title="Cases failed to load"
        detail="The read model is unreachable."
        action={<button type="button">Try again</button>}
      />,
    );
    expect(html).toContain('Cases failed to load');
    expect(html).toContain('The read model is unreachable.');
    expect(html).toContain('<button');
    expect(html).toContain('Try again');
  });
});

describe('EmptyState', () => {
  it('is a quiet, centred placeholder — not an alert (positive)', () => {
    const html = render(
      <EmptyState title="No capability cases yet" hint="Cases define the capability you want." />,
    );
    expect(html).toContain('data-arena-state="empty"');
    expect(html).toContain('No capability cases yet');
    expect(html).toContain('Cases define the capability you want.');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });
});

describe('DeniedState', () => {
  it('alerts with the default message (positive)', () => {
    const html = render(<DeniedState />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-arena-state="denied"');
    expect(html).toContain('You do not have access to this area.');
  });

  it('names the required authority without granting anything (positive)', () => {
    const html = render(
      <DeniedState requiredAuthority="permission: cases:read" />,
    );
    expect(html).toContain('Required authority');
    expect(html).toContain('permission: cases:read');
    expect(html).not.toContain('data-arena-state="error"');
  });
});

describe('state distinctness (UX quality gates)', () => {
  it('renders empty, denied and error as three different documents (positive)', () => {
    const empty = render(<EmptyState title="Nothing here" />);
    const denied = render(<DeniedState />);
    const error = render(<ErrorState />);
    expect(new Set([empty, denied, error])).toHaveLength(3);
    expect(empty).toContain('data-arena-state="empty"');
    expect(denied).toContain('data-arena-state="denied"');
    expect(error).toContain('data-arena-state="error"');
  });
});

describe('DemoDataBadge', () => {
  it('labels demo data visibly and explains itself (positive)', () => {
    const html = render(<DemoDataBadge />);
    expect(html).toContain('data-arena-state="demo"');
    expect(html).toContain('data-arena-truth="demo"');
    expect(html).toContain('Demo data');
    expect(html).toContain(stateKindConfig('demo').meaning);
    expect(html).toContain('arena-truth__marker--tag');
  });

  it('appends an optional note (positive)', () => {
    expect(render(<DemoDataBadge note="seed: reference" />)).toContain(
      'seed: reference',
    );
  });
});

describe('StaleDataNotice', () => {
  it('announces staleness as a status with the refresh time (positive)', () => {
    const html = render(<StaleDataNotice asOf="2 minutes ago" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('data-arena-state="stale"');
    expect(html).toContain('last refreshed 2 minutes ago');
  });

  it('warns without a timestamp when unknown (positive)', () => {
    expect(render(<StaleDataNotice />)).toContain(
      'This view may be out of date.',
    );
  });
});

describe('TruthBadge — the ten-term product-truth vocabulary', () => {
  it('renders label, kind attribute and marker class for every kind (positive)', () => {
    for (const kind of STATE_KINDS) {
      const config = stateKindConfig(kind);
      const html = render(<TruthBadge kind={kind} />);
      expect(html).toContain(`data-arena-truth="${kind}"`);
      expect(html).toContain(config.label);
      expect(html).toContain(`arena-truth__marker--${config.marker}`);
      expect(html).toContain(`arena-truth--${kind}`);
    }
  });

  it('renders ten mutually distinct documents — no badge collapse (positive)', () => {
    const documents = STATE_KINDS.map((kind) => render(<TruthBadge kind={kind} />));
    expect(new Set(documents)).toHaveLength(10);
  });

  it('throws on an unknown kind — the vocabulary is closed (negative)', () => {
    expect(() =>
      render(<TruthBadge kind={'ai-result' as never} />),
    ).toThrowError(/unknown product-truth state kind/);
  });
});
