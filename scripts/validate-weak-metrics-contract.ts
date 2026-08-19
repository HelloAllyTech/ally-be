/**
 * Contract check between the service and the UI.
 *
 * The repository tests prove the SQL counts correctly; the tab's vitest suite
 * proves the component renders a given payload. This closes the gap between
 * them: it builds the real response through the real service and asserts the
 * shape the tab actually reads — group ids, series ids, units, states, and the
 * null-vs-zero rule.
 *
 * Worth having because the two sides were written against a DTO rather than
 * against each other: a series renamed in the service and not in the tab would
 * pass both suites and render an empty card in production.
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/validate-weak-metrics-contract.ts
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { WeakMetricsAnalyticsRepository } from '../src/analytics/repository/weak-metrics-analytics.repository';
import { WeakMetricsAnalyticsService } from '../src/analytics/service/weak-metrics-analytics.service';
import {
  WeakMetricsBucket,
  WeakMetricsRange,
} from '../src/analytics/dto/weak-metrics.dto';

// What the tab expects to find. Kept explicit so a rename on either side fails
// here rather than silently rendering a blank card.
const EXPECTED_GROUPS = [
  'responsiveness',
  'progression',
  'language_realism',
  'feedback_groundedness',
  'clienthood',
];

const EXPECTED_SERIES: Record<string, string[]> = {
  responsiveness: [
    'understanding',
    'unresponsive_turns',
    're_prompt',
    'barge_in',
  ],
  progression: [
    'repetition_turns',
    'session_loop_rate',
    'inappropriate_stasis',
    'semantic_stasis',
    'resolution',
  ],
  language_realism: ['register', 'colloquialness', 'dialect_lexicon'],
  feedback_groundedness: [
    'groundedness',
    'feedback_false_negatives',
    'fabricated_quotes',
    'unhealthy_scored',
    'criticism_ratio',
  ],
  clienthood: [
    'role_inversion',
    'over_compliance',
    'role_slip',
    'counsellor_directed_questions',
  ],
};

const VALID_UNITS = new Set(['percent', 'per100turns', 'ratio', 'count']);
const VALID_STATES = new Set(['measured', 'partial', 'none']);

async function main() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5477),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_DATABASE ?? 'ally_local',
  });
  await ds.initialize();

  const service = new WeakMetricsAnalyticsService(
    new WeakMetricsAnalyticsRepository(ds),
  );

  let failures = 0;
  const check = (label: string, ok: boolean, detail = '') => {
    if (!ok) failures++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  };

  console.log('\n=== Service builds a complete response ===');
  const res = await service.getWeakMetrics({
    range: WeakMetricsRange.M12,
    bucket: WeakMetricsBucket.MONTH,
  });

  check('metricsVersion present', Boolean(res.metricsVersion), res.metricsVersion);
  check('parameters echoed', Object.keys(res.parameters).length > 0);
  check('bucket echoed', res.bucket === 'month', res.bucket);
  check('start is ISO', !Number.isNaN(Date.parse(res.start)), res.start);
  check('filterOptions present', Boolean(res.filterOptions));
  check('worstScenarios is an array', Array.isArray(res.worstScenarios));

  console.log('\n=== All five metric groups, in order ===');
  const groupIds = res.groups.map(g => g.id);
  check(
    'group ids match what the tab renders',
    JSON.stringify(groupIds) === JSON.stringify(EXPECTED_GROUPS),
    groupIds.join(', '),
  );

  console.log('\n=== Every series the tab expects exists ===');
  for (const group of res.groups) {
    const ids = group.series.map(s => s.id);
    const expected = EXPECTED_SERIES[group.id] ?? [];
    const missing = expected.filter(e => !ids.includes(e));
    check(
      `${group.id}: ${ids.length} series`,
      missing.length === 0,
      missing.length ? `missing ${missing.join(', ')}` : ids.join(', '),
    );
  }

  console.log('\n=== Units, states and the null-vs-zero rule ===');
  for (const group of res.groups) {
    check(
      `${group.id} state is valid`,
      VALID_STATES.has(group.state),
      group.state,
    );
    for (const s of group.series) {
      if (!VALID_UNITS.has(s.unit)) {
        check(`${group.id}/${s.id} unit`, false, s.unit);
      }
      if (!VALID_STATES.has(s.state)) {
        check(`${group.id}/${s.id} state`, false, s.state);
      }
      // The rule the tab relies on to distinguish "no data" from "clean": a
      // zero denominator must produce null, never 0.
      const badZero = s.points.find(p => p.denominator === 0 && p.value !== null);
      if (badZero) {
        check(
          `${group.id}/${s.id} zero denominator yields null`,
          false,
          `bucket ${badZero.bucket} has value ${badZero.value}`,
        );
      }
      // latest/previous must come from points that have values.
      if (s.latest !== null && !s.points.some(p => p.value !== null)) {
        check(`${group.id}/${s.id} latest without any valued point`, false);
      }
    }
  }
  check('unit/state/null sweep completed', true);

  console.log('\n=== Every series carries a caveat where it is partial or absent ===');
  for (const group of res.groups) {
    for (const s of group.series) {
      if (s.state !== 'measured' && !s.caveat) {
        check(
          `${group.id}/${s.id} non-measured series has a caveat`,
          false,
          'a partial signal with no caveat reads as a real number',
        );
      }
    }
  }
  check('caveat sweep completed', true);

  await ds.destroy();
  console.log(
    failures === 0
      ? '\nCONTRACT OK — the tab and the service agree\n'
      : `\n${failures} CONTRACT FAILURE(S)\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
