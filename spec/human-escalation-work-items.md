# Arena Human Escalation / Capability Commerce Work Orders CWO1.0

## Purpose

After B019, Arena becomes an API-native human expert escalation infrastructure layer for AI software.

North star:

> Arena is the Stripe of human expert escalation for AI automation.

Any AI application can procure reliable human capability through Arena, with the result returned in machine-consumable form and the human intervention optionally transformed into reusable tools, knowledge, skills, evaluation assets or Agent Body improvements.

## Design rule

C-series extends, rather than replaces, the A-series and B-series.

A-series = capability infrastructure.
B-series = productization and hosted UX.
C-series = human escalation network + capability commerce.

## Work orders

| ID | Scope | Depends | Owned surfaces |
|---|---|---|---|
| C001 | Expert Escalation API + MCP + webhooks + durable lifecycle | B019,A025,A015 | packages/escalation/*, services/escalation-api/*, adapters/escalation/*, contracts/escalation/* |
| C002 | Escalation routing / capability demand compiler | C001,A004,A007,A006 | packages/escalation-routing/*, services/escalation-routing/* |
| C003 | AI Expert Intake / adaptive capability interview agent | C002,A006,A007 | packages/expert-intake/*, services/expert-intake/* |
| C004 | Expert calibration, pre-training and continuous requalification | C003,A007,A017 | packages/expert-calibration/*, services/expert-calibration/* |
| C005 | Expert performance / Merit-style longitudinal evidence profile | C004,A007,A019,A020 | packages/expert-performance/*, services/expert-performance/* |
| C006 | Expert environment capsule / privacy-sanitized session replication | C001,B002,A009,A010,A015 | packages/expert-session/*, services/expert-session/*, adapters/expert-environment/* |
| C007 | Live human intervention modes: solve/correct/unblock/review/teach | C006,C001,A011,A012,A013 | packages/intervention/*, services/intervention/* |
| C008 | Tool-gap and domain-knowledge capture pipeline | C007,A019,A020,A021 | packages/tool-gap/*, packages/knowledge-capture/*, services/capability-improvement/* |
| C009 | Escalation validation/adjudication and expert replacement/revision | C007,C005,A012,A013 | packages/escalation-validation/*, services/escalation-validation/* |
| C010 | Human expert payments, escrow/hold, platform fees and payouts | C001,A033,A034 | packages/payments/*, services/payments/*, adapters/payments/* |
| C011 | Expert engagement, availability, scheduling and SLA management | C005,C010,A031 | packages/expert-engagement/*, services/expert-engagement/* |
| C012 | Human-data production studio for customer AI pipelines | C001,C006,C007,C009,A014,A017 | apps/web/src/human-data/*, packages/human-data/*, services/human-data/* |
| C013 | Adversarial Expert Evaluation / Expert Arena competition | C009,A012,A013,A030 | packages/adversarial-evaluation/*, services/adversarial-evaluation/*, apps/web/src/competitions/* |
| C014 | On-demand Agent Body pretraining and capability-body marketplace | C008,C009,A021,A023,A024 | services/body-marketplace/*, apps/web/src/body-marketplace/* |
| C015 | Capability-demand matching across experts, Bodies, tools, knowledge and artifacts | C002,C005,C008,C014,A004,A021,A032 | packages/capability-routing/*, services/capability-routing/* |
| C016 | Capability economics / intervention unit economics | C005,C009,C010,C015,A033,A035 | packages/capability-economics/*, services/capability-economics/* |
| C017 | Developer portal, API keys, sandbox, SDK quickstarts and escalation observability | C001,C010,B019 | apps/web/src/developers/*, packages/developer-platform/*, services/developer-platform/* |
| C018 | Enterprise privacy/retention/policy packs for expert sessions | C006,C007,A034 | packages/expert-session-policy/*, services/expert-session-policy/* |
| C019 | Reference integrations: Epoch + generic AI application | C001,C006,C007,C010,C017 | adapters/epoch-escalation/*, examples/generic-ai-client/* |
| C020 | Network quality system: expert reputation, dispute, conflict, anti-gaming and fraud controls | C005,C009,C010,C013,A034 | packages/network-quality/*, services/network-quality/* |
| C021 | Human escalation observability and SLA operations | C001,C005,C010,C011,C015,A035 | packages/escalation-observability/*, services/escalation-observability/*, apps/web/src/escalation-ops/* |
| C022 | Capability learning compiler: intervention → tool/knowledge/skill/body/eval improvements | C008,C009,C013,C014,A020,A021,A022,A023 | packages/capability-learning/*, services/capability-learning/* |

## Safe three-worker waves

### C1 — API/network foundation
C001, C002, C003

### C2 — expert quality + session
C004, C005, C006

### C3 — intervention + improvement
C007, C008, C009

### C4 — commercial / human data / competition
C010, C011, C012

### C5 — capability products
C013, C014, C015

### C6 — developer / enterprise / economics
C016, C017, C018

### C7 — integrations / network quality / operations
C019, C020, C021

### C8 — learning compiler
C022

The Tech Lead must recompute readiness live before every wave.

## Escalation modes

The C-series supports:

- SOLVE
- CORRECT
- UNBLOCK
- REVIEW
- TEACH
- TOOL_GAP
- KNOWLEDGE
- EVALUATE

A request may transition between modes only through explicit lifecycle state and authorization.

## Core commercial loop

Application
→ Arena API
→ capability demand
→ expert matching
→ offer/accept
→ secure expert session
→ intervention
→ validation
→ result
→ payment
→ platform fee
→ reusable learning/artifact capture

## Learning loop

Human intervention can produce:

- immediate correction;
- knowledge patch;
- tool-gap signal;
- tool specification;
- skill candidate;
- evaluator;
- verifier input;
- training/evaluation data;
- improved Agent Body;
- new marketplace asset.

Nothing becomes globally reusable merely because an expert typed it.

Rights, validation, provenance and scope are mandatory.

## Environment rule

Where supported, the expert works inside a bounded replica of the agent's actual environment at the escalation point.

The environment capsule must preserve relevant context while enforcing privacy and authority barriers.

The expert cannot directly alter the host application's live world through the replica.

## Competition rule

The adversarial competition system is an alternate evaluation path, not a replacement verification authority.

Raw upvote/downvote ratio can be surfaced as a discovery/community signal but cannot by itself establish correctness or certification.

## Payment rule

The first payment implementation should use an adapter to a supported marketplace payment provider where legally/commercially appropriate.

Stripe Connect is a natural reference implementation because it supports platform application fees and marketplace transfer patterns. Exact merchant-of-record, connected-account, settlement and cross-border responsibilities must be determined for each launch jurisdiction. citeturn787126search0turn787126search1

Arena's payment domain must remain provider-neutral.

## Completion target

The C-series is complete when a generic external AI application can:

1. register with Arena;
2. submit an escalation request;
3. specify the capability need and budget;
4. have Arena locate/route to a qualified expert;
5. provide the expert a bounded replica of the agent's environment;
6. allow solve/correct/unblock/teach/review work;
7. optionally let the originating agent observe the approved intervention stream;
8. validate the result;
9. receive structured machine-readable output;
10. pay the expert through the platform;
11. have Arena retain its platform fee;
12. receive approved knowledge/tool/capability improvement artifacts;
13. retry or replace an expert when necessary;
14. observe status/SLAs through API/webhooks;
15. run adversarial competition evaluation where appropriate;
16. publish or consume reusable Agent Bodies and capability artifacts.

The result should work for Epoch and for an unrelated third-party AI application using only Arena's public contracts.
