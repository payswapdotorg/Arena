# G003 evidence — landing, demo, comprehension, CTAs, truth labels, role safety

## First-run landing (fresh profile, 1280x800)

Accessibility snapshot (verbatim excerpt):

```
- link "Skip to main content"
- complementary "Context rail" → navigation "Context navigation":
    Home · Cases · Bodies · Research · Marketplace · Operations · Settings
- heading "Professional AI capability, kept inspectable" [level=1]
- paragraph: "Arena turns desired outcomes into certified agent capability — with the engineering evidence always in reach."
- "What Arena is" / "What an Agent Body is" / "Start with a guided scenario" (H2 sections)
- link "Explore a capability"     ← primary CTA
- link "See how an Agent Body works"   ← secondary CTA
```

Comprehension verdict: a first-time visitor can tell what the product is (H1 + value prop),
what it consists of (three explainer sections), and what to do next (two labelled CTAs).

## Demo surface — truth labels (verbatim)

```
- strong: "Demo mode."
- StaticText: "Demo state is not customer state. Everything here is a deterministic, resettable replay."
- navigation "Demo role lenses"
```

The demo/UX invariant "Demo state is not customer state" is visibly rendered.

## Role switch (interaction, verbatim)

Clicking the "Expert" lens link:

```
url: https://arena-preview-five.vercel.app/demo?role=expert
heading: "Expert lens" [level=2]      (was "Owner lens")
"Explore by role": "Arena reads differently depending on who you are: an owner asks what is
happening and what it costs; an agent-builder asks how bodies are put together; an expert
asks where their judgment is needed. Pick a role lens above — the same labelled truth, from your angle."
```

Role safety: the copy itself states the lens principle ("the same labelled truth, from your
angle") — presentation, not authority. Server-side gating of Operations was verified by the
G002 acceptance harness ("Operations surface gated by server-side fail-closed session
validation", 2026-10-07 13:21 UTC run).
