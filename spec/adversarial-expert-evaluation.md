# Arena Adversarial Expert Evaluation AE1.0

## Purpose

Provide an alternative to conventional evaluator staffing for domains where qualified evaluators are scarce.

Experts compete by solving tasks and attempting to falsify one another's proposed solutions.

This is an evaluation method, not a replacement for Arena's Verification authority.

## Competition model

For a task:
1. multiple qualified experts independently submit solutions;
2. each solution is exposed to challenge;
3. experts can challenge another solution;
4. a challenge must identify a concrete claim, step, artifact or outcome;
5. challengers provide evidence for the challenge;
6. solution authors may respond;
7. experts vote on challenge validity;
8. adjudication/verifier derives the final result.

Supported judgments:
- UPVOTE_WITH_PROOF;
- DOWNVOTE_WITH_PROOF;
- CHALLENGE;
- ACCEPT_CHALLENGE;
- REJECT_CHALLENGE;
- NEEDS_MORE_EVIDENCE.

## Raw community signal

The proposed upvote/downvote ratio is retained as a discovery signal.

It must not by itself be the final correctness authority.

Guardrails:
- minimum vote/evidence threshold;
- no self-voting;
- conflict-of-interest exclusion;
- duplicate-account protection;
- rate limiting;
- qualification-aware visibility;
- challenge/evidence requirement;
- small-sample status;
- tie/uncertainty handling.

## Evidence-weighted adjudication

Final adjudication may incorporate:
- qualified expert votes;
- challenge validity;
- evidence quality;
- verifier outcome;
- task-specific evaluator;
- historical calibration;
- agreement/disagreement patterns.

Use pairwise comparison where appropriate, with a defensible aggregation method rather than treating raw popularity as truth.

Pairwise comparison and Bradley-Terry-style aggregation are established evaluation techniques, while debate research provides a theoretical basis for having competing solvers expose errors for a verifier. citeturn128285academia14turn956631search6

## Competition UX

The UI should feel like an expert arena:

Problem
→ Solutions
→ Challenge
→ Proof
→ Response
→ Community signal
→ Adjudication
→ Verified result

Each claim should link to the evidence supporting it.

Do not turn the product into social-media popularity voting.

## Benefits

This mode can:
- reduce reliance on a single evaluator;
- expose hidden errors;
- create adversarial trajectories;
- discover missing requirements;
- generate disagreement data;
- identify expert strengths;
- create benchmark material.

## Certification boundary

Competition results can feed Evaluation/Verification/Certification inputs.

They cannot redefine certification scope or bypass Verifier authority.
