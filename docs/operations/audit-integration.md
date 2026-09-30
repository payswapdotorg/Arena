# Security-Audit Integration (A034 ↔ A035)

How the A034 security layer's audit trail becomes first-class telemetry. This is the operational bridge between `@arena/security`'s append-only, tamper-evident audit chain and the observability layer.

## Principle

**Audit events are telemetry, not a parallel universe.** A034 already produces structured, sequenced, correlation-addressable audit events (`SecurityAuditEvent`: closed kind vocabulary, REQUIRED correlation id, optional causation id). A035 wraps them in the `audit` telemetry-signal kind so ONE query surface (`queryTelemetry`) and ONE alerting engine serve security operations alongside platform operations.

## The audit signal

An `AuditSignal` (kind `audit`) is a telemetry signal whose payload references a STRUCTURALLY VALID `@arena/security` audit event:

```ts
{
  signalVersion: 1,
  kind: 'audit',
  signalId: 'audit-…',
  sequence: 7,                    // 1..n contiguous within the security-service stream
  occurredAt: 1_794_000_000_000, // epoch ms
  sourceService: 'security-service',
  correlationId: 'corr-…',        // REQUIRED (A015 discipline)
  causationId: null,              // the causing command's envelope id, when known
  tenantId: 'tenant-alpha',
  auditEvent: {                   // validated by isSecurityAuditEvent — fail-closed
    recordVersion: 1,
    eventId: 'audit-evt-…',
    kind: 'authorization-decision', // the CLOSED A034 vocabulary
    tenantId: 'tenant-alpha',
    principalId: 'principal-…',
    action: 'evaluate-authorization',
    boundaryClass: 'tenant-scope',
    outcome: { effect: 'deny', reason: 'no-matching-policy' },
    correlationId: 'corr-…',
    causationId: '…',
    occurredAt: '2026-10-01T00:00:00.000Z',
  },
}
```

Validation is fail-closed: a structurally invalid audit event is rejected with `OBS_INVALID_AUDIT` at signal construction AND at ingestion — an audit producer regression can never silently degrade the telemetry stream.

## What this buys operations

1. **One query surface.** `queryTelemetry({ correlationId })` returns the audit trail interleaved with metrics, traces and logs of the same causal flow — the runbook's "pull the correlation id" step covers security incidents identically.
2. **The audit chain gets an SLO.** `slo-audit-chain-integrity` (target 1.00, zero budget — see [slo-targets.md](./slo-targets.md)) measures `audit-chain-verified`; chain verification telemetry rides the same ingestion path, so a broken chain pages via the standard engine (`rule-audit-chain-zero-budget`, freeze rule).
3. **Closed-vocabulary analytics.** The A034 audit kinds (`authorization-decision`, `tenant-access-denied`, `data-rights-violation`, `secret-detected`, …) appear on dashboard D4 as-is — no free-text parsing, no invented categories. Deny/allow ratios and per-boundary-class rates derive from the closed `outcome.effect` + `boundaryClass` fields.
4. **Flap-protected alerting on audit conditions.** Standard alert rules (e.g. a `metric-above-threshold` on `tenant-access-denied` rate) inherit determinism, sustainment and cooldown semantics — security pages are as trustworthy as platform pages.

## Boundary discipline

- The observability package IMPORTS `@arena/security` types/validators (domain→domain composition, allowed by boundary rule B4) but never mutates security state — audit events are facts the security service emitted; observability only wraps and evaluates them (event rule: events describe facts that have occurred).
- The security service remains the sole authority for the audit chain (A034); the observability service is a consumer, per spec/service-boundaries.md — no cross-service state writes.
- `secret-detected` audit events enter telemetry as closed signals; the telemetry vocabulary itself contains no sensitive-material words (enforced by the hygiene suites in both packages).

## Wiring sketch

```ts
// security side (conceptual): after appending to the audit chain,
// emit the same event as an audit telemetry signal:
const signal = toTelemetrySignal({
  signalVersion: 1,
  kind: 'audit',
  signalId: `audit-${event.eventId}`,
  sequence: nextSequence,
  occurredAt: Date.parse(event.occurredAt),
  sourceService: 'security-service',
  correlationId: event.correlationId,
  causationId: event.causationId,
  tenantId: event.tenantId,
  auditEvent: event,
});

// observability side: standard idempotent ingestion:
const command = makeIngestTelemetryCommand(signal, {
  correlationId: event.correlationId,
  idempotencyKey: `audit-${event.eventId}`,
});
const ack = await service.ingest(JSON.stringify(command));
```

The idempotency key derived from `eventId` makes audit-signal emission naturally idempotent — re-delivery re-acknowledges without double-counting (the `slo-audit-chain-integrity` budget can never be inflated by retries).
