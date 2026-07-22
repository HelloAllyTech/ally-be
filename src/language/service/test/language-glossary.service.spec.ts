import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  GlossaryEntryStatus,
  GlossaryInjectionMode,
  GlossarySectionStatus,
  LanguageGlossarySection,
} from '../../entity/language-glossary-section.entity';
import { LanguageGlossaryService } from '../language-glossary.service';
import { UpsertGlossarySectionDto } from '../../dto/glossary-section.dto';

const tamil = { id: 6, value: 'ta-IN', label: 'Tamil (India)', evalConfig: {} };

const makeSection = (
  overrides: Partial<LanguageGlossarySection> = {},
): LanguageGlossarySection =>
  ({
    id: 'sec-1',
    languageId: 6,
    sectionCode: 'core_style',
    title: 'Core style',
    entries: [
      {
        id: 'e1',
        type: 'rule',
        text: 'Speak colloquial Tamil.',
        status: GlossaryEntryStatus.PUBLISHED,
      },
    ],
    injectionMode: GlossaryInjectionMode.ALWAYS,
    status: GlossarySectionStatus.DRAFT,
    version: 1,
    ...overrides,
  }) as LanguageGlossarySection;

describe('LanguageGlossaryService', () => {
  let service: LanguageGlossaryService;
  let glossaryRepository: any;
  let languagesRepository: any;
  let promptRepository: any;
  let promptVersionRepository: any;
  let annotationRepository: any;
  let llmProviderFactory: any;
  let getCompletion: jest.Mock;

  beforeEach(() => {
    glossaryRepository = {
      findAllForLanguage: jest.fn().mockResolvedValue([]),
      findPublishedByLanguage: jest.fn().mockResolvedValue([]),
      findSection: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => v),
    };
    languagesRepository = { findOne: jest.fn().mockResolvedValue(tamil) };
    promptRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'p1',
        promptCode: 'glossary_generation',
        useDashboardOverride: true,
        currentVersion: 1,
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        temperature: null,
      }),
    };
    promptVersionRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ prompt: 'Generate for {{languageName}}' }),
    };
    annotationRepository = { find: jest.fn().mockResolvedValue([]) };
    getCompletion = jest.fn();
    llmProviderFactory = {
      getProvider: jest.fn().mockReturnValue({ getCompletion }),
    };
    const configService = {
      promptTranslation: {
        defaultProvider: 'gemini',
        defaultModel: 'gemini-2.5-pro',
        temperature: 0.2,
        maxTokens: 8192,
      },
    };
    service = new LanguageGlossaryService(
      glossaryRepository,
      languagesRepository,
      promptRepository,
      promptVersionRepository,
      annotationRepository,
      llmProviderFactory,
      configService as any,
    );
  });

  describe('upsertSection', () => {
    const dto: UpsertGlossarySectionDto = {
      title: 'Core style',
      entries: [
        {
          id: 'e1',
          type: 'rule',
          text: 'Speak colloquial Tamil.',
          status: GlossaryEntryStatus.PUBLISHED,
        },
      ] as any,
      injectionMode: GlossaryInjectionMode.ALWAYS,
    };

    it('creates a new draft section at version 1', async () => {
      const saved = await service.upsertSection(6, 'core_style', dto);
      expect(saved.status).toBe(GlossarySectionStatus.DRAFT);
      expect(saved.version).toBe(1);
      expect(glossaryRepository.save).toHaveBeenCalled();
    });

    it('bumps version when updating an existing section', async () => {
      glossaryRepository.findSection.mockResolvedValue(
        makeSection({ version: 3 }),
      );
      const saved = await service.upsertSection(6, 'core_style', dto);
      expect(saved.version).toBe(4);
    });

    it('rejects when language does not exist', async () => {
      languagesRepository.findOne.mockResolvedValue(null);
      await expect(
        service.upsertSection(99, 'core_style', dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('enforces the Tier 0 cap when editing a published always-section', async () => {
      const huge = {
        ...dto,
        entries: Array.from({ length: 199 }, (_, i) => ({
          id: `e${i}`,
          type: 'rule' as const,
          text: `A long rule about colloquial spoken Tamil register number ${i}. `.repeat(
            5,
          ),
          status: GlossaryEntryStatus.PUBLISHED,
        })),
      } as UpsertGlossarySectionDto;
      glossaryRepository.findSection.mockResolvedValue(
        makeSection({ status: GlossarySectionStatus.PUBLISHED }),
      );
      await expect(
        service.upsertSection(6, 'core_style', huge),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('publishSection', () => {
    it('publishes an under-cap always-section', async () => {
      glossaryRepository.findSection.mockResolvedValue(makeSection());
      const saved = await service.publishSection(6, 'core_style');
      expect(saved.status).toBe(GlossarySectionStatus.PUBLISHED);
    });

    it('blocks publish when the prospective Tier 0 set exceeds the cap', async () => {
      const bigEntries = Array.from({ length: 150 }, (_, i) => ({
        id: `e${i}`,
        type: 'rule' as const,
        text: `Very long standing instruction about register and agreement ${i}. `.repeat(
          6,
        ),
        status: GlossaryEntryStatus.PUBLISHED,
      }));
      glossaryRepository.findSection.mockResolvedValue(
        makeSection({ sectionCode: 'pronouns_kinship', entries: bigEntries }),
      );
      glossaryRepository.findPublishedByLanguage.mockResolvedValue([
        makeSection({
          status: GlossarySectionStatus.PUBLISHED,
          entries: bigEntries,
        }),
      ]);
      await expect(
        service.publishSection(6, 'pronouns_kinship'),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s on a missing section', async () => {
      await expect(service.publishSection(6, 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('archiveSection', () => {
    it('archives an existing section', async () => {
      glossaryRepository.findSection.mockResolvedValue(
        makeSection({ status: GlossarySectionStatus.PUBLISHED }),
      );
      const saved = await service.archiveSection(6, 'core_style');
      expect(saved.status).toBe(GlossarySectionStatus.ARCHIVED);
    });
  });

  describe('resolveTier1Sections', () => {
    it('compiles published retrieved sections with their hints, dropping empty ones', async () => {
      glossaryRepository.findPublishedByLanguage.mockResolvedValue([
        makeSection({
          sectionCode: 'clinical_terms',
          title: 'Clinical terms',
          injectionMode: GlossaryInjectionMode.RETRIEVED,
          status: GlossarySectionStatus.PUBLISHED,
          retrievalHint: 'Retrieve when clinical.',
        }),
        makeSection({
          sectionCode: 'empty_one',
          title: 'Empty',
          injectionMode: GlossaryInjectionMode.RETRIEVED,
          status: GlossarySectionStatus.PUBLISHED,
          entries: [],
        }),
      ]);
      const out = await service.resolveTier1Sections(6);
      expect(glossaryRepository.findPublishedByLanguage).toHaveBeenCalledWith(
        6,
        GlossaryInjectionMode.RETRIEVED,
      );
      expect(out).toHaveLength(1);
      expect(out[0].title).toBe('Clinical terms');
      expect(out[0].retrievalHint).toBe('Retrieve when clinical.');
      expect(out[0].content).toContain('## Clinical terms');
    });
  });

  describe('resolveTier0Glossary', () => {
    it('compiles only published always-sections', async () => {
      glossaryRepository.findPublishedByLanguage.mockResolvedValue([
        makeSection({ status: GlossarySectionStatus.PUBLISHED }),
      ]);
      const out = await service.resolveTier0Glossary(6);
      expect(out).toContain('## Core style');
      expect(glossaryRepository.findPublishedByLanguage).toHaveBeenCalledWith(
        6,
        GlossaryInjectionMode.ALWAYS,
      );
    });
  });

  describe('generateDraftGlossary', () => {
    const generated = [
      {
        sectionCode: 'core_style',
        title: 'Core style',
        injectionMode: 'always',
        retrievalHint: null,
        entries: [{ type: 'rule', text: 'Speak colloquial Tamil.' }],
      },
      {
        sectionCode: 'clinical_terms',
        title: 'Clinical terms',
        injectionMode: 'retrieved',
        retrievalHint: 'Retrieve when clinical.',
        entries: [
          { type: 'term_pair', english: 'worry', preferred: 'டென்ஷன்' },
        ],
      },
    ];

    it('parses fenced JSON, fills placeholders, and saves drafts with fresh entry ids', async () => {
      getCompletion.mockResolvedValue(
        '```json\n' + JSON.stringify(generated) + '\n```',
      );
      const result = await service.generateDraftGlossary(6);
      expect(result.created).toEqual(['core_style', 'clinical_terms']);
      const [systemMessage] = getCompletion.mock.calls[0][0];
      expect(systemMessage.content).toContain('Tamil (India)');
      const savedSections = glossaryRepository.save.mock.calls.map(
        (c: any[]) => c[0],
      );
      expect(savedSections[0].status).toBe(GlossarySectionStatus.DRAFT);
      expect(savedSections[0].entries[0].id).toBeDefined();
      expect(savedSections[0].entries[0].status).toBe(
        GlossaryEntryStatus.PUBLISHED,
      );
      expect(savedSections[1].retrievalHint).toBe('Retrieve when clinical.');
    });

    it('never overwrites published sections', async () => {
      getCompletion.mockResolvedValue(JSON.stringify(generated));
      glossaryRepository.findSection.mockImplementation(
        async (_: number, code: string) =>
          code === 'core_style'
            ? makeSection({ status: GlossarySectionStatus.PUBLISHED })
            : null,
      );
      const result = await service.generateDraftGlossary(6);
      expect(result.skipped).toEqual(['core_style']);
      expect(result.created).toEqual(['clinical_terms']);
    });

    it('rejects unparseable model output', async () => {
      getCompletion.mockResolvedValue('sorry, here is your glossary: ...');
      await expect(service.generateDraftGlossary(6)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('backfillGlossaries', () => {
    it('generates for every active non-English language, capturing per-language failures', async () => {
      languagesRepository.find = jest.fn().mockResolvedValue([
        { id: 1, value: 'en-IN', label: 'English (India)', active: true },
        { id: 6, value: 'ta-IN', label: 'Tamil (India)', active: true },
        { id: 2, value: 'hi-IN', label: 'Hindi (India)', active: true },
      ]);
      const spy = jest
        .spyOn(service, 'generateDraftGlossary')
        .mockResolvedValueOnce({
          created: ['core_style'],
          updated: [],
          skipped: [],
        })
        .mockRejectedValueOnce(new Error('gemini down'));

      const outcomes = await service.backfillGlossaries();

      expect(spy).toHaveBeenCalledTimes(2);
      expect(outcomes.map((o) => o.value)).toEqual(['ta-IN', 'hi-IN']);
      expect(outcomes[0].created).toEqual(['core_style']);
      expect(outcomes[1].error).toBe('gemini down');
    });

    it('targets explicit language ids when given', async () => {
      languagesRepository.find = jest
        .fn()
        .mockResolvedValue([{ id: 6, value: 'ta-IN', label: 'Tamil (India)' }]);
      const spy = jest
        .spyOn(service, 'generateDraftGlossary')
        .mockResolvedValue({ created: [], updated: [], skipped: [] });
      await service.backfillGlossaries([6]);
      expect(spy).toHaveBeenCalledWith(6, undefined);
    });
  });

  describe('consolidateGlossary', () => {
    const annotation = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      dimension: 'dialect_lexicon',
      category: 'wrong_regional_variety',
      severity: 'major',
      evidenceQuote: 'பதட்டம்',
      reasoning: 'Literary register for a clinical term.',
      aiText: 'உங்களுக்கு பதட்டம் உள்ளதா?',
      ...extra,
    });

    const consolidationOutput = [
      {
        sectionCode: 'clinical_terms',
        title: 'Clinical terms',
        injectionMode: 'retrieved',
        retrievalHint: 'Retrieve when clinical.',
        entries: [
          {
            type: 'term_pair',
            english: 'anxiety',
            preferred: 'டென்ஷன்',
            avoid: 'பதட்டம்',
            importance: 4,
            sourceAnnotationIndexes: [1, 2],
          },
        ],
      },
    ];

    it('returns zeros without calling the LLM when no unconsumed annotations exist', async () => {
      glossaryRepository.findAllForLanguage.mockResolvedValue([
        makeSection({
          entries: [
            {
              id: 'e1',
              type: 'rule',
              text: 'old',
              status: GlossaryEntryStatus.PROPOSED,
              provenance: { source: 'consolidation', annotationIds: ['a1'] },
            },
          ],
        }),
      ]);
      annotationRepository.find.mockResolvedValue([annotation('a1')]);
      const result = await service.consolidateGlossary(6);
      expect(result.annotationsConsidered).toBe(0);
      expect(getCompletion).not.toHaveBeenCalled();
    });

    it('lands consolidated entries as proposed with annotation provenance', async () => {
      annotationRepository.find.mockResolvedValue([
        annotation('a1'),
        annotation('a2'),
      ]);
      getCompletion.mockResolvedValue(JSON.stringify(consolidationOutput));

      const result = await service.consolidateGlossary(6, 'admin');

      expect(result.annotationsConsidered).toBe(2);
      expect(result.proposed).toBe(1);
      expect(result.sections).toEqual(['clinical_terms']);
      const saved = glossaryRepository.save.mock.calls.at(-1)[0];
      expect(saved.status).toBe(GlossarySectionStatus.DRAFT);
      const entry = saved.entries[0];
      expect(entry.status).toBe(GlossaryEntryStatus.PROPOSED);
      expect(entry.provenance.annotationIds).toEqual(['a1', 'a2']);
      expect(entry.importance).toBe(4);
      expect(entry.sourceAnnotationIndexes).toBeUndefined();
    });

    it('skips entries that duplicate existing ones (any status)', async () => {
      annotationRepository.find.mockResolvedValue([annotation('a1')]);
      glossaryRepository.findSection.mockResolvedValue(
        makeSection({
          sectionCode: 'clinical_terms',
          entries: [
            {
              id: 'e1',
              type: 'term_pair',
              english: 'Anxiety',
              preferred: 'டென்ஷன்',
              status: GlossaryEntryStatus.PUBLISHED,
            },
          ],
        }),
      );
      getCompletion.mockResolvedValue(JSON.stringify(consolidationOutput));

      const result = await service.consolidateGlossary(6);
      expect(result.proposed).toBe(0);
      expect(result.skippedDuplicates).toBe(1);
    });

    it('rejects unparseable consolidation output', async () => {
      annotationRepository.find.mockResolvedValue([annotation('a1')]);
      getCompletion.mockResolvedValue('here are your entries: ...');
      await expect(service.consolidateGlossary(6)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
