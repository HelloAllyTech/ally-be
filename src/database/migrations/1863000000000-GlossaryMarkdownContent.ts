import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Glossary authoring pivot: sections become plain MARKDOWN (`content`), not
 * typed entry lists. What admins write is what the agent gets — the runtime
 * always received compiled markdown anyway; this removes the structured
 * middle layer that made the editor heavy. `entries` is repurposed to hold
 * only consolidation proposals ({id, markdown, status, provenance}).
 *
 * Backfill: existing typed entries (dev/local drafts only — nothing is
 * published anywhere yet) are rendered into `content` with the same rules the
 * old compiler used; old `proposed` entries become markdown proposals.
 *
 * Also bumps the glossary_generation / glossary_consolidation prompts to v2
 * bodies that speak markdown natively.
 */
export class GlossaryMarkdownContent1863000000000 implements MigrationInterface {
  name = 'GlossaryMarkdownContent1863000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "language_glossary_sections" ADD COLUMN IF NOT EXISTS "content" text NOT NULL DEFAULT ''`,
    );

    const rows: {
      id: string;
      entries: OldEntry[] | null;
      content: string;
    }[] = await queryRunner.query(
      `SELECT "id", "entries", "content" FROM "language_glossary_sections"`,
    );

    for (const row of rows) {
      const entries = Array.isArray(row.entries) ? row.entries : [];
      // Rows written after the code pivot (or already migrated) are skipped.
      const isOldShape = entries.some((e) => e && (e as OldEntry).type);
      if (!isOldShape && (row.content ?? '') !== '') continue;
      if (!isOldShape && entries.length === 0) continue;

      const publishedLines: string[] = [];
      const proposals: NewProposal[] = [];
      for (const entry of entries) {
        if (!entry) continue;
        const markdown = renderOldEntry(entry);
        if (!markdown) continue;
        if (entry.status === 'proposed' || entry.status === 'rejected') {
          proposals.push({
            id: entry.id,
            markdown,
            status: entry.status,
            importance: entry.importance,
            provenance: entry.provenance,
          });
        } else {
          publishedLines.push(markdown);
        }
      }

      const content = row.content?.trim()
        ? row.content
        : publishedLines.join('\n');
      await queryRunner.query(
        `UPDATE "language_glossary_sections" SET "content" = $1, "entries" = $2::jsonb WHERE "id" = $3`,
        [content, JSON.stringify(proposals), row.id],
      );
    }

    await upsertPromptVersion(
      queryRunner,
      'glossary_generation',
      GENERATION_V2,
    );
    await upsertPromptVersion(
      queryRunner,
      'glossary_consolidation',
      CONSOLIDATION_V2,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Data down-migration is lossy by nature; keep it simple — restore v1
    // prompt bodies and drop the column (content is derivable from entries in
    // the old world, not vice versa).
    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 1 WHERE "promptCode" IN ('glossary_generation', 'glossary_consolidation')`,
    );
    await queryRunner.query(
      `ALTER TABLE "language_glossary_sections" DROP COLUMN IF EXISTS "content"`,
    );
  }
}

interface OldEntry {
  id: string;
  type?: 'term_pair' | 'rule' | 'pattern';
  english?: string;
  preferred?: string;
  avoid?: string;
  text?: string;
  note?: string;
  examples?: string[];
  markdown?: string;
  status: string;
  importance?: number;
  provenance?: Record<string, unknown>;
}

interface NewProposal {
  id: string;
  markdown: string;
  status: string;
  importance?: number;
  provenance?: Record<string, unknown>;
}

/** Same rendering the old compiler used, so backfilled content matches what
 * the agent would have received. */
function renderOldEntry(entry: OldEntry): string {
  if (entry.markdown) return entry.markdown;
  switch (entry.type) {
    case 'term_pair': {
      if (!entry.english || !entry.preferred) return '';
      let line = `- ${entry.english}: say "${entry.preferred}"`;
      if (entry.avoid) line += `; avoid "${entry.avoid}"`;
      if (entry.note) line += ` (${entry.note})`;
      return line;
    }
    case 'rule':
    case 'pattern': {
      if (!entry.text) return '';
      const lines = [`- ${entry.text}`];
      for (const example of entry.examples ?? []) {
        lines.push(`  e.g. ${example}`);
      }
      return lines.join('\n');
    }
    default:
      return '';
  }
}

async function upsertPromptVersion(
  queryRunner: QueryRunner,
  promptCode: string,
  body: string,
): Promise<void> {
  await queryRunner.query(
    `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
       SELECT p."id", 2, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2
       ON CONFLICT ("promptId", "version") DO NOTHING`,
    [body, promptCode],
  );
  await queryRunner.query(
    `UPDATE "prompts" SET "currentVersion" = 2 WHERE "promptCode" = $1 AND "currentVersion" < 2`,
    [promptCode],
  );
}

const GENERATION_V2 = `You are an expert sociolinguist and localizer for a voice-AI mental-health training platform operating in India. AI agents role-play as clients speaking {{languageName}} (code: {{languageCode}}), but the underlying LLM only partially knows the language. Your job is to produce a compact GLOSSARY that CONSTRAINS and CORRECTS the agent's {{languageName}} — not to teach the language.

Language eval config (script, target variety, diglossia): {{evalConfig}}

The agents' known failure modes, in priority order:
1. Register mixing: literary/formal register leaks into clinical or emotional topics; conversation must stay COLLOQUIAL SPOKEN {{languageName}} throughout.
2. Grammatical agreement errors: wrong gender pronouns/verb forms, especially for female kin (mother, sister, wife).
3. Unnatural phrasing: word-for-word translations instead of how a native speaker actually talks.

Each section body is PLAIN MARKDOWN — short bullet lines a busy model can obey:
- Term pairs: - worry: say "டென்ஷன்" (avoid: "பதட்டம்")
- Rules with native-script examples:
  - Always use colloquial spoken forms, never literary verb endings.
    e.g. சாப்டீங்களா? (not சாப்பிட்டீர்களா?)
- Exemplar utterances for conversational moves.

Return STRICT JSON (no markdown fences around the JSON itself) — an array of sections whose "content" values are the markdown bodies:
[
  {
    "sectionCode": "core_style",
    "title": "Core style",
    "injectionMode": "always",
    "retrievalHint": null,
    "content": "- ...markdown lines..."
  },
  ...
]

REQUIRED SECTIONS:
1. "core_style" (injectionMode "always"): 6-10 lines — register policy, code-mixing policy (keep commonly code-mixed English words like app, tension, call, medicine as spoken), highest-impact term pairs.
2. "pronouns_kinship" (injectionMode "always"): 4-8 rules — gender/honorific agreement for kin terms (mother, father, sister, spouse), each with 2-3 native-script examples.
3. "clinical_terms" (injectionMode "retrieved", retrievalHint "Retrieve when the reply is turning toward diagnosis, symptoms, medication, therapy, or health advice"): 10-20 term pairs in colloquial register.
4. "emotions" (injectionMode "retrieved", retrievalHint "Retrieve when the reply will express or discuss feelings, moods, or emotional states"): 8-15 lines.
5. "smalltalk" (injectionMode "retrieved", retrievalHint "Retrieve for greetings, openings, closings, and casual chit-chat"): 6-12 exemplar utterances.

RULES:
- Native script only for {{languageName}} text (no transliteration), matching the script in the eval config.
- Colloquial SPOKEN register everywhere — write examples the way people talk, not the way textbooks write.
- English scaffolding for term names and rule text; native script for the language examples.
- Keep "always" sections tight: they are injected into every conversational turn under a strict token budget.
- Return ONLY the JSON array.`;

const CONSOLIDATION_V2 = `You are an expert sociolinguist maintaining a per-language GLOSSARY that constrains and corrects an AI agent speaking {{languageName}} (code: {{languageCode}}). A language-quality judge has flagged errors in real agent conversations. Your job is CONSOLIDATION: cluster these raw error instances into a FEW generalized markdown glossary lines that would prevent them.

Consolidation is compression — many instances become few lines:
- If several annotations show the same class of mistake, produce ONE line that generalizes it.
- Prefer amending the vocabulary domain where the error lives (clinical terms, emotions, pronouns) over inventing new sections.
- Do NOT restate what the existing glossary already covers (its content is listed below).
- Fewer, higher-leverage lines beat many narrow ones. Skip one-off errors that don't generalize.

THE EXISTING GLOSSARY (do not duplicate; use these sectionCodes when the line belongs there):
{{existingGlossary}}

THE ERROR ANNOTATIONS (numbered; each has dimension, category, severity, the offending span, and the judge's reasoning):
{{annotations}}

Return STRICT JSON (no markdown fences around the JSON itself) — an array of sections to amend or create:
[
  {
    "sectionCode": "<existing code, or a new snake_case code>",
    "title": "<required for NEW sections only>",
    "injectionMode": "<'always'|'retrieved', NEW sections only; default 'retrieved'>",
    "retrievalHint": "<NEW retrieved sections only: one line saying when to pull it>",
    "proposals": [
      {
        "markdown": "- <one glossary line in the same markdown style as the existing content; native script for {{languageName}} text; may include an indented 'e.g.' example line>",
        "importance": <1-5, 5 = most frequent/severe in the annotations>,
        "sourceAnnotationIndexes": [<numbers of the annotations this line generalizes>]
      }
    ]
  }
]

RULES:
- Native script for all {{languageName}} text; colloquial SPOKEN register.
- Every proposal MUST list the sourceAnnotationIndexes it generalizes.
- Only propose additions to 'always' sections for standing constraints (register policy, agreement rules) that matter on every turn.
- Return ONLY the JSON array. Return [] if nothing generalizes.`;
