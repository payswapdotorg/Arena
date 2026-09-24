# Arena Service and Protocol Boundaries SB1.0

## Principle

A service owns a capability and persists through explicit contracts. It may not reach directly into another service's private storage.

## Canonical boundaries

### Control/API

Owns:
- authenticated API surface;
- command/query routing;
- tenant scope;
- request validation.

Does not own domain truth.

### Artifact Service

Owns:
- immutable artifact metadata;
- object-storage references;
- lineage;
- digest validation.

### Expert Service

Owns:
- expert profile;
- competencies;
- qualification evidence;
- matching inputs.

### Task Service

Owns:
- TaskSpec lifecycle;
- compiler output;
- task versions.

### Environment Service

Owns:
- environment definitions;
- run lifecycle;
- execution leases;
- snapshots.

### Trajectory Service

Owns:
- event/trajectory persistence;
- compression/chunking;
- trajectory retrieval.

### Evaluation Service

Owns:
- evaluator definitions;
- evaluation jobs;
- evaluation results.

### Verification Service

Owns:
- verifier definitions;
- evidence requirements;
- verification results.

### Learning Service

Owns:
- experiments;
- interventions;
- comparisons;
- attribution;
- learned-artifact proposals.

### Body Forge / Registry

Owns:
- body manifests;
- body versions;
- releases;
- model compatibility references.

### Certification Service

Owns:
- certification suite versions;
- certification runs;
- certification status.

### Marketplace/Billing

Owns:
- publication;
- listing;
- entitlement;
- usage/accounting records.

## Cross-service rule

Services communicate with:

- versioned commands/events;
- immutable refs;
- typed query APIs;
- correlation/idempotency metadata.

No service may mutate another service's authoritative state directly.

## Database rule

One logical authority per data object.

Sharing a physical PostgreSQL cluster is permitted later; sharing uncontracted tables is not.

## Event rule

Events describe facts that have occurred.

Commands request work.

Queries retrieve projections.

Do not use events as hidden mutable database writes.

## Epoch boundary

Arena↔Epoch follows `spec/epoch-integration.md`.

No Arena service may import Epoch's internal domain types or database schema.
