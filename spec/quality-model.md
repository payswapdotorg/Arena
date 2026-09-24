# Arena Quality Model Q1.0

## Principle

Arena optimizes for verified capability gain per unit of expert effort, not raw data volume.

## Quality dimensions

Every material task/body/evaluation may be measured on:

- correctness;
- task realism;
- discriminative power;
- reproducibility;
- expert agreement;
- verifier strength;
- leakage resistance;
- coverage;
- uncertainty/calibration;
- downstream capability lift.

## Expert quality

Do not collapse expert quality into a single global score.

Maintain evidence for:

- competency by skill;
- task-family performance;
- agreement;
- review outcomes;
- consistency;
- domain/jurisdiction fit;
- recentness/freshness;
- conflicts/limitations.

## Task quality

Measure:

- completion validity;
- difficulty;
- capability discrimination;
- shortcut resistance;
- environment realism;
- verifier reliability;
- expert review quality.

Low-discrimination tasks should be retired or revised, with lineage retained.

## Evaluation quality

Track:

- false positive/negative evidence where measurable;
- evaluator agreement;
- verifier agreement;
- known blind spots;
- benchmark contamination/leakage;
- score stability under rerun.

Changing an evaluator requires a new version and cannot be treated as a pure model improvement.

## Agent Body quality

A Body Version has capability-specific evidence.

Report:

```
body score
substrate score
possession score
environment score
verification confidence
```

Do not report a Body certification as a score for the base model.

## Capability lift

A learning intervention is successful only when:

1. target capability improves on a pinned evaluation population;
2. improvement survives a verification audit;
3. evaluator/version changes are accounted for;
4. regression on protected capabilities is measured;
5. uncertainty/variance is reported where material.

## Certification levels

The implementation may support:

- DEVELOPMENT — internal test evidence;
- CANDIDATE — suite complete, not production-cleared;
- CERTIFIED — suite pass under declared composition;
- CONDITIONAL — passes with declared constraints;
- REVOKED — prior claim no longer valid.

These are lifecycle states, not universal professional ratings.

## Professional limitations

Certification does not grant a legal license, professional registration, sign-off authority or authority to practice where external law/regulation requires it.
