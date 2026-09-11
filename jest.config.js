/**
 * Jest configuration, moved out of package.json so the worker pool can be
 * sized conditionally.
 *
 * Everything below `maxWorkers` is verbatim what the `jest` key in
 * package.json held; only the resource limits are new.
 *
 * Two settings, two scopes: `maxWorkers` is local-only, `workerIdleMemoryLimit`
 * applies everywhere. See the note beside each.
 *
 * Why: Jest defaults to (cores - 1) workers, each a Node process running
 * ts-jest over this codebase. On a 10-core / 16 GB dev machine that is 9
 * TypeScript compilers at once, and running it next to the ally-web Vitest
 * suite exhausted the machine. CI is deliberately exempt — a runner is a clean
 * box doing one thing, with a low core count already, and throttling it would
 * slow every pipeline to fix a problem it does not have.
 *
 * Overrides: JEST_MAX_WORKERS=8 to raise it, =1 to serialise for debugging.
 * Applies in CI too, if a pipeline ever needs to pin the pool.
 */
const isCI = Boolean(process.env.CI);
const requested = Number.parseInt(process.env.JEST_MAX_WORKERS ?? '', 10);
const explicit = Number.isFinite(requested) && requested > 0 ? requested : null;
// 3, not 4: measured on a 10-core / 16 GB machine, `npx jest src/learn` peaked at
// 7.65 GB with 4 workers (161s). That fits, but leaves little room for an editor,
// Chrome and Docker alongside it — and this suite is the memory-hungry one, since
// every worker runs ts-jest over the whole project's types.
const maxWorkers = explicit ?? (isCI ? null : 3);

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  transformIgnorePatterns: ['node_modules/(?!(uuid)/)'],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/$1',
  },
  // Worker pool size is LOCAL ONLY: a runner is a clean box doing one thing, and
  // throttling it would slow every pipeline to fix a problem it does not have.
  ...(maxWorkers ? { maxWorkers } : {}),

  // The memory valve applies EVERYWHERE, including CI, and that is a correction.
  //
  // It was bundled with maxWorkers under the "CI is exempt" reasoning, but the two
  // are not the same kind of setting. Sizing the pool is about sharing a developer's
  // machine. Recycling a worker that has ballooned is about a leak this suite already
  // warns about on every run ("a worker process has failed to exit gracefully"), and a
  // runner is not immune to it: CI died with "Ineffective mark-compacts near heap
  // limit" at ~3.9GB, exit 134, after every suite it had reported PASSED. It passed on
  // re-run, which is the worst version of the problem — a red master and a red release
  // that both clear on a retry teach everyone to retry rather than look.
  //
  // Not a throttle. A worker is recycled BETWEEN test files once it exceeds the limit,
  // so the only cost is process startup on a worker that was about to die anyway.
  workerIdleMemoryLimit: '1GB',
};
