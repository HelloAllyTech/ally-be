import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRatingMetadata1777500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "rating_metadata" (
         "rating" integer PRIMARY KEY,
         "ratingText" character varying NOT NULL,
         "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
         "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
       )`,
    );

    await queryRunner.query(
      `INSERT INTO "rating_metadata" ("rating", "ratingText", "tags") VALUES
         (1, 'Needs major improvements.', '["poor","unclear","distorted","noisy","inconsistent"]'::jsonb),
         (2, 'Could be better.',          '["average","weak","rough","patchy","dull"]'::jsonb),
         (3, 'Decent, but room to grow.', '["decent","acceptable","balanced","okay","fair"]'::jsonb),
         (4, 'Nice experience!',          '["good","clear","engaging","smooth","solid"]'::jsonb),
         (5, 'Excellent and highly effective!', '["excellent","crisp","immersive","flawless","outstanding"]'::jsonb)
       ON CONFLICT ("rating") DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "rating_metadata"`);
  }
}
