# @arena/human-data

The human-data production studio domain core (Work Order C012; issue #118).

A customer commissions targeted human data (corrections, demonstrations,
evaluations, knowledge) for their AI pipeline; the commission compiles to
ES1.0 EscalationRequests through the C001 public port (`createEscalationRequest`
— one seam, no new lifecycle); validated, rights-cleared deliverables derive
ONLY from C009-ACCEPTED intervention outputs; and the rights-gated set is
packaged into versioned, immutable dataset bundles over the A014
`@arena/datasets` vocabulary.

## Laws enforced structurally

- **The rights wall** — a deliverable without an explicit GRANTED
  consent/rights statement can never enter a dataset bundle
  (`requireGrantedConsent` / `assertDeliverableRightsGated`; spec/security.md
  data rights; architecture-lock rules 11, 18, 31; EES1.0 consent).
- **The validation gate** — deliverables derive only from C009-ACCEPTED
  adjudication outcomes (`deriveDeliverable`); acceptance is decided by the
  C009 seam, never self-certified.
- **The replay law** — demonstration records carry the EES1.0 bounded-session
  replay trace (`state → human action → observable consequence → evidence`)
  and reject any record masquerading as a live-world mutation.
- **Tenant isolation** — commission, deliverables and bundles are
  tenant-scoped; cross-tenant derivation/assembly is a typed
  `HUMAN_DATA_CROSS_TENANT` failure.

## Reference service and studio

- `services/human-data` — the reference service (commission lifecycle as
  durable idempotent jobs; escalations through injected C001 ports;
  deliverables collected from C009-accepted results).
- `apps/web/src/human-data` — the studio web routes (commission builder,
  production dashboard, dataset delivery).
