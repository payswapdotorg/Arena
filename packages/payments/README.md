# @arena/payments

Arena human-expert payments domain core — **Work Order C010** (issue #77; `docs/LLM-ARCHITECT-FINAL-HANDOFF.md` §8 commercial model; `spec/human-escalation-work-items.md` C010 row).

Pure TypeScript domain package whose only workspace import is `@arena/protocol-core`. Payment providers stay behind the provider-neutral `PaymentProviderPort` (architecture-lock rule 33); the deterministic demo adapter lives in `adapters/payments`.

## Surfaces

| Module | Responsibility |
|---|---|
| `money.ts` | Money primitives: currency + amount as ONE typed value; string-scaled minor units, BigInt arithmetic (floats never touch money); multi-currency as representation only — conversion is a provider concern, out of scope |
| `fees.ts` | Versioned, deterministic platform-fee + expert-payout splits; caller-supplied splits are recomputed and any divergence is a typed `PAYMENTS_SPLIT_MISMATCH` |
| `ledger.ts` | The append-only escrow/hold ledger: `opened → held → offered → accepted → captured → released/refunded`; budget HOLD at creation, offer/acceptance markers, CAPTURE at ACCEPTED, RELEASE (fee split) on completion, REFUND on revision/rejection/cancellation/timeout; double-entry lines; contiguous 1..n entries with a sha256 digest chain; operation-key idempotency; closed lifecycle allowlists (expired/revoked commercial states deny typed) |
| `audit.ts` | Commercial audit events — one per applied money operation (the commercial audit surface) |
| `provider.ts` | Provider-neutral `PaymentProviderPort` + the truth-label law (demo money is never customer money) + the recorded open production questions (MoR, payout rails, tax, jurisdiction) |
| `envelopes.ts` | `payments` SchemaRef namespace envelope wiring (command / event / response) |

## Truth-label law

Every money record carries `truth: 'demo' | 'customer'` (spec/free-tier-contract.md demo posture: demo state is never customer-authoritative state). The demo provider may never execute customer-money instructions and a customer ledger may never ride the demo provider — both are typed `PAYMENTS_TRUTH_LABEL_VIOLATION`.

## Generated contracts

`packages/payments/contracts/*.json` are produced by `scripts/generate-contracts.mjs` (deterministic; sorted keys). Drift is checked by `pnpm test` (drift suite) and centrally by governance G9 (auto-discovery of package-level generators).

## Explicit open production questions (recorded, not guessed)

Merchant-of-record, payout/settlement rails, tax handling and jurisdiction constraints are provider/composition-root decisions behind the port — deliberately NOT modeled here.
