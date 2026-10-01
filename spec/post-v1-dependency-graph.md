# Arena Post-V1 Dependency Graph

## Productization spine

A036
├→ B001
├→ B002
└→ B003

B001 + B002 + B003
├→ B004
└→ B005

B001 + B003 + B005
└→ B006

B004 + B005 + B006
└→ B007

B007
├→ B008
├→ B009
├→ B010
├→ B011
├→ B012
├→ B013
└→ B014

B002 + B004 + B005 + B014
└→ B015

B001 + B002 + B006
└→ B016

B008 + B009 + B010 + B011 + B012 + B013 + B014 + B015 + B016
└→ B017

B017 + B007-B016
└→ B018

B015 + B017 + B018
└→ B019

## Safe three-worker waves

### Wave B1
- B001 — web runtime/design system
- B002 — hosted infrastructure adapters
- B003 — roles/contexts

### Wave B2
- B004 — auth/session
- B005 — persisted read model

### Wave B3
- B007 — capability cockpit
- B008 — case/task flow
- B009 — expert flow

### Wave B4
- B010 — body studio
- B011 — replay
- B012 — evaluation/research

### Wave B5
- B013 — marketplace
- B014 — operations/capacity
- B015 — deployment

### Wave B6
- B016 — local install
- B017 — product E2E / UX validation
- B018 — UX polish

B019 is serialized launch acceptance.

## Rule

The Tech Lead must recompute readiness from the actual main branch, exact Work Order dependencies, ownership registry and open PR state before every dispatch.
