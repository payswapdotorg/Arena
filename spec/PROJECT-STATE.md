# Arena Project State

Architecture: A1.0
Work Order schema: AWO1.0
Default branch: main
Maximum concurrent workers: 3

## Current main head

This state file is updated by the Architect/Tech Lead after every accepted merge.

Current seed/foundation history has been committed in small atomic bootstrap commits. The exact latest SHA is always taken from live GitHub state rather than inferred from this document.

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

A001 acceptance must establish:

- reproducible local install;
- frozen dependency policy;
- package/service/app layer rules;
- governance self-test;
- boundary self-test;
- CI;
- baseline test/typecheck/lint/build commands;
- package template;
- contract generation/drift mechanism;
- documented repository layout;
- no architecture-lock violations.

## Verification baseline

No executable baseline exists before A001.

After A001, record the exact commands, versions, result counts, CI run and merge SHA here.

## Review lessons

Record durable lessons from worker failures, connector/platform failures, test gaps and architecture review here. Never rely on chat-only memory.

## Successor rule

After every accepted merge:

1. reconcile live GitHub ground truth;
2. update this file with merge SHA and verification baseline;
3. update AI_CONTINUATION.md and the Architect handoff;
4. derive READY items from spec/dependency-graph.md;
5. select at most three disjoint Work Orders;
6. record dispatch base SHA and ownership;
7. perform dependency/lockfile reconciliation serially.

Never dispatch based on stale status text when GitHub state disagrees.
