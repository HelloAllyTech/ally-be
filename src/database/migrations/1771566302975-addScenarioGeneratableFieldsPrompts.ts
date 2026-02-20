import { PromptCode } from 'src/prompt/enum/prompt-code.enum';
import { MigrationInterface, QueryRunner } from 'typeorm';

const PROMPTS = [
  {
    code: PromptCode.OPENAI_SIMULATION_CHARACTER_PROFILE_TEXT_PROMPT_CODE,
    name: 'OpenAI Simulation Character Profile Text Prompt',
    description:
      'Prompt for auto-generating a character profile text for a role-play simulation scenario',
    template: `You are generating a "Character Profile Text" for a role-play simulation.

Goal:
Write a vivid, grounded, realistic character profile that an AI role-play agent can follow consistently during a simulation.

Inputs (authoritative):
- Title: {{title}}
- Character name: {{name}}
- Age: {{age}}
- Gender: {{gender}}
- Gender identity: {{genderIdentity}}
- Sexual orientation: {{sexualOrientation}}
- Profession: {{profession}}
- Current location: {{currentLocation}}

Hard rules:
1) Use ONLY the given inputs. Do not invent extra factual attributes such as: employer/company name, detailed address, phone/email, exact salary, childhood backstory, medical conditions, diagnoses, trauma history, religion/caste, political affiliation, criminal history, or family members—unless explicitly provided in the inputs (they are not).
2) Do NOT mention or imply the character is an AI, model, assistant, or fictional.
3) Keep it respectful and non-stereotypical, especially for gender identity and sexual orientation. No moral judgments, no slurs, no fetishization.
4) No explicit sexual content. Mention sexual orientation only neutrally if it naturally fits; otherwise keep it minimal.
5) Keep it consistent with age and profession and location.
6) Output length: 50-100 words.
7) Write in third person.
8) Tone: professional, simulation-ready, specific but not over-detailed.

Structure (follow exactly):
- 1–2 lines: Snapshot (name, age, profession, location) + current vibe.
- 3–5 lines: Work context and typical day (profession-relevant).
- 2–4 lines: Communication style + values/boundaries (how they behave in conversation).
- 1 line: A short "Role-play cues" sentence that hints how the agent should portray them (e.g., calm, direct, curious), without listing bullet points.

Now generate the Character Profile Text for the given inputs.`,
  },
  {
    code: PromptCode.OPENAI_SIMULATION_CHALLENGE_DESCRIPTION_PROMPT_CODE,
    name: 'OpenAI Simulation Challenge Description Prompt',
    description:
      'Prompt for auto-generating a challenge description for a role-play simulation scenario',
    template: `You are generating a "Challenge Description" for a mental health role-play simulation.

Context:
The user is a counsellor. The AI agent will act as the client described in the character profile. The purpose is to allow the counsellor to practice the specified competency.

Inputs (authoritative):
- Title: {{title}}
- Competency being practiced: {{competency}}
- Character Profile Text: {{characterProfileText}}

Goal:
Write a focused Challenge Description that clearly explains the emotional and therapeutic difficulty the counsellor must navigate in this session.

Important:
This is NOT a full scenario or story.
Do NOT narrate detailed events.
Do NOT script dialogue.
Do NOT describe multiple scenes.
Describe the core emotional struggle and therapeutic tension only.

Hard Rules:
1) Align strictly with the character profile.
2) The client's distress must be realistic but not extreme.
3) Do NOT diagnose mental disorders.
4) Do NOT mention evaluation, scoring, or testing.
5) Keep it clinically grounded and emotionally nuanced.
6) Length: 100–150 words.
7) Write in second person (address the counsellor as "you").

Content Requirements:
- Briefly describe the client's current emotional state.
- Clearly explain the internal conflict, resistance, avoidance, or cognitive pattern creating difficulty.
- Show why this interaction requires the specified competency.
- Highlight what makes the counselling dynamic challenging (e.g., defensiveness, emotional withdrawal, over-intellectualizing, fear of vulnerability, people-pleasing, anger masking hurt, etc.).

Tone:
Professional, emotionally grounded, and therapeutic.

The output should read like a precise description of the counselling challenge — not a story.

Now generate the Challenge Description.`,
  },
  {
    code: PromptCode.OPENAI_SIMULATION_OPENING_DIALOGUES_PROMPT_CODE,
    name: 'OpenAI Simulation Opening Dialogues Prompt',
    description:
      'Prompt for auto-generating opening dialogue lines for a role-play simulation scenario',
    template: `You are generating opening dialogue lines for a mental health role-play simulation.

Context:
The user is a counsellor.
The AI agent will act as the client.
These lines represent the CLIENT'S FIRST SPOKEN WORDS at the beginning of a session.

Inputs (authoritative):
- Title: {{title}}
- Character Profile Text: {{characterProfileText}}
- Challenge Description: {{challengeDescription}}

Goal:
Generate a list of realistic, emotionally grounded opening statements the client might say at the start of the session.

Critical Instructions:
1) These must be spoken dialogue lines only.
2) Do NOT include narration, explanations, or stage directions.
3) Do NOT include the counsellor's lines.
4) Do NOT introduce new factual details not present in the profile or challenge.
5) Avoid generic therapy clichés like:
   - "I don't know where to start."
   - "I guess I'm here because..."
   - "I just need help."
6) Each line should reflect:
   - The emotional tone from the challenge description
   - The client's personality and communication style
   - The tension or internal conflict described
7) Some lines may show:
   - Defensiveness
   - Hesitation
   - Emotional overwhelm
   - Over-intellectualizing
   - Minimizing
   - Irritability masking vulnerability
   - Confusion or rumination
8) Keep each line between 12–35 words.
9) Generate 6–10 distinct dialogue options.
10) Output MUST be a valid JSON array of strings.
11) No numbering. No additional text. Only the JSON array.

The dialogue should feel like something a real client would actually say in the first few seconds of a session — emotionally specific, not scripted, not theatrical.

Now generate the opening dialogue list.`,
  },
  {
    code: PromptCode.OPENAI_SIMULATION_STATES_INSTRUCTIONS_PROMPT_CODE,
    name: 'OpenAI Simulation States Instructions Prompt',
    description:
      'Prompt for auto-generating dynamic client states for a role-play simulation scenario',
    template: `You are generating dynamic client states for a mental health role-play simulation.

Context:
The AI agent plays the client.
During the simulation, the client's emotional state changes based on the counsellor's score.
You must define 4 progressive emotional states.

Inputs (authoritative):
- Title: {{title}}
- Character Profile Text: {{characterProfileText}}
- Challenge Description: {{challengeDescription}}

Goal:
Generate 4 distinct emotional states of the client, representing a progression from initial guardedness/distress to greater openness or regulation (if counselling is effective).

Each state must contain:

1) "instruction" → A short behavioral directive (5–10 words) describing how the client should behave conversationally in that state.
   Examples of style (not content to copy):
   - "Guarded and emotionally defensive"
   - "More reflective but still hesitant"
   - "Emotionally open and self-aware"
   - "Withdrawn and resistant to vulnerability"

2) "dialogues" → A list of 5–8 short sample dialogue lines (strings only).
   These are example lines the client might say while in that state.
   They should:
   - Match the emotional tone of that state
   - Align with the challenge description
   - Reflect the character's communication style
   - Avoid new factual inventions
   - Avoid diagnosis
   - Avoid explicit self-harm content
   - Be 10–30 words each
   - Be emotionally realistic, not theatrical

State Design Rules:

- State 1 → Highest resistance, defensiveness, emotional constriction, or dysregulation consistent with the challenge.
- State 2 → Slight softening or emotional cracks appearing.
- State 3 → Noticeable reflection, insight, or vulnerability emerging.
- State 4 → Most emotionally regulated, open, or constructive version of the client.

Do NOT:
- Mention scoring.
- Mention improvement explicitly.
- Mention therapy techniques.
- Script counsellor responses.
- Include narration.
- Include headings.
- Include explanations outside JSON.

Output Format (strictly follow this structure):

{
  "state_1": {
    "instruction": "string (5-10 words)",
    "dialogues": ["string", "string", ...]
  },
  "state_2": {
    "instruction": "string (5-10 words)",
    "dialogues": ["string", "string", ...]
  },
  "state_3": {
    "instruction": "string (5-10 words)",
    "dialogues": ["string", "string", ...]
  },
  "state_4": {
    "instruction": "string (5-10 words)",
    "dialogues": ["string", "string", ...]
  }
}

Only output valid JSON. No extra commentary.`,
  },
];

export class AddScenarioGeneratableFieldsPrompts1771566302975 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const prompt of PROMPTS) {
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

      await queryRunner.query(
        `UPDATE "prompts" SET "currentVersion" = 1 WHERE "promptCode" = $1`,
        [prompt.code],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const prompt of PROMPTS) {
      await queryRunner.query(
        `DELETE FROM "prompts_versions" pv
             USING "prompts" p
             WHERE pv."promptId" = p."id" AND p."promptCode" = $1`,
        [prompt.code],
      );

      await queryRunner.query(`DELETE FROM "prompts" WHERE "promptCode" = $1`, [
        prompt.code,
      ]);
    }
  }
}
