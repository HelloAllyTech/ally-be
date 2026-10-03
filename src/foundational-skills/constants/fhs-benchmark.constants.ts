/**
 * The foundational-skills BENCHMARK: one fixed roleplay, taken at onboarding
 * and again later, scored whole against the same rubric, judge prompt and
 * model as the cut pipeline, and compared within each learner.
 *
 * Why it exists: cut-to-cut scores cannot show learning. Every cut is a
 * different mix of scenarios, so one cut's composite is mostly that mix
 * (ICC ≈ 0.03 on production data). Holding the scenario fixed removes the mix,
 * which is the only way a before/after difference can be read as the learner.
 *
 * Nothing here is part of the ruler (`FHS_RUBRIC_VERSION`): these are rules
 * for which sessions get scored and which pairs are compared.
 */

/** `scenarios.metadata` key that marks a roleplay as a benchmark. */
export const FHS_BENCHMARK_METADATA_KEY = 'fhsBenchmark';

/**
 * SQL predicate: the scenario aliased `alias` is flagged as a benchmark.
 * JSONB containment rather than `->>'fhsBenchmark')::boolean`, so a malformed
 * value written by some other path is simply "not a benchmark" instead of a
 * cast error that would stop every benchmark query.
 */
export const isBenchmarkScenarioSql = (alias: string): string =>
  `${alias}.metadata @> '{"${FHS_BENCHMARK_METADATA_KEY}": true}'::jsonb`;

/**
 * Below this much learner speech (code points) in the session, the judge is
 * not called and the session is stored SKIPPED: most rubric skills would have
 * had no opportunity, so the composite would rest on one or two skills and a
 * before/after pair built on it would compare different things.
 */
export const FHS_BENCHMARK_MIN_LEARNER_CHARS = 1500;

/**
 * A learner's first and latest benchmark sessions are compared only when the
 * latest came after at least this many more sealed cuts (5,000 characters of
 * their own speech each) than the first — enough practice in between for a
 * change to be about practice rather than the retake itself.
 */
export const FHS_BENCHMARK_MIN_CUTS_BETWEEN = 3;

/**
 * Benchmark sessions scored per scheduler tick. Small: benchmark sessions are
 * rare, and the tick shares a sequential scheduler bucket with everything else.
 */
export const FHS_BENCHMARKS_PER_TICK = 8;
