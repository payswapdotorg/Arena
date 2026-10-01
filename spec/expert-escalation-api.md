# Arena Expert Escalation API ES1.0

## Purpose

Provide one provider-neutral API through which any AI application can request human expert intervention.

The API must be usable without requiring the caller to understand Arena's internal domain topology.

## Primary object

EscalationRequest

Minimum fields:
- request_id;
- client_app_id;
- tenant_id;
- source_workflow_ref;
- source_run_ref;
- task_ref where available;
- capability_need;
- escalation_mode(s);
- urgency;
- deadline;
- budget/currency;
- required expert capabilities;
- geographic/locale requirements where relevant;
- desired output schema;
- context references;
- environment-session policy;
- privacy policy;
- permitted actions;
- learning permissions;
- data-retention policy;
- idempotency key;
- correlation ID.

## Response

The application receives:
- request status;
- accepted expert/session reference where permitted;
- result payload;
- evidence references;
- validation status;
- cost;
- Arena fee;
- expert payout status;
- reusable artifact references where authorized;
- suggested tool/knowledge improvements where discovered.

## Lifecycle

CREATED
→ TRIAGED
→ MATCHING
→ OFFERED
→ ACCEPTED
→ SESSION_READY
→ IN_PROGRESS
→ SUBMITTED
→ VALIDATING
→ ACCEPTED | REVISION_REQUIRED | REJECTED
→ PAID
→ LEARNING_CAPTURED
→ CLOSED

Timeout, cancellation and expert replacement are explicit states.

## Routing

Routing considers:
- qualified capabilities;
- demonstrated performance;
- current availability;
- historical task fit;
- geography/locale;
- required tools;
- conflict-of-interest rules;
- privacy clearance;
- budget;
- deadline.

Capability qualification remains separate from authorization.

## Result types

A response can be typed as:
- Correction
- Unblock
- Answer
- Decision
- Solution
- Review
- EvidenceBundle
- KnowledgePatch
- ToolGapSignal
- EvaluationVerdict
- LearningArtifactRef

## API surfaces

Support:
- REST;
- SDKs;
- webhook/event delivery;
- MCP tool interface;
- idempotent status polling.

The first integration should be trivial:

POST /v1/escalations

and return a durable request_id.

## Webhook events

Minimum events:
- escalation.created;
- escalation.matched;
- escalation.accepted;
- escalation.session.ready;
- escalation.started;
- escalation.progressed;
- escalation.submitted;
- escalation.validation.updated;
- escalation.completed;
- escalation.failed;
- escalation.cancelled;
- escalation.payment.updated;
- escalation.learning.updated.

## Design constraint

The escalation API is an integration boundary, not a new semantic authority.

Canonical Arena objects back it.

Host applications remain authoritative over their own workflows and worlds.
