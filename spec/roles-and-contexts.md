# Arena Roles and Contexts RC1.0

## Core distinction

```
Identity
  ↓
Tenant membership
  ↓
Permission / policy
  ↓
Granted roles
  ↓
Active role context
  ↓
UI workflow
```

Changing the active role context changes how the product helps the user. It never grants new permissions.

## Role contexts

### Owner / Customer

Goal:
understand capability gaps, track outcomes, procure expertise, consume released capabilities.

Primary surfaces:
- Capability Inbox
- active cases
- progress/outcomes
- body library
- marketplace
- release adoption

### Agent Builder

Goal:
assemble and improve Agent Bodies.

Primary surfaces:
- Body Studio
- Skills
- tools
- knowledge
- possession matrix
- compatibility
- certification
- release

### Expert

Goal:
perform high-value professional work.

Primary surfaces:
- assigned work
- environment/workbench
- evidence
- review
- compensation/status
- capability history

### Evaluator

Goal:
make “good” measurable.

Primary surfaces:
- evaluator builder
- criteria
- verifier bindings
- suites
- runs
- failure analysis

### Researcher

Goal:
discover capability boundaries and measure improvement.

Primary surfaces:
- benchmark lab
- experiments
- body × substrate comparisons
- capability graph
- datasets
- research reports

### Operator

Goal:
keep Arena healthy and understandable.

Primary surfaces:
- jobs
- environments
- telemetry
- SLOs
- incidents
- audit
- quotas

### Marketplace Participant

Goal:
publish/discover/use capability artifacts.

Primary surfaces:
- catalog
- artifact detail
- provenance
- verification
- offers/grants
- review
- usage

### Administrator

Goal:
manage identity, tenant policy, entitlements, integrations and audit.

Primary surfaces:
- members
- roles
- policies
- providers
- entitlements
- audit

## Same-object / different-lens rule

A Capability Case remains the same canonical object regardless of role.

Owner view:
“Why is my agent struggling?”

Expert view:
“What work am I being asked to perform?”

Builder view:
“What capability is missing from the Body?”

Researcher view:
“What evidence supports the capability hypothesis?”

Operator view:
“Is the workflow/job healthy?”

The object is shared; the projection is role-specific.

## Role switcher

Persistent but compact.

It must show:

- current tenant/workspace;
- current active role;
- other granted roles;
- permission warnings when a workflow is unavailable;
- a “view as”/preview function only where explicitly permitted.

Switching preserves:

- current object/case where safe;
- navigation breadcrumb;
- unsaved drafts when supported;
- selected time range/filter where meaningful.

Switching never preserves a mutation capability that the new role does not have.
