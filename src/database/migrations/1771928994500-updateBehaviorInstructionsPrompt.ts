import { PromptCode } from 'src/prompt/enum/prompt-code.enum';
import { MigrationInterface, QueryRunner } from 'typeorm';

const PROMPT_TEMPLATE_V2 = `You are generating Behaviour Instructions for a mental health counselling simulation.

Context:
These instructions help evaluate a counsellor's performance.
Each instruction object links a specific helper behavior to how the AI client (actor) responds when that behavior occurs.

Inputs (authoritative):
- Title: {{title}}
- Competency: {{competency}}
- Allowed Helper Behaviors (predefined list):
{{allowedHelperBehaviorsList}}

IMPORTANT:
You MUST ONLY use helper behaviors from the provided list.
Do NOT rewrite, paraphrase, merge, or invent new behaviors.
Reference behaviors by their numeric ID only.

Goal:
Generate a list of behavior_instruction objects derived strictly from the given competency.

Each object must contain:

1) "category" → must be exactly one of:
   - "SHOULD_DO"
   - "SHOULD_NOT_DO"

2) "helper_behavior_ids" → a list of 1–3 numeric IDs selected from the allowed list.
   - Use the exact numeric IDs from the provided list.
   - Do not invent IDs.
   - Do not repeat the same combination excessively.

3) "actor_response" → a realistic client response (single string) that reflects how a client would emotionally react when those behaviours are observed.
   - 12–30 words.
   - Emotionally grounded.
   - No mention of therapy techniques.
   - No scoring or evaluation references.
   - No new factual backstory.
   - No crisis escalation or explicit self-harm content.

Rules:

- Generate at most 10 behavior_instruction objects.
- Generate as many as are meaningfully relevant to the competency, but do not exceed 10.
- Do NOT force a specific number.
- Include both categories where applicable.
- Ensure behaviors logically map to the competency.
- Do not include explanations or commentary.
- Output must be valid JSON matching the required schema.

Output format:

{
  "instructions": [
    {
      "category": "SHOULD_DO",
      "helper_behavior_ids": [1, 3],
      "actor_response": "Client reaction line"
    }
  ]
}

Only output valid JSON.`;

const PROMPT_CODE =
  PromptCode.OPENAI_SIMULATION_BEHAVIOR_INSTRUCTIONS_PROMPT_CODE;

export class UpdateBehaviorInstructionsPrompt1771928994500 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
           SELECT p."id", 2, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2`,
      [PROMPT_TEMPLATE_V2, PROMPT_CODE],
    );

    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 2 WHERE "promptCode" = $1`,
      [PROMPT_CODE],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 1 WHERE "promptCode" = $1`,
      [PROMPT_CODE],
    );

    await queryRunner.query(
      `DELETE FROM "prompts_versions" pv
           USING "prompts" p
           WHERE pv."promptId" = p."id" AND p."promptCode" = $1 AND pv."version" = 2`,
      [PROMPT_CODE],
    );
  }
}
