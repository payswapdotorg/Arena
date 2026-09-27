/**
 * The console stylesheet (Work Order A018, gate 3): a plain CSS string
 * served INLINE in every page — no external assets, no CDN, no fonts, no
 * scripts. System font stack only; neutral palette (no vendor colors).
 */

export const CONSOLE_STYLESHEET = `
:root {
  color-scheme: light dark;
  --ink: #1c1917;
  --ink-soft: #57534e;
  --paper: #fafaf9;
  --card: #ffffff;
  --line: #e7e5e4;
  --accent: #0f766e;
  --accent-ink: #ffffff;
  --warn: #9a3412;
  --ok: #166534;
  --muted: #f5f5f4;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--paper);
  color: var(--ink);
  line-height: 1.55;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header.site {
  background: var(--card);
  border-bottom: 1px solid var(--line);
  padding: 0.9rem 1.25rem;
}
header.site .title { font-size: 1.15rem; font-weight: 650; letter-spacing: 0.01em; }
header.site .subtitle { color: var(--ink-soft); font-size: 0.85rem; margin-top: 0.15rem; }
nav.site { margin-top: 0.75rem; display: flex; flex-wrap: wrap; gap: 0.35rem 1.1rem; }
nav.site a { font-size: 0.9rem; }
nav.site a[aria-current="page"] { font-weight: 650; color: var(--ink); }
main { flex: 1 1 auto; width: 100%; max-width: 72rem; margin: 0 auto; padding: 1.25rem 1.25rem 2.5rem; }
footer.site {
  background: var(--card);
  border-top: 1px solid var(--line);
  color: var(--ink-soft);
  font-size: 0.8rem;
  padding: 0.75rem 1.25rem;
}
h1 { font-size: 1.35rem; margin: 0 0 1rem; }
h2 { font-size: 1.05rem; margin: 1.5rem 0 0.6rem; }
p.lead { color: var(--ink-soft); margin-top: -0.6rem; margin-bottom: 1rem; font-size: 0.92rem; }
table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); font-size: 0.88rem; }
th, td { text-align: left; padding: 0.55rem 0.7rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { background: var(--muted); font-weight: 600; white-space: nowrap; }
tr:last-child td { border-bottom: none; }
td.num, th.num { text-align: right; }
.digest { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.78rem; word-break: break-all; }
.muted { color: var(--ink-soft); }
.badge {
  display: inline-block; padding: 0.05rem 0.5rem; border-radius: 999px;
  font-size: 0.75rem; border: 1px solid var(--line); background: var(--muted);
}
.badge.status-succeeded, .badge.status-resolved, .badge.status-active { color: var(--ok); border-color: var(--ok); }
.badge.status-failed, .badge.status-critical { color: var(--warn); border-color: var(--warn); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 0.9rem; margin: 1rem 0; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 0.5rem; padding: 0.9rem 1rem; }
.card .stat { font-size: 1.6rem; font-weight: 650; }
.card .label { color: var(--ink-soft); font-size: 0.8rem; }
dl.kv { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 1rem; margin: 0; font-size: 0.88rem; }
dl.kv dt { color: var(--ink-soft); }
dl.kv dd { margin: 0; word-break: break-word; }
ol.steps { padding-left: 1.2rem; }
ol.steps li { margin-bottom: 0.6rem; }
section.panel { margin-bottom: 1.5rem; }
.note { font-size: 0.85rem; color: var(--ink-soft); }
@media (max-width: 40rem) {
  main { padding: 1rem 0.9rem 2rem; }
  table { font-size: 0.8rem; }
  th, td { padding: 0.4rem 0.45rem; }
}
`.trim() as string;
