# Evaluation and Verification Specification EV1.0

## Evaluation

Evaluation is judgment against explicit criteria.

Evaluator types include:

- deterministic test;
- model-based evaluator;
- expert evaluator;
- rubric evaluator;
- simulation evaluator;
- comparative evaluator;
- adversarial evaluator.

Every evaluator has id/version, inputs, criteria, output schema, reproducibility characteristics, confidence/limitations and provenance.

## Verification

Verification establishes evidence supporting a result.

Methods may include:

- unit/integration tests;
- deterministic/formal checks;
- constraint checks;
- simulation;
- measurement;
- inspection;
- expert review;
- evidence provenance validation.

A verifier declares required evidence, method, pass/fail/unknown semantics and reproducibility policy.

## Separation

Evaluation may produce a score or judgment.

Verification may establish whether required evidence exists and supports required claims.

Neither is professional licensure.

## Certification Suite

A Certification Suite is a pinned composition of evaluators and verifiers.

It declares:

- target Body/version;
- required environment;
- test population;
- pass criteria;
- minimum evidence;
- known blind spots;
- recertification policy.
