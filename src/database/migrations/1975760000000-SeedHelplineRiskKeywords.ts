import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Platform-default keyword risk rules for the text helpline (`tenant_id` NULL).
 *
 * This is the synchronous first line of the risk screen (docs/text-helpline.md
 * §9.2 step 1): it runs on every talker message, including in the waiting
 * room, before any model is consulted, and it is what still works when the
 * classifier is down. It is deliberately biased towards false positives — a
 * flag is a banner and a checklist for a trained listener, not an action taken
 * on the talker.
 *
 * Levels: HIGH for explicit intent or explicit passive ideation ("I don't want
 * to live"); ELEVATED for self-harm and softer, ambiguous phrasing.
 *
 * Match types:
 *  - WORD for English, matching whole words of the normalised text. A
 *    substring match on a short risk word is how "therapist" fires a rule
 *    keyed on "rapist" — the reason the WhatsApp crisis rules are whole-word
 *    too, and their phrases are reused here verbatim.
 *  - CONTAINS for Hindi, Marathi, Tamil and Kannada stems, which inflect and
 *    agglutinate ("आत्महत्याओं", "தற்கொலைக்கு"); whole-word matching would
 *    miss most real messages.
 *
 * Normalisation (NFKC, lowercase, punctuation → space, Devanagari nukta and
 * ZWJ/ZWNJ folded, Unicode Marks KEPT) is applied to both sides in
 * `util/helpline-text-normaliser.ts`, so phrases are written naturally here —
 * "don't want to live" matches "Don’t want to live!!".
 *
 * Idempotent: keyed on (scope, language, phrase), so a re-run adds only
 * missing rows and never revives a rule an admin disabled.
 */
interface SeedRule {
  phrase: string;
  language: string;
  matchType: 'WORD' | 'CONTAINS';
  level: 'HIGH' | 'ELEVATED';
}

const word = (language: string, level: SeedRule['level'], phrases: string[]) =>
  phrases.map(
    (phrase): SeedRule => ({ phrase, language, matchType: 'WORD', level }),
  );
const contains = (
  language: string,
  level: SeedRule['level'],
  phrases: string[],
) =>
  phrases.map(
    (phrase): SeedRule => ({ phrase, language, matchType: 'CONTAINS', level }),
  );

export const HELPLINE_SEED_RULES: SeedRule[] = [
  // ── English ──────────────────────────────────────────────────────────────
  ...word('en', 'HIGH', [
    // The WhatsApp bot's crisis set (1892000000008), minus the self-harm
    // phrases, which are ELEVATED below.
    'suicide',
    'suicidal',
    'kill myself',
    'killing myself',
    'end my life',
    'take my own life',
    'overdose',
    'want to die',
    // Additional explicit and passive ideation.
    'ending my life',
    'take my life',
    'wanna die',
    'want to be dead',
    'better off dead',
    'better off without me',
    "don't want to live",
    'dont want to live',
    'no reason to live',
    'not worth living',
    'end it all',
    'hang myself',
    'slit my wrists',
  ]),
  ...word('en', 'ELEVATED', [
    'self harm',
    'selfharm',
    'hurt myself',
    'harm myself',
    'cut myself',
    'cutting myself',
    "can't go on",
    'cant go on',
    'no point living',
    'give up on life',
  ]),

  // ── Hindi (Devanagari) ───────────────────────────────────────────────────
  // Written without nukta: the normaliser folds ख़/ज़ → ख/ज on both sides, so
  // "ख़ुदकुशी" and "खुदकुशी" are one rule.
  ...contains('hi', 'HIGH', [
    'आत्महत्या',
    'खुदकुशी',
    'मर जाना चाहता',
    'मर जाना चाहती',
    'मरना चाहता',
    'मरना चाहती',
    'जीना नहीं चाहता',
    'जीना नहीं चाहती',
    'जीने का मन नहीं',
    'जीने की कोई वजह नहीं',
    'खुद को मार',
    'अपनी जान ले',
    'जिंदगी खत्म',
    'जिन्दगी खत्म',
  ]),
  ...contains('hi', 'ELEVATED', ['खुद को नुकसान', 'खुद को चोट']),

  // ── Hindi (romanised / Hinglish) ─────────────────────────────────────────
  // Stored under `hi`; screening applies every language's rules to every chat,
  // so these also catch a talker who picked English and writes Hinglish.
  ...contains('hi', 'HIGH', [
    'marna chahta',
    'marna chahti',
    'mar jana chahta',
    'mar jana chahti',
    'jeena nahi chahta',
    'jeena nahi chahti',
    'jina nahi chahta',
    'jina nahi chahti',
    'jeena nhi chahta',
    'jeena nhi chahti',
    'jeene ka mann nahi',
    'khudkushi',
    'khudkhushi',
    'suicide kar',
    'khud ko maar',
    'khud ko mar',
    'apni jaan le',
    'zindagi khatam',
    'jindagi khatam',
    'aatmahatya',
    'atmahatya',
  ]),

  // ── Marathi ──────────────────────────────────────────────────────────────
  ...contains('mr', 'HIGH', [
    'आत्महत्या',
    'जीव द्यायचा',
    'मरायचं आहे',
    'मरायचे आहे',
    'जगायचं नाही',
    'जगायचे नाही',
    'स्वतःला संपव',
  ]),

  // ── Tamil ────────────────────────────────────────────────────────────────
  ...contains('ta', 'HIGH', [
    'தற்கொலை',
    'சாக வேண்டும்',
    'சாகணும்',
    'சாக விரும்பு',
    'வாழ விருப்பமில்லை',
    'வாழ்க்கையை முடித்து',
  ]),

  // ── Kannada ──────────────────────────────────────────────────────────────
  ...contains('kn', 'HIGH', [
    'ಆತ್ಮಹತ್ಯೆ',
    'ಸಾಯಬೇಕು',
    'ಸಾಯಲು ಬಯಸ',
    'ಬದುಕಲು ಇಷ್ಟವಿಲ್ಲ',
  ]),
];

export class SeedHelplineRiskKeywords1975760000000 implements MigrationInterface {
  name = 'SeedHelplineRiskKeywords1975760000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const rule of HELPLINE_SEED_RULES) {
      await queryRunner.query(
        `INSERT INTO "helpline_risk_keyword_rules" ("tenant_id", "phrase", "language", "match_type", "level", "enabled")
         SELECT NULL, $1::varchar, $2::varchar, $3::varchar, $4::varchar, true
         WHERE NOT EXISTS (
           SELECT 1 FROM "helpline_risk_keyword_rules"
           WHERE "tenant_id" IS NULL AND "language" = $2::varchar AND "phrase" = $1::varchar
         )`,
        [rule.phrase, rule.language, rule.matchType, rule.level],
      );
    }
  }

  /** Removes only the platform defaults this seeded; org rules are untouched. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const rule of HELPLINE_SEED_RULES) {
      await queryRunner.query(
        `DELETE FROM "helpline_risk_keyword_rules"
         WHERE "tenant_id" IS NULL AND "language" = $2::varchar AND "phrase" = $1::varchar`,
        [rule.phrase, rule.language],
      );
    }
  }
}
