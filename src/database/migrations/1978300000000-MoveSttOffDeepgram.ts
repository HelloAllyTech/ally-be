import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves every live-session STT default off Deepgram and onto Google chirp_2.
 *
 * Deepgram's credits ran out on 2026-10-18: the LiveKit plugin now gets a 402
 * on the websocket handshake, and the agent closes the session with
 * `stt_error` before the learner has said a word. English (`en-IN`,
 * `en-GLOBAL`, and anything an admin pointed at the "Deepgram — nova-3"
 * registry row) was the only traffic still on it; every Indic language has run
 * on Google chirp_2 in asia-southeast1 since
 * `1768392581395-AddLlmAndSttProviderConfigToLanguages`, and the V2V tester
 * transcribes English with exactly that config, so it is the proven target.
 *
 * Updates BOTH rungs of the resolution chain so they cannot disagree:
 *   - the `stt_configs` rows the languages and simulations point at (re-pointed
 *     in place, so every `sttConfigId` and per-simulation pick keeps working), and
 *   - the legacy `languages.sttProviderConfig` jsonb that serves as the fallback.
 *
 * Keyed on the old provider and idempotent — re-running, or running where the
 * value was already changed by hand, is a no-op. `down()` restores Deepgram
 * nova-3 on rows this migration produced (identified by the renamed label and
 * by the chirp_2 config on languages that were English).
 *
 * NOTE: a fleet-wide correction, so it ships as a migration rather than an
 * edit in the admin UI — the admin picker no longer offers Deepgram at all.
 */
const OLD_PROVIDER = 'deepgram';
const NEW_PROVIDER = 'google';
const NEW_CONFIG = { model: 'chirp_2', location: 'asia-southeast1' };
const OLD_CONFIG = { model: 'nova-3' };
const OLD_NAME = 'Deepgram — nova-3';
const NEW_NAME = 'Google — chirp_2 (was Deepgram)';

export class MoveSttOffDeepgram1978300000000 implements MigrationInterface {
  name = 'MoveSttOffDeepgram1978300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Registry rows. The whole config is replaced rather than patched: a
    // Deepgram config carries nothing Google understands, and leaving `model:
    // nova-3` behind would make Google reject the stream.
    await queryRunner.query(
      `
      UPDATE "stt_configs"
         SET "provider" = $1,
             "config" = $2::jsonb,
             "name" = CASE
               WHEN "name" = $3 AND NOT EXISTS (
                 SELECT 1 FROM "stt_configs" other WHERE other."name" = $4
               ) THEN $4
               ELSE "name"
             END
       WHERE lower("provider") = $5
      `,
      [
        NEW_PROVIDER,
        JSON.stringify(NEW_CONFIG),
        OLD_NAME,
        NEW_NAME,
        OLD_PROVIDER,
      ],
    );

    // The legacy jsonb rung on languages, still the fallback when a language's
    // sttConfigId is cleared.
    await queryRunner.query(
      `
      UPDATE "languages"
         SET "sttProviderConfig" = jsonb_build_object(
               'provider', $1::text,
               'config', $2::jsonb
             )
       WHERE lower("sttProviderConfig" ->> 'provider') = $3
      `,
      [NEW_PROVIDER, JSON.stringify(NEW_CONFIG), OLD_PROVIDER],
    );

    await this.report(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      UPDATE "stt_configs"
         SET "provider" = $1,
             "config" = $2::jsonb,
             "name" = CASE WHEN "name" = $3 THEN $4 ELSE "name" END
       WHERE "name" = $3
      `,
      [OLD_PROVIDER, JSON.stringify(OLD_CONFIG), NEW_NAME, OLD_NAME],
    );

    // Only the English languages were ever on Deepgram; the Indic ones were
    // on chirp_2 already and must not be touched.
    await queryRunner.query(
      `
      UPDATE "languages"
         SET "sttProviderConfig" = jsonb_build_object(
               'provider', $1::text,
               'config', $2::jsonb
             )
       WHERE "value" LIKE 'en%'
         AND lower("sttProviderConfig" ->> 'provider') = $3
      `,
      [OLD_PROVIDER, JSON.stringify(OLD_CONFIG), NEW_PROVIDER],
    );
  }

  /**
   * Log the outcome. A migration that matched nothing is indistinguishable from
   * one that worked unless it says so, and this one changes which engine hears
   * every English session.
   */
  private async report(queryRunner: QueryRunner): Promise<void> {
    try {
      const left: Array<{ n: string }> = await queryRunner.query(
        `SELECT count(*)::text AS n FROM "stt_configs" WHERE lower("provider") = $1`,
        [OLD_PROVIDER],
      );
      const languages: Array<{ value: string }> = await queryRunner.query(
        `
        SELECT l."value"
          FROM "languages" l
          LEFT JOIN "stt_configs" s ON s."id" = l."sttConfigId"
         WHERE lower(COALESCE(s."provider", l."sttProviderConfig" ->> 'provider')) = $1
         ORDER BY l."value"
        `,
        [OLD_PROVIDER],
      );
      console.log(
        `[MoveSttOffDeepgram] ${left[0]?.n ?? '?'} stt_configs row(s) still on ${OLD_PROVIDER}; ` +
          `languages still resolving to it: ${languages.map((row) => row.value).join(', ') || '(none)'}`,
      );
    } catch (error) {
      console.log(
        `[MoveSttOffDeepgram] report failed (the swap itself is unaffected): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
