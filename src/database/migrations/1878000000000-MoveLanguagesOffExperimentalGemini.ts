import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves every language off `gemini-2.0-flash-exp` and onto `gemini-2.5-flash`.
 *
 * Eight of thirteen languages — Bengali, Telugu, Marathi, Tamil, Gujarati,
 * Kannada, Punjabi and Odia, i.e. every Indic language except Malayalam — were
 * running an *experimental* Google endpoint set back in
 * `1768392581395-AddLlmAndSttProviderConfigToLanguages`. Google retires `-exp`
 * models on short notice and without a GA deprecation window, so this was a
 * live outage waiting to happen.
 *
 * It was invisible because `gemini-2.0-flash-exp` appears nowhere in
 * `LLM_MODEL_REGISTRY`: the list the pickers offered and the value the runtime
 * actually used had drifted apart, and nothing compared them. Surfacing that is
 * precisely why the model catalog moved into the database.
 *
 * Updates BOTH rungs of the resolution chain so they cannot disagree:
 *   - the `llm_configs` row the languages point at (`llmConfigId`), and
 *   - the legacy `languages.llmProviderConfig` jsonb that serves as the fallback.
 *
 * Keyed on the old model string and idempotent — re-running, or running where
 * the value was already changed by hand, is a no-op. `down()` restores the
 * experimental model.
 *
 * NOTE: this is a fleet-wide correction, so it ships as a migration rather than
 * an edit in the admin UI — a UI change would only apply to whichever
 * environment it was made in, and dev and prod would drift. Ongoing model tuning
 * belongs in the Model Catalog; corrections that must hold everywhere belong
 * here.
 */
const OLD_MODEL = 'gemini-2.0-flash-exp';
const NEW_MODEL = 'gemini-2.5-flash';

export class MoveLanguagesOffExperimentalGemini1878000000000 implements MigrationInterface {
  name = 'MoveLanguagesOffExperimentalGemini1878000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.swapModel(queryRunner, OLD_MODEL, NEW_MODEL);
    await this.report(queryRunner, NEW_MODEL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.swapModel(queryRunner, NEW_MODEL, OLD_MODEL);
  }

  private async swapModel(
    queryRunner: QueryRunner,
    from: string,
    to: string,
  ): Promise<void> {
    // The named config the languages point at. Renamed in step with the model
    // so the label does not lie about what it runs. Guarded against the unique
    // name index in case a row for the target already exists.
    await queryRunner.query(
      `
      UPDATE "llm_configs"
         SET "config" = jsonb_set("config", '{model}', to_jsonb($2::text)),
             "name" = CASE
               WHEN "name" = $3 AND NOT EXISTS (
                 SELECT 1 FROM "llm_configs" other WHERE other."name" = $4
               ) THEN $4
               ELSE "name"
             END
       WHERE "config" ->> 'model' = $1
      `,
      [from, to, `Google — ${from}`, `Google — ${to}`],
    );

    // The legacy jsonb rung. Left in place as the fallback by the registry
    // migrations, so it has to move too — otherwise a language whose
    // llmConfigId is ever cleared would silently drop back to the retired model.
    await queryRunner.query(
      `
      UPDATE "languages"
         SET "llmProviderConfig" =
               jsonb_set("llmProviderConfig", '{config,model}', to_jsonb($2::text))
       WHERE "llmProviderConfig" -> 'config' ->> 'model' = $1
      `,
      [from, to],
    );
  }

  /**
   * Log the outcome. A migration that matched nothing is indistinguishable from
   * one that worked unless it says so, and this one changes which model eight
   * languages talk to.
   */
  private async report(queryRunner: QueryRunner, model: string): Promise<void> {
    try {
      const rows: Array<{ label: string }> = await queryRunner.query(
        `
        SELECT l.label
          FROM "languages" l
         WHERE l."llmProviderConfig" -> 'config' ->> 'model' = $1
         ORDER BY l.id
        `,
        [model],
      );
      console.log(
        `[MoveLanguagesOffExperimentalGemini] ${rows.length} language(s) now on ${model}: ${
          rows.map((row) => row.label).join(', ') || '(none)'
        }`,
      );
    } catch (error) {
      console.log(
        `[MoveLanguagesOffExperimentalGemini] report failed (the swap itself is unaffected): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
