# @arena/ui-platform

The Arena design system (Work Order B001). Presentation-only React 19
components and design tokens for the Next.js product host in `apps/web`.

**Boundary rule:** this package imports NOTHING from `@arena/*` domain
packages — it may not invent a second representation of domain truth
(spec/product-requirements.md P1.0). Its only runtime dependencies are
`react` and `react-dom` (exact pins).

## Surface

| Area | Exports |
|---|---|
| Tokens | `tokens.ts` — color / spacing / type / font / radius / elevation / motion / breakpoint scales + the ten-term product-truth state vocabulary (`STATE_KINDS`, `stateKindConfig`, `STATE_KIND_CONFIGS`) |
| States | `LoadingState`, `ErrorState`, `EmptyState`, `DeniedState`, `DemoDataBadge`, `StaleDataNotice`, `TruthBadge` |
| A11y | `SkipLink`, `LiveRegion`, `FocusBoundary`, `focusTrapSequence` / `nextFocusStop`, `prefersReducedMotion` / `motionDuration` / `REDUCED_MOTION_MEDIA_QUERY`, `elementId` / `describeWith` |
| Layout | `WorkspaceShell`, `Surface`, `PageHeader`, `PrimaryAction`, `ContextualNavigation`, `ShellBottomNav` |
| Shell slots | `WorkspaceSelectorSlot`, `RoleSwitcherSlot`, `GlobalSearchSlot`, `JobsNotificationsSlot`, `ProfileSlot` (typed placeholders; B003/B004/B007/B014 fill them) |

## Styles

The host app imports two stylesheets:

```tsx
import '@arena/ui-platform/tokens.css';      // generated CSS custom properties
import '@arena/ui-platform/components.css';  // component + responsive styles
```

`src/tokens/tokens.css` is **generated** from the typed token registry:

```bash
pnpm --filter @arena/ui-platform tokens:css   # regenerate
```

A test fails if the committed file drifts from `generateTokensCss()`.

## Product-truth state vocabulary

The ten kinds — verified, evidence, expert-judgment, model-output,
simulation, evaluation, certification, suggestion, hypothesis, demo — each
get a distinct color, a distinct marker shape and a distinct always-visible
label (UXM1.0 §State semantics). No two can render as one interchangeable
"AI result" badge; unknown kinds throw (closed vocabulary).

## Responsive shell

`WorkspaceShell` implements the UXM1.0 responsive rule with pure CSS
(JavaScript-free): 3-zone grid on desktop (context rail / main stage /
inspector), collapsible rail + sheet inspector on tablet, top bar + bottom
nav + bottom-sheet inspector on mobile. All motion collapses under
`prefers-reduced-motion`.

## Commands

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint . (root flat config, walks up)
pnpm test        # vitest run (react-dom/server renderToStaticMarkup, no jsdom)
pnpm build       # tsc -p tsconfig.build.json -> dist/ (+ CSS copies)
```
