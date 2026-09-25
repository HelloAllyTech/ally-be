import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Move every Sarvam TTS voice from `bulbul:v2` to `bulbul:v3`.
 *
 * Sarvam retired v2: synthesis now fails with 400 "Model 'bulbul:v2' has been
 * deprecated. Please use 'bulbul:v3' instead", so a Sarvam-voiced session
 * loses all agent audio. v3 shares none of v2's speakers (Sarvam rejects
 * `abhilash` etc. on v3), so each row also gets a v3 speaker. The mapping is
 * gender-matched and fixed, so two characters that sounded different on v2
 * still sound different on v3; every target was checked against Sarvam's API
 * in hi/ta/mr/kn/bn/en before this was written (2026-09-25).
 *
 * Only `model` and `speaker` change — name, gender, age and everything else on
 * the row are untouched. Requires ally-ai-learn ≥ v1.46.0: before that the
 * worker never passed the configured model to the plugin at all.
 *
 * `down()` restores v2 rows, which Sarvam no longer serves; it exists so the
 * migration history stays reversible, not as a working rollback.
 */
const SPEAKER_V2_TO_V3: Record<string, string> = {
  abhilash: 'aditya',
  karun: 'rahul',
  hitesh: 'rohan',
  anushka: 'priya',
  manisha: 'neha',
  vidya: 'kavya',
  arya: 'ishita',
};

export class SarvamTtsBulbulV31973600000000 implements MigrationInterface {
  name = 'SarvamTtsBulbulV31973600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [v2, v3] of Object.entries(SPEAKER_V2_TO_V3)) {
      await queryRunner.query(
        `UPDATE "scenario_voices"
            SET "config" = "config" || jsonb_build_object('model', 'bulbul:v3', 'speaker', $2::text),
                "updatedAt" = now()
          WHERE upper("provider") = 'SARVAM'
            AND "config"->>'model' = 'bulbul:v2'
            AND lower("config"->>'speaker') = $1`,
        [v2, v3],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [v2, v3] of Object.entries(SPEAKER_V2_TO_V3)) {
      await queryRunner.query(
        `UPDATE "scenario_voices"
            SET "config" = "config" || jsonb_build_object('model', 'bulbul:v2', 'speaker', $1::text),
                "updatedAt" = now()
          WHERE upper("provider") = 'SARVAM'
            AND "config"->>'model' = 'bulbul:v3'
            AND lower("config"->>'speaker') = $2`,
        [v2, v3],
      );
    }
  }
}
