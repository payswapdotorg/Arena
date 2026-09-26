# @arena/web

Placeholder Arena app (Work Order A001). Plain TypeScript — deliberately not
Next.js yet; the web console and workbench arrive with A017/A018 inside
`apps/web/src/*`.

Purpose today:

1. prove the layer direction **apps → packages** (this app imports
   `@arena/protocol-core`; `pnpm boundary` fails if a package ever imports
   back into an app);
2. exercise the protocol primitives end to end (envelope → canonical
   serialization → sha256 digest → verification).

## Commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm start   # runs the envelope selfcheck (node --experimental-strip-types)
```
