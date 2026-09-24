# Arena Worker Runbook

## Before implementation

Read:

- repository governance;
- architecture lock;
- assigned Work Order;
- dependency graph;
- project state;
- live GitHub issue/PR state;
- exact dispatch base SHA.

Run the repository governance check before coding once A001 has implemented it.

## Branch

Use:

```
work/A###-short-slug
```

## Ownership

Write only inside the declared Work Order surface.

Do not edit:

- project state;
- architecture lock;
- work item definitions;
- dependency graph;
- continuation/handoff;
- another Work Order surface,

while the Work Order is in flight.

The Tech Lead updates governance at acceptance/merge boundaries.

## Dependencies

Workers may propose dependencies but must not change root manifests or lockfiles during parallel work.

The Tech Lead performs serialized dependency intake and lockfile reconciliation.

## Tests and evidence

Every Work Order includes:

- positive tests;
- negative/adversarial tests;
- contract/parity tests where relevant;
- reproducible commands;
- evidence artifacts/paths;
- known limitations.

## PR

Every PR states:

- Work Order;
- dispatch base SHA;
- final head SHA;
- owned paths;
- implementation summary;
- acceptance mapping;
- verification;
- evidence;
- limitations;
- architecture questions.

Workers never merge.

## Review/remediation

Architect findings are fixed on the same PR. Re-run affected tests and the relevant complete battery after remediation.

## Fresh-session requirement

The repository must remain understandable without this conversation.
