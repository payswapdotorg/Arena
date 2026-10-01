/**
 * The expert-marketplace pure router + renderer (Work Order A031 — the
 * A017/A018 web-surface house pattern, kept INSIDE the app tree because
 * A031 owns no packages/* surface).
 *
 * PURE: no I/O, no clock reads, no mutation of the injected corpus —
 * every request renders from the same frozen reference state. The corpus
 * shape is defined HERE as plain view types (produced by corpus.mjs from
 * the REAL domain packages + the marketplace fabric); the transport
 * (server.ts) injects `handleMarketplaceRequest` closed over the corpus.
 *
 * Routes (read-only):
 *   GET /                        — the marketplace listing cards
 *   GET /listings/<listingId>    — one expert profile: qualification
 *                                   evidence, active offers, stats
 *   GET /engagements             — the engagement + review records
 *   GET /nope (anything else)    — 404
 * Non-GET methods — 405 with Allow: GET, HEAD.
 */

/** One listing card in the corpus view-model. */
export interface MarketplaceListingView {
  readonly listingRef: string;
  readonly listingId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly headline: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly domains: readonly string[];
  readonly jurisdictions: readonly string[];
  readonly qualificationProofs: readonly {
    readonly claimRef: string;
    readonly recordRef: string;
    readonly status: string;
    readonly inForce: boolean;
    readonly validUntil: string;
  }[];
  readonly offers: readonly {
    readonly offerId: string;
    readonly kind: string;
    readonly headline: string;
    readonly currency: string;
    readonly amountMinor: number;
    readonly unit: string;
  }[];
  readonly engagements: number;
  readonly completed: number;
  readonly reviews: number;
  readonly averageRating: number | null;
  readonly publishedAt: string | null;
}

/** One engagement (+ its review when present) in the corpus view-model. */
export interface MarketplaceEngagementView {
  readonly engagementId: string;
  readonly tenant: string;
  readonly listingRef: string;
  readonly expertId: string;
  readonly customer: string;
  readonly scopeNote: string;
  readonly status: string;
  readonly review: {
    readonly rating: number;
    readonly verdict: string;
    readonly text: string;
  } | null;
}

/** The frozen corpus the router renders from. */
export interface MarketplaceCorpus {
  readonly tenant: string;
  readonly generatedNote: string;
  readonly listings: readonly MarketplaceListingView[];
  readonly engagements: readonly MarketplaceEngagementView[];
}

/** A rendered marketplace response (the transport contract). */
export interface MarketplaceResponse {
  readonly status: number;
  readonly contentType: string;
  readonly html: string;
  readonly allow?: string;
}

/** Escape untrusted text for HTML interpolation (fail-closed rendering). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) =>
    ch === '&'
      ? '&amp;'
      : ch === '<'
        ? '&lt;'
        : ch === '>'
          ? '&gt;'
          : ch === '"'
            ? '&quot;'
            : '&#39;',
  );
}

function money(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light; }
body { font-family: system-ui, sans-serif; margin: 0; background: #f7f7f5; color: #1c1917; }
main { max-width: 60rem; margin: 0 auto; padding: 1.5rem; }
header.site { background: #1c1917; color: #f7f7f5; padding: 1rem 1.5rem; }
header.site a { color: #f7f7f5; text-decoration: none; font-weight: 600; }
nav { margin: 1rem 0; display: flex; gap: 1rem; }
nav a { color: #57534e; text-decoration: none; border-bottom: 2px solid transparent; }
nav a:hover { border-color: #d6d3d1; }
section.card { background: #fff; border: 1px solid #e7e5e4; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
.badge { display: inline-block; background: #e7e5e4; border-radius: 999px; padding: 0.05rem 0.6rem; font-size: 0.8rem; margin-right: 0.35rem; }
.badge.ok { background: #dcfce7; color: #14532d; }
.badge.warn { background: #fef3c7; color: #78350f; }
code { background: #f5f5f4; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.85em; word-break: break-all; }
footer.site { margin-top: 2rem; padding: 1rem 1.5rem; color: #78716c; font-size: 0.85rem; }
h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; } dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; } dt { color: #57534e; }
</style>
</head>
<body>
<header class="site"><a href="/">Arena Expert Marketplace</a></header>
<main>
${body}
</main>
<footer class="site">Read-only reference marketplace surface — every record is content-addressed and append-only (A031).</footer>
</body>
</html>`;
}

function proofBadge(proof: { inForce: boolean; status: string }): string {
  return proof.inForce
    ? '<span class="badge ok">qualification in force</span>'
    : `<span class="badge warn">qualification ${escapeHtml(proof.status)} (not in force)</span>`;
}

function renderListingCard(listing: MarketplaceListingView): string {
  const offers =
    listing.offers
      .map(
        (offer) =>
          `<li><strong>${escapeHtml(offer.headline)}</strong> — ${escapeHtml(offer.kind)} — <code>${escapeHtml(money(offer.amountMinor, offer.currency))}/${escapeHtml(offer.unit)}</code></li>`,
      )
      .join('') || '<li>(no active offers)</li>';
  const rating =
    listing.averageRating === null
      ? 'no reviews yet'
      : `${listing.averageRating.toFixed(1)}/5 over ${listing.reviews} review(s)`;
  return `<section class="card">
<h2><a href="/listings/${encodeURIComponent(listing.listingId)}">${escapeHtml(listing.headline)}</a></h2>
<p>${escapeHtml(listing.description)}</p>
<p>${proofBadge({ inForce: listing.qualificationProofs.some((p) => p.inForce), status: listing.qualificationProofs[0]?.status ?? 'unresolved' })}
<span class="badge">${escapeHtml(listing.expertId)}</span>
<span class="badge">${escapeHtml(listing.tenant)}</span>
${listing.capabilities.map((c) => `<span class="badge">${escapeHtml(c)}</span>`).join('')}</p>
<ul>${offers}</ul>
<p>${escapeHtml(rating)} · ${listing.engagements} engagement(s), ${listing.completed} completed</p>
</section>`;
}

function renderListingDetail(listing: MarketplaceListingView): string {
  const proofs = listing.qualificationProofs
    .map(
      (proof) =>
        `<li>${proofBadge(proof)} claim <code>${escapeHtml(proof.claimRef.slice(0, 16))}…</code> record <code>${escapeHtml(proof.recordRef.slice(0, 16))}…</code> valid until ${escapeHtml(proof.validUntil || '—')}</li>`,
    )
    .join('');
  const offers =
    listing.offers
      .map(
        (offer) =>
          `<dt>${escapeHtml(offer.offerId)} (${escapeHtml(offer.kind)})</dt><dd>${escapeHtml(offer.headline)} — <code>${escapeHtml(money(offer.amountMinor, offer.currency))}/${escapeHtml(offer.unit)}</code></dd>`,
      )
      .join('') || '<dt>offers</dt><dd>none active</dd>';
  return `<h1>${escapeHtml(listing.headline)}</h1>
<p>${escapeHtml(listing.description)}</p>
<section class="card">
<h2>Expert</h2>
<dl><dt>expert id</dt><dd><code>${escapeHtml(listing.expertId)}</code></dd>
<dt>tenant</dt><dd>${escapeHtml(listing.tenant)}</dd>
<dt>published at</dt><dd>${escapeHtml(listing.publishedAt ?? '—')}</dd>
<dt>domains</dt><dd>${listing.domains.map(escapeHtml).join(', ') || '—'}</dd>
<dt>jurisdictions</dt><dd>${listing.jurisdictions.map(escapeHtml).join(', ') || '—'}</dd></dl>
</section>
<section class="card">
<h2>Qualification evidence (A007 gate)</h2>
<ul>${proofs || '<li>(none)</li>'}</ul>
</section>
<section class="card">
<h2>Active offers</h2>
<dl>${offers}</dl>
</section>
<section class="card">
<h2>Engagement statistics</h2>
<dl><dt>engagements</dt><dd>${listing.engagements}</dd>
<dt>completed</dt><dd>${listing.completed}</dd>
<dt>reviews</dt><dd>${listing.reviews}</dd>
<dt>average rating</dt><dd>${listing.averageRating === null ? 'no reviews yet' : escapeHtml(listing.averageRating.toFixed(2))}</dd></dl>
</section>`;
}

function renderEngagements(corpus: MarketplaceCorpus): string {
  const rows = corpus.engagements
    .map(
      (engagement) =>
        `<section class="card">
<h2>${escapeHtml(engagement.engagementId)} — ${escapeHtml(engagement.status)}</h2>
<dl><dt>expert</dt><dd><code>${escapeHtml(engagement.expertId)}</code></dd>
<dt>customer</dt><dd>${escapeHtml(engagement.customer)}</dd>
<dt>scope</dt><dd>${escapeHtml(engagement.scopeNote)}</dd>
<dt>review</dt><dd>${
          engagement.review === null
            ? 'not reviewed'
            : `${engagement.review.rating}/5 (${escapeHtml(engagement.review.verdict)}) — ${escapeHtml(engagement.review.text)}`
        }</dd></dl>
</section>`,
    )
    .join('');
  return `<h1>Engagements</h1>${rows || '<p>No engagements recorded.</p>'}`;
}

/** True iff the corpus is deeply frozen (the read-only guarantee). */
export function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (!Object.isFrozen(value)) return false;
  for (const key of Object.getOwnPropertyNames(value)) {
    const child = (value as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      if (!Object.isFrozen(child)) return false;
      for (const entry of child) {
        if (!isDeepFrozen(entry)) return false;
      }
    } else if (!isDeepFrozen(child)) {
      return false;
    }
  }
  return true;
}

/** The pure request handler: route + render from the frozen corpus. */
export function handleMarketplaceRequest(
  request: { readonly method: string; readonly path: string },
  corpus: MarketplaceCorpus,
): MarketplaceResponse {
  const html = (title: string, body: string): MarketplaceResponse => ({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    html: layout(title, body),
  });
  const notFound = (): MarketplaceResponse => ({
    status: 404,
    contentType: 'text/html; charset=utf-8',
    html: layout('Not found', '<h1>Not found</h1><p>No marketplace record at this address.</p>'),
  });
  const methodNotAllowed = (): MarketplaceResponse => ({
    status: 405,
    contentType: 'text/html; charset=utf-8',
    html: layout('Method not allowed', '<h1>Method not allowed</h1><p>The marketplace surface is read-only.</p>'),
    allow: 'GET, HEAD',
  });

  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed();

  const path = request.path.replace(/\/+$/, '') || '/';
  if (path === '/') {
    return html(
      'Arena Expert Marketplace',
      `<h1>Qualified expert listings (${escapeHtml(corpus.tenant)})</h1>${corpus.listings.map(renderListingCard).join('')}`,
    );
  }
  const listingMatch = /^\/listings\/([^/]+)$/.exec(path);
  if (listingMatch !== null) {
    const listingId = decodeURIComponent(listingMatch[1] ?? '');
    const listing = corpus.listings.find((entry) => entry.listingId === listingId);
    if (listing === undefined) return notFound();
    return html(listing.headline, renderListingDetail(listing));
  }
  if (path === '/engagements') {
    return html('Engagements', renderEngagements(corpus));
  }
  return notFound();
}
