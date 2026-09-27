/**
 * HTML escaping for @arena/control-ui (Work Order A018, gate 3).
 *
 * EVERY dynamic value interpolated into a rendered page goes through
 * `escapeHtml` (text contexts) or `escapeHtmlAttribute` (attribute
 * contexts) — the renderers accept this discipline by construction:
 * they only ever build strings from view-model fields via these helpers.
 * Raw HTML appears solely from the renderers' own literal templates.
 *
 * Escaping covers the OWASP-recommended set for HTML text and attribute
 * contexts: & < > " ' and the backtick (attribute contexts only, where
 * IE-era unquoted-attribute quirks made it significant).
 */

/** Escape a string for safe interpolation into HTML text content. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Escape a string for safe interpolation into a double-quoted HTML attribute. */
export function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

/**
 * Render an unknown value for display: strings pass through escaping
 * unchanged; everything else is rendered as JSON (stable key order is the
 * caller's concern; view-models are constructed, not parsed) and escaped.
 * Never returns raw HTML.
 */
export function escapeValue(value: unknown): string {
  if (typeof value === 'string') return escapeHtml(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean' || value === null || value === undefined) {
    return String(value);
  }
  return escapeHtml(JSON.stringify(value) ?? 'null');
}
