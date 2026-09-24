# Arena Architecture Lock A1.0

1. Agent Body is a first-class persistent object.
2. Cognitive Substrate is distinct from Agent Body.
3. Possession is a versioned binding, not an alias for the model.
4. Certification claims apply to the tested composition, not the base model alone.
5. Body Versions are immutable and content-addressed.
6. Historical evidence is append-only and never rewritten by learning.
7. Evaluation and verification are distinct responsibilities.
8. Environment execution is isolated and bounded.
9. Expert identity/qualification is distinct from authorization and system authority.
10. Model/provider details remain behind adapters.
11. Customer data is tenant-scoped and cannot be silently cross-reused.
12. Public artifacts are explicitly published and versioned.
13. Arena does not become an external host system's semantic authority.
14. For Epoch, World Model, Action Gateway, Constraint Engine, Verification/Evidence and Delivery State remain authoritative.
15. No direct Arena writes to Epoch authoritative stores.
16. One responsibility has one authority.
17. Long-running jobs are idempotent and correlation-addressable.
18. Material artifacts are provenance-addressable.
19. Root manifests and lockfiles are serially reconciled.
20. Web is the canonical Arena control UI; other clients share semantic contracts.
21. New domains extend skills/environments/evaluators/packs; they do not fork the Arena lifecycle.
22. Model-specific artifacts may exist but cannot silently redefine Body identity.
23. Safety, privacy, licensing and professional limitations are explicit metadata.
24. The repository must remain self-describing for a fresh Architect session.

## Architecture Change Request

A locked rule can change only through a recorded Architecture Change Request containing impact analysis, revised requirements/contracts, acceptance criteria, dependency changes, version/lock update, frontier update and explicit approval.
