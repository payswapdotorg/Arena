# Arena Security and Data Governance S1.0

## Tenancy

Tenant boundaries cover:

- customer identities;
- expert records;
- tasks;
- environments;
- trajectories;
- datasets;
- bodies;
- model interactions;
- certification evidence.

## Data rights

Artifacts retain:

- owner;
- source;
- permitted use;
- contract/license reference;
- retention;
- publication status.

Customer data is never used for cross-tenant learning without explicit authorization.

## Expert rights

Expert work records applicable:

- contributor identity;
- compensation terms;
- attribution policy;
- rights to derived artifacts;
- withdrawal/deletion policy where contractually and technically applicable.

## Model data

Input/output retention is configurable by tenant and task policy.

Secrets never enter generic trajectories.

## Environment security

Untrusted environments are sandboxed.

Network access is deny-by-default where practical.

Tools are capability-scoped.

## Certification

Evidence references immutable artifacts.

Revocation or expiry produces a status transition; historical records remain auditable.
