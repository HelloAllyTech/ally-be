/**
 * Live reproduction/confirmation for the "minimum score 0 locks the learner
 * out of the rest of the Track" bug. Runs the REAL TrackProgressService
 * against the REAL local Postgres — real SQL, real transaction, real
 * unlock-the-next-item walk. Nothing about the score gate is mocked.
 *
 * It stands up its own DataSource over the track tables rather than booting
 * AppModule, so it does not depend on the dev container's state.
 *
 * It builds a throwaway Track (one section, two ROLEPLAY items), enrolls a
 * real user with simulation 1 UNLOCKED and simulation 2 LOCKED, ends
 * simulation 1's roleplay, and reads simulation 2's status back out of
 * Postgres. Everything it creates is hard-deleted again in `finally`.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/repro-track-min-score-zero.ts
 *
 * Note: NOT `ts-node -T` — the track entities declare their enum columns as
 * `@Column({ enum: ... })` with no explicit `type`, so TypeORM reads the
 * column type out of `emitDecoratorMetadata`, which transpile-only drops.
 */
import 'dotenv/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackEnrollment } from 'src/track/entity/track-enrollment.entity';
import { TrackItemProgress } from 'src/track/entity/track-item-progress.entity';
import { TrackItem } from 'src/track/entity/track-item.entity';
import { TrackSection } from 'src/track/entity/track-section.entity';
import { Track } from 'src/track/entity/track.entity';
import { TrackItemProgressRepository } from 'src/track/repository/track-item-progress.repository';
import { TrackItemRepository } from 'src/track/repository/track-item.repository';
import { TrackProgressService } from 'src/track/service/track-progress.service';

type Case = {
  label: string;
  minScore?: number;
  score?: number;
  expected: SessionItemStatus;
};

const CASES: Case[] = [
  {
    label: 'minScore 0, learner scored -25 (the reported bug)',
    minScore: 0,
    score: -25,
    expected: SessionItemStatus.UNLOCKED,
  },
  {
    label: 'minScore 0, learner scored 0',
    minScore: 0,
    score: 0,
    expected: SessionItemStatus.UNLOCKED,
  },
  {
    label: 'minScore 0, no score produced',
    minScore: 0,
    score: undefined,
    expected: SessionItemStatus.UNLOCKED,
  },
  {
    label: 'no minScore configured, learner scored -25',
    minScore: undefined,
    score: -25,
    expected: SessionItemStatus.UNLOCKED,
  },
  {
    label: 'minScore 70, learner scored 50 (must still be enforced)',
    minScore: 70,
    score: 50,
    expected: SessionItemStatus.LOCKED,
  },
  {
    label: 'minScore 70, learner scored 70 (must unlock)',
    minScore: 70,
    score: 70,
    expected: SessionItemStatus.UNLOCKED,
  },
];

const run = async () => {
  const dataSource = new DataSource({
    type: 'postgres',
    // Straight from ally-be/.env via dotenv — no credentials in this file.
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    entities: [
      Track,
      TrackSection,
      TrackItem,
      TrackEnrollment,
      TrackItemProgress,
    ],
    synchronize: false,
    logging: false,
  });
  await dataSource.initialize();

  // The real service, wired to real repositories over the real database. Only
  // the config (no global minimum duration) and the event bus are local.
  const progressService = new TrackProgressService(
    dataSource,
    {
      simulationPath: { simulationPathItemMinDurationForCompletion: 0 },
    } as any,
    new EventEmitter2(),
    new TrackItemProgressRepository(dataSource),
    new TrackItemRepository(dataSource),
  );

  // Any real user/tenant will do — we only need the FK values to be plausible.
  const [{ id: userId, tenantId }] = await dataSource.query(
    `SELECT id, tenant_id AS "tenantId" FROM users WHERE tenant_id IS NOT NULL ORDER BY id LIMIT 1`,
  );
  console.log(`Using userId=${userId} tenantId=${tenantId}\n`);

  const trackRepo = dataSource.getRepository(Track);
  const sectionRepo = dataSource.getRepository(TrackSection);
  const itemRepo = dataSource.getRepository(TrackItem);
  const enrollmentRepo = dataSource.getRepository(TrackEnrollment);
  const progressRepo = dataSource.getRepository(TrackItemProgress);

  const results: Array<{ label: string; got: string; pass: boolean }> = [];

  for (const testCase of CASES) {
    const track = await trackRepo.save(
      trackRepo.create({
        title: `[repro] minScore ${String(testCase.minScore)}`,
        totalItems: 2,
      }),
    );
    try {
      const section = await sectionRepo.save(
        sectionRepo.create({ trackId: track.id, title: 'Section 1', order: 1 }),
      );
      const first = await itemRepo.save(
        itemRepo.create({
          trackId: track.id,
          trackSectionId: section.id,
          type: 'ROLEPLAY' as any,
          order: 1,
          title: 'Simulation 1',
          // Exactly what the builder persists when the author leaves
          // "Minimum score" alone.
          completionCriteria:
            testCase.minScore === undefined
              ? {}
              : { minScore: testCase.minScore },
        }),
      );
      const second = await itemRepo.save(
        itemRepo.create({
          trackId: track.id,
          trackSectionId: section.id,
          type: 'ROLEPLAY' as any,
          order: 2,
          title: 'Simulation 2',
          completionCriteria: {},
        }),
      );
      const enrollment = await enrollmentRepo.save(
        enrollmentRepo.create({
          trackId: track.id,
          userId,
          tenantId,
          startedAt: new Date(),
        }),
      );
      const firstProgress = await progressRepo.save(
        progressRepo.create({
          trackEnrollmentId: enrollment.id,
          trackItemId: first.id,
          userId,
          status: SessionItemStatus.UNLOCKED,
        }),
      );
      const secondProgress = await progressRepo.save(
        progressRepo.create({
          trackEnrollmentId: enrollment.id,
          trackItemId: second.id,
          userId,
          status: SessionItemStatus.LOCKED,
        }),
      );

      // The learner finishes a 5-minute roleplay — well past any duration gate.
      await progressService.handleRoleplayEnd({
        trackItemProgressId: firstProgress.id,
        score: testCase.score,
        callDuration: 300_000,
      });

      const after = await progressRepo.findOne({
        where: { id: secondProgress.id },
      });
      const got = after!.status;
      const pass = got === testCase.expected;
      results.push({ label: testCase.label, got, pass });
      console.log(
        `${pass ? 'PASS' : 'FAIL'}  ${testCase.label}\n` +
          `      simulation 2 is ${got} (expected ${testCase.expected})`,
      );
    } finally {
      // Hard-delete everything; these entities are soft-delete by default.
      await dataSource.query(
        `DELETE FROM track_item_progress WHERE "trackEnrollmentId" IN (SELECT id FROM track_enrollments WHERE "trackId" = $1)`,
        [track.id],
      );
      await dataSource.query(
        `DELETE FROM track_enrollments WHERE "trackId" = $1`,
        [track.id],
      );
      await dataSource.query(`DELETE FROM track_items WHERE "trackId" = $1`, [
        track.id,
      ]);
      await dataSource.query(
        `DELETE FROM track_sections WHERE "trackId" = $1`,
        [track.id],
      );
      await dataSource.query(`DELETE FROM tracks WHERE id = $1`, [track.id]);
    }
  }

  await dataSource.destroy();

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} scenarios behaved as expected.`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
