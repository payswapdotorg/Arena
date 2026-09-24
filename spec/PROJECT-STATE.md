# Arena Project State

Architecture: A1.0
Work Order schema: AWO1.0
Default branch: main
Maximum concurrent workers: 3

## Bootstrap status

Repository architecture, governance, requirements, implementation plan, core object specifications, security/data governance, service boundaries, dependency graph and Work Orders are committed.

Live A001 Work Order: Issue #1.

Use live GitHub branch state for the exact latest main SHA. This file records product/workflow state; it must never be treated as a substitute for Git ancestry.

## Current frontier

- A001 AUTHORIZED
- A002 WAITING_ON_DEPENDENCIES
- A003 WAITING_ON_DEPENDENCIES
- A004 WAITING_ON_DEPENDENCIES
- A005 WAITING_ON_DEPENDENCIES
- A006 WAITING_ON_DEPENDENCIES
- A007 WAITING_ON_DEPENDENCIES
- A008 WAITING_ON_DEPENDENCIES
- A009 WAITING_ON_DEPENDENCIES
- A010 WAITING_ON_DEPENDENCIES
- A011 WAITING_ON_DEPENDENCIES
- A012 WAITING_ON_DEPENDENCIES
- A013 WAITING_ON_DEPENDENCIES
- A014 WAITING_ON_DEPENDENCIES
- A015 WAITING_ON_DEPENDENCIES
- A016 WAITING_ON_DEPENDENCIES
- A017 WAITING_ON_DEPENDENCIES
- A018 WAITING_ON_DEPENDENCIES
- A019 WAITING_ON_DEPENDENCIES
- A020 WAITING_ON_DEPENDENCIES
- A021 WAITING_ON_DEPENDENCIES
- A022 WAITING_ON_DEPENDENCIES
- A023 WAITING_ON_DEPENDENCIES
- A024 WAITING_ON_DEPENDENCIES
- A025 WAITING_ON_DEPENDENCIES
- A026 WAITING_ON_DEPENDENCIES
- A027 WAITING_ON_DEPENDENCIES
- A028 WAITING_ON_DEPENDENCIES
- A029 WAITING_ON_DEPENDENCIES
- A030 WAITING_ON_DEPENDENCIES
- A031 WAITING_ON_DEPENDENCIES
- A032 WAITING_ON_DEPENDENCIES
- A033 WAITING_ON_DEPENDENCIES
- A034 WAITING_ON_DEPENDENCIES
- A035 WAITING_ON_DEPENDENCIES
- A036 WAITING_ON_DEPENDENCIES

## Current authorized assignment

A001 — Repository foundation, governance, CI, test harness, package boundaries and base protocol primitives.

Acceptance requires:
- reproducible local install;
- frozen dependency policy;
- package/service/app layer enforcement;
- governance self-test;
- boundary self-test;
- CI;
- baseline typecheck/lint/test/build;
- package template;
- contract generation/drift mechanism;
- repository layout documentation;
- no architecture-lock violation.

## Verification baseline

No executable baseline exists before A001.

After A001, record:
- Node/pnpm/tool versions;
- exact commands;
- pass counts;
- CI run;
- final merge SHA;
- known limitations.

## Review lessons

Record durable lessons from worker failures, connector/platform failures, test gaps and architecture reviews here.

## Successor rule

After every accepted merge:
1. reconcile GitHub ground truth;
2. update this file with exact merge SHA and verification baseline;
3. update AI_CONTINUATION.md and docs/LLM-ARCHITECT-HANDOFF.md;
4. derive READY items from spec/dependency-graph.md;
5. dispatch at most three disjoint items;
6. record base SHA/ownership;
7. serialize dependency and lockfile reconciliation.

Never dispatch from stale status text when live GitHub state disagrees.
