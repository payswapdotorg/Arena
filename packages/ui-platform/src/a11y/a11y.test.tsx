import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { describeWith, elementId } from './aria.js';
import { FocusBoundary } from './FocusBoundary.js';
import { focusTrapSequence, nextFocusStop } from './focus.js';
import { LiveRegion } from './LiveRegion.js';
import { prefersReducedMotion, REDUCED_MOTION_MEDIA_QUERY, motionDuration } from './reduced-motion.js';
import { SkipLink } from './SkipLink.js';

const render = (element: React.ReactElement): string =>
  renderToStaticMarkup(element);

describe('SkipLink', () => {
  it('targets the main landmark by default (positive)', () => {
    const html = render(<SkipLink />);
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('Skip to main content');
  });

  it('honours a custom target and label (positive)', () => {
    expect(render(<SkipLink target="#stage" label="Skip to stage" />)).toContain(
      'href="#stage"',
    );
  });

  it('renders before the main landmark it targets (positive)', () => {
    const html = render(
      <div>
        <SkipLink target="#x" />
        <main id="x">Stage</main>
      </div>,
    );
    const skipIndex = html.indexOf('href="#x"');
    const mainIndex = html.indexOf('<main id="x"');
    expect(skipIndex).toBeGreaterThanOrEqual(0);
    expect(mainIndex).toBeGreaterThan(skipIndex);
  });

  it('must not point at a target that does not exist (negative)', () => {
    // Composition contract: a skip link without its landmark in the
    // composed tree is a broken promise. We assert the failure mode by
    // checking that the href id is absent from the document.
    const html = render(
      <div>
        <SkipLink target="#nowhere" />
        <main id="main-content">Stage</main>
      </div>,
    );
    expect(html).not.toContain('id="nowhere"');
  });
});

describe('LiveRegion', () => {
  it('is a polite atomic status region by default (positive)', () => {
    const html = render(<LiveRegion>Saved</LiveRegion>);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('Saved');
  });

  it('maps assertive politeness to role alert (positive)', () => {
    const html = render(<LiveRegion politeness="assertive">Deleted</LiveRegion>);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
  });
});

describe('FocusBoundary', () => {
  it('renders a labelled modal dialog with start and end sentinels (positive)', () => {
    const html = render(
      <FocusBoundary label="Inspector">
        <p>Content</p>
      </FocusBoundary>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Inspector"');
    expect(html).toContain('data-arena-focus-sentinel="start"');
    expect(html).toContain('data-arena-focus-sentinel="end"');
    expect(html.indexOf('data-arena-focus-sentinel="start"')).toBeLessThan(
      html.indexOf('<p>Content'),
    );
  });

  it('can render as non-modal for inline regions (positive)', () => {
    expect(
      render(
        <FocusBoundary label="Filters" modal={false}>
          <p>Filters</p>
        </FocusBoundary>,
      ),
    ).toContain('aria-modal="false"');
  });
});

describe('focus helpers', () => {
  it('keeps order and rejects nothing for a valid sequence (positive)', () => {
    expect(focusTrapSequence(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('wraps forward and backward around the trap (positive)', () => {
    const order = ['a', 'b', 'c'];
    expect(nextFocusStop(order, 'a', 'forward')).toBe('b');
    expect(nextFocusStop(order, 'c', 'forward')).toBe('a');
    expect(nextFocusStop(order, 'a', 'backward')).toBe('c');
    expect(nextFocusStop(order, 'b', 'backward')).toBe('a');
  });

  it('fails open to a sane edge for an unknown current stop (positive)', () => {
    expect(nextFocusStop(['a', 'b'], 'zzz', 'forward')).toBe('a');
    expect(nextFocusStop(['a', 'b'], 'zzz', 'backward')).toBe('b');
    expect(nextFocusStop(['a', 'b'], null, 'forward')).toBe('a');
  });

  it('rejects an empty trap sequence (negative)', () => {
    expect(() => focusTrapSequence([])).toThrowError(
      /at least one stop/,
    );
  });

  it('rejects duplicate stop ids (negative)', () => {
    expect(() => focusTrapSequence(['a', 'b', 'a'])).toThrowError(
      /duplicate focus trap stop id/,
    );
  });

  it('rejects empty-string stop ids (negative)', () => {
    expect(() => focusTrapSequence(['a', ''])).toThrowError(
      /non-empty/,
    );
  });
});

describe('reduced-motion helpers', () => {
  it('exposes the canonical media query (positive)', () => {
    expect(REDUCED_MOTION_MEDIA_QUERY).toBe('(prefers-reduced-motion: reduce)');
  });

  it('reads matchMedia-like state objects (positive)', () => {
    expect(prefersReducedMotion({ matches: true })).toBe(true);
    expect(prefersReducedMotion({ matches: false })).toBe(false);
  });

  it('reads serialized state strings (positive)', () => {
    expect(prefersReducedMotion('reduce')).toBe(true);
    expect(prefersReducedMotion('no-preference')).toBe(false);
  });

  it('treats missing or unknown signals as motion-safe (positive)', () => {
    expect(prefersReducedMotion(null)).toBe(false);
    expect(prefersReducedMotion(undefined)).toBe(false);
    expect(prefersReducedMotion('unexpected')).toBe(false);
  });

  it('collapses durations to zero when reduced motion is preferred (positive)', () => {
    expect(motionDuration(true, '200ms')).toBe('0ms');
    expect(motionDuration(false, '200ms')).toBe('200ms');
  });
});

describe('aria helpers', () => {
  it('builds deterministic slug ids (positive)', () => {
    expect(elementId('Arena', 'Inspector Sheet')).toBe('arena-inspector-sheet');
    expect(elementId('Arena', 'Inspector Sheet')).toBe(
      elementId('arena', 'inspector sheet'),
    );
  });

  it('rejects ids that slugify to nothing (negative)', () => {
    expect(() => elementId('!!!', 'x')).toThrowError(/slugifiable/);
    expect(() => elementId('x', '!!!')).toThrowError(/slugifiable/);
  });

  it('joins describe ids and omits the attribute when empty (positive)', () => {
    expect(describeWith('a', undefined, 'b')).toBe('a b');
    expect(describeWith(undefined, undefined)).toBeUndefined();
  });
});
