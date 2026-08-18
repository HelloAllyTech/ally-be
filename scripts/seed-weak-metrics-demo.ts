/** Seeds a small but realistic judge dataset so the UI has charts to render. */
import 'reflect-metadata';
import { DataSource } from 'typeorm';

async function main() {
  const ds = new DataSource({
    type: 'postgres', host: 'localhost', port: 5477,
    username: 'postgres', password: process.env.DB_PASSWORD ?? 'postgres',
    database: 'ally_local',
  });
  await ds.initialize();

  const sessions: Array<{ id: string; sid: string }> = await ds.query(
    `SELECT id, id AS sid FROM scenario_sessions
      WHERE "roomId" NOT LIKE 'preview-%' ORDER BY "createdAt" DESC LIMIT 12`,
  );
  if (!sessions.length) { console.log('no sessions to seed against'); process.exit(1); }

  await ds.query(`DELETE FROM turn_drift_judgment WHERE "judgePromptVersion"='v2'`);
  await ds.query(`DELETE FROM language_error_annotations WHERE "judgePromptVersion"='v2'`);
  await ds.query(`DELETE FROM language_judgment_sessions WHERE "judgePromptVersion"='v2'`);
  await ds.query(`DELETE FROM feedback_claim_judgment`);

  const months = ['2026-05-15','2026-06-15','2026-07-15','2026-08-10'];
  let n = 0;
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const at = months[i % months.length];
    const model = i % 3 === 0 ? 'gpt-4.1-mini' : 'gpt-4o-mini';
    const lang = i % 4 === 0 ? 'ta-IN' : 'en-IN';
    const turns = 8;
    for (let t = 0; t < turns; t++) {
      const rep = i % 3 === 0 && t >= 2 && t <= 4;
      const inv = t === 5 && i % 4 === 0;
      await ds.query(
        `INSERT INTO turn_drift_judgment
          (id,"scenarioSessionId","turnIndex","coherence","topicLabel","aiReplyFailureMode",
           "inCharacter",language,"scenarioId","llmModel","occurredAt","judgeModel",
           "judgePromptVersion",tenant_id,"createdAt","updatedAt",
           "roleInversion","offeredSolution","solutionsOffered",
           "introducedNewInformation","stuckIsAppropriate","resistanceBriefed")
         VALUES (gen_random_uuid(),$1,$2,'fully_coherent','on_topic',$3,true,$4,
                 (SELECT "scenarioId" FROM scenario_sessions WHERE id=$1),$5,$6,
                 'gemini-2.5-pro','v2','ally',$6,$6,$7,$8,$9,$10,$11,true)`,
        [s.id, t, rep ? 'repetition' : (inv ? 'role_slip' : 'none'), lang, model, at,
         inv, t === 1, t === 1 ? 3 : 0, !rep, rep ? (t === 2) : null],
      );
      n++;
    }
    await ds.query(
      `INSERT INTO language_judgment_sessions
        (id,"scenarioSessionId","turnsJudged","turnsGarbled",language,"scenarioId","llmModel",
         "occurredAt","judgeModel","judgePromptVersion",tenant_id,"createdAt","updatedAt")
       VALUES (gen_random_uuid(),$1,$2,1,$3,
               (SELECT "scenarioId" FROM scenario_sessions WHERE id=$1),$4,$5,
               'gemini-2.5-pro','v2','ally',$5,$5)`,
      [s.id, turns, lang, model, at],
    );
    for (const [dim, cat, sev] of [
      ['register','too_formal_diglossia','major'],
      ['colloquialness','literal_translation_stilt','minor'],
      ['dialect_lexicon','nonexistent_word','critical'],
      ['understanding','ignored_context','major'],
    ] as const) {
      if (dim === 'dialect_lexicon' && i % 4 !== 0) continue;
      await ds.query(
        `INSERT INTO language_error_annotations
          (id,"scenarioSessionId","sessionJudgmentId","turnIndex",layer,dimension,category,
           severity,"conditionedOut","isolationBasis",language,"scenarioId","llmModel",
           "occurredAt","judgeModel","judgePromptVersion",tenant_id,"createdAt","updatedAt")
         VALUES (gen_random_uuid(),$1,gen_random_uuid(),2,'appropriateness',$2,$3,$4,false,
                 'persona_specified',$5,
                 (SELECT "scenarioId" FROM scenario_sessions WHERE id=$1),$6,$7,
                 'gemini-2.5-pro','v2','ally',$7,$7)`,
        [s.id, dim, cat, sev, lang, model, at],
      );
    }
    for (const [kind, idx, verdict] of [
      ['positive', 0, 'supported'],
      ['improvement', 0, i % 3 === 0 ? 'contradicted' : 'supported'],
      ['improvement', 1, 'unsupported'],
    ] as const) {
      await ds.query(
        `INSERT INTO feedback_claim_judgment
          (id,"scenarioSessionId","claimKind","claimIndex",verdict,"quotesTranscript",
           "claimText",language,"scenarioId","llmModel","occurredAt","judgeModel",
           "judgePromptVersion",tenant_id,"createdAt","updatedAt")
         VALUES (gen_random_uuid(),$1,$2,$3,$4,true,'seeded claim',$5,
                 (SELECT "scenarioId" FROM scenario_sessions WHERE id=$1),$6,$7,
                 'gemini-2.5-pro','v1','ally',$7,$7)`,
        [s.id, kind, idx, verdict, lang, model, at],
      );
    }
  }
  console.log(`seeded ${n} drift turns across ${sessions.length} sessions`);
  await ds.destroy();
}
main().catch(e => { console.error(e); process.exit(1); });
