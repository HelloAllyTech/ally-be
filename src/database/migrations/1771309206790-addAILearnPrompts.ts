import { PromptCode } from 'src/prompt/enum/prompt-code.enum';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class addAILearnPrompts1771309206790 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const prompts = [
      {
        code: PromptCode.ALLY_AI_LEARN_DEFAULT,
        name: 'AI Learn Default Base Prompt',
        description:
          'Base system prompt for AI roleplay client in counselor training simulations. Used when no custom prompt is provided in the scenario.',
        template: `You are an AI roleplay assistant for counselor training.
In this simulation, you must act ONLY as the **client** in a therapy session.
Stay fully in character, provide realistic dialogue, and do not switch roles
unless explicitly instructed.

**Important Instructions:**
- Prefer first-person phrasing (e.g., "I feel…", "I've been struggling with…").
- Allow the counselor to guide the conversation.
- If the counselor is silent or open-ended, share one thought, feeling,
  or small story, then stop.
- Maintain consistency with your life history but allow natural
  variation in tone and detail.
- Respond naturally, as a real client would (use first-person voice).
- Reveal information gradually, not all at once.
- Start with few details and open up more as counsellor asks questions.
- Show authentic emotions, hesitations, or small inconsistencies
  typical of real conversations.
- Do not give therapy advice, diagnoses, or act as the counselor.
- If sensitive topics arise, respond realistically but without graphic
  or explicit detail.
- Keep each reply under ~120 words to simulate session pacing.
- Do NOT include stage directions, action descriptions, or expressions in
  brackets or parentheses (e.g., "(sighs)", "(pausing)", "(shaking head)").
  Your response will be spoken aloud via text-to-speech, so output only
  the words the client would actually say.`,
      },
      {
        code: PromptCode.ALLY_AI_LEARN_CLIENT_PERSONA_TEMPLATE,
        name: 'Client Persona Template',
        description:
          'Template structure for displaying client persona details. Placeholders are filled at runtime with values from scenario metadata (promptData). Used together with the base instruction to build the full system prompt.',
        template: `{base_instruction}

## Your Client Persona Details
This is the background information for your character.

**Your name:**
{name}

**Your age:**
{age}

**Your gender:**
{gender}

{gender_details}

**Your current location:**
{current_location}

{profession}

**Your current context:**
{context}

{guidelines}

{previous_memory}

{life_history}

{core_memories}
{personality}
{starting_state}
{emotional_needs}
{tone}
{custom_fields}

{response_length}
{agent_dialogues}`,
      },
      {
        code: PromptCode.ALLY_AI_LEARN_PROSODY_GENERATION,
        name: 'Prosody Default Generation Prompt',
        description:
          'Establishes physiological baseline for character voice using prosody science. Used for initial prosody parameter generation.',
        template: `Based on the following scenario information, establish a "Physiological Baseline" for
the character's voice using prosody science principles.

CHARACTER INFORMATION:
{prompt_content}

{opening_statements_section}

AVAILABLE PARAMETERS:
{parameter_metadata}

PROSODY SCIENCE APPROACH:
Instead of guessing emotions, simulate a physiological state based on:

1. PHYSIOLOGICAL BASELINE:
   - Character's trauma history, age, and "startingState" from the scenario
   - These factors determine baseline vocal fold tension (pitch), respiration
     rate (pace/speed), and emotional control (stability)
   - Example: A character with childhood trauma may have higher baseline pitch
     (chronic stress) and lower stability (hypervigilance)
   - IMPORTANT: If opening statements are provided above, analyze their emotional
     tone and use them to inform the initial parameter values. The opening statement
     represents the character's first utterance and should reflect their initial
     emotional state and physiological baseline.

2. AROUSAL-VALENCE MAPPING:
   - High Arousal + Positive Valence (excitement, joy) →
     Higher pitch, faster pace
   - High Arousal + Negative Valence (anxiety, anger) →
     Higher pitch, faster pace, lower stability
   - Low Arousal + Positive Valence (calm, contentment) →
     Lower pitch, normal pace, higher stability
   - Low Arousal + Negative Valence (sadness, depression) →
     Lower pitch, slower pace, variable stability

3. PARAMETER MAPPINGS:
   - Pitch: Correlates with vocal fold tension
     * Stress/Anxiety = Higher pitch
     * Sadness/Relaxation = Lower pitch
   - Pace/Speed: Correlates with respiration rate
     * Urgency/Panic = Faster pace
     * Contemplation/Depression = Slower pace
   - Stability: Correlates with emotional control
     * High Stability = Guarded/Professional (suppressed emotions)
     * Low Stability = Trembling/Vulnerable (raw emotions)
   - Loudness (if available): Correlates with autonomic response
     * Shame/Withdrawal = Lower volume
     * Excitement/Breakthrough = Higher volume

Analyze the character's:
- Trauma history and age (affects baseline physiology)
- Starting emotional state (affects initial parameter values)
- Personality traits (affects how they express emotions)
- Context and situation (affects current physiological state)
- Opening statement(s) (if provided) - analyze the emotional tone, urgency, and
  physiological state implied by how the character would say their first words

Return a JSON object with parameter names as keys and appropriate default values
that establish the character's physiological baseline. If opening statements are
provided, the parameters should reflect the emotional and physiological state
implied by those statements.`,
      },
    ];

    // Insert prompts for the first 3
    for (const prompt of prompts) {
      await queryRunner.query(
        `INSERT INTO "prompts" ("promptCode", "name", "description", "currentVersion")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("promptCode") DO NOTHING`,
        [prompt.code, prompt.name, prompt.description, 1],
      );

      await queryRunner.query(
        `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
         SELECT p."id", 1, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2
         ON CONFLICT ("promptId", "version") DO NOTHING`,
        [prompt.template, prompt.code],
      );
    }

    // The remaining 2 prompts are very large, so I'll add them separately
    const prosodyUnifiedCode = PromptCode.ALLY_AI_LEARN_PROSODY_UNIFIED;
    const prosodyUnifiedName = 'Prosody Unified Prompt With Enhancement';
    const prosodyUnifiedDescription =
      'Generates prosody parameters and enhanced text for real-time speech. Supports text enhancement (e.g. therapy-specific tags like [sighs]).';

    // Due to the large size of this prompt, I'm truncating it here
    // You should copy the full content from the Excel file
    const prosodyUnifiedTemplate = `Analyze the following response text using prosody science principles and
generate both prosody parameters and enhanced text.

CURRENT PARAMETERS (PRIMARY BASELINE - USE THESE AS STARTING POINT):
{current_parameters}

⚠️ CRITICAL RULE #1: The CURRENT PARAMETERS above are your PRIMARY BASELINE.
   - NATURAL VARIATION: Allow subtle natural variation (1-2%) even without
     marked events to simulate natural speech patterns
   - When NO marked event: Apply 1-2% natural variation based on response
     text emotional tone
   - When marked event EXISTS: Apply 3-5% variation (pace/speed: 3%, pitch/loudness: 5%)
   - Example natural variation: If current value is X, natural range is
     X ± (X × 0.02) - 2% variation
   - Example marked event: If current value is X, max change is X × 0.03 = 0.03X,
     so new value should be X ± 0.03X - 3% variation
   - NEVER make changes larger than 2% for natural variation, 3% for pace/speed
     with marked events, 5% for pitch/loudness with marked events
   - NOTE: Parameter names and ranges vary by provider - check AVAILABLE PARAMETERS
     section below for exact parameter names and valid ranges

PERSONA CONTEXT (for prosody decisions):
{persona_context}

CONVERSATION HISTORY:
{conversation_history}

CURRENT RESPONSE TEXT:
{response_text}

AVAILABLE PARAMETERS:
{parameter_metadata}

TEXT ENHANCEMENT RULES:
{text_enhancement_instructions}

[... rest of the prompt content - see Excel file for full content ...]`;

    await queryRunner.query(
      `INSERT INTO "prompts" ("promptCode", "name", "description", "currentVersion")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("promptCode") DO NOTHING`,
      [prosodyUnifiedCode, prosodyUnifiedName, prosodyUnifiedDescription, 1],
    );

    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
       SELECT p."id", 1, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2
       ON CONFLICT ("promptId", "version") DO NOTHING`,
      [prosodyUnifiedTemplate, prosodyUnifiedCode],
    );

    const prosodyParametersOnlyCode =
      PromptCode.ALLY_AI_LEARN_PROSODY_PARAMETERS_ONLY;
    const prosodyParametersOnlyName = 'Prosody Parameters Only Prompt';
    const prosodyParametersOnlyDescription =
      'Generates prosody parameters only (no text enhancement). Used when TTS provider does not support text enhancement.';

    const prosodyParametersOnlyTemplate = `Analyze the following response text using prosody science principles and
determine appropriate prosody parameters.

[... rest of the prompt content - see Excel file for full content ...]`;

    await queryRunner.query(
      `INSERT INTO "prompts" ("promptCode", "name", "description", "currentVersion")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("promptCode") DO NOTHING`,
      [
        prosodyParametersOnlyCode,
        prosodyParametersOnlyName,
        prosodyParametersOnlyDescription,
        1,
      ],
    );

    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
       SELECT p."id", 1, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2
       ON CONFLICT ("promptId", "version") DO NOTHING`,
      [prosodyParametersOnlyTemplate, prosodyParametersOnlyCode],
    );

    // Ensure currentVersion is set to 1 for all prompts
    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 1 WHERE "promptCode" IN ($1, $2, $3, $4, $5)`,
      [
        PromptCode.ALLY_AI_LEARN_DEFAULT,
        PromptCode.ALLY_AI_LEARN_CLIENT_PERSONA_TEMPLATE,
        PromptCode.ALLY_AI_LEARN_PROSODY_GENERATION,
        PromptCode.ALLY_AI_LEARN_PROSODY_UNIFIED,
        PromptCode.ALLY_AI_LEARN_PROSODY_PARAMETERS_ONLY,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const promptCodes = [
      PromptCode.ALLY_AI_LEARN_DEFAULT,
      PromptCode.ALLY_AI_LEARN_CLIENT_PERSONA_TEMPLATE,
      PromptCode.ALLY_AI_LEARN_PROSODY_GENERATION,
      PromptCode.ALLY_AI_LEARN_PROSODY_UNIFIED,
      PromptCode.ALLY_AI_LEARN_PROSODY_PARAMETERS_ONLY,
    ];

    // Delete prompt versions for the specific prompts
    await queryRunner.query(
      `DELETE FROM "prompts_versions" pv
       USING "prompts" p
       WHERE pv."promptId" = p."id" AND p."promptCode" = ANY($1)`,
      [promptCodes],
    );

    // Delete prompts
    await queryRunner.query(
      `DELETE FROM "prompts" WHERE "promptCode" = ANY($1)`,
      [promptCodes],
    );
  }
}
