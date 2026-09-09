import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioVoices } from 'src/learn/entity/scenario-voices.entity';
import { Languages } from 'src/language/entity/languages.entity';
import { CharacterInterviewSession } from '../entity/character-interview-session.entity';
import { CharacterInterviewSessionRepository } from '../repository/character-interview-session.repository';
import { CharacterInterviewSessionStatus } from '../enum/character-interview.enum';
import { InterviewToolExecutionOutcome } from '../type/character-interview-sse.type';
import {
  MAX_CHARACTER_KNOWLEDGE_SOURCES_COUNT,
  MAX_CHARACTER_LINGUISTIC_STYLE_SAMPLES_COUNT,
} from '../constants/scenario-character.constants';
import { KnowledgeChunkPassage } from 'src/ai/dto/knowledge.dto';
import { KbSearchDto } from 'src/knowledge-base/dto/knowledge-base.dto';
import {
  KbCharacterTopic,
  KbCorpus,
  KbRetrievalConsumer,
} from 'src/knowledge-base/enum/knowledge-base.enum';
import { KnowledgeBaseService } from 'src/knowledge-base/service/knowledge-base.service';

/**
 * How many served chunk ids a session carries.
 *
 * A ~25-question interview searching a few times per phase will not approach this; the cap
 * exists so a pathological loop cannot grow an unbounded array on a row rewritten every turn.
 * Oldest ids fall off first, which at worst re-sends a passage from early in the interview.
 */
const MAX_SERVED_CHUNK_IDS = 200;

/** Mutable per-turn context threaded through tool executions. */
export interface InterviewToolExecutionContext {
  session: CharacterInterviewSession;
  userId: number;
}

// Must match the admin form's dropdown values (GENDER_OPTIONS /
// GENDER_IDENTITY_OPTIONS / SEXUAL_ORIENTATION_OPTIONS in ally-web
// constants/SimulationCreator.ts) or the review form shows an empty dropdown.
const GENDER_VALUES = ['male', 'female', 'non-binary'];
const GENDER_IDENTITY_VALUES = [
  'Agender',
  'Female/Woman',
  'Genderqueer',
  'Gender Fluid',
  'Gender Non-Conforming',
  'Intergender',
  'Intersex',
  'Male/Man',
  'Nonbinary',
  'Other',
  'Transgender',
  'Trans Man/Male',
  'Trans Woman/Female',
];
/**
 * Coerce a per-language map the model sent, tolerating the shape the tool
 * schema asked for BEFORE characters went per-language.
 *
 * The interviewer prompt is file-backed and may be dashboard-overridden in
 * production, so a deployed prompt can still be asking for a flat string or a
 * flat array. Filing such an answer under `fallbackKey` keeps the interview
 * working; rejecting it would strand the admin mid-draft over a contract
 * change they cannot see.
 */
/**
 * How a per-language key the model sent becomes a `languages.id`.
 *
 * Observed in production: one `save_character_draft` call keyed `voices` and
 * `languageCharacteristics` by numeric id and `linguisticStyleSamples` by
 * LOCALE (`"en-IN"`) — in the same call. A locale key is not a rejection, it
 * just stores content the studio can never render, since every language-keyed
 * form field looks up by numeric id. Same silent-invisibility class as a
 * language that is no longer enabled.
 */
export type LanguageKeyResolver = (key: string) => string;

/** Pull a sample out of whatever container the model wrapped it in. */
const asText = (raw: unknown): string => {
  if (typeof raw === 'string') return raw.trim();
  // Also observed in production: `[{ "sample": "..." }]` rather than
  // `["..."]`. Dropping these emptied every language and lost the whole set.
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const field of ['sample', 'text', 'value', 'utterance', 'line']) {
      const candidate = (raw as Record<string, unknown>)[field];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
  }
  return '';
};

/**
 * Coerce a per-language map the model sent, tolerating the shape the tool
 * schema asked for BEFORE characters went per-language.
 *
 * The interviewer prompt is file-backed and may be dashboard-overridden in
 * production, so a deployed prompt can still be asking for a flat string or a
 * flat array. Filing such an answer under `fallbackKey` keeps the interview
 * working; rejecting it would strand the admin mid-draft over a contract
 * change they cannot see.
 */
const objectOfStrings = (
  value: unknown,
  fallbackKey: string,
  resolveKey: LanguageKeyResolver,
): Record<string, string> => {
  if (typeof value === 'string') {
    return value.trim() ? { [fallbackKey]: value.trim() } : {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const languageId = resolveKey(String(key).trim()) || fallbackKey;
    const text = asText(raw);
    if (text) out[languageId] = text;
  }
  return out;
};

/** The same leniency for `{ "<languageId>": string[] }`. */
const objectOfStringArrays = (
  value: unknown,
  fallbackKey: string,
  resolveKey: LanguageKeyResolver,
): Record<string, string[]> => {
  const clean = (raw: unknown): string[] =>
    (Array.isArray(raw) ? raw : []).map((item) => asText(item)).filter(Boolean);

  if (Array.isArray(value)) {
    const list = clean(value);
    return list.length ? { [fallbackKey]: list } : {};
  }
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const languageId = resolveKey(String(key).trim()) || fallbackKey;
    // A single string where a list was asked for is still one sample.
    const list = typeof raw === 'string' ? clean([raw]) : clean(raw);
    if (list.length) out[languageId] = list;
  }
  return out;
};

const SEXUAL_ORIENTATION_VALUES = [
  'Asexual',
  'Bisexual',
  'Gay',
  'Heterosexual (straight)',
  'Lesbian',
  'Pansexual',
  'Queer',
  'Questioning',
];

/**
 * The interview agent's tool belt (modeled on CopilotToolsService).
 * ask_question and save_character_draft end the turn; get_voices is a
 * read-only catalog lookup. save_character_draft is the only mutating tool:
 * it validates the profile against the character-form limits and persists it
 * on the session row (NOT into scenario_characters — the human reviews the
 * draft in the character form and saves it there).
 */
@Injectable()
export class CharacterInterviewToolsService {
  private readonly logger = LoggerService.getInstance(
    CharacterInterviewToolsService.name,
  );

  constructor(
    private readonly sessionRepository: CharacterInterviewSessionRepository,
    private readonly dataSource: DataSource,
    private readonly knowledgeBaseService: KnowledgeBaseService,
  ) {}

  getToolDefinitions(): any[] {
    return [
      {
        name: 'ask_question',
        description:
          'Ask the admin ONE question and wait for their answer (the turn ends). ' +
          'Ask exactly one question at a time. Choose the kind that fits: ' +
          'freeText for open answers; singleSelect for one-of; multiSelect for ' +
          'many-of; dropdown for long option lists. For select/dropdown kinds ' +
          'each option is a {id,label,description?} object. ALWAYS set ' +
          'allowCustom=true on select questions so the admin can type their own ' +
          'answer instead; set allowNone to offer a "None of these" choice, and ' +
          'minSelections/maxSelections to bound multiSelect/dropdown answers.',
        input_schema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The question to ask' },
            kind: {
              type: 'string',
              enum: ['freeText', 'singleSelect', 'multiSelect', 'dropdown'],
            },
            options: {
              type: 'array',
              description:
                'Choices for singleSelect/multiSelect/dropdown (omit for freeText)',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['id', 'label'],
              },
            },
            allowCustom: {
              type: 'boolean',
              description: 'Show an "add your own" free-text entry',
            },
            allowNone: {
              type: 'boolean',
              description: 'Offer a "None of these" choice',
            },
            minSelections: {
              type: 'number',
              description: 'Minimum selections before the admin can confirm',
            },
            maxSelections: {
              type: 'number',
              description: 'Maximum selections allowed',
            },
          },
          required: ['prompt', 'kind'],
        },
      },
      {
        name: 'get_voices',
        description:
          'List the active TTS voices (id, name, provider, languageId, ' +
          'language). Call this before the voice questions, then ask ONE ' +
          'question PER language the character speaks via ask_question ' +
          '(kind="singleSelect" or "dropdown", one option per voice with ' +
          'id = voice id, label = "Name — Language", description = why it ' +
          'fits). Offer a language only the voices actually cover, and offer ' +
          "a language's own voices only — a voice belongs to one language and " +
          'is rejected under any other. The answers go into ' +
          "save_character_draft.voices, keyed by that voice's languageId.",
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'search_corpus',
        description:
          'Search the character-library corpus — clinical and lived-experience ' +
          'reference material an Ally admin has curated — for passages that can ' +
          'make the next question specific or the draft real. Read-only; the ' +
          'turn does NOT end, so search and then continue in the same turn.\n\n' +
          'Search when a phase turns on knowledge you should not invent: how a ' +
          'condition actually presents, what a day in some life is really like, ' +
          'how someone in that situation actually talks. Query in your own words, ' +
          'as a full question — not keywords. Pass `topics` for the part of the ' +
          'person you are working on; it boosts material a curator mapped there ' +
          'without hiding anything else.\n\n' +
          'An EMPTY result is a real, useful answer and not an error to retry. It ' +
          'means the corpus does not cover this. Do not rephrase and search again ' +
          'more than once, and NEVER present invented detail as though it came ' +
          'from the corpus — say what you are drawing on instead.',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'The question you want answered, in full words (e.g. "how does ' +
                'early-stage dementia change how someone speaks?")',
            },
            topics: {
              type: 'array',
              description:
                'Which part of the character this is about. Boosts, never ' +
                'restricts.',
              items: {
                type: 'string',
                enum: [
                  'identity',
                  'life_context',
                  'inner_life',
                  'history_and_presenting_concern',
                  'speech_and_language',
                ],
              },
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'save_character_draft',
        description:
          'Finish the interview: submit the COMPLETE character profile you ' +
          'built from the answers. The admin reviews it in the character form ' +
          'and saves it to the library from there, so every field must be ' +
          'final-quality. On validation failure you get the structured error ' +
          'list back and MUST self-repair with a corrected call.',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Full name (≤200 chars)' },
            age: { type: 'number', description: 'Age in years (1–150)' },
            gender: { type: 'string', enum: GENDER_VALUES },
            genderIdentity: {
              type: 'string',
              enum: GENDER_IDENTITY_VALUES,
            },
            sexualOrientation: {
              type: 'string',
              enum: SEXUAL_ORIENTATION_VALUES,
            },
            profession: {
              type: 'string',
              description: 'Occupation (≤200 chars)',
            },
            currentLocation: {
              type: 'string',
              description: 'Where they live now (≤300 chars)',
            },
            characterProfileText: {
              type: 'string',
              description:
                'The character backstory — rich, specific, internally ' +
                'consistent. HARD LIMIT 2500 chars; put overflow depth into ' +
                'knowledgeSources instead.',
            },
            voices: {
              type: 'object',
              description:
                'Chosen voice per language: { "<languageId>": "<voiceId>" }, ' +
                "the languageId taken from get_voices. Only that language's " +
                'own voices are accepted. Omit a language the admin skipped, ' +
                'and omit the object entirely if they skipped voice.',
              additionalProperties: { type: 'string' },
            },
            languageCharacteristics: {
              type: 'object',
              description:
                'Speech-style guidance PER LANGUAGE, keyed by languageId: ' +
                'dialect, register, code-mixing norms, pace, verbal tics ' +
                '(≤1000 chars each). Write each in terms of how they speak ' +
                'THAT language.',
              additionalProperties: { type: 'string' },
            },
            linguisticStyleSamples: {
              type: 'object',
              description:
                'Sample utterances PER LANGUAGE, keyed by languageId ' +
                "(≤20 per language, ≤300 chars each). Write each language's " +
                "samples in that language's own script — not translations of " +
                'the English ones.',
              additionalProperties: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            knowledgeSources: {
              type: 'array',
              description:
                'Topic-titled knowledge the character can draw on — family ' +
                'history, work life, the presenting concern, relationships… ' +
                'This is where the interview depth lives (≤50 items).',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: '≤200 chars' },
                  text: { type: 'string', description: '≤2500 chars' },
                },
                required: ['title', 'text'],
              },
            },
          },
          required: [
            'name',
            'age',
            'gender',
            'genderIdentity',
            'sexualOrientation',
            'profession',
            'currentLocation',
            'characterProfileText',
          ],
        },
      },
    ];
  }

  async execute(
    name: string,
    input: Record<string, any>,
    context: InterviewToolExecutionContext,
  ): Promise<InterviewToolExecutionOutcome> {
    switch (name) {
      case 'ask_question':
        return this.executeAskQuestion(input);
      case 'get_voices':
        return this.executeGetVoices();
      case 'search_corpus':
        return this.executeSearchCorpus(input, context);
      case 'save_character_draft':
        return this.executeSaveCharacterDraft(input, context);
      default:
        return {
          modelResult: { ok: false, error: `Unknown tool "${name}"` },
          summary: `Unknown tool "${name}"`,
        };
    }
  }

  private executeAskQuestion(
    input: Record<string, any>,
  ): InterviewToolExecutionOutcome {
    const questionId = uuidv4();
    const selectKinds = ['singleSelect', 'multiSelect', 'dropdown'];
    let kind = String(input?.kind ?? 'freeText');
    if (![...selectKinds, 'freeText'].includes(kind)) kind = 'freeText';

    const isSelect = selectKinds.includes(kind);
    const options = isSelect
      ? this.normalizeQuestionOptions(input?.options)
      : [];

    const question: Record<string, any> = {
      id: questionId,
      prompt: String(input?.prompt ?? ''),
      kind,
      ...(options.length ? { options } : {}),
      ...(input?.allowCustom ? { allowCustom: true } : {}),
      ...(input?.allowNone ? { allowNone: true } : {}),
      ...(typeof input?.minSelections === 'number'
        ? { minSelections: input.minSelections }
        : {}),
      ...(typeof input?.maxSelections === 'number'
        ? { maxSelections: input.maxSelections }
        : {}),
    };
    return {
      modelResult: {
        ok: true,
        questionId,
        note: 'Question delivered; the admin will answer in their next message.',
      },
      summary: `Asked: ${question.prompt}`,
      events: [{ event: 'question', data: question }],
      endTurn: true,
    };
  }

  /** Accepts {id,label,description?} objects or bare strings. */
  private normalizeQuestionOptions(
    raw: unknown,
  ): { id: string; label: string; description?: string }[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((opt) => {
        if (typeof opt === 'string') {
          const value = opt.trim();
          return value ? { id: value, label: value } : null;
        }
        if (opt && typeof opt === 'object') {
          const o = opt as Record<string, any>;
          const id = String(o.id ?? o.label ?? '').trim();
          const label = String(o.label ?? o.id ?? '').trim();
          if (!id || !label) return null;
          return o.description
            ? { id, label, description: String(o.description) }
            : { id, label };
        }
        return null;
      })
      .filter(Boolean) as { id: string; label: string; description?: string }[];
  }

  /**
   * The language a flat, pre-per-language answer belongs to: the named voice's
   * own language, else English, else id 1. Never a guess that could file a
   * Marathi voice under English — that is the bug this model change removes.
   */
  /**
   * Maps whatever the model used as a per-language key onto a `languages.id`:
   * a numeric id passes through, a locale (`en-IN`) or a bare code (`hi`)
   * resolves, and anything unrecognised is left alone for the caller's
   * fallback to handle.
   */
  private async buildLanguageKeyResolver(): Promise<LanguageKeyResolver> {
    const languages = await this.dataSource.getRepository(Languages).find();
    const byCode = new Map<string, string>();
    for (const language of languages) {
      for (const code of [language.value, language.translationCode]) {
        const normalized = String(code ?? '')
          .trim()
          .toLowerCase();
        // First writer wins, so a specific locale is not shadowed by a bare
        // code registered on another row.
        if (normalized && !byCode.has(normalized)) {
          byCode.set(normalized, String(language.id));
        }
      }
    }

    return (key: string): string => {
      const raw = String(key ?? '').trim();
      if (!raw) return raw;
      if (/^\d+$/.test(raw)) return raw;
      const exact = byCode.get(raw.toLowerCase());
      if (exact) return exact;
      // "en-IN" -> "en" when only the bare code is registered.
      const base = raw.split(/[-_]/)[0].toLowerCase();
      return byCode.get(base) ?? raw;
    };
  }

  private async resolveFallbackLanguageKey(voiceId?: string): Promise<string> {
    if (voiceId) {
      const voice = await this.dataSource
        .getRepository(ScenarioVoices)
        .findOne({ where: { id: voiceId } });
      if (voice?.languageId != null) return String(voice.languageId);
    }
    const english = await this.dataSource
      .getRepository(Languages)
      .findOne({ where: { value: 'en-IN' } });
    return english ? String(english.id) : '1';
  }

  /**
   * Retrieve grounding passages for the interview, and remember what this session has
   * already been shown.
   *
   * TWO THINGS ARE DELIBERATE HERE.
   *
   * An empty result comes back as ok:TRUE with an explicit note, never ok:false. Every other
   * tool uses ok:false to mean "you got this wrong, repair and retry", and the model obliges —
   * so reporting "the corpus has nothing on this" as a failure would send it into a rephrase
   * loop against a corpus that genuinely does not cover the topic, burning turns to arrive
   * back where it started. "I found nothing" is a correct answer to a good question.
   *
   * A passage this session has already been given comes back as a REFERENCE rather than its
   * full text. The interview loop resends the entire transcript every turn, so an 800-token
   * passage retrieved twice is not paid for twice — it is paid for on every turn from then
   * on, twice over. Tracking the served chunk ids costs a jsonb write and removes that
   * entirely; the model still learns the passage matched its new query, which is the part
   * carrying information.
   */
  private async executeSearchCorpus(
    input: Record<string, any>,
    context: InterviewToolExecutionContext,
  ): Promise<InterviewToolExecutionOutcome> {
    const query = String(input?.query ?? '').trim();
    if (!query) {
      return {
        modelResult: { ok: false, error: 'A query is required to search.' },
        summary: 'Corpus search skipped - no query',
      };
    }

    const topics = this.normalizeCharacterTopics(input?.topics);

    let passages: KnowledgeChunkPassage[];
    try {
      ({ passages } = await this.knowledgeBaseService.search(
        {
          corpus: KbCorpus.CHARACTER_LIBRARY,
          query,
          characterTopics: topics,
        } as KbSearchDto,
        {
          consumer: KbRetrievalConsumer.INTERVIEW_AGENT,
          sessionId: context.session.id,
          userId: context.userId,
        },
      ));
    } catch (error) {
      // The interview is worth more than its grounding. A vector store that is down must
      // degrade the questions, not end the session - and the model has to be TOLD that is
      // what happened, or it will read an empty result as "the corpus has nothing" and say
      // so to the admin, which would be a lie about the library's contents.
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `Interview session ${context.session.id}: corpus search failed - ${message}`,
      );
      return {
        modelResult: {
          ok: false,
          error:
            'The reference corpus could not be reached, so this search returned ' +
            'nothing. This is NOT evidence the corpus lacks the material - do not ' +
            'tell the admin it has nothing. Carry on from what you already know.',
        },
        summary: 'Corpus search failed (retrieval unavailable)',
      };
    }

    const alreadyServed = new Set(this.servedChunkIds(context.session));
    const fresh: string[] = [];

    const results = passages.map((passage) => {
      const seen = alreadyServed.has(passage.chunk_id);
      if (!seen) fresh.push(passage.chunk_id);
      return {
        chunkId: passage.chunk_id,
        document: passage.document_title,
        ...(passage.section_path ? { section: passage.section_path } : {}),
        similarity: Number(passage.similarity.toFixed(4)),
        ...(seen
          ? {
              text: null,
              note: 'Already provided earlier in this interview - reuse it from above rather than asking for it again.',
            }
          : { text: passage.text }),
      };
    });

    if (fresh.length) {
      await this.rememberServedChunks(context.session, fresh);
    }

    return {
      modelResult: {
        ok: true,
        passages: results,
        ...(results.length
          ? {}
          : {
              note:
                'The corpus has nothing on this. That is a real answer, not a ' +
                'failure - draw on what the admin has told you, and do not imply ' +
                'any of it came from reference material.',
            }),
      },
      summary: results.length
        ? `Corpus: ${results.length} passage(s) for "${query}"`
        : `Corpus: nothing found for "${query}"`,
    };
  }

  /** Only the topics the schema defines; anything else is dropped rather than sent on. */
  private normalizeCharacterTopics(raw: unknown): KbCharacterTopic[] {
    if (!Array.isArray(raw)) return [];
    const allowed = new Set<string>(Object.values(KbCharacterTopic));
    return raw
      .map((value) => String(value ?? '').trim())
      .filter((value) => allowed.has(value)) as KbCharacterTopic[];
  }

  private servedChunkIds(session: CharacterInterviewSession): string[] {
    const served = session.metadata?.servedChunkIds;
    return Array.isArray(served) ? served.map((id) => String(id)) : [];
  }

  /**
   * Append to the session's served set.
   *
   * Read-modify-write on a jsonb column, safe here only because one interview turn runs at a
   * time per session - the orchestrator's loop is sequential and a session has a single
   * admin. Capped because the set is a token optimisation, not a record: an unbounded array
   * on a hot row would eventually cost more to carry than the duplicate passages it saves.
   */
  private async rememberServedChunks(
    session: CharacterInterviewSession,
    chunkIds: string[],
  ): Promise<void> {
    const merged = [...this.servedChunkIds(session), ...chunkIds].slice(
      -MAX_SERVED_CHUNK_IDS,
    );
    session.metadata = { ...(session.metadata ?? {}), servedChunkIds: merged };
    try {
      await this.sessionRepository.update(
        { id: session.id },
        { metadata: session.metadata },
      );
    } catch (error) {
      // Losing the set costs tokens, never correctness - the next search just resends a
      // passage the model already has. Not worth failing a turn over.
      this.logger.warn(
        `Interview session ${session.id}: could not record served chunks - ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async executeGetVoices(): Promise<InterviewToolExecutionOutcome> {
    const voices = await this.dataSource
      .getRepository(ScenarioVoices)
      .find({ where: { active: true }, order: { name: 'ASC' } });
    const languageIds = [...new Set(voices.map((voice) => voice.languageId))];
    const languages = languageIds.length
      ? await this.dataSource
          .getRepository(Languages)
          .findBy({ id: In(languageIds) })
      : [];
    const languageById = new Map(languages.map((lang) => [lang.id, lang]));
    return {
      modelResult: {
        ok: true,
        voices: voices.map((voice) => ({
          id: voice.id,
          name: voice.name,
          provider: voice.provider,
          // The key the draft must file this voice under. Without it the
          // model had only a display label to go on and would have had to
          // guess the id.
          languageId: voice.languageId ?? null,
          language: languageById.get(voice.languageId)?.label ?? null,
          gender: (voice.config as Record<string, unknown>)?.gender ?? null,
          age: (voice.config as Record<string, unknown>)?.age ?? null,
        })),
      },
      summary: `Listed ${voices.length} active voice(s)`,
    };
  }

  /**
   * Validate the profile against the character-form limits, persist it on
   * the session row, and emit `character_draft`. Validation failures come
   * back as ok:false so the model self-repairs; nothing is written to
   * scenario_characters here.
   */
  private async executeSaveCharacterDraft(
    input: Record<string, any>,
    context: InterviewToolExecutionContext,
  ): Promise<InterviewToolExecutionOutcome> {
    const errors: string[] = [];
    const str = (value: unknown) =>
      typeof value === 'string' ? value.trim() : '';

    const name = str(input?.name);
    if (!name || name.length > 200) {
      errors.push('name is required (1–200 chars)');
    }
    const age = Number(input?.age);
    if (!Number.isFinite(age) || age < 1 || age > 150) {
      errors.push('age must be a number between 1 and 150');
    }
    const gender = str(input?.gender);
    if (!GENDER_VALUES.includes(gender)) {
      errors.push(`gender must be one of: ${GENDER_VALUES.join(', ')}`);
    }
    const genderIdentity = str(input?.genderIdentity);
    if (!GENDER_IDENTITY_VALUES.includes(genderIdentity)) {
      errors.push(
        `genderIdentity must be one of: ${GENDER_IDENTITY_VALUES.join(', ')}`,
      );
    }
    const sexualOrientation = str(input?.sexualOrientation);
    if (!SEXUAL_ORIENTATION_VALUES.includes(sexualOrientation)) {
      errors.push(
        `sexualOrientation must be one of: ${SEXUAL_ORIENTATION_VALUES.join(', ')}`,
      );
    }
    const profession = str(input?.profession);
    if (!profession || profession.length > 200) {
      errors.push('profession is required (1–200 chars)');
    }
    const currentLocation = str(input?.currentLocation);
    if (!currentLocation || currentLocation.length > 300) {
      errors.push('currentLocation is required (1–300 chars)');
    }
    const characterProfileText = str(input?.characterProfileText);
    if (!characterProfileText) {
      errors.push('characterProfileText is required');
    } else if (characterProfileText.length > 2500) {
      errors.push(
        `characterProfileText is ${characterProfileText.length} chars — the hard limit is 2500. ` +
          'Compress it and move the overflow depth into knowledgeSources.',
      );
    }
    // Per-language maps now. Kept lenient about the container the model sends
    // — a flat string or array is what the previous contract asked for, and a
    // dashboard-overridden interviewer prompt may still be asking for it — so
    // an old-shaped answer is filed under the language its voice implies
    // rather than rejected.
    // Where a flat, old-shaped answer gets filed: the language of the voice
    // the model named, else English. Resolved once so a legacy draft's voice,
    // style and samples cannot land under different languages.
    const fallbackLanguageKey = await this.resolveFallbackLanguageKey(
      str(input?.voiceId) || undefined,
    );
    const resolveLanguageKey = await this.buildLanguageKeyResolver();

    const languageCharacteristics = objectOfStrings(
      input?.languageCharacteristics,
      fallbackLanguageKey,
      resolveLanguageKey,
    );
    for (const [languageId, value] of Object.entries(languageCharacteristics)) {
      if (value.length > 1000) {
        errors.push(
          `languageCharacteristics["${languageId}"] must be ≤1000 chars`,
        );
      }
    }

    const samplesByLanguage = objectOfStringArrays(
      input?.linguisticStyleSamples,
      fallbackLanguageKey,
      resolveLanguageKey,
    );
    const linguisticStyleSamples = Object.values(samplesByLanguage).flat();
    for (const [languageId, samples] of Object.entries(samplesByLanguage)) {
      if (samples.length > MAX_CHARACTER_LINGUISTIC_STYLE_SAMPLES_COUNT) {
        errors.push(
          `linguisticStyleSamples["${languageId}"] must have ` +
            `≤${MAX_CHARACTER_LINGUISTIC_STYLE_SAMPLES_COUNT} items`,
        );
      }
    }
    if (linguisticStyleSamples.some((sample) => sample.length > 300)) {
      errors.push('each linguistic style sample must be ≤300 chars');
    }

    const knowledgeSources = (
      Array.isArray(input?.knowledgeSources) ? input.knowledgeSources : []
    )
      .map((source: any) => ({
        id: uuidv4(),
        title: str(source?.title),
        text: str(source?.text),
      }))
      .filter((source) => source.title);
    if (knowledgeSources.length > MAX_CHARACTER_KNOWLEDGE_SOURCES_COUNT) {
      errors.push(
        `knowledgeSources must have ≤${MAX_CHARACTER_KNOWLEDGE_SOURCES_COUNT} items`,
      );
    }
    if (knowledgeSources.some((source) => source.title.length > 200)) {
      errors.push('each knowledge source title must be ≤200 chars');
    }
    if (knowledgeSources.some((source) => source.text.length > 2500)) {
      errors.push('each knowledge source text must be ≤2500 chars');
    }

    // Every voice must be a real, active catalog voice AND belong to the
    // language it is filed under. A made-up id would save fine but point the
    // character at nothing; an id borrowed from another language dispatches
    // that language's TTS into a session in this one.
    const voices = objectOfStrings(
      input?.voices ?? (str(input?.voiceId) ? { '': str(input.voiceId) } : {}),
      fallbackLanguageKey,
      resolveLanguageKey,
    );
    for (const [languageId, voiceId] of Object.entries(voices)) {
      const voice = await this.dataSource
        .getRepository(ScenarioVoices)
        .findOne({ where: { id: voiceId, active: true } });
      if (!voice) {
        errors.push(
          `voices["${languageId}"] = "${voiceId}" is not an active voice — ` +
            'call get_voices and use a real id, or omit that language',
        );
        continue;
      }
      if (voice.languageId != null && String(voice.languageId) !== languageId) {
        errors.push(
          `voices["${languageId}"] = "${voice.name}" belongs to language ` +
            `${voice.languageId} — file each voice under its own languageId`,
        );
      }
    }

    if (errors.length > 0) {
      return {
        modelResult: {
          ok: false,
          error: 'validation_failed',
          message:
            'The character draft is invalid. Fix these and retry save_character_draft.',
          errors,
        },
        summary: `Draft rejected: ${errors.length} validation error(s)`,
      };
    }

    const draft: Record<string, any> = {
      name,
      age,
      gender,
      genderIdentity,
      sexualOrientation,
      profession,
      currentLocation,
      characterProfileText,
      ...(Object.keys(voices).length ? { voices } : {}),
      ...(Object.keys(languageCharacteristics).length
        ? { languageCharacteristics }
        : {}),
      ...(Object.keys(samplesByLanguage).length
        ? { linguisticStyleSamples: samplesByLanguage }
        : {}),
      ...(knowledgeSources.length ? { knowledgeSources } : {}),
    };

    // Partial UPDATE, not a full-entity save: context.session was loaded at
    // the top of the turn, before the orchestrator's atomic
    // `lastMessageSeq + 1` append for the user message. Saving the whole
    // (now-stale) entity would overwrite that counter back down and the
    // orchestrator's next append (the assistant row) would collide on the
    // (sessionId, seq) unique index. Touching only these three columns
    // leaves lastMessageSeq alone regardless of staleness.
    await this.sessionRepository.update(
      { id: context.session.id },
      {
        draftCharacter: draft,
        status: CharacterInterviewSessionStatus.COMPLETED,
        updatedBy: context.userId,
      },
    );
    context.session = {
      ...context.session,
      draftCharacter: draft,
      status: CharacterInterviewSessionStatus.COMPLETED,
      updatedBy: context.userId,
    };

    this.logger.info(
      `Character interview draft saved: session=${context.session.id} name="${name}"`,
    );
    return {
      modelResult: {
        ok: true,
        note: 'Draft delivered — the admin now reviews it in the character form. The interview is complete; thank them briefly.',
      },
      summary: `Character draft ready: ${name}`,
      events: [{ event: 'character_draft', data: { draft } }],
      endTurn: true,
    };
  }
}
