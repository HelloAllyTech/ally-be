import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `learn_room_metadata` — full room-metadata envelope per LiveKit room, stored
 * at session/preview start and fetched by the voice agent over the api-key
 * webhook (GET /v1/learn/webhook/room-metadata/:roomName).
 *
 * Backing store for the slim-dispatch design: LiveKit room + dispatch metadata
 * carry only a fetch pointer, so the ~180KB scenario envelope no longer rides
 * inside agent availability requests (which blew LiveKit's 3s dispatch window
 * over the high-RTT server↔worker link and stranded sessions on "agent will
 * join in a few seconds").
 *
 * Rows are short-lived working data (rooms live minutes to hours); the store
 * service sweeps rows older than ROOM_METADATA_STALE_HOURS on each insert,
 * using the createdAt index.
 */
export class CreateLearnRoomMetadata1865000000000 implements MigrationInterface {
  name = 'CreateLearnRoomMetadata1865000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "learn_room_metadata" (
        "roomName" character varying(255) NOT NULL,
        "payload" jsonb NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_learn_room_metadata" PRIMARY KEY ("roomName")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_learn_room_metadata_created_at"
        ON "learn_room_metadata" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_learn_room_metadata_created_at"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "learn_room_metadata"`);
  }
}
