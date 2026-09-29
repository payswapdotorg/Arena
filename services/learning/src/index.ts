/**
 * @arena/learning-fabric — the in-process reference LEARNING
 * EXPERIMENT FABRIC (Work Order A020; requirements R15, R16).
 *
 * Two objects:
 *   - ExperimentRegistry — content-addressed descriptor registration
 *     (idempotent by digest; identity conflicts rejected — changing an
 *     experiment requires a new version);
 *   - ExperimentEngine — the reference experiment runner: resolve
 *     descriptor → enforce arm contracts (REAL A011/A012/A013 guards +
 *     pinned population/environment/baseline enforcement) → freeze
 *     historical inputs (learning boundary) → pure comparison /
 *     attribution / verdict computation → append-only, content-addressed
 *     ExperimentRunRecord emission, idempotent by experiment key.
 *     Learning proposals are NEW content-addressed objects;
 *     LEARNING_REWRITE_ATTEMPT fires on any attempt to propose a
 *     historical digest as learning output (lock rule 6).
 *
 * In-process only: no network, no database. The pure protocol lives in
 * @arena/learning; the sibling record guards it re-validates come from
 * @arena/trajectory, @arena/evaluation and @arena/verification
 * (devDependencies of this fabric — the engine imports them only for
 * the REAL structural guards; consumers supply the records).
 */

export * from './registry.js';
export * from './engine.js';
