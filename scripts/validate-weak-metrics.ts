/**
 * Executes every query in WeakMetricsAnalyticsRepository against the local
 * database, then seeds a fixture whose correct answers are known by hand and
 * checks the aggregations reproduce them.
 *
 * Two different failures are being hunted here, and only the second needs the
 * fixture:
 *
 *  1. STRUCTURAL — a malformed CTE, or a `$n` placeholder that no longer lines
 *     up after the numerator/denominator fragments are concatenated. These
 *     throw, so an empty database is enough to catch them.
 *
 *  2. LOGICAL — a query that runs clean and counts the wrong thing. A
 *     placeholder bound to the wrong value filters silently rather than
 *     erroring, so it survives both a compile and an empty-table run. The
 *     fixture below exists specifically for that class.
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/validate-weak-metrics.ts
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import {
  WeakMetricsAnalyticsRepository,
  WeakMetricsFilters,
} from '../src/analytics/repository/weak-metrics-analytics.repository';
import { LanguageJudgeRepository } from '../src/analytics/repository/language-judge.repository';

const TENANT = 'weakmetrics-validate';
const SESSION_LOOP = '11111111-1111-4111-8111-111111111111';
const SESSION_CLEAN = '22222222-2222-4222-8222-222222222222';

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
  const repo = new WeakMetricsAnalyticsRepository(ds);
  const languageRepo = new LanguageJudgeRepository(ds);

  const f: WeakMetricsFilters = {
    start: new Date('2025-01-01T00:00:00Z'),
    bucket: 'month',
    judgeModel: 'gemini-2.5-pro',
    judgePromptVersion: 'v1',
  };

  const calls: Array<[string, () => Promise<unknown>]> = [
    ['latestDriftJudgeVersion', () => repo.latestDriftJudgeVersion()],
    ['understandingWeightedTrend', () => repo.understandingWeightedTrend(f)],
    ['unresponsiveTurnTrend', () => repo.unresponsiveTurnTrend(f)],
    ['rePromptTrend', () => repo.rePromptTrend(f)],
    ['bargeInTrend', () => repo.bargeInTrend(f)],
    ['repetitionTurnTrend', () => repo.repetitionTurnTrend(f)],
    ['sessionLoopRateTrend', () => repo.sessionLoopRateTrend(f)],
    ['semanticStasisTrend', () => repo.semanticStasisTrend(f)],
    ['resolutionTrend', () => repo.resolutionTrend(f)],
    [
      'realismWeightedTrend(register)',
      () => repo.realismWeightedTrend(f, 'register'),
    ],
    [
      'realismWeightedTrend(colloquialness)',
      () => repo.realismWeightedTrend(f, 'colloquialness'),
    ],
    [
      'realismWeightedTrend(dialect_lexicon)',
      () => repo.realismWeightedTrend(f, 'dialect_lexicon'),
    ],
    ['briefOverrideBreakdown', () => repo.briefOverrideBreakdown(f)],
    ['fabricatedQuoteTrend', () => repo.fabricatedQuoteTrend(f)],
    ['groundednessTrend', () => repo.groundednessTrend(f)],
    ['falseNegativeFeedbackTrend', () => repo.falseNegativeFeedbackTrend(f)],
    ['feedbackToneTrend', () => repo.feedbackToneTrend(f)],
    ['unhealthyScoredTrend', () => repo.unhealthyScoredTrend(f)],
    ['scoreVsLengthPairs', () => repo.scoreVsLengthPairs(f)],
    ['roleSlipTrend', () => repo.roleSlipTrend(f)],
    ['roleInversionTrend', () => repo.roleInversionTrend(f)],
    ['overComplianceTrend', () => repo.overComplianceTrend(f)],
    ['inappropriateStasisTrend', () => repo.inappropriateStasisTrend(f)],
    [
      'counsellorDirectedQuestionTrend',
      () => repo.counsellorDirectedQuestionTrend(f),
    ],
    ['roleSlipByScenario', () => repo.roleSlipByScenario(f, 1)],
    ['filterOptions', () => repo.filterOptions(f.start)],
  ];

  // --- Pass 1: structural -------------------------------------------------
  console.log('\n=== Pass 1: every query executes (filters applied) ===');
  let failures = 0;
  // A fully-populated filter tuple exercises the dimension loop, which is where
  // the placeholder numbering actually shifts.
  const filtered: WeakMetricsFilters = {
    ...f,
    language: 'ta-IN',
    llmModel: 'gpt-4o-mini',
    scenarioId: 96,
    // Included because prompt version is the one dimension that takes a
    // different route per table (stamped column vs derived from the session),
    // so it is the likeliest to break exactly one query's placeholder run.
    promptVersion: '7',
  };
  for (const [name, fn] of calls) {
    for (const [label, filters] of [
      ['bare', f],
      ['filtered', filtered],
    ] as const) {
      try {
        const orig = { ...f };
        Object.assign(f, filters);
        await fn();
        Object.assign(f, orig);
      } catch (e) {
        failures++;
        console.log(`  FAIL ${name} [${label}]: ${(e as Error).message}`);
      }
    }
  }
  console.log(
    failures === 0 ? '  all queries executed' : `  ${failures} failures`,
  );

  // --- Pass 2: logical, against a hand-checked fixture ---------------------
  console.log('\n=== Pass 2: aggregations reproduce known answers ===');
  await seed(ds);

  const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures++;
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}` +
        (ok ? '' : ` want ${JSON.stringify(expected)}`),
    );
  };

  const g: WeakMetricsFilters = {
    start: new Date('2025-01-01T00:00:00Z'),
    bucket: 'month',
    judgeModel: 'gemini-2.5-pro',
    judgePromptVersion: 'v1',
  };

  // Fixture: SESSION_LOOP has 6 judged turns, turns 2,3,4 are `repetition`
  // (a run of 3) and turn 5 is role_slip. SESSION_CLEAN has 4 turns, one
  // isolated repetition at turn 1 (a run of 1).
  const rep = (await repo.repetitionTurnTrend(g)) as Array<{
    numerator: number;
    denominator: number;
  }>;
  check(
    'repetition turns 4 of 10',
    [Number(rep[0].numerator), Number(rep[0].denominator)],
    [4, 10],
  );

  const loop = (await repo.sessionLoopRateTrend(g)) as Array<{
    numerator: number;
    denominator: number;
  }>;
  check(
    'sessions with a run >=3: 1 of 2',
    [Number(loop[0].numerator), Number(loop[0].denominator)],
    [1, 2],
  );

  const slip = (await repo.roleSlipTrend(g)) as Array<{
    numerator: number;
    denominator: number;
  }>;
  check(
    'role_slip 1 of 10',
    [Number(slip[0].numerator), Number(slip[0].denominator)],
    [1, 10],
  );

  // Language: one `register` annotation at major (weight 5) + one at minor
  // (weight 1) = 6, over 10 judged turns.
  const reg = (await repo.realismWeightedTrend(g, 'register')) as Array<{
    numerator: number;
    denominator: number;
  }>;
  check(
    'register weighted 6 over 10 turns',
    [Number(reg[0].numerator), Number(reg[0].denominator)],
    [6, 10],
  );

  // understanding: one critical (10), conditionedOut one is excluded.
  const und = (await repo.understandingWeightedTrend(g)) as Array<{
    numerator: number;
    denominator: number;
  }>;
  check(
    'understanding weighted 10 (conditionedOut excluded)',
    [Number(und[0].numerator), Number(und[0].denominator)],
    [10, 10],
  );

  // Fabricated citations: of the claims that CITE the transcript, how many
  // cite it wrongly. A claim with no quote is not in the denominator at all.
  const fq = (await repo.fabricatedQuoteTrend(g)) as Array<{
    numerator: number;
    denominator: number;
  }>;
  check(
    'fabricated quotes: 1 inaccurate of 2 quoting claims (non-quoting excluded)',
    [Number(fq[0]?.numerator ?? -1), Number(fq[0]?.denominator ?? -1)],
    [1, 2],
  );

  // Tone: 3 improvements over 2 positives.
  const tone = (await repo.feedbackToneTrend(g)) as Array<{
    numerator: number;
    denominator: number;
  }>;
  check(
    'tone 3 improvements / 2 positives',
    [Number(tone[0].numerator), Number(tone[0].denominator)],
    [3, 2],
  );

  // --- v2 judge labels --------------------------------------------------
  //
  // Fixture: LOOP turn 5 is role_inversion; turns 2 and 3 add nothing, but
  // turn 2's stuckness is APPROPRIATE (correct resistance) and turn 3's is
  // not — so only turn 3 counts. The session offers 5 solutions against a
  // resistant brief, so it trips over-compliance.
  const inv = (await repo.roleInversionTrend(g)) as Array<{
    numerator: number;
    denominator: number;
  }>;
  check(
    'role inversion 1 of 6 labelled turns',
    [Number(inv[0].numerator), Number(inv[0].denominator)],
    [1, 6],
  );

  const stas = (await repo.inappropriateStasisTrend(g)) as Array<{
    numerator: number;
    denominator: number;
  }>;
  check(
    'inappropriate stasis 1 of 6 (correct resistance excluded)',
    [Number(stas[0].numerator), Number(stas[0].denominator)],
    [1, 6],
  );

  const over = (await repo.overComplianceTrend(g)) as Array<{
    numerator: number;
    denominator: number;
  }>;
  check(
    'over-compliance 1 resistant session of 1',
    [Number(over[0].numerator), Number(over[0].denominator)],
    [1, 1],
  );

  // ---- backfill selector --------------------------------------------------
  //
  // The selector must not hand back sessions the judge cannot read. Skipping
  // them inside the run was survivable while a run took the whole backlog; once
  // runs are chunked it is fatal, because a skipped session gets no judgment
  // row and so comes back in the very next chunk — the language family span
  // two hours re-skipping the same twenty-five sessions and judged nothing.
  //
  // SESSION_LOOP has transcript messages, SESSION_CLEAN has none, so the pair
  // pins both halves: the readable one is offered, the unreadable one is not.
  const selectable = (await languageRepo.selectSessions({
    sinceDays: 3650,
    onlyUnjudged: false,
  })) as Array<{ id: string }>;
  const selectableIds = selectable.map((r) => r.id);
  check(
    'selector offers a session that has AI turns',
    selectableIds.includes(SESSION_LOOP),
    true,
  );
  check(
    'selector skips a session with no AI turns (would spin a chunk forever)',
    selectableIds.includes(SESSION_CLEAN),
    false,
  );

  // ---- turn conditions ----------------------------------------------------
  //
  // The (session, turnIndex) join. Ten turns carry metrics; six of them were
  // faulted by a judge — LOOP turn 1 by a language annotation, LOOP turns 2-5
  // and CLEAN turn 1 by a drift failure mode. Every other turn has metrics and
  // no verdict against it, so a join that matched loosely (on session alone,
  // say) would fault all ten and this would catch it.
  //
  // Scoped to the fixture's scenario. Unlike the trend queries, this one reads
  // `scenario_session_turn_metrics`, which a developer's local database is
  // likely to hold from unrelated work — and stray rows judged under a
  // DIFFERENT language version silently join the population when the pin below
  // is varied, which is exactly the number this section asserts on. Scenario 96
  // is the fixture's; nothing else uses it.
  const tcPin = { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v1' };
  const tcFilter = { ...g, scenarioId: 96 };
  const tc = (await repo.turnConditionBreakdown(tcFilter, tcPin)) as Array<{
    factor: string;
    turns: number;
    faults: number;
  }>;
  const sumOf = (factor: string, key: 'turns' | 'faults') =>
    tc
      .filter((r) => r.factor === factor)
      .reduce((a, r) => a + Number(r[key]), 0);

  check(
    'turn conditions band all 10 metric-carrying turns',
    sumOf('responseLatencyMs', 'turns'),
    10,
  );
  check(
    'turn conditions fault exactly the 6 judged-bad turns',
    sumOf('responseLatencyMs', 'faults'),
    6,
  );

  // Quartiles must actually split rather than collapsing into one band.
  check(
    'latency splits into four bands',
    tc.filter((r) => r.factor === 'responseLatencyMs').length,
    4,
  );

  // Both sides of each yes/no condition survive the GROUP BY.
  check(
    'interrupted keeps both branches',
    tc.filter((r) => r.factor === 'interrupted').length,
    2,
  );
  check(
    'knowledge retrieval keeps both branches',
    tc.filter((r) => r.factor === 'knowledgeRetrieval').length,
    2,
  );

  // The language pin has to bind independently of the drift pin. Pointed at a
  // version the annotations were not written under, the one language-derived
  // fault must drop out and the five drift ones must stay — if the pin were
  // ignored, or shared with drift, this would still read 6.
  const tcWrongLang = (await repo.turnConditionBreakdown(tcFilter, {
    judgeModel: 'gemini-2.5-pro',
    judgePromptVersion: 'v2',
  })) as Array<{ factor: string; faults: number }>;
  check(
    'language pin binds inside the join (annotation fault drops)',
    tcWrongLang
      .filter((r) => r.factor === 'responseLatencyMs')
      .reduce((a, r) => a + Number(r.faults), 0),
    5,
  );

  // Language filter must actually bind: ta-IN has no fixture rows.
  const filteredRep = (await repo.repetitionTurnTrend({
    ...g,
    language: 'ta-IN',
  })) as unknown[];
  check('language filter binds (ta-IN empty)', filteredRep.length, 0);

  const enRep = (await repo.repetitionTurnTrend({
    ...g,
    language: 'en-IN',
  })) as Array<{ numerator: number }>;
  check(
    'language filter binds (en-IN keeps rows)',
    Number(enRep[0]?.numerator),
    4,
  );

  // ---- prompt version -----------------------------------------------------
  //
  // Two routes to the same slice: judge tables filter on their own stamped
  // column, everything else derives it from the session's promptVersions map.
  // They have to select the same population, or one filter selection would
  // show two different corpora on one screen — so both are checked against the
  // same fixture, and both are checked to actually EXCLUDE, since a predicate
  // that silently matches everything looks identical to a working one.
  const pvJudge = (await repo.repetitionTurnTrend({
    ...g,
    promptVersion: '7',
  })) as Array<{ numerator: number; denominator: number }>;
  check(
    'promptVersion binds on a judge series (column route)',
    [Number(pvJudge[0]?.numerator), Number(pvJudge[0]?.denominator)],
    [4, 10],
  );

  const pvJudgeMiss = (await repo.repetitionTurnTrend({
    ...g,
    promptVersion: '99', // the decoy key's value — must not be chosen
  })) as unknown[];
  check('promptVersion excludes on a judge series', pvJudgeMiss.length, 0);

  const pvTone = (await repo.feedbackToneTrend({
    ...g,
    promptVersion: '7',
  })) as Array<{ numerator: number; denominator: number }>;
  check(
    'promptVersion binds on a feedback series (session route)',
    [Number(pvTone[0]?.numerator), Number(pvTone[0]?.denominator)],
    [3, 2],
  );

  const pvToneMiss = (await repo.feedbackToneTrend({
    ...g,
    promptVersion: '8',
  })) as unknown[];
  check('promptVersion excludes on a feedback series', pvToneMiss.length, 0);

  // Every series must actually honour the language filter. resolutionTrend
  // shipped without one: it filtered scenario, version and prompt straight off
  // the session row and silently ignored language and model, so picking Hindi
  // left it showing platform-wide numbers. A filter that quietly does nothing
  // is worse than one that empties a chart — nothing on screen says the
  // selection was dropped.
  const everySeries: Array<
    [string, (f: WeakMetricsFilters) => Promise<unknown>]
  > = [
    ['resolutionTrend', (ff) => repo.resolutionTrend(ff)],
    ['rePromptTrend', (ff) => repo.rePromptTrend(ff)],
    ['semanticStasisTrend', (ff) => repo.semanticStasisTrend(ff)],
    ['feedbackToneTrend', (ff) => repo.feedbackToneTrend(ff)],
    ['offLanguageTurnTrend', (ff) => repo.offLanguageTurnTrend(ff)],
    ['unhealthyScoredTrend', (ff) => repo.unhealthyScoredTrend(ff)],
    ['bargeInTrend', (ff) => repo.bargeInTrend(ff)],
  ];
  for (const [name, run] of everySeries) {
    // The fixture is entirely en-IN, so a language nothing matches must empty
    // every one of these. Any that comes back populated is ignoring the filter.
    const rows = (await run({ ...g, language: 'zz-ZZ' })) as unknown[];
    check(`${name} honours the language filter`, rows.length, 0);
  }

  const pvOptions = await repo.filterOptions(g.start);
  check(
    'prompt versions are offered from judged data',
    pvOptions.promptVersions.includes('7'),
    true,
  );

  await cleanup(ds);
  await ds.destroy();

  console.log(
    failures === 0
      ? '\nALL CHECKS PASSED\n'
      : `\n${failures} CHECK(S) FAILED\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

async function cleanup(ds: DataSource) {
  const ids = `('${SESSION_LOOP}','${SESSION_CLEAN}')`;
  await ds.query(
    `DELETE FROM turn_drift_judgment WHERE "scenarioSessionId" IN ${ids}`,
  );
  await ds.query(
    `DELETE FROM language_error_annotations WHERE "scenarioSessionId" IN ${ids}`,
  );
  await ds.query(
    `DELETE FROM language_judgment_sessions WHERE "scenarioSessionId" IN ${ids}`,
  );
  await ds.query(
    `DELETE FROM scenario_session_messages WHERE "scenarioSessionId" IN ${ids}`,
  );
  await ds.query(
    `DELETE FROM scenario_session_details WHERE "scenarioSessionId" IN ${ids}`,
  );
  await ds.query(
    `DELETE FROM feedback_claim_judgment WHERE "scenarioSessionId" IN ${ids}`,
  );
  await ds.query(
    `DELETE FROM scenario_session_turn_metrics WHERE "scenarioSessionId" IN ${ids}`,
  );
  await ds.query(`DELETE FROM scenario_sessions WHERE id IN ${ids}`);
}

async function seed(ds: DataSource) {
  await cleanup(ds);
  const at = '2026-03-15T10:00:00Z';

  for (const id of [SESSION_LOOP, SESSION_CLEAN]) {
    await ds.query(
      // roomId must not start with 'preview-': the judge session selector
      // excludes those, and a fixture that looked like a Studio preview would
      // silently drop out of half these queries.
      //
      // `promptVersions` is the map the prompt-version filter derives from for
      // every table that has no column of its own. Both fixtures sit on '7'
      // alongside a decoy key, so a query that reads the wrong entry picks up
      // '99' and the check below fails.
      `INSERT INTO scenario_sessions (id, "roomId", "scenarioId", "counselorId", status, "startedAt", tenant_id, metadata, "createdAt", "updatedAt")
       VALUES ($1, $4, 96, 1, 'COMPLETED', $2, $3, $5::jsonb, $2, $2)`,
      [
        id,
        at,
        TENANT,
        `validate-${id.slice(0, 8)}`,
        JSON.stringify({
          promptVersions: {
            ally_ai_learn_system_audio_tag_guidance: '99',
            ally_ai_learn_system_main_agent_prompt: '7',
          },
        }),
      ],
    );
  }

  // Drift turns. LOOP: turns 2,3,4 repetition (run of 3), turn 5 role_slip.
  // [session, turnIndex, failureMode, roleInversion, introducedNew,
  //  stuckIsAppropriate, solutionsOffered, resistanceBriefed]
  // Only SESSION_LOOP carries v2 labels, so the denominators below (6) prove
  // the queries count labelled turns rather than all judged turns.
  type DriftRow = [
    string,
    number,
    string | null,
    boolean | null,
    boolean | null,
    boolean | null,
    number | null,
    boolean | null,
  ];
  const driftRows: DriftRow[] = [
    [SESSION_LOOP, 0, null, false, true, null, 0, true],
    [SESSION_LOOP, 1, null, false, true, null, 2, true],
    // Added nothing, but correctly held out against a weak intervention.
    [SESSION_LOOP, 2, 'repetition', false, false, true, 0, true],
    // Added nothing and should have moved — the only true stasis failure.
    [SESSION_LOOP, 3, 'repetition', false, false, false, 0, true],
    [SESSION_LOOP, 4, 'repetition', false, true, null, 3, true],
    [SESSION_LOOP, 5, 'role_slip', true, true, null, 0, true],
    [SESSION_CLEAN, 0, null, null, null, null, null, null],
    [SESSION_CLEAN, 1, 'repetition', null, null, null, null, null],
    [SESSION_CLEAN, 2, null, null, null, null, null, null],
    [SESSION_CLEAN, 3, null, null, null, null, null, null],
  ];
  for (const [
    sid,
    ti,
    mode,
    inv,
    newInfo,
    stuckOk,
    sols,
    resist,
  ] of driftRows) {
    await ds.query(
      `INSERT INTO turn_drift_judgment
         (id, "scenarioSessionId", "turnIndex", "aiReplyFailureMode", "inCharacter",
          language, "scenarioId", "llmModel", "occurredAt", "judgeModel",
          "judgePromptVersion", tenant_id, "createdAt", "updatedAt",
          "roleInversion", "introducedNewInformation", "stuckIsAppropriate",
          "solutionsOffered", "resistanceBriefed", "promptVersion")
       VALUES (gen_random_uuid(), $1, $2, $3, true, 'en-IN', 96, 'gpt-4o-mini',
               $4, 'gemini-2.5-pro', 'v1', $5, $4, $4, $6, $7, $8, $9, $10, '7')`,
      [sid, ti, mode, at, TENANT, inv, newInfo, stuckOk, sols, resist],
    );
  }

  // Turn metrics — the other half of the (session, turnIndex) join. One row per
  // judged turn, so the conditions panel has something to band. Values are
  // spread evenly rather than realistically: the point is that ntile() splits
  // them and that each row lands on the right turn, not that 100ms is plausible.
  //
  // `interrupted` and the retrieval time are set so BOTH sides of each yes/no
  // condition exist — a fixture where a flag is always false cannot tell a
  // working GROUP BY from one that dropped a branch.
  const turnMetrics: Array<[string, number, number, boolean, number]> = [
    // sessionId, turnIndex, responseLatencyMs, interrupted, knowledgeRetrievalMs
    [SESSION_LOOP, 0, 100, false, 0],
    [SESSION_LOOP, 1, 200, false, 0],
    [SESSION_LOOP, 2, 300, false, 900],
    [SESSION_LOOP, 3, 400, true, 900],
    [SESSION_LOOP, 4, 500, false, 900],
    [SESSION_LOOP, 5, 600, false, 900],
    [SESSION_CLEAN, 0, 700, false, 0],
    [SESSION_CLEAN, 1, 800, false, 0],
    [SESSION_CLEAN, 2, 900, true, 900],
    [SESSION_CLEAN, 3, 1000, false, 900],
  ];
  for (const [sid, ti, latency, interrupted, retrieval] of turnMetrics) {
    await ds.query(
      `INSERT INTO scenario_session_turn_metrics
         (id, "scenarioSessionId", "roomId", "turnIndex", "responseLatencyMs",
          "eouDelayMs", "responseChars", "knowledgeRetrievalMs", interrupted,
          language, "scenarioId", "llmModel", "occurredAt", tenant_id,
          "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'en-IN', 96,
               'gpt-4o-mini', $9, $10, $9, $9)`,
      [
        sid,
        `validate-${sid.slice(0, 8)}`,
        ti,
        latency,
        latency * 2,
        latency / 10,
        retrieval,
        interrupted,
        at,
        TENANT,
      ],
    );
  }

  // Language denominator: 10 turns judged across the two sessions.
  for (const [sid, turns] of [
    [SESSION_LOOP, 6],
    [SESSION_CLEAN, 4],
  ] as const) {
    await ds.query(
      `INSERT INTO language_judgment_sessions
         (id, "scenarioSessionId", "turnsJudged", "turnsGarbled", language, "scenarioId",
          "llmModel", "occurredAt", "judgeModel", "judgePromptVersion", tenant_id,
          "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 0, 'en-IN', 96, 'gpt-4o-mini', $3,
               'gemini-2.5-pro', 'v1', $4, $3, $3)`,
      [sid, turns, at, TENANT],
    );
  }

  const anns: Array<[string, string, string, boolean]> = [
    // dimension, category, severity, conditionedOut
    ['register', 'too_formal_diglossia', 'major', false],
    ['register', 'too_formal_diglossia', 'minor', false],
    ['understanding', 'ignored_context', 'critical', false],
    // Excluded from the understanding rate: garbled input is the STT's fault.
    ['understanding', 'misinterpreted_intent', 'critical', true],
  ];
  for (const [dimension, category, severity, conditionedOut] of anns) {
    await ds.query(
      `INSERT INTO language_error_annotations
         (id, "scenarioSessionId", "sessionJudgmentId", "turnIndex", layer, dimension,
          category, severity, "conditionedOut", "isolationBasis", language, "scenarioId",
          "llmModel", "occurredAt", "judgeModel", "judgePromptVersion", tenant_id,
          "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, gen_random_uuid(), 1, 'appropriateness', $2, $3, $4,
               $5, 'persona_specified', 'en-IN', 96, 'gpt-4o-mini', $6,
               'gemini-2.5-pro', 'v1', $7, $6, $6)`,
      [SESSION_LOOP, dimension, category, severity, conditionedOut, at, TENANT],
    );
  }

  // Transcript. The AI turns carry the phrase the "matched" feedback quote cites.
  const msgs: Array<[number, string, number, number]> = [
    [
      -1,
      'I have been feeling completely overwhelmed by everything at home lately.',
      0,
      5,
    ],
    [
      1,
      'That sounds really difficult. Tell me more about what happens at home.',
      6,
      11,
    ],
    [
      -1,
      'It is the same thing every single day and nothing ever seems to change.',
      12,
      18,
    ],
  ];
  for (const [sender, content, ss, es] of msgs) {
    await ds.query(
      `INSERT INTO scenario_session_messages
         ("scenarioSessionId", "senderId", "messageType", content, "startSeconds",
          "endSeconds", tenant_id, "createdAt", "updatedAt")
       VALUES ($1, $2, 'TEXT', $3, $4, $5, $6, $7, $7)`,
      [SESSION_LOOP, sender, content, ss, es, TENANT, at],
    );
  }

  // Feedback: 2 positives / 3 improvements; one quote real, one fabricated.
  const summary = {
    feedback: {
      positives: [
        'The counsellor reflected well when the client said "feeling completely overwhelmed by everything at home".',
        'Good use of open questions throughout the session.',
      ],
      improvements: [
        'The counsellor missed the moment when the client said "I have decided to leave my job tomorrow" and moved on.',
        'Could have summarised more often.',
        'Consider slowing the pace.',
      ],
      skillCoverage: [
        { category: 'Listening Engagement', percentage: 70 },
        { category: 'Emotional Attunement', percentage: 50 },
      ],
    },
  };
  await ds.query(
    `INSERT INTO scenario_session_details
       ("scenarioSessionId", summary, tenant_id, "createdAt", "updatedAt")
     VALUES ($1, $2::jsonb, $3, $4, $4)`,
    [SESSION_LOOP, JSON.stringify(summary), TENANT, at],
  );

  // Groundedness claims. Three quote the transcript and one of those quotes is
  // wrong; a fourth makes no citation at all and must stay OUT of the
  // fabricated-quote denominator — a claim that cites nothing cannot fabricate.
  const claims: Array<[string, number, string, boolean, boolean | null]> = [
    // claimKind, claimIndex, verdict, quotesTranscript, quoteIsAccurate
    ['improvement', 0, 'contradicted', true, false],
    ['improvement', 1, 'supported', true, true],
    ['positive', 0, 'supported', false, null],
  ];
  for (const [kind, idx, verdict, quotes, accurate] of claims) {
    await ds.query(
      `INSERT INTO feedback_claim_judgment
         (id, "scenarioSessionId", "claimKind", "claimIndex", "verdict",
          "quotesTranscript", "quoteIsAccurate", "claimText", language,
          "scenarioId", "llmModel", "occurredAt", "judgeModel",
          "judgePromptVersion", tenant_id, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'fixture claim',
               'en-IN', 96, 'gpt-4o-mini', $7, 'gemini-2.5-pro', 'v1', $8, $7, $7)`,
      [SESSION_LOOP, kind, idx, verdict, quotes, accurate, at, TENANT],
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
