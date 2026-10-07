# Arena Human Escalation Dependency Graph

## Canonical dependencies

B019
└→ C001
   ├→ C002
   │  └→ C003
   │     └→ C004
   │        └→ C005
   ├→ C006
   │  └→ C007
   │     ├→ C008
   │     └→ C009
   │        ├→ C011
   │        └→ C013
   └→ C010
      └→ C011

C005 + C010
└→ C011

C001 + C006 + C007 + C009
└→ C012

C009 + A012 + A013
└→ C013

C008 + C009 + A021 + A023
└→ C014

C002 + C005 + C008 + C014
└→ C015

C005 + C009 + C010 + C015
└→ C016

C001 + C010
└→ C017

C006 + C007
└→ C018

C001 + C006 + C007 + C010 + C017
└→ C019

C005 + C009 + C010 + C013
└→ C020

C001 + C005 + C010 + C011 + C015
└→ C021

C008 + C009 + C013 + C014
└→ C022

## Corrected three-worker dispatch plan

### Gate closure

G001, G002, G003
- may run concurrently;
- disjoint evidence surfaces;
- final launch-integrity reconciliation is TL-owned.

### C wave 1

After G closure, dispatch:
- C001 — Escalation API / MCP / webhooks / lifecycle
- C010 waits on C001 and therefore MUST NOT be dispatched with C001.

### C wave 2

After C001:
- C002 — capability-demand compiler / routing
- C006 — expert environment session
- C010 — payments / platform fee / payout

These three are independent after C001 and have disjoint surfaces.

### C wave 3

After C002/C006/C010:
- C003 — adaptive expert intake
- C007 — intervention modes
- C017 — developer portal / sandbox / SDK

### C wave 4

After C003/C007 as required:
- C004 — expert calibration / requalification
- C008 — tool + knowledge capture
- C009 — escalation validation/adjudication

### C wave 5

- C005 — expert performance
- C011 — engagement/availability/SLA
- C012 — human-data production

### C wave 6

- C013 — adversarial expert evaluation
- C014 — Agent Body pretraining / capability-body marketplace
- C015 — cross-resource capability-demand routing

### C wave 7

- C016 — capability economics
- C018 — enterprise session privacy/retention policy
- C020 — network quality / dispute / anti-fraud

### C wave 8

- C019 — Epoch + generic reference integrations
- C021 — escalation observability / SLA operations
- C022 — capability learning compiler

The Tech Lead must recompute actual readiness from main before every dispatch and may pull an independently-ready item forward when doing so preserves disjoint write surfaces and dependency correctness.

## Rules

- One Work Order = one branch = one PR.
- Maximum three concurrent workers.
- Root manifests/lockfiles are TL-owned serialized surfaces.
- No worker may redefine canonical Arena authority.
- C002 is blocked by C001.
- C010 is blocked by C001.
- C003 is blocked by C002.
- Commercial live claims remain blocked until launch-integrity closure is complete.
