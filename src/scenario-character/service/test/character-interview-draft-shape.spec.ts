import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CharacterInterviewToolsService } from '../character-interview-tools.service';
import { CharacterInterviewSessionRepository } from '../../repository/character-interview-session.repository';
import { LoggerService } from 'src/logger/logger.service';

jest.mock('src/logger/logger.service');

/**
 * How `save_character_draft` copes with the per-language shapes a live model
 * actually sends.
 *
 * Every case here was observed in production, in a single call: `voices` and
 * `languageCharacteristics` keyed by numeric id while `linguisticStyleSamples`
 * was keyed by LOCALE, with its samples wrapped as `{ "sample": "..." }`
 * objects rather than plain strings. The strict reading dropped every language
 * and the whole sample set vanished with the draft still reported as saved —
 * the same silent-invisibility failure as content keyed to a language the
 * studio no longer lists.
 */

const LANGUAGES = [
  { id: 1, value: 'en-IN', translationCode: 'en', label: 'English (India)' },
  { id: 2, value: 'hi-IN', translationCode: 'hi', label: 'Hindi (India)' },
  { id: 5, value: 'mr-IN', translationCode: 'mr', label: 'Marathi (India)' },
];

const VOICES = [
  { id: 'voice-en', name: 'Anushka', languageId: 1, active: true },
  { id: 'voice-hi', name: 'Manisha', languageId: 2, active: true },
];

describe('save_character_draft — per-language shapes', () => {
  let service: CharacterInterviewToolsService;
  let saved: Record<string, any>;

  const sessionRepository = { update: jest.fn(), findOne: jest.fn() };

  const dataSource = {
    getRepository: jest.fn((entity: any) => {
      const name = entity?.name ?? '';
      if (/Languages/i.test(name)) {
        return {
          find: jest.fn(async () => LANGUAGES),
          findOne: jest.fn(async () => LANGUAGES[0]),
        };
      }
      return {
        find: jest.fn(async () => VOICES),
        findOne: jest.fn(
          async ({ where }: any) =>
            VOICES.find((v) => v.id === where?.id) ?? null,
        ),
      };
    }),
  };

  const base = {
    name: 'Priya',
    age: 34,
    gender: 'female',
    genderIdentity: 'Female/Woman',
    sexualOrientation: 'Heterosexual (straight)',
    profession: 'Schoolteacher',
    currentLocation: 'Pune',
    characterProfileText: 'A 34-year-old schoolteacher in Pune.',
  };

  const run = async (input: Record<string, any>) => {
    saved = {};
    sessionRepository.update.mockImplementation((_id: string, patch: any) => {
      saved = patch;
      return Promise.resolve({ affected: 1 });
    });
    const outcome = await (service as any).executeSaveCharacterDraft(
      { ...base, ...input },
      { session: { id: 'sess-1', lastMessageSeq: 1 }, userId: 1 },
    );
    return { outcome, draft: saved.draftCharacter ?? {} };
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (LoggerService.getInstance as jest.Mock) = jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterInterviewToolsService,
        {
          provide: CharacterInterviewSessionRepository,
          useValue: sessionRepository,
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    service = module.get(CharacterInterviewToolsService);
  });

  it('resolves locale keys to language ids', async () => {
    const { draft } = await run({
      linguisticStyleSamples: {
        'en-IN': ['I am managing.'],
        'hi-IN': ['मैं ठीक हूँ।'],
      },
    });

    // A locale key would store fine and never render: the studio's
    // language-keyed fields all look up by numeric id.
    expect(Object.keys(draft.linguisticStyleSamples ?? {}).sort()).toEqual([
      '1',
      '2',
    ]);
  });

  it('resolves a bare language code too', async () => {
    const { draft } = await run({
      languageCharacteristics: { mr: 'Colloquial Pune Marathi' },
    });
    expect(draft.languageCharacteristics).toEqual({
      '5': 'Colloquial Pune Marathi',
    });
  });

  it('unwraps samples the model wrapped in objects', async () => {
    const { draft } = await run({
      linguisticStyleSamples: {
        '1': [
          { sample: 'The syllabus requires three plays.' },
          { sample: "It's manageable." },
        ],
      },
    });

    // The exact production payload. Filtering these as "not strings" emptied
    // the array, which then dropped the language entirely.
    expect(draft.linguisticStyleSamples).toEqual({
      '1': ['The syllabus requires three plays.', "It's manageable."],
    });
  });

  it('handles the real call: ids for voices, locales and wrapped samples together', async () => {
    const { draft } = await run({
      voices: { '1': 'voice-en', '2': 'voice-hi' },
      languageCharacteristics: { '1': 'Formal English', '2': 'Warm Hindi' },
      linguisticStyleSamples: { 'en-IN': [{ sample: 'I am fine.' }] },
    });

    expect(draft.voices).toEqual({ '1': 'voice-en', '2': 'voice-hi' });
    expect(draft.languageCharacteristics).toEqual({
      '1': 'Formal English',
      '2': 'Warm Hindi',
    });
    expect(draft.linguisticStyleSamples).toEqual({ '1': ['I am fine.'] });
  });

  it('takes a single string where a list was asked for', async () => {
    const { draft } = await run({
      linguisticStyleSamples: { '1': 'Just the one line.' },
    });
    expect(draft.linguisticStyleSamples).toEqual({
      '1': ['Just the one line.'],
    });
  });

  it('still accepts the pre-per-language flat shape', async () => {
    // A dashboard-overridden prompt may still be asking for it.
    const { draft } = await run({
      voiceId: 'voice-hi',
      languageCharacteristics: 'Warm Hindi',
      linguisticStyleSamples: ['मैं ठीक हूँ।'],
    });

    // Filed under the named voice's own language, not blindly under English.
    expect(draft.voices).toEqual({ '2': 'voice-hi' });
    expect(draft.languageCharacteristics).toEqual({ '2': 'Warm Hindi' });
    expect(draft.linguisticStyleSamples).toEqual({ '2': ['मैं ठीक हूँ।'] });
  });

  it('rejects a voice filed under a language it does not belong to', async () => {
    const { outcome } = await run({ voices: { '1': 'voice-hi' } });
    expect(outcome.modelResult.ok).toBe(false);
    expect(JSON.stringify(outcome.modelResult.errors)).toMatch(
      /belongs to language 2/,
    );
  });

  it('leaves an unrecognisable key alone rather than guessing', async () => {
    const { draft } = await run({
      languageCharacteristics: { klingon: 'nope' },
    });
    expect(Object.keys(draft.languageCharacteristics ?? {})).toEqual([
      'klingon',
    ]);
  });
});
