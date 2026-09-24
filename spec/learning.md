# Learning and Experiment Specification LE1.0

## Experiment

An Experiment compares a baseline against an intervention.

Minimum:

- experiment id/version;
- target capability;
- baseline Body/Model/Runtime;
- intervention artifact(s);
- task population;
- evaluation suite;
- verification suite;
- environment versions;
- outcome metrics;
- uncertainty/statistical method;
- result;
- provenance.

## Interventions

An intervention may change:

- skills;
- procedures;
- retrieval/knowledge;
- tool configuration;
- memory policy;
- evaluator/verifier;
- substrate;
- model-specific adaptation;
- body composition.

The changed surface must be explicit.

## Attribution

Distinguish:

- substrate improvement;
- Body improvement;
- environment improvement;
- evaluator changes;
- verifier changes;
- sampling/measurement variance.

A changed evaluator score is not automatically a capability improvement.

## Learning boundary

Learning may produce a new Body Version.

Learning may never rewrite historical trajectories, task/environment versions, certification evidence or original customer records.

## Calibration

Where outcomes can later be observed, compare predicted confidence/score with outcomes and preserve applicability context.
