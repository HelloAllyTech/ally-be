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
          'List the active TTS voices (id, name, provider, language). Call ' +
          'this before asking the voice question, then present the fitting ' +
          'voices via ask_question (kind="singleSelect" or "dropdown", one ' +
          'option per voice with id = voice id, label = "Name — Language"). ' +
          'The chosen id goes into save_character_draft.voiceId.',
        input_schema: { type: 'object', properties: {} },
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
            voiceId: {
              type: 'string',
              description:
                'Voice id chosen from get_voices (omit if the admin skipped voice)',
            },
            languageCharacteristics: {
              type: 'string',
              description:
                'Free-text speech-style guidance: dialect, register, ' +
                'code-mixing norms, pace, verbal tics (≤1000 chars)',
            },
            linguisticStyleSamples: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Sample utterances in the character’s literal voice ' +
                '(≤20 items, ≤300 chars each)',
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
          language: languageById.get(voice.languageId)?.label ?? null,
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
    const languageCharacteristics = str(input?.languageCharacteristics);
    if (languageCharacteristics.length > 1000) {
      errors.push('languageCharacteristics must be ≤1000 chars');
    }

    const linguisticStyleSamples = (
      Array.isArray(input?.linguisticStyleSamples)
        ? input.linguisticStyleSamples
        : []
    )
      .map((sample: unknown) => str(sample))
      .filter(Boolean);
    if (
      linguisticStyleSamples.length >
      MAX_CHARACTER_LINGUISTIC_STYLE_SAMPLES_COUNT
    ) {
      errors.push(
        `linguisticStyleSamples must have ≤${MAX_CHARACTER_LINGUISTIC_STYLE_SAMPLES_COUNT} items`,
      );
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

    // voiceId must be a real, active catalog voice — a made-up id would save
    // fine but point the character at nothing.
    const voiceId = str(input?.voiceId) || undefined;
    if (voiceId) {
      const voice = await this.dataSource
        .getRepository(ScenarioVoices)
        .findOne({ where: { id: voiceId, active: true } });
      if (!voice) {
        errors.push(
          `voiceId "${voiceId}" is not an active voice — call get_voices and use a real id, or omit voiceId`,
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
      ...(voiceId ? { voiceId } : {}),
      ...(languageCharacteristics ? { languageCharacteristics } : {}),
      ...(linguisticStyleSamples.length ? { linguisticStyleSamples } : {}),
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
