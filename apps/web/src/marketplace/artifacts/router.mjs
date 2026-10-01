/**
 * The pure marketplace router/view/renderer (Work Order A032 — the
 * A018/A017 web-surface house pattern, in the app layer because A032
 * owns no UI-package surface).
 *
 * Plain .mjs (no TypeScript) on purpose: @arena/web's frozen manifest
 * declares only @arena/protocol-core, so cross-tree domain imports
 * must stay in the .mjs corpus/bootstrap layer (see corpus.mjs).
 *
 * Read-only by construction:
 *   - GET/HEAD only — every other method answers 405 (+Allow);
 *   - every view is projected from the FROZEN corpus;
 *   - every interpolation is HTML-escaped;
 *   - no I/O, no clocks, no random — byte-deterministic rendering.
 */

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const MARKETPLACE_ROUTES = Object.freeze(['/', '/offers', '/offers/<offerId>']);
export const MARKETPLACE_ALLOWED_METHODS = Object.freeze(['GET', 'HEAD']);

// ---------------------------------------------------------------------------
// Freeze + escape (the house discipline)
// ---------------------------------------------------------------------------

export function deepFreeze(value) {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

export function isDeepFrozen(value) {
  if (typeof value !== 'object' || value === null) return true;
  if (!Object.isFrozen(value)) return false;
  return Object.keys(value).every((key) => isDeepFrozen(value[key]));
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ---------------------------------------------------------------------------
// View projections (typed by structure; frozen by construction)
// ---------------------------------------------------------------------------

/** Marketplace request/response contract (the transport consumes this). */
export function handleMarketplaceRequest(request, corpus) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return renderMethodNotAllowed(request.path);
  }
  const path = request.path.length > 1 && request.path.endsWith('/')
    ? request.path.slice(0, -1)
    : request.path;
  if (path === '/' || path === '/offers') {
    return renderListing(corpus);
  }
  const profileMatch = /^\/offers\/([a-z0-9-]+)$/.exec(path);
  if (profileMatch !== null) {
    const offerId = profileMatch[1];
    const profile = corpus.profiles.find((entry) => entry.offerId === offerId);
    if (profile === undefined) {
      return renderNotFound(request.path);
    }
    return renderProfile(profile);
  }
  return renderNotFound(request.path);
}

// ---------------------------------------------------------------------------
// Renderers (pure functions corpus → HTML)
// ---------------------------------------------------------------------------

const STYLESHEET = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #fafaf9; color: #1c1917; }
header { background: #1c1917; color: #fafaf9; padding: 1rem 2rem; }
header h1 { margin: 0; font-size: 1.1rem; letter-spacing: 0.02em; }
header p { margin: 0.25rem 0 0; font-size: 0.8rem; color: #a8a29e; }
main { max-width: 52rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: 0.08em; color: #57534e; }
.card { background: #ffffff; border: 1px solid #e7e5e4; border-radius: 0.5rem; padding: 1rem 1.25rem; margin: 0.75rem 0; }
.card h3 { margin: 0 0 0.25rem; font-size: 1rem; }
.card .meta { font-size: 0.75rem; color: #78716c; margin: 0.15rem 0; }
.badge { display: inline-block; font-size: 0.7rem; border-radius: 999px; padding: 0.1rem 0.6rem; border: 1px solid #d6d3d1; color: #44403c; }
.badge.public { background: #ecfdf5; border-color: #a7f3d0; color: #065f46; }
.badge.tenant-internal { background: #fef3c7; border-color: #fde68a; color: #92400e; }
.badge.dataset { background: #eff6ff; border-color: #bfdbfe; color: #1e40af; }
.badge.evaluation-suite { background: #f5f3ff; border-color: #ddd6fe; color: #5b21b6; }
.badge.environment { background: #f0fdf4; border-color: #bbf7d0; color: #14532d; }
.digest { font-family: ui-monospace, monospace; font-size: 0.7rem; word-break: break-all; color: #57534e; }
.stats { display: flex; gap: 0.75rem; flex-wrap: wrap; margin: 0 0 1rem; }
.stat { background: #ffffff; border: 1px solid #e7e5e4; border-radius: 0.5rem; padding: 0.6rem 1rem; min-width: 7rem; }
.stat .value { font-size: 1.25rem; font-weight: 600; }
.stat .label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: #78716c; }
section { margin: 1.5rem 0; }
footer { border-top: 1px solid #e7e5e4; margin-top: 2rem; padding: 1rem 0 0; font-size: 0.75rem; color: #78716c; }
ul.plain { list-style: none; padding: 0; margin: 0; }
ul.plain li { padding: 0.35rem 0; border-bottom: 1px dashed #e7e5e4; font-size: 0.85rem; }
`;

function renderDocument(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLESHEET}</style>
</head>
<body>
<header>
<h1>Arena Artifact Marketplace</h1>
<p>Datasets · evaluation suites · environments — provenance-gated listings (read-only)</p>
</header>
<main>
${bodyHtml}
</main>
<footer>Arena · A032 reference web surface · every listing is admission-gated on A002 provenance + passing A013 verification</footer>
</body>
</html>`;
}

function htmlResponse(status, title, bodyHtml, allow) {
  const response = {
    status,
    contentType: 'text/html; charset=utf-8',
    html: renderDocument(title, bodyHtml),
  };
  if (allow !== undefined) response.allow = allow;
  return Object.freeze(response);
}

function renderListing(corpus) {
  const cards = corpus.profiles
    .map(
      (profile) => `
<div class="card">
<h3><a href="/offers/${escapeHtml(profile.offerId)}">${escapeHtml(profile.title)}</a></h3>
<p class="meta">
<span class="badge ${escapeHtml(profile.artifactKind)}">${escapeHtml(profile.artifactKind)}</span>
<span class="badge ${escapeHtml(profile.visibility)}">${escapeHtml(profile.visibility)}</span>
<span class="badge">${escapeHtml(profile.tenant)}</span>
</p>
<p class="meta">${escapeHtml(profile.summary)}</p>
<p class="meta">artifact <span class="digest">${escapeHtml(profile.artifactIdentity)}</span></p>
<p class="meta">reviews: ${escapeHtml(String(profile.reviewCount))}${profile.averageRating === null ? '' : ` · average rating ${escapeHtml(String(profile.averageRating))}`}</p>
</div>`,
    )
    .join('');
  const stats = Object.entries(corpus.counts)
    .map(
      ([label, value]) =>
        `<div class="stat"><div class="value">${escapeHtml(String(value))}</div><div class="label">${escapeHtml(label)}</div></div>`,
    )
    .join('');
  return htmlResponse(
    200,
    'Artifact marketplace — listings',
    `<div class="stats">${stats}</div>
<h2>Listings</h2>
${cards}`,
  );
}

function renderProfile(profile) {
  const evidence = profile.evidence
    .map(
      (entry) =>
        `<li><span class="badge">${escapeHtml(entry.kind)}</span> <span class="digest">${escapeHtml(entry.digest)}</span>${entry.outcome === null ? '' : ` · outcome <b>${escapeHtml(entry.outcome)}</b>`}</li>`,
    )
    .join('');
  const reviews = profile.reviews
    .map(
      (review) =>
        `<li><b>${escapeHtml(String(review.rating))}/5</b> · ${escapeHtml(review.verdict)} · ${escapeHtml(review.body)}<br><span class="meta">${escapeHtml(review.reviewerTenant)} / ${escapeHtml(review.reviewerId)}</span></li>`,
    )
    .join('');
  const grants = profile.grants
    .map(
      (grant) =>
        `<li><span class="badge ${escapeHtml(grant.state)}">${escapeHtml(grant.state)}</span> ${escapeHtml(grant.grantId)} · ${escapeHtml(grant.permittedUse)} · grantee ${escapeHtml(grant.granteeTenant)}</li>`,
    )
    .join('');
  const rights = profile.rights
    ? `<ul class="plain">
<li>license: <b>${escapeHtml(profile.rights.license)}</b></li>
<li>commercial use: ${escapeHtml(profile.rights.commercialUse)}</li>
<li>redistribution: ${escapeHtml(profile.rights.redistribution)}</li>
<li>customer data: ${escapeHtml(profile.rights.customerData)}</li>
</ul>`
    : '<p class="meta">no rights record</p>';
  return htmlResponse(
    200,
    `Offer ${profile.offerId}`,
    `<div class="card">
<h3>${escapeHtml(profile.title)}</h3>
<p class="meta">
<span class="badge ${escapeHtml(profile.artifactKind)}">${escapeHtml(profile.artifactKind)}</span>
<span class="badge ${escapeHtml(profile.visibility)}">${escapeHtml(profile.visibility)}</span>
<span class="badge">${escapeHtml(profile.tenant)}</span>
<span class="badge">${escapeHtml(profile.state)}</span>
</p>
<p class="meta">${escapeHtml(profile.summary)}</p>
<p class="meta">offer record digest <span class="digest">${escapeHtml(profile.offerDigest)}</span></p>
<p class="meta">artifact <span class="digest">${escapeHtml(profile.artifactIdentity)}</span></p>
</div>
<section>
<h2>License &amp; rights (A002)</h2>
${rights}
</section>
<section>
<h2>Admission evidence (provenance + verification)</h2>
<ul class="plain">${evidence}</ul>
</section>
<section>
<h2>Access grants (A034 data-rights enforced)</h2>
<ul class="plain">${grants === '' ? '<li class="meta">no grants recorded</li>' : grants}</ul>
</section>
<section>
<h2>Reviews (grant-gated)</h2>
<ul class="plain">${reviews === '' ? '<li class="meta">no reviews yet</li>' : reviews}</ul>
</section>`,
  );
}

function renderNotFound(path) {
  return htmlResponse(
    404,
    'Not found',
    `<div class="card"><h3>404 — no such marketplace page</h3><p class="meta digest">${escapeHtml(path)}</p></div>`,
  );
}

function renderMethodNotAllowed(path) {
  return htmlResponse(
    405,
    'Method not allowed',
    `<div class="card"><h3>405 — the marketplace is read-only</h3><p class="meta digest">${escapeHtml(path)}</p><p class="meta">Allowed methods: GET, HEAD</p></div>`,
    'GET, HEAD',
  );
}
