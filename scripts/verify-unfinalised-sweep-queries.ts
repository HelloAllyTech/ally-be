/**
 * Exercises the two raw/QueryBuilder reads behind the unfinalised-session
 * sweep against the REAL local Postgres, where a unit test's mocked repository
 * cannot: `findEndedSessionsMissingFinalisation` (QueryBuilder, tenant-spanning)
 * and `sumDetectionScores` (raw SQL, with the uuid/varchar cast the behaviour
 * join needs). Read-only — it writes nothing.
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';
import { ScenarioSessionDetails } from 'src/learn/entity/scenario-session-details.entity';
import { ScenarioSessionRepository } from 'src/learn/repository/scenario-session.repository';

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    entities: [ScenarioSessions, ScenarioSessionDetails],
    synchronize: false,
  });
  await dataSource.initialize();

  const repo = new ScenarioSessionRepository(dataSource);

  const now = Date.now();
  const found = await repo.findEndedSessionsMissingFinalisation({
    endedAfter: new Date(now - 365 * 24 * 60 * 60 * 1000),
    endedBefore: new Date(now - 15 * 60 * 1000),
    limit: 200,
  });
  console.log(`findEndedSessionsMissingFinalisation -> ${found.length} row(s)`);
  for (const session of found.slice(0, 5)) {
    console.log(
      `  ${session.id} room=${session.roomId} endedAt=${session.endedAt?.toISOString()} ` +
        `score=${session.score ?? 'NULL'} track=${session.trackItemProgressId ?? '-'}`,
    );
  }

  const sums = await repo.sumDetectionScores(found.map((s) => s.id));
  console.log(`sumDetectionScores -> ${sums.size} session(s) with detections`);
  for (const [id, total] of sums) console.log(`  ${id} = ${total}`);

  // Prove the raw SQL over sessions that DO have detections, so the query is
  // exercised with real rows rather than only on an empty id set.
  const withDetections: Array<{ id: string }> = await dataSource.query(
    `SELECT DISTINCT e."scenarioSessionId" AS id
       FROM scenario_session_events e
      WHERE e.score IS NOT NULL
      LIMIT 10`,
  );
  const controlSums = await repo.sumDetectionScores(
    withDetections.map((r) => r.id),
  );
  console.log(
    `control set: ${withDetections.length} session(s) with scored events -> ` +
      `${controlSums.size} summed`,
  );
  for (const [id, total] of controlSums) console.log(`  ${id} = ${total}`);

  console.log(
    `sumDetectionScores([]) -> ${(await repo.sumDetectionScores([])).size}`,
  );

  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
