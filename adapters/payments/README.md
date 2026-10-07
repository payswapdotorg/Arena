# @arena/payments-adapters

Deterministic **DEMO** payment-provider adapters (Work Order **C010**, issue #77; `docs/LLM-ARCHITECT-FINAL-HANDOFF.md` §8 commercial model; architecture-lock rule 33).

One law: expert payment, Arena fees, settlement and payout are commercial concerns behind the **provider-neutral `PaymentProviderPort`** (defined in the domain package `@arena/payments`); adapters implement the port, services orchestrate it, and **no real payment provider is integrated in C010**. This package never imports services (boundary rule B4); its only workspace dependency is the domain package that owns the port.

## 1. `DemoPaymentProvider` — the deterministic reference adapter

Implements `PaymentProviderPort` with clearly-labelled **demo** state (the truth-label law: *demo money is never customer money*):

- **Deterministic** — the same instruction (body) always produces the byte-identical `ProviderTransferRecord`: `providerTransferId = dtx_<sha256(canonical instruction view)>`, no randomness, injected clock (default fixed epoch), stable across instances and runs.
- **Idempotent on the instruction key** — a duplicate instruction replays the recorded record verbatim (the duplicate-payout guard at the provider seam); the same key with a **different body** is a typed `PAYMENTS_IDENTITY_CONFLICT` — never a silent rebind.
- **Truth-label law, defense in depth** — an instruction asserting `truth: 'customer'` is a typed `PAYMENTS_TRUTH_LABEL_VIOLATION` refusal (the service layer checks it too).
- **Typed shape failures** — malformed instructions (float-shaped minor units, destinations outside `['platform','expert']`, missing idempotency keys) fail closed with typed `PaymentError`s.
- **Deterministic failure injection** — `failingInstructionKeys` records a failure once (typed `status: 'failed'` + `failureReason`) which duplicates replay verbatim; the service maps non-succeeded records to `PAYMENTS_PROVIDER_FAILURE` and leaves the ledger untouched (no half-settled money).
- **Append-only transfer log** — `listTransfers()` is the in-memory audit surface in execution order (reference fabric; real provider-side persistence is a production provider concern).

## 2. Provider posture — explicit OPEN production questions (recorded, not guessed)

`DEMO_PROVIDER_POSTURE` (machine-readable) and `PROVIDER_POSTURE_OPEN_QUESTIONS` (from the domain port) record what a production provider decision must still settle:

1. **Merchant-of-record responsibilities** — who is the MoR for expert payouts and platform fees.
2. **Payout and settlement rails and timing** — rails, settlement cadence, reconciliation.
3. **Tax handling and invoicing** — withholding, invoicing obligations, VAT/sales tax posture.
4. **Jurisdiction and cross-border constraints** — where experts and tenants sit, licensing limits.

The demo adapter executes **demo state only** (`executesCustomerMoney: false`). Wiring a real provider is a host composition-root decision that must answer the four questions above before any customer money moves — C010 deliberately makes no claim about them.

## Wiring (host composition root)

```ts
import { PaymentService } from '@arena/payments-service';
import { DemoPaymentProvider } from '@arena/payments-adapters';

const payments = new PaymentService({
  clock,                 // injected time source
  store, outbox,         // injected persistence / at-least-once event fabric
  lifecycle,             // the C001 escalation lifecycle READ port
  provider: new DemoPaymentProvider({ clock }),   // demo truth — labelled, deterministic
  feeSchedule,           // deterministic platform-fee/expert-payout rule
});
```

A real provider implements the same port (`providerId`, `truth: 'customer'`, idempotent `transfer`) — the service layer never learns provider specifics.
