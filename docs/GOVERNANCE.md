# Arena Governance G1.0

## Authority order

1. Architecture Lock
2. Requirements
3. Work Items
4. Dependency Graph
5. Project State
6. Worker Runbook
7. PR/issue evidence
8. conversation context

Conversation is never a durable authority.

## Work Order lifecycle

```
WAITING_ON_DEPENDENCIES
→ READY
→ ACTIVE
→ REVIEW
→ ACCEPTED
→ MERGED
```

Failure/remediation stays attached to the same Work Order/PR.

## Dispatch

The Tech Lead must:

- select only READY work;
- freeze ownership;
- record base SHA;
- check exact path overlap;
- cap active workers at 3.

## Acceptance

Acceptance requires scope completion, architecture compliance, green verification, reproducible evidence, ownership compliance and no unresolved critical finding.

## Governance checks

A001 must implement machine checks covering:

- work-order ownership;
- concurrent overlap;
- required source-of-truth files;
- authorized frontier consistency;
- architecture lock presence;
- generated-contract drift once generators exist.
