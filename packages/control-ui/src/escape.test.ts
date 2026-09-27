/**
 * Escape utilities — positive and negative tests (Work Order A018, gate 3).
 *
 * The negative cases are the XSS gates: a hostile value must NEVER produce
 * a raw `<script` sequence in output, neither in text nor in attribute
 * position.
 */

import { describe, expect, it } from 'vitest';
import { escapeHtml, escapeHtmlAttribute, escapeValue } from './escape.js';

describe('escapeHtml (gate 3)', () => {
  it('escapes the five OWASP characters (positive)', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
  });

  it('leaves safe text untouched (positive)', () => {
    expect(escapeHtml('capability case 1.0.0 — tenant-a/case-1')).toBe(
      'capability case 1.0.0 — tenant-a/case-1',
    );
    expect(escapeHtml('')).toBe('');
  });

  it('neutralizes a script-tag payload (negative — the gate-3 escape test)', () => {
    const hostile = '<script>alert("pwned")</script>';
    const escaped = escapeHtml(hostile);
    expect(escaped).toBe('&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt;');
    // The rendered string contains &lt;script&gt; and NEVER a raw <script tag.
    expect(escaped).toContain('&lt;script&gt;');
    expect(escaped).not.toContain('<script');
  });

  it('escapes a full attribute-breakout payload (negative)', () => {
    const hostile = `" onmouseover="alert(1)`;
    expect(escapeHtml(hostile)).toBe('&quot; onmouseover=&quot;alert(1)');
  });

  it('escapes backticks in attribute contexts (negative)', () => {
    expect(escapeHtmlAttribute('`payload`')).toBe('&#96;payload&#96;');
    expect(escapeHtmlAttribute('a`b')).toBe('a&#96;b');
  });

  it('renders unknown values safely via escapeValue (negative)', () => {
    expect(escapeValue({ hostile: '<script>' })).toBe(
      '{&quot;hostile&quot;:&quot;&lt;script&gt;&quot;}',
    );
    expect(escapeValue(42)).toBe('42');
    expect(escapeValue(true)).toBe('true');
    expect(escapeValue(null)).toBe('null');
    expect(escapeValue(undefined)).toBe('undefined');
    expect(escapeValue('<b>')).toBe('&lt;b&gt;');
  });
});
