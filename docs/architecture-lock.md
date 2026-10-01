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


## Approved Product Direction — Human Escalation Infrastructure

25. Arena's commercial north star is human expert escalation infrastructure for AI applications; the public integration boundary is an application-facing Escalation API.
26. External applications remain authoritative for their live workflows/worlds; Arena supplies human capability and validated results through explicit contracts.
27. Human escalation supports SOLVE, CORRECT, UNBLOCK, REVIEW, TEACH, TOOL_GAP, KNOWLEDGE and EVALUATE modes as explicitly authorized request states.
28. A human expert session may operate on a bounded replica of the originating agent's environment; the replica is never a write path to the host application's live authoritative world.
29. Expert sessions must enforce declared privacy, tenancy, secret, action and retention barriers.
30. Arena captures observable expert work, evidence, tool use and explicit annotations; hidden chain-of-thought is neither required nor a canonical learning artifact.
31. An accepted escalation result is operationally distinct from any reusable learning artifact; reuse requires explicit rights, provenance, validation and scope.
32. Expert interventions may produce tool-gap, knowledge, skill, evaluator, benchmark and Agent Body improvement candidates without silently mutating the host application's live agent.
33. Expert payment, Arena fees, settlement and payout are commercial concerns behind provider-neutral adapters and do not become domain-specific payment-provider contracts.
34. Adversarial expert competition is an alternative evaluation mechanism; popularity signals cannot bypass Arena Verification or certification authority.
35. Human expert qualification/performance evidence is distinct from role authorization and from correctness verification.
36. Epoch is a reference customer/integrator of the generic Arena Escalation API, not a special semantic authority inside Arena.
