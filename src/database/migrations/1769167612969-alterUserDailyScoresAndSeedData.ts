import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterUserDailyScoresAndSeedData1769167612969 implements MigrationInterface {
  name = 'AlterUserDailyScoresAndSeedData1769167612969';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_daily_scores" DROP COLUMN "minutesPlayed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_daily_scores" ADD "minutesPlayed" numeric(10,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_daily_scores" DROP COLUMN "totalScore"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_daily_scores" ADD "totalScore" numeric(10,2) NOT NULL DEFAULT '0'`,
    );

    await queryRunner.query(`
      WITH minutes_played AS (
        SELECT 
          ss."counselorId" AS user_id, 
          ss."tenant_id",
          DATE(ss."endedAt") AS date,
          SUM(EXTRACT(EPOCH FROM (ss."endedAt" - ss."startedAt")) / 60.0) AS minutes
        FROM scenario_sessions ss
        WHERE ss."startedAt" IS NOT NULL AND ss."endedAt" IS NOT NULL
        GROUP BY ss."counselorId", ss."tenant_id", DATE(ss."endedAt")
      ),
      
      review_reactions_agg AS (
        SELECT 
          rr."createdBy" AS user_id, 
          rr."tenant_id",
          DATE(rr."createdAt") AS date,
          COUNT(*) * 0.25 AS score
        FROM review_reactions rr
        JOIN reviews r ON rr."reviewId" = r.id
        WHERE rr."createdBy" != r."createdBy" AND rr."deletedAt" IS NULL
        GROUP BY rr."createdBy", rr."tenant_id", DATE(rr."createdAt")
      ),
      
      comment_reactions_agg AS (
        SELECT 
          rcr."createdBy" AS user_id, 
          rcr."tenant_id",
          DATE(rcr."createdAt") AS date,
          COUNT(*) * 0.25 AS score
        FROM review_comment_reactions rcr
        JOIN review_comments rc ON rcr."reviewCommentId" = rc.id
        JOIN review_threads rt ON rc."reviewThreadId" = rt.id
        JOIN reviews r ON rt."reviewId" = r.id
        WHERE rcr."createdBy" != r."createdBy" AND rcr."deletedAt" IS NULL
        GROUP BY rcr."createdBy", rcr."tenant_id", DATE(rcr."createdAt")
      ),
      
      comments_agg AS (
        SELECT 
          rc."createdBy" AS user_id, 
          rc."tenant_id",
          DATE(rc."createdAt") AS date,
          COUNT(*) * 0.5 AS score
        FROM review_comments rc
        JOIN review_threads rt ON rc."reviewThreadId" = rt.id
        JOIN reviews r ON rt."reviewId" = r.id
        WHERE rc."createdBy" != r."createdBy" AND rc."deletedAt" IS NULL
        GROUP BY rc."createdBy", rc."tenant_id", DATE(rc."createdAt")
      ),
      
      -- Combine all user/tenant/date combinations
      all_keys AS (
        SELECT user_id, tenant_id, date FROM minutes_played
        UNION
        SELECT user_id, tenant_id, date FROM review_reactions_agg
        UNION
        SELECT user_id, tenant_id, date FROM comment_reactions_agg
        UNION
        SELECT user_id, tenant_id, date FROM comments_agg
      ),
      
      combined AS (
        SELECT 
          ak.user_id,
          ak.tenant_id,
          ak.date,
          COALESCE(mp.minutes, 0) AS minutes_played,
          COALESCE(rra.score, 0) AS review_reaction_score,
          COALESCE(cra.score, 0) AS comment_reaction_score,
          COALESCE(ca.score, 0) AS comment_score,
          -- Calculate total score: minutes + reactions + comments + active day bonus
          COALESCE(mp.minutes, 0) + 
          COALESCE(rra.score, 0) + 
          COALESCE(cra.score, 0) + 
          COALESCE(ca.score, 0) +
          CASE WHEN COALESCE(mp.minutes, 0) >= 1 THEN 1 ELSE 0 END AS total_score
        FROM all_keys ak
        LEFT JOIN minutes_played mp ON ak.user_id = mp.user_id AND ak.tenant_id = mp.tenant_id AND ak.date = mp.date
        LEFT JOIN review_reactions_agg rra ON ak.user_id = rra.user_id AND ak.tenant_id = rra.tenant_id AND ak.date = rra.date
        LEFT JOIN comment_reactions_agg cra ON ak.user_id = cra.user_id AND ak.tenant_id = cra.tenant_id AND ak.date = cra.date
        LEFT JOIN comments_agg ca ON ak.user_id = ca.user_id AND ak.tenant_id = ca.tenant_id AND ak.date = ca.date
      )
      
      INSERT INTO user_daily_scores ("userId", "tenant_id", "date", "minutesPlayed", "totalScore")
      SELECT 
        c.user_id,
        c.tenant_id,
        c.date,
        c.minutes_played,
        c.total_score
      FROM combined c
      ON CONFLICT ("userId", "tenant_id", "date") 
      DO UPDATE SET
        "minutesPlayed" = user_daily_scores."minutesPlayed" + EXCLUDED."minutesPlayed",
        "totalScore" = user_daily_scores."totalScore" + EXCLUDED."totalScore"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`TRUNCATE TABLE user_daily_scores`);

    await queryRunner.query(
      `ALTER TABLE "user_daily_scores" DROP COLUMN "totalScore"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_daily_scores" ADD "totalScore" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_daily_scores" DROP COLUMN "minutesPlayed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_daily_scores" ADD "minutesPlayed" integer NOT NULL DEFAULT '0'`,
    );
  }
}
