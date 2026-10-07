# Arena Post-B019 Launch Integrity Closure L2.0

## Purpose

B001-B019 implementation is complete, but the B019 launch record contains launch-day evidence rows still marked unchecked. This closure stage resolves the difference between:

- implementation complete;
- hosted preview wired;
- public-preview claims independently demonstrated.

This stage does not reopen B001-B019 unless an actual defect is found.

## G Work Orders

| ID | Scope | Dependencies | Owned surfaces |
|---|---|---|---|
| G001 | Fresh-machine/local product proof and reconciliation | B016,B017,B019 | docs/evidence/local/*, release/evidence/local/* |
| G002 | Hosted live proof, provider/quota proof and current deployment reconciliation | B015,B019 | docs/evidence/hosted/*, release/evidence/hosted/* |
| G003 | Fresh-browser UX/product audit and launch evidence closure | B017,B018,B019 | docs/evidence/ux/*, release/evidence/ux/* |

## Concurrency

G001, G002 and G003 are intentionally disjoint and may run concurrently.

Each is one branch/PR.

The TL owns final release-gate reconciliation.

## G001 — Local proof

Demonstrate on a clean environment:

- install;
- build;
- start;
- home;
- Demo;
- Demo reset;
- representative lifecycle;
- reference Bodies;
- role switch;
- replay;
- evaluation/certification;
- local persistence behavior as documented.

Record exact:
- environment;
- Node/pnpm versions;
- commands;
- outputs;
- limitations.

Do not merely cite an existing unit test.

## G002 — Hosted proof

Reconcile current deployed state:

- public URL;
- HTTP health;
- Vercel deployment;
- Neon connectivity/migration status;
- R2 lifecycle;
- Upstash coordination;
- provider capacity state;
- fail-closed quota behavior;
- no paid fallback;
- server-side secret posture.

Any current Vercel access/authorization issue must be resolved or explicitly documented as a blocker. A stale October 4 deployment record is not sufficient proof for an October 7 launch claim.

## G003 — Fresh-browser UX audit

Using a fresh browser profile:

- first-run landing;
- Demo;
- role switch;
- cases;
- expert workbench;
- Body Studio;
- replay;
- evaluation/certification;
- marketplace;
- operations;
- mobile/viewport checks.

Capture evidence for:
- comprehension;
- primary CTA clarity;
- state truth;
- role safety;
- mobile layout;
- keyboard accessibility;
- loading/empty/error/denied states.

Do not redesign the product during this audit unless a concrete usability/architecture defect is identified.

## Final closure gate

All three G items must be accepted before Arena may use the strongest public statement:

> Arena is installable, usable and publicly previewable.

C-series implementation may begin after B019, but production/commercial launch claims remain gated on G001-G003.

## If a defect is discovered

Classify it:

- documentation/evidence defect;
- product UX defect;
- deployment defect;
- architecture defect;
- security defect.

Only an architecture/security defect automatically blocks dependent C-series work.

Do not silently patch semantic contracts inside a G work order.

