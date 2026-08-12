import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed the bot's settings row and its mandatory keyword templates.
 *
 * The bot is seeded DISABLED (`enabled: false`). Nothing here should start answering workers the
 * moment the migration runs — the number, the app secret and the corpus all have to be in place
 * first, and the admin flips the switch when they are.
 *
 * The mandatory templates are seeded rather than left to an admin because a bot for this audience with
 * no crisis reply configured is not a degraded bot, it is an unsafe one. Their WORDING is editable (a
 * helpline number changes, the tone needs work) but `mandatory: true` stops them being deleted or
 * deactivated.
 *
 * Priority bands, so ordering cannot be got wrong by accident: crisis 0-99, consent 100-199,
 * command 200-299, faq 300+. The matcher runs one ordered pass, and a crisis rule losing to an FAQ
 * rule is a crisis reply that never gets sent.
 */
const SETTINGS_NAME = 'whatsapp_bot';

const DEFAULT_SETTINGS = {
  enabled: false,
  provider: 'meta',
  consentRequired: true,
  disclaimerText:
    'This is an automated assistant that answers from our reference material. It is not medical ' +
    'advice and not a crisis service. Reply STOP to opt out.',
  crisisEscalationText:
    'It sounds like this may be urgent. This assistant cannot help with a crisis. Please contact a ' +
    'supervisor or a crisis line now: {helpline_numbers}',
  fallbackText:
    'Something went wrong on my side and I could not answer that. Please try again in a moment.',
  declineText:
    'My reference material does not cover that. A colleague or supervisor is the better route for ' +
    'this one.',
  unsupportedMediaText:
    'I can only read text messages. Please type your question.',
  rateLimitText:
    'That is a lot of questions at once. Please wait a few minutes and try again.',
  rateLimit: { perMinute: 6, perHour: 30, perDay: 100 },
  retrieval: {
    topK: 8,
    minSimilarity: 0.35,
    declineSimilarity: 0.42,
    maxPassages: 5,
    maxContextTokens: 3000,
    similarityBand: 0.08,
    translateQuery: true,
  },
  maxAnswerChars: 1400,
  maxReplyChars: 1600,
  maxCitations: 3,
  conversationIdleMinutes: 1440,
  helplineNumbers: '',
};

interface SeedTemplate {
  kind: string;
  name: string;
  matchType: string;
  patterns: string[];
  priority: number;
  responseText: string;
  terminal: boolean;
  mandatory: boolean;
}

const TEMPLATES: SeedTemplate[] = [
  {
    kind: 'crisis',
    name: 'Immediate risk',
    // ANY_OF is whole-word matching, and that choice matters: a substring match on a short risk word
    // is how "therapist" fires a rule keyed on "rapist", sending a crisis reply to a legitimate
    // clinical question.
    matchType: 'any_of',
    patterns: [
      'suicide',
      'suicidal',
      'kill myself',
      'killing myself',
      'end my life',
      'take my own life',
      'overdose',
      'self harm',
      'selfharm',
      'hurt myself',
      'want to die',
    ],
    priority: 10,
    responseText:
      'It sounds like this may be urgent. This assistant answers from reference material and ' +
      'cannot help with a crisis. Please contact a supervisor or a crisis line now: ' +
      '{helpline_numbers}',
    // Terminal: nothing runs after a crisis match, including retrieval.
    terminal: true,
    mandatory: true,
  },
  {
    kind: 'consent',
    name: 'Opt out',
    matchType: 'exact',
    patterns: ['stop', 'unsubscribe', 'cancel', 'quit'],
    priority: 110,
    responseText:
      'You will not receive any more messages from this assistant. Reply START at any time to opt ' +
      'back in.',
    terminal: true,
    mandatory: true,
  },
  {
    kind: 'consent',
    name: 'Opt back in',
    matchType: 'exact',
    patterns: ['start', 'subscribe', 'resume'],
    priority: 120,
    responseText:
      'You are opted back in. This is an automated assistant that answers from our reference ' +
      'material. It is not medical advice and not a crisis service.',
    terminal: false,
    mandatory: true,
  },
  {
    kind: 'command',
    name: 'Greeting',
    matchType: 'exact',
    patterns: ['hi', 'hello', 'hey', 'namaste', 'start chat'],
    priority: 210,
    responseText:
      'Hello. Ask me a question about our reference material and I will answer from it, with the ' +
      'source. I am not a crisis service. Reply HELP for more.',
    terminal: false,
    mandatory: false,
  },
  {
    kind: 'command',
    name: 'Help',
    matchType: 'exact',
    patterns: ['help', 'menu', 'what can you do', 'options'],
    priority: 220,
    // Fixed wording rather than generated, so the bot never improvises a description of its own
    // capabilities — the one thing it cannot check against the corpus.
    responseText:
      'Ask a question in your own words and I will answer from our reference material, telling you ' +
      'which document and page it came from. If the material does not cover it, I will say so ' +
      'rather than guess. I am not a crisis service and I do not give medical advice. Reply STOP ' +
      'to opt out.',
    terminal: false,
    mandatory: true,
  },
];

export class SeedWhatsAppBotSettingsAndTemplates1892000000008 implements MigrationInterface {
  name = 'SeedWhatsAppBotSettingsAndTemplates1892000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Idempotent: re-running must not overwrite settings an admin has since tuned.
    const existing = await queryRunner.query(
      `SELECT id FROM "global_settings" WHERE name = $1 LIMIT 1`,
      [SETTINGS_NAME],
    );
    if (existing.length === 0) {
      await queryRunner.query(
        `INSERT INTO "global_settings" ("name", "value", "createdBy", "updatedBy")
         VALUES ($1, $2, 0, 0)`,
        [SETTINGS_NAME, JSON.stringify(DEFAULT_SETTINGS)],
      );
    }

    for (const template of TEMPLATES) {
      // Keyed on name so an admin's edited wording survives a re-run.
      const found = await queryRunner.query(
        `SELECT id FROM "wa_keyword_templates" WHERE "name" = $1 AND "kind" = $2 LIMIT 1`,
        [template.name, template.kind],
      );
      if (found.length > 0) continue;

      await queryRunner.query(
        `INSERT INTO "wa_keyword_templates"
          ("kind", "name", "match_type", "patterns", "priority", "response_text",
           "bypass_rag", "terminal", "active", "mandatory")
         VALUES ($1, $2, $3, $4, $5, $6, true, $7, true, $8)`,
        [
          template.kind,
          template.name,
          template.matchType,
          template.patterns,
          template.priority,
          template.responseText,
          template.terminal,
          template.mandatory,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "wa_keyword_templates" WHERE "name" = ANY($1)`,
      [TEMPLATES.map((t) => t.name)],
    );
    await queryRunner.query(`DELETE FROM "global_settings" WHERE name = $1`, [
      SETTINGS_NAME,
    ]);
  }
}
