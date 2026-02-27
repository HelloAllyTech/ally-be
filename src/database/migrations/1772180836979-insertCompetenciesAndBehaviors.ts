import { MigrationInterface, QueryRunner } from 'typeorm';

const COMPETENCIES = [
  'Non-Verbal Communication',
  'Verbal Communication',
  'Explain & Promote Confidentiality',
  'Rapport Building & Self-Disclosure',
  'Exploration & Normalization of Feelings',
  'Empathy, Warmth & Genuineness',
  'Assessment of Harm & Response Planning',
  'Linking Emotions, Thoughts & Behaviours',
  "Explore Client's Explanation for Problem",
  'Involvement of Family & Significant Others',
  'Collaborative Goal Setting',
  'Promote Realistic Hope',
  'Strengthen Coping Strategies',
  'Psychoeducation with Local Terminology',
  'Elicitation of Feedback',
];

const BEHAVIORS = [
  // Non-Verbal Communication - SHOULD_NOT_DO
  'Appears distracted (interrupting to pick up a call)',
  'Laughs at client',
  'No acknowledgement after sharing',
  'Interrupts without permission',
  // Non-Verbal Communication - SHOULD_DO
  'Use of soft tone, voice pitch and pacing',
  'Uses supportive gestures',
  'Uses brief verbal encouragers (uh-huh, I see)',
  'Allows silences',
  "Adjusts voice, tone, emoting to match client's affect",

  // Verbal Communication - SHOULD_NOT_DO
  'Interrupts client',
  "Leading/suggestive closed questions (e.g. 'you did not want that right?')",
  'Overuse of "why" questions',
  'Corrects or accuses client',
  'Uses culturally inappropriate or stigmatizing language',
  'Gives premature advice',
  // Verbal Communication - SHOULD_DO
  'Uses open-ended questions',
  'Allows client to complete statements',
  'Summarises and paraphrases',
  'Clarifies in first person',
  'Encourages elaboration ("Tell me more…")',
  'Matches rhythm and pacing to client',

  // Explain & Promote Confidentiality - SHOULD_NOT_DO
  'Forces disclosure',
  'Describes confidentiality inaccurately',
  'Promises full confidentiality without exceptions',
  'Minimises privacy concerns',
  // Explain & Promote Confidentiality - SHOULD_DO
  'Clearly explains confidentiality',
  'Explains limits (harm to self/others/from others)',
  'Explains rationale for breaking confidentiality',
  'Describes referral/reporting process',
  'Addresses any questions/concerns about confidentiality',
  'Checks client understanding',

  // Rapport Building & Self-Disclosure - SHOULD_NOT_DO
  'Dominates with personal stories',
  "Minimises client's problems",
  'Rushes clients',
  'Asks unnecessary embarrassing questions',
  'Shares confidential information about others',
  'Over-shares personal experiences',
  // Rapport Building & Self-Disclosure - SHOULD_DO
  'Introduces self and explains role',
  'Makes client comfortable (welcome, assuring)',
  'Assures client of their support',
  "Asks client's name and language preference",
  'Uses appropriate small talk',
  'Asks client to reflect on what has been shared (checks if they have any questions)',
  'Shares limited, relevant experiences appropriately',

  // Exploration & Normalization of Feelings - SHOULD_NOT_DO
  "Says client reaction is unusual (e.g., 'People don't usually react this way')",
  'Minimises/dismisses emotions',
  'Forces emotional disclosure',
  'Judges emotional responses',
  // Exploration & Normalization of Feelings - SHOULD_DO
  'Asks client to reflect on the experience of sharing emotions',
  'Normalises reactions appropriately',
  'Uses validating statements',
  'Explores hesitancy to share emotions',
  'Reflects emotional expressions thoughtfully',
  "Comments thoughtfully on client's facial expression to encourage emotional expression",
  'Validates emotional responses while reframing potentially harmful emotional reactions',

  // Empathy, Warmth & Genuineness - SHOULD_NOT_DO
  "Critical of client's concerns",
  'Dismissive of concerns',
  'Helper appears ingenuine, inappropriate or insincere',
  'Imposes personal beliefs',
  // Empathy, Warmth & Genuineness - SHOULD_DO
  'Demonstrates warmth and genuineness',
  'Shows consistent concern and care',
  "Asks questions to identify what emotions the client was feeling (e.g., 'I wonder if you felt sad or angry when this happened')",
  'Is warm, friendly, and genuine throughout roleplay',
  "Asks client to reflect on empathic statements from helper (e.g., 'What did you think when I said you sounded sad?')",
  "Respects client's perspective",

  // Assessment of Harm & Response Planning - SHOULD_NOT_DO
  'Does not ask about harm to self or others',
  'Lectures using moral/religious arguments',
  'Expresses shock or disbelief in response to disclosure',
  'Encourages secrecy about harm, promises not to share',
  'Leaves client alone after disclosure',
  // Assessment of Harm & Response Planning - SHOULD_DO
  'Asks directly about harm to self/others/from others',
  'Assesses intent, means, prior attempts',
  'Identifies risk and protective factors',
  'Develops collaborative safety plan',
  'Follows appropriate reporting or referral procedures',

  // Linking Emotions, Thoughts & Behaviours - SHOULD_NOT_DO
  'Criticises client for reduced functioning',
  'Says no connection exists',
  'Induces guilt about family impact',
  'Focuses only on one domain (e.g., only behaviour)',
  'Dismisses emotions',
  // Linking Emotions, Thoughts & Behaviours - SHOULD_DO
  'Asks about daily functioning, behaviours and associated emotions',
  'Explores link between symptoms and daily life',
  'Explores bidirectional relationship between thoughts, emotions, and behaviours',
  'Provides clear explanation of cognitive-behavioural model',
  "Uses examples relevant to client's life",

  // Explore Client's Explanation for Problem - SHOULD_NOT_DO
  "Criticises client's beliefs",
  'Endorses harmful beliefs',
  "Ignores client's explanatory model",
  'Directly challenges cultural beliefs',
  "Ignores client's understanding of problem",
  // Explore Client's Explanation for Problem - SHOULD_DO
  'Asks about perceived causes',
  'Explores family/social network views',
  'Incorporates client perspective into care',
  'Maintains curiosity towards client perspective',
  'Reframes harmful explanations respectfully',

  // Involvement of Family & Significant Others - SHOULD_NOT_DO
  'Forces involvement',
  'Forbids involvement without reason',
  'Involves/insists on involving others without permission',
  'Allows family to disempower client',
  // Involvement of Family & Significant Others - SHOULD_DO
  "Asks about close persons in client's life",
  "Explores client's preferences",
  'Involves others with consent',
  'Facilitates supportive participation of family significant others',

  // Collaborative Goal Setting - SHOULD_NOT_DO
  'Dictates goals',
  'Dismisses client goals without explanation',
  'Provides misleading information about outcomes',
  // Collaborative Goal Setting - SHOULD_DO
  'Asks about client goals and expectations',
  'Explains achievable outcomes clearly',
  'Aligns treatment plan with client goals',
  'Reframes unrealistic goals collaboratively',

  // Promote Realistic Hope - SHOULD_NOT_DO
  'Gives unrealistic promises',
  'Provides no hope for change',
  'Shames client doubts',
  'Expresses pessimism about change',
  // Promote Realistic Hope - SHOULD_DO
  'Praises help-seeking behaviour',
  'Encourages realistic optimism',
  'Explores and addresses doubts',
  'Clarifies limits of treatment realistically',

  // Strengthen Coping Strategies - SHOULD_NOT_DO
  'Dismisses coping strategies',
  'Encourages harmful coping',
  'Judges past problem-solving attempts',
  // Strengthen Coping Strategies - SHOULD_DO
  'Asks about past/current coping',
  'Praises positive coping strategies',
  'Encourages continuation of safe coping',
  'Brainstorms alternatives collaboratively',

  // Psychoeducation with Local Terminology - SHOULD_NOT_DO
  'Uses technical jargon without checking',
  'Uses stigmatizing language',
  'Does not check understanding',
  // Psychoeducation with Local Terminology - SHOULD_DO
  'Uses simple, clear language',
  'Integrates local terminology and idioms',
  "Incorporates client's explanatory model",
  'Checks and clarifies understanding',

  // Elicitation of Feedback - SHOULD_NOT_DO
  'Lectures without asking feedback',
  'Offers harmful suggestions',
  'Ignores client feedback',
  'Becomes defensive',
  // Elicitation of Feedback - SHOULD_DO
  'Asks for feedback on suggestions',
  'Clarifies and reframes based on feedback',
  'Summarises feedback and checks accuracy',
  'Adjusts recommendations collaboratively',
];

export class InsertCompetenciesAndBehaviors1772180836979 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const name of COMPETENCIES) {
      await queryRunner.query(
        `INSERT INTO "competencies" ("name")
         SELECT $1::text
         WHERE NOT EXISTS (SELECT 1 FROM "competencies" WHERE "name" = $1::text)`,
        [name],
      );
    }

    for (const name of BEHAVIORS) {
      await queryRunner.query(
        `INSERT INTO "behaviors" ("name")
         SELECT $1::text
         WHERE NOT EXISTS (SELECT 1 FROM "behaviors" WHERE "name" = $1::text)`,
        [name],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of BEHAVIORS) {
      await queryRunner.query(`DELETE FROM "behaviors" WHERE "name" = $1`, [
        name,
      ]);
    }

    for (const name of COMPETENCIES) {
      await queryRunner.query(`DELETE FROM "competencies" WHERE "name" = $1`, [
        name,
      ]);
    }
  }
}
