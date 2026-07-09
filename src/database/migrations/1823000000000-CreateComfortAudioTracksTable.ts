import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateComfortAudioTracksTable1823000000000
  implements MigrationInterface
{
  name = 'CreateComfortAudioTracksTable1823000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "comfort_audio_tracks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" text NOT NULL,
        "audio_url" text NOT NULL,
        "content_type" character varying(100),
        "size_bytes" bigint,
        "created_by" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_comfort_audio_tracks_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_comfort_audio_tracks_created_at" ON "comfort_audio_tracks" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_comfort_audio_tracks_name" ON "comfort_audio_tracks" ("name")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_comfort_audio_tracks_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_comfort_audio_tracks_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "comfort_audio_tracks"`);
  }
}
