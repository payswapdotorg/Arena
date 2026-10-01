# Arena Human Escalation Dependency Graph

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
   └→ C010

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

## Recommended three-worker waves

### Wave C1
C001 — Escalation API/MCP/webhooks
C002 — demand/routing compiler
C010 — payment infrastructure

### Wave C2
C003 — AI expert intake
C004 — expert calibration
C006 — expert environment session

### Wave C3
C005 — expert performance
C007 — intervention modes
C009 — validation/adjudication

### Wave C4
C008 — tool/knowledge capture
C011 — engagement/SLA
C012 — human-data production

### Wave C5
C013 — adversarial expert evaluation
C014 — Body pretraining marketplace
C015 — capability-demand routing

### Wave C6
C016 — economics
C017 — developer portal
C018 — enterprise session policy

### Wave C7
C019 — Epoch/generic integrations
C020 — network quality/fraud/disputes
C021 — escalation operations

### Wave C8
C022 — capability learning compiler

The Tech Lead must validate all dependencies and ownership against the live repository before dispatch.
