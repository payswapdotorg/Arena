# @arena/marketplace-ui

The reusable view model for Arena marketplace surfaces (Work Order B013; issue #88).

Pure, deterministic, frozen-data-driven projections of expert-service and artifact
listings into the shapes marketplace screens render:

- **Listing view models** — identity, provenance summary (evidence-class mark),
  rights posture, verification status (its own truth class), certification badge
  ONLY when a certification record backs it (composition-scoped), and the explicit
  entitlement state machine (granted / revoked / expired / pending).
- **Detail view models** — the full provenance chain, licence terms, verification
  evidence addresses (append-only), entitlement history, and the purchase action
  view model (what a purchase grants and explicitly does NOT grant).
- **Honest readers** — every field is read honestly: a missing or foreign-typed
  value degrades to `undefined` and lands in `unknownFields`; pending/unknown stay
  pending/unknown; a listing without certification renders "not certified", never
  a blank.

Zero runtime dependencies. This package is a projection, never a second domain
model: it adds no price logic, no entitlement logic, and no authority. The
governing product truths are carried as frozen data (`PURCHASE_NOT_CERTIFICATION_NOTE`,
`CERTIFICATION_COMPOSITION_SCOPE_NOTE`, `ENTITLEMENT_STATE_NOTE`) so no view can
render them away.
