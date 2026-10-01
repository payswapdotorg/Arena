# Arena Hosted Preview / Free-Tier Deployment FT1.0

## Goal

Provide a hosted Arena preview that a new user can open and use without running local infrastructure.

This is a bounded preview profile, not a claim that arbitrary high-volume production workloads remain free.

## Provider map

| Concern | Provider | Preview role |
|---|---|---|
| Web / control plane | Vercel Hobby | Next.js App Router, short API requests, static assets |
| PostgreSQL | Neon Free | Arena control-plane state |
| Large immutable artifacts | Cloudflare R2 Standard | trajectories, datasets, evidence bundles, releases |
| Ephemeral coordination | Upstash Redis Free | rate limits, idempotency, caches, bounded coordination |
| Web/data acquisition | Apify Free | optional bounded research/data Actors |

Current vendor-published allowances must be checked during deployment because provider limits can change.

At the time of this architecture:
- Vercel Hobby is $0/month. Vercel Functions on Hobby have a 300-second maximum duration, so long-running Arena jobs must not depend on one request. [Vercel pricing and limits]
- Neon Free is $0 and publishes 100 projects, 10 branches/project, 100 CU-hours/project/month, 0.5 GB storage/project and 5 GB public network transfer/project/month. [Neon Free limits]
- Cloudflare R2 Standard includes 10 GB-month storage, 1M Class A operations and 10M Class B operations/month, with free Internet egress. [Cloudflare R2 pricing]
- Upstash Redis Free includes 256 MB data, 10 GB monthly bandwidth and 500K monthly commands. [Upstash pricing]
- Apify Free provides $5 of platform spend and blocks further platform usage after the allowance is exhausted until the next cycle. [Apify pricing]

## Topology

Browser
  -> Vercel / Next.js
     -> Neon adapter
     -> R2 adapter
     -> Upstash adapter
     -> optional Apify adapter

Arena internal contracts remain provider-neutral.

## Long-running jobs

Do not use a single Vercel request as the durable worker.

Required pattern:

UI/API command
  -> durable Job record
  -> queue/coordination signal
  -> bounded worker execution
  -> checkpoint
  -> status event
  -> UI projection

The free-tier preview may run only deterministic/reference environments in-process or in bounded workers.

Arbitrary untrusted code execution is not a free-tier browser feature.

## Hosted modes

### Demo mode

No infrastructure credentials exposed.
Seeded deterministic tenant/workspace.
No external model calls required.

### Connected mode

Users may connect allowed model/provider integrations through server-side secrets.

### Expert mode

Expert work can initially use seeded reference assignments. Production expert workflows are entitlement-gated.

## Budget guardrails

Every provider adapter declares:

- allowance;
- estimated resource cost;
- per-tenant quota;
- per-job limit;
- fail-closed threshold;
- current consumption;
- exhausted/disabled state.

The UI exposes remaining preview capacity and never silently upgrades to a paid path.

## Required environment variables

Server-side only:

DATABASE_URL
R2 endpoint/bucket/access keys
UPSTASH_REDIS_REST_URL and token
optional APIFY token
authentication/session secrets

Public configuration may expose only non-secret deployment metadata and safe feature flags.

## Acceptance

A hosted-preview release is accepted only when:

- Vercel deployment is green;
- environment health checks pass;
- Neon migrations are reproducible;
- R2 lifecycle works;
- Redis idempotency/rate-limit behavior works;
- optional Apify adapter has a dry run;
- quota state is visible;
- required preview paths work without paid-only features;
- free-tier exhaustion fails gracefully and without billable fallback.
