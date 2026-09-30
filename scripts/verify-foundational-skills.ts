/**
 * End-to-end check of the foundational-skills measure against a real Postgres:
 * migration, eligibility SQL, cutting (incl. carry across ticks), scoring with a
 * stub judge, and the analytics read side. Optionally one REAL judge call.
 *
 *   FHS_DB=fhs_scratch npx ts-node -r tsconfig-paths/register scripts/verify-foundational-skills.ts
 *   FHS_REAL_LLM=1 ...   # also send one synthetic window to the pinned model
 *
 * Point FHS_DB at a throwaway copy of the local database — this script writes
 * synthetic sessions and leaves them there. Never run it against a shared DB.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { CreateFoundationalSkills1974600000000 } from 'src/database/migrations/1974600000000-CreateFoundationalSkills';
import { FoundationalSkillsRepository } from 'src/foundational-skills/repository/foundational-skills.repository';
import { FoundationalSkillsService } from 'src/foundational-skills/service/foundational-skills.service';
import {
  FoundationalSkillsJudgeService,
  buildJudgeSystemPrompt,
} from 'src/foundational-skills/service/foundational-skills-judge.service';
import {
  FHS_CUT_LEARNER_CHARS,
  FHS_JUDGE_MODEL,
  FHS_SKILL_KEYS,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { FoundationalSkillsAnalyticsRepository } from 'src/analytics/repository/foundational-skills-analytics.repository';
import { FoundationalSkillsAnalyticsService } from 'src/analytics/service/foundational-skills-analytics.service';
import { renderWindow } from 'src/foundational-skills/util/transcript-window.util';
import {
  parseJudgeReply,
  validateJudgement,
} from 'src/foundational-skills/util/skill-scoring.util';

function env(): Record<string, string> {
  const path = join(__dirname, '../../ally-be/.env');
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')];
      }),
  );
}

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ok  ${message}`);
}

const HELPER_LINE = (i: number) =>
  `I hear you. Can you tell me more about how that has been affecting your sleep and your work this week, and what you have tried so far? (${i})`;
const CLIENT_LINE = (i: number) =>
  `It has been hard. I keep worrying about money and I cannot focus at all. (${i})`;

async function main() {
  const e = env();
  const database = process.env.FHS_DB;
  if (!database || database === e.DB_DATABASE) {
    throw new Error('Set FHS_DB to a throwaway database, not the shared one');
  }
  const ds = new DataSource({
    type: 'postgres',
    host: 'localhost',
    port: Number(e.DB_PORT ?? 5477),
    username: e.DB_USERNAME,
    password: e.DB_PASSWORD,
    database,
    entities: [],
  });
  await ds.initialize();

  console.log('1. migration');
  const qr = ds.createQueryRunner();
  await new CreateFoundationalSkills1974600000000().up(qr);
  await new CreateFoundationalSkills1974600000000().up(qr); // idempotent
  await qr.release();
  await ds.query(`TRUNCATE foundational_skill_cuts CASCADE`);
  await ds.query(
    `DELETE FROM scenario_session_messages WHERE "scenarioSessionId" IN (SELECT id FROM scenario_sessions WHERE "roomId" LIKE 'fhs-verify-%' OR "roomId" LIKE 'preview-fhs-%')`,
  );
  await ds.query(
    `DELETE FROM scenario_sessions WHERE "roomId" LIKE 'fhs-verify-%' OR "roomId" LIKE 'preview-fhs-%'`,
  );

  const [{ id: tenant }] = await ds.query(
    `SELECT id::text FROM tenants WHERE code = 'northwind-behavioral-health'`,
  );
  await ds.query(
    `UPDATE tenants SET "isTestOrganization" = true WHERE code = 'brightpath-counseling'`,
  );
  const [{ id: testTenant }] = await ds.query(
    `SELECT id::text FROM tenants WHERE code = 'brightpath-counseling'`,
  );
  if (!testTenant) throw new Error('no test tenant');
  const [{ id: scenarioId }] = await ds.query(
    `SELECT id FROM scenarios LIMIT 1`,
  );

  let room = 0;
  async function session(opts: {
    user: number;
    helperTurns: number;
    endedMinutesAgo: number;
    tenantId?: string;
    roomPrefix?: string;
    v2v?: boolean;
    status?: string;
  }): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO scenario_sessions
         (tenant_id, "roomId", "scenarioId", "counselorId", status, "eventStatus", "startedAt", "endedAt", metadata)
       VALUES ($1, $2, $3, $4, $5, 'COMPLETED', now() - make_interval(mins => $6 + 10), now() - make_interval(mins => $6), $7)
       RETURNING id`,
      [
        opts.tenantId ?? tenant,
        `${opts.roomPrefix ?? 'fhs-verify-'}${++room}`,
        scenarioId,
        opts.user,
        opts.status ?? 'ENDED',
        opts.endedMinutesAgo,
        opts.v2v ? { v2vTest: true } : {},
      ],
    );
    for (let i = 0; i < opts.helperTurns; i += 1) {
      await ds.query(
        `INSERT INTO scenario_session_messages (tenant_id, "scenarioSessionId", "senderId", "messageType", content, "startSeconds", metadata)
         VALUES ($1, $2, -1, 'TEXT', $3, $4, NULL), ($1, $2, -1, 'TEXT', 'Hmm...', $5, '{"utteranceKind":"filler"}'),
                ($1, $2, $6, 'TEXT', $7, $8, NULL)`,
        [
          opts.tenantId ?? tenant,
          id,
          CLIENT_LINE(i),
          i * 20,
          i * 20 + 1,
          opts.user,
          HELPER_LINE(i),
          i * 20 + 10,
        ],
      );
    }
    // A redelivered duplicate of the last helper turn: must not count twice.
    await ds.query(
      `INSERT INTO scenario_session_messages (tenant_id, "scenarioSessionId", "senderId", "messageType", content, "startSeconds")
       VALUES ($1, $2, $3, 'TEXT', $4, $5)`,
      [
        opts.tenantId ?? tenant,
        id,
        opts.user,
        HELPER_LINE(opts.helperTurns - 1),
        (opts.helperTurns - 1) * 20 + 10,
      ],
    );
    return id;
  }

  const helperChars = HELPER_LINE(0).length; // ~145
  const turnsPerCut = Math.ceil(FHS_CUT_LEARNER_CHARS / helperChars);
  console.log(
    `   (${helperChars} chars per helper turn → ~${turnsPerCut} turns per cut)`,
  );

  const A = 900001;
  const B = 900002;
  // Learner A: 2.5 cuts of eligible speech across three sessions.
  await session({ user: A, helperTurns: turnsPerCut, endedMinutesAgo: 3000 });
  await session({
    user: A,
    helperTurns: Math.ceil(turnsPerCut / 2),
    endedMinutesAgo: 2000,
  });
  await session({ user: A, helperTurns: turnsPerCut, endedMinutesAgo: 1000 });
  // Excluded for A: too recent, AI-vs-AI, test org, preview room, abandoned.
  await session({ user: A, helperTurns: turnsPerCut * 3, endedMinutesAgo: 10 });
  await session({
    user: A,
    helperTurns: turnsPerCut * 3,
    endedMinutesAgo: 900,
    v2v: true,
  });
  await session({
    user: A,
    helperTurns: turnsPerCut * 3,
    endedMinutesAgo: 900,
    tenantId: testTenant,
  });
  await session({
    user: A,
    helperTurns: turnsPerCut * 3,
    endedMinutesAgo: 900,
    roomPrefix: 'preview-fhs-',
  });
  await session({
    user: A,
    helperTurns: turnsPerCut * 3,
    endedMinutesAgo: 900,
    status: 'ABANDONED',
  });
  // Learner B: just short of one cut.
  await session({
    user: B,
    helperTurns: turnsPerCut - 2,
    endedMinutesAgo: 500,
  });

  // Learner C: just under one cut of real speech, but over it if every
  // redelivered duplicate were counted. The readiness query must agree with
  // the cutter and NOT select them.
  const C = 900003;
  const cSession = await session({
    user: C,
    helperTurns: turnsPerCut - 1,
    endedMinutesAgo: 400,
  });
  for (let i = 0; i < 5; i += 1) {
    await ds.query(
      `INSERT INTO scenario_session_messages (tenant_id, "scenarioSessionId", "senderId", "messageType", content, "startSeconds")
       VALUES ($1, $2, $3, 'TEXT', $4, $5)`,
      [
        tenant,
        cSession,
        C,
        `  ${HELPER_LINE(turnsPerCut - 2)}\n`,
        (turnsPerCut - 2) * 20 + 10,
      ],
    );
  }

  const repo = new FoundationalSkillsRepository(ds);
  console.log('2. readiness filter');
  const ready = await repo.findLearnersReadyToCut(FHS_CUT_LEARNER_CHARS, 200);
  assert(ready.includes(A), 'learner A is ready to cut');
  assert(!ready.includes(B), 'learner B (short of 5,000 chars) is not');
  assert(
    !ready.includes(C),
    'learner C (over 5,000 only if redelivered duplicates counted) is not',
  );

  const stubLlm = {
    complete: async (req: { prompt: string }) => {
      const h1 = /\[H1\] HELPER: (.*)/.exec(req.prompt)?.[1] ?? '';
      const c1 = /\[C1\] CLIENT: (.*)/.exec(req.prompt)?.[1] ?? '';
      return {
        text: JSON.stringify({
          skills: [
            {
              skill: 'verbal',
              opportunity: true,
              observed: [
                { code: 'verbal.b1', line: 'H1', quote: h1.slice(20, 60) },
                { code: 'verbal.a1', line: 'H1', quote: 'tell me more' },
              ],
            },
            {
              skill: 'functioning',
              opportunity: true,
              observed: [
                {
                  code: 'functioning.b1',
                  line: 'H1',
                  quote: 'affecting your sleep',
                },
                { code: 'functioning.u2', line: 'C1', quote: c1.slice(0, 20) },
              ],
            },
            { skill: 'confidentiality', opportunity: false, observed: [] },
            {
              skill: 'empathy',
              opportunity: true,
              observed: [
                { code: 'empathy.b1', line: 'H1', quote: 'made up quote' },
              ],
            },
            ...FHS_SKILL_KEYS.filter(
              (k) =>
                ![
                  'verbal',
                  'functioning',
                  'confidentiality',
                  'empathy',
                ].includes(k),
            ).map((k) => ({ skill: k, opportunity: false, observed: [] })),
          ],
        }),
        model: FHS_JUDGE_MODEL,
        usage: { inputTokens: 1000, outputTokens: 200 },
      };
    },
  };
  const service = new FoundationalSkillsService(
    repo,
    new FoundationalSkillsJudgeService(stubLlm as any),
  );

  console.log('3. first tick');
  const first = await service.tick();
  console.log('  ', first);
  const cutsA = await ds.query(
    `SELECT "cutIndex", "learnerChars", "startsMidSession", "endsMidSession", array_length("sessionIds",1) AS sessions
       FROM foundational_skill_cuts WHERE "userId" = $1 ORDER BY "cutIndex"`,
    [A],
  );
  console.table(cutsA);
  assert(
    cutsA.length === 2,
    'A has exactly 2 sealed cuts (2.5 cuts of eligible speech)',
  );
  assert(
    cutsA.every(
      (c: any) =>
        c.learnerChars >= FHS_CUT_LEARNER_CHARS &&
        c.learnerChars < FHS_CUT_LEARNER_CHARS + helperChars,
    ),
    'every cut holds 5,000+ learner chars and ends on the crossing turn (duplicate not double-counted)',
  );
  assert(
    cutsA[1].sessions === 2 || cutsA[1].sessions === 3,
    'cut 2 spans sessions',
  );
  const bCuts = await ds.query(
    `SELECT count(*)::int AS n FROM foundational_skill_cuts WHERE "userId" = $1`,
    [B],
  );
  assert(bCuts[0].n === 0, 'B has no cut');

  const assessments = await ds.query(
    `SELECT status, "compositeScore"::float AS composite, "hasUnhelpfulBehaviour" AS unhelpful, "skillLevels", "droppedTicks"
       FROM foundational_skill_assessments ORDER BY "createdAt"`,
  );
  console.table(
    assessments.map((a: any) => ({
      ...a,
      skillLevels: JSON.stringify(a.skillLevels),
    })),
  );
  assert(
    assessments.length === 2 &&
      assessments.every((a: any) => a.status === 'SCORED'),
    'both cuts scored',
  );
  assert(
    assessments[0].skillLevels.verbal === 2,
    'verbal: one basic + one advanced (missing a basic) → 2',
  );
  assert(
    assessments[0].skillLevels.functioning === 1,
    'functioning: absence behaviour with client cue → 1',
  );
  assert(
    assessments[0].skillLevels.empathy === 2,
    'empathy: fabricated quote dropped → 2',
  );
  assert(
    !('confidentiality' in assessments[0].skillLevels),
    'no-opportunity skill absent from levels',
  );
  assert(assessments[0].droppedTicks === 1, 'one tick dropped');

  console.log('4. second tick is a no-op');
  const second = await service.tick();
  assert(
    second.cutsSealed === 0 && second.cutsScored === 0,
    'nothing new to cut or score',
  );

  console.log('5. new practice continues from the carried tail');
  await session({ user: A, helperTurns: turnsPerCut, endedMinutesAgo: 120 });
  const third = await service.tick();
  assert(third.cutsSealed === 1, 'one more cut sealed');
  const [cut3] = await ds.query(
    `SELECT "cutIndex", "startsMidSession", "sessionIds" FROM foundational_skill_cuts WHERE "userId" = $1 AND "cutIndex" = 3`,
    [A],
  );
  assert(
    cut3?.startsMidSession === true,
    'cut 3 starts mid-session (the carried tail)',
  );

  console.log('6. analytics read side');
  const analytics = new FoundationalSkillsAnalyticsService(
    new FoundationalSkillsAnalyticsRepository(ds),
  );
  const res = await analytics.getFoundationalSkills();
  console.log(
    JSON.stringify({ cuts: res.cuts, coverage: res.coverage }, null, 2),
  );
  assert(
    res.coverage.cutsSealed === 3 && res.coverage.cutsScored === 3,
    'coverage counts',
  );
  assert(
    res.cuts.length === 0,
    'axis empty: no cut reached by 5 learners (privacy floor)',
  );
  const raw = await new FoundationalSkillsAnalyticsRepository(ds).getCutRows(
    'fhs-text-v1',
  );
  assert(raw.length === 3 && raw[0].learners === 1, 'raw cut rows computed');
  const skillRows = await new FoundationalSkillsAnalyticsRepository(
    ds,
  ).getSkillRows('fhs-text-v1');
  assert(
    skillRows.some((r) => r.skill === 'verbal'),
    'per-skill rows keyed by skill',
  );

  if (process.env.FHS_REAL_LLM) {
    console.log('7. one REAL judge call');
    const turns = await repo.loadTurns([cut3.sessionIds[0]]);
    const sessions = new Map(
      [...turns].map(([id, t]) => [
        id,
        { sessionId: id, endedAt: new Date(), tenantId: null, turns: t },
      ]),
    );
    const firstId = cut3.sessionIds[0];
    const t = turns.get(firstId)!;
    const rendered = renderWindow(
      sessions,
      {
        sessionIds: [firstId],
        startSessionId: firstId,
        startMessageId: t[0].messageId,
        endSessionId: firstId,
        endMessageId: t[Math.min(9, t.length - 1)].messageId,
      },
      2000,
    );
    const started = Date.now();
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${e.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: FHS_JUDGE_MODEL,
        response_format: { type: 'json_object' },
        max_completion_tokens: 16000,
        messages: [
          { role: 'system', content: buildJudgeSystemPrompt() },
          { role: 'user', content: rendered.text },
        ],
      }),
    });
    const body: any = await response.json();
    const text = body?.choices?.[0]?.message?.content ?? '';
    const parsed = parseJudgeReply(text);
    assert(
      parsed && Array.isArray(parsed.skills),
      `real reply parses (${Date.now() - started} ms, usage ${JSON.stringify(body?.usage)})`,
    );
    const { verdicts, stats } = validateJudgement(
      parsed!.skills,
      rendered.lines,
    );
    console.table(
      verdicts.map((v) => ({
        skill: v.skill,
        level: v.level,
        observed: v.observed.join(' '),
      })),
    );
    console.log('   stats', stats);
    assert(stats.missingSkills === 0, 'real judge returned all 14 skills');
  }

  await ds.destroy();
  console.log('\nALL CHECKS PASSED');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
