# Arena Product Requirements P1.0

## Product status target

Arena V1 core is complete. The next program (B-series) moves Arena from an engineering/reference implementation to a product that a new user can install, open in a browser, understand, and use.

## Definition of “usable”

A fresh user must be able to:

1. start Arena locally with a documented one-command path;
2. open the product UI without developer-only diagnostics being the default entry point;
3. enter a seeded Demo/Preview workspace without external credentials;
4. understand what Arena does within the first session;
5. choose or switch among roles the user has been granted;
6. see the same underlying Arena object through a role-appropriate workflow;
7. create or continue a Capability Case;
8. inspect a Task, Environment, Trajectory, Evaluation, Verification result and Agent Body;
9. run the deterministic reference Software Engineer and Structural Engineer flows;
10. inspect why a Body/Substrate possession is or is not certified;
11. discover marketplace artifacts without confusing them with authoritative operational state;
12. export/use released artifacts through the API/SDK;
13. understand where humans, agents, models, evaluators and authoritative systems each sit.

## Definition of “hosted”

A public preview deployment must be reachable from a stable Vercel URL.

The hosted product must use free-tier-compatible infrastructure for the preview profile:

- Vercel Hobby for the Next.js web/control plane;
- Neon Free for control-plane PostgreSQL;
- Cloudflare R2 Standard for immutable artifact/blob storage;
- Upstash Redis Free for short-lived cache, rate-limit, idempotency and coordination workloads;
- Apify Free only where external web/data acquisition is actually needed and bounded.

A provider is never a semantic dependency. Each is accessed through an adapter.

Free-tier mode must have explicit quotas and must fail closed when a provider limit is reached. It must not silently create billable usage.

## Definition of “friendly”

Arena is not a backend dashboard with forms.

The primary user experience is a guided, visual workspace that:

- teaches by showing;
- exposes the causal relationship between objects;
- defaults to the next useful action;
- uses progressive disclosure;
- keeps advanced controls available without making them the default;
- gives every role a tailored working surface;
- allows role switching without losing context;
- distinguishes operational facts from suggestions, scores, hypotheses and expert judgments.

## Role model

A user may hold many roles.

Role is a presentation/workflow context.

Permission is an authorization fact.

Never infer authorization from role selection.

Reference roles:

- Owner/Customer — define desired capability/outcome and consume releases.
- Agent Builder — compose bodies, skills, knowledge, tools and policies.
- Expert — perform/review professional work and provide validated experience.
- Evaluator — define and run evaluation suites.
- Researcher — benchmark bodies/substrates and study capability lift.
- Operator — monitor jobs, environments, failures and SLOs.
- Marketplace Participant — publish, discover, buy or license artifacts.
- Administrator — manage tenant configuration, identity, policy and audit.

A user can have any subset simultaneously.

## Primary information architecture

Global:

- Home
- Work
- Capabilities
- Bodies
- Environments
- Evaluations
- Library/Marketplace
- Research
- Operations
- Settings

Contextual navigation changes with active role and selected workspace.

## Demo-first requirement

The first-run experience must offer:

- Explore Demo;
- Start a real workspace;
- See how an Agent Body works;
- See the Epoch learning loop.

Demo state is clearly marked and cannot be mistaken for customer-authoritative state.

## Product truth hierarchy

UI labels must distinguish:

- Verified fact;
- Evidence;
- Expert judgment;
- Model output;
- Simulation result;
- Evaluation result;
- Certification;
- Suggestion/hypothesis.

Do not display them with identical visual semantics.

## Mobile

The web product must be responsive.

Important workflows must work on narrow screens:

- onboarding;
- role switching;
- case triage;
- body inspection;
- task review;
- evaluation summary;
- marketplace browsing;
- approval/review actions.

Dense engineering views may progressively collapse into inspector sheets/tabs.

## Accessibility

Target WCAG 2.2 AA practices for keyboard access, focus visibility, semantics, color-independent meaning, reduced motion and readable contrast.

## UX/architecture rule

UI is a projection over canonical Arena contracts.

Components may not invent a second representation of domain truth.

UX may be creative in layout, animation, storytelling and information grouping, but cannot alter authoritative lifecycle semantics.
