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
    content: '- Speak colloquial Tamil.',
    entries: [],
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
  let annotationQb: any;
  let batchRepository: any;
  let attachmentRepository: any;
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
        currentVersion: 2,
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
    // Consolidation reads annotations via a query builder (it carries the raw
    // test-tenant exclusion fragment). Tests stub the terminal getMany().
    annotationQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    annotationRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(annotationQb),
      manager: { query: jest.fn().mockResolvedValue([]) },
    };
    batchRepository = {
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => ({ id: v.id ?? 'batch-1', ...v })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    attachmentRepository = {
      find: jest.fn().mockResolvedValue([]),
      manager: { query: jest.fn().mockResolvedValue([]) },
    };
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
      batchRepository,
      attachmentRepository,
      llmProviderFactory,
      configService as any,
    );
  });

  describe('upsertSection', () => {
    const dto: UpsertGlossarySectionDto = {
      title: 'Core style',
      content: '- Speak colloquial Tamil.',
      injectionMode: GlossaryInjectionMode.ALWAYS,
    };

    it('creates a new draft section at version 1', async () => {
      const saved = await service.upsertSection(6, 'core_style', dto);
      expect(saved.status).toBe(GlossarySectionStatus.DRAFT);
      expect(saved.version).toBe(1);
      expect(saved.content).toBe('- Speak colloquial Tamil.');
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
        content: Array.from(
          { length: 400 },
          (_, i) =>
            `- A long standing rule about colloquial spoken Tamil register number ${i}.`,
        ).join('\n'),
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
      const bigContent = Array.from(
        { length: 300 },
        (_, i) => `- Very long standing instruction about register ${i}.`,
      ).join('\n');
      glossaryRepository.findSection.mockResolvedValue(
        makeSection({ sectionCode: 'pronouns_kinship', content: bigContent }),
      );
      glossaryRepository.findPublishedByLanguage.mockResolvedValue([
        makeSection({
          status: GlossarySectionStatus.PUBLISHED,
          content: bigContent,
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
          content: '',
        }),
      ]);
      const out = await service.resolveTier1Sections(6);
      expect(out).toHaveLength(1);
      expect(out[0].title).toBe('Clinical terms');
      expect(out[0].retrievalHint).toBe('Retrieve when clinical.');
      expect(out[0].content).toContain('## Clinical terms');
      expect(out[0].sectionCode).toBe('clinical_terms');
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
        undefined,
      );
    });
  });

  describe('resolveGlossaryMeta', () => {
    it('returns null when the language has nothing published', async () => {
      glossaryRepository.findPublishedByLanguage.mockResolvedValue([]);
      expect(await service.resolveGlossaryMeta(6)).toBeNull();
    });

    it('maps published section versions across both tiers and counts Tier 0 tokens', async () => {
      glossaryRepository.findPublishedByLanguage.mockResolvedValue([
        makeSection({
          sectionCode: 'core_style',
          status: GlossarySectionStatus.PUBLISHED,
          version: 4,
        }),
        makeSection({
          sectionCode: 'clinical_terms',
          injectionMode: GlossaryInjectionMode.RETRIEVED,
          status: GlossarySectionStatus.PUBLISHED,
          version: 2,
        }),
      ]);
      const meta = await service.resolveGlossaryMeta(6);
      // Unfiltered query: meta must cover both tiers, not just always-sections.
      expect(glossaryRepository.findPublishedByLanguage).toHaveBeenCalledWith(
        6,
        undefined,
        undefined,
      );
      expect(meta).toEqual({
        versions: { core_style: 4, clinical_terms: 2 },
        tier0Tokens: expect.any(Number),
      });
      // Tokens count the compiled always-set only — the retrieved section
      // must not inflate the Tier 0 cost.
      expect(meta!.tier0Tokens).toBeGreaterThan(0);
    });
  });

  describe('generateDraftGlossary', () => {
    const generated = [
      {
        sectionCode: 'core_style',
        title: 'Core style',
        injectionMode: 'always',
        retrievalHint: null,
        content: '- Speak colloquial Tamil.\n- Keep code-mixed English words.',
      },
      {
        sectionCode: 'clinical_terms',
        title: 'Clinical terms',
        injectionMode: 'retrieved',
        retrievalHint: 'Retrieve when clinical.',
        content: '- worry: say "டென்ஷன்" (avoid: "பதட்டம்")',
      },
    ];

    it('scores seeded avoid-lines against the corpora and flags contradictions', async () => {
      // Corpus: learners say the avoid-term பதட்டம் constantly — the seeded
      // pair must be recorded as contradicted in provenance.seedEvidence so
      // the reviewer sees it before publishing (the Kannada ಆದರೆ lesson).
      annotationRepository.manager.query.mockResolvedValue(
        Array.from({ length: 10 }, () => ({
          content: 'எனக்கு பதட்டம் இருக்கு',
          senderId: 101,
        })),
      );
      getCompletion.mockResolvedValue(JSON.stringify(generated));

      await service.generateDraftGlossary(6);

      const clinical = glossaryRepository.save.mock.calls
        .map((c: any[]) => c[0])
        .find((s: any) => s.sectionCode === 'clinical_terms');
      expect(clinical.provenance.seedEvidence).toEqual([
        expect.objectContaining({
          verdict: 'contradicted',
          avoidLearnerCount: 10,
        }),
      ]);
      // Sections without avoid-lines carry no seedEvidence noise.
      const core = glossaryRepository.save.mock.calls
        .map((c: any[]) => c[0])
        .find((s: any) => s.sectionCode === 'core_style');
      expect(core.provenance.seedEvidence).toBeUndefined();
    });

    it('parses fenced JSON, fills placeholders, and saves markdown drafts', async () => {
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
      expect(savedSections[0].content).toContain('- Speak colloquial Tamil.');
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
      tenantId: 'tenant-1',
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
        proposals: [
          {
            markdown: '- anxiety: say "டென்ஷன்" (avoid: "பதட்டம்")',
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
              markdown: '- old proposal',
              status: GlossaryEntryStatus.PROPOSED,
              provenance: { source: 'consolidation', annotationIds: ['a1'] },
            },
          ],
        }),
      ]);
      annotationQb.getMany.mockResolvedValue([annotation('a1')]);
      const result = await service.consolidateGlossary(6);
      expect(result.annotationsConsidered).toBe(0);
      expect(getCompletion).not.toHaveBeenCalled();
    });

    it('lands markdown proposals with annotation + tenant provenance', async () => {
      annotationQb.getMany.mockResolvedValue([
        annotation('a1'),
        annotation('a2', { tenantId: 'tenant-2' }),
      ]);
      getCompletion.mockResolvedValue(JSON.stringify(consolidationOutput));

      const result = await service.consolidateGlossary(6, 'admin');

      expect(result.annotationsConsidered).toBe(2);
      expect(result.proposed).toBe(1);
      expect(result.sections).toEqual(['clinical_terms']);
      const saved = glossaryRepository.save.mock.calls.at(-1)[0];
      expect(saved.status).toBe(GlossarySectionStatus.DRAFT);
      const proposal = saved.entries[0];
      expect(proposal.status).toBe(GlossaryEntryStatus.PROPOSED);
      expect(proposal.markdown).toContain('டென்ஷன்');
      expect(proposal.provenance!.annotationIds).toEqual(['a1', 'a2']);
      // Breadth signal: distinct supporting orgs, for the global-vs-overlay split.
      expect(proposal.provenance!.tenantIds).toEqual(['tenant-1', 'tenant-2']);
      expect(proposal.importance).toBe(4);
    });

    it('excludes test-organization tenants from the annotation read', async () => {
      annotationQb.getMany.mockResolvedValue([annotation('a1')]);
      getCompletion.mockResolvedValue(JSON.stringify(consolidationOutput));

      await service.consolidateGlossary(6);

      const fragments = annotationQb.andWhere.mock.calls.map(
        (c: any[]) => c[0],
      );
      expect(
        fragments.some(
          (f: unknown) =>
            typeof f === 'string' && f.includes('"isTestOrganization" = true'),
        ),
      ).toBe(true);
    });

    it('skips proposals duplicating existing content lines or proposals', async () => {
      annotationQb.getMany.mockResolvedValue([annotation('a1')]);
      glossaryRepository.findSection.mockResolvedValue(
        makeSection({
          sectionCode: 'clinical_terms',
          content: '- anxiety: say "டென்ஷன்" (avoid: "பதட்டம்")',
        }),
      );
      getCompletion.mockResolvedValue(JSON.stringify(consolidationOutput));

      const result = await service.consolidateGlossary(6);
      expect(result.proposed).toBe(0);
      expect(result.skippedDuplicates).toBe(1);
    });

    it('rejects unparseable consolidation output', async () => {
      annotationQb.getMany.mockResolvedValue([annotation('a1')]);
      getCompletion.mockResolvedValue('here are your entries: ...');
      await expect(service.consolidateGlossary(6)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('never removes or overwrites existing content/entries — only appends new proposals', async () => {
      const existingSection = makeSection({
        sectionCode: 'clinical_terms',
        title: 'Clinical terms',
        content: '- doctor: say "டாக்டர்" (avoid: "மருத்துவர்")',
        status: GlossarySectionStatus.PUBLISHED,
        injectionMode: GlossaryInjectionMode.RETRIEVED,
        entries: [
          {
            id: 'e-accepted',
            markdown: '- old accepted entry',
            status: GlossaryEntryStatus.ACCEPTED,
            provenance: { source: 'consolidation', annotationIds: ['a-old-1'] },
          },
          {
            id: 'e-rejected',
            markdown: '- old rejected entry',
            status: GlossaryEntryStatus.REJECTED,
            provenance: { source: 'consolidation', annotationIds: ['a-old-2'] },
          },
        ],
      });
      const originalContent = existingSection.content;
      const originalEntriesSnapshot = existingSection.entries!.map((e) => ({
        ...e,
      }));

      // The consumed-set (built from existing entries' provenance) must not
      // swallow a genuinely new annotation just because OTHER annotations
      // were already consumed.
      glossaryRepository.findAllForLanguage.mockResolvedValue([
        existingSection,
      ]);
      glossaryRepository.findSection.mockResolvedValue(existingSection);
      annotationQb.getMany.mockResolvedValue([annotation('a-new')]);
      getCompletion.mockResolvedValue(JSON.stringify(consolidationOutput));

      const result = await service.consolidateGlossary(6, 'admin');

      expect(result.annotationsConsidered).toBe(1);
      const saved = glossaryRepository.save.mock.calls.at(-1)[0];

      // Untouched fields — consolidation never rewrites these on an
      // existing section.
      expect(saved.content).toBe(originalContent);
      expect(saved.status).toBe(GlossarySectionStatus.PUBLISHED);
      expect(saved.title).toBe('Clinical terms');
      expect(saved.injectionMode).toBe(GlossaryInjectionMode.RETRIEVED);

      // Pre-existing entries preserved, in original order, byte-for-byte.
      expect(saved.entries).toHaveLength(3);
      expect(saved.entries[0]).toEqual(originalEntriesSnapshot[0]);
      expect(saved.entries[1]).toEqual(originalEntriesSnapshot[1]);

      // The new proposal is appended after them, not inserted in place of
      // anything.
      expect(saved.entries[2].status).toBe(GlossaryEntryStatus.PROPOSED);
      expect(saved.entries[2].markdown).toContain('டென்ஷன்');
    });
  });

  describe('proposal review', () => {
    const proposal = {
      id: 'p1',
      markdown: '- anxiety: say "டென்ஷன்"',
      status: GlossaryEntryStatus.PROPOSED,
      provenance: { source: 'consolidation' as const, annotationIds: ['a1'] },
    };

    it('accept appends the markdown to content and keeps the row as accepted', async () => {
      glossaryRepository.findSection.mockResolvedValue(
        makeSection({ entries: [{ ...proposal }] }),
      );
      const saved = await service.acceptProposal(6, 'core_style', 'p1');
      expect(saved.content).toContain('- anxiety: say "டென்ஷன்"');
      expect(saved.entries[0].status).toBe(GlossaryEntryStatus.ACCEPTED);
      expect(saved.entries[0].provenance!.annotationIds).toEqual(['a1']);
    });

    it('accept enforces the Tier 0 cap on a live always-section', async () => {
      const bigContent = Array.from(
        { length: 400 },
        (_, i) => `- Very long standing rule number ${i} about register.`,
      ).join('\n');
      glossaryRepository.findSection.mockResolvedValue(
        makeSection({
          status: GlossarySectionStatus.PUBLISHED,
          content: bigContent,
          entries: [{ ...proposal }],
        }),
      );
      glossaryRepository.findPublishedByLanguage.mockResolvedValue([
        makeSection({
          status: GlossarySectionStatus.PUBLISHED,
          content: bigContent,
        }),
      ]);
      await expect(
        service.acceptProposal(6, 'core_style', 'p1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('reject keeps the row (annotations stay consumed) without touching content', async () => {
      glossaryRepository.findSection.mockResolvedValue(
        makeSection({ entries: [{ ...proposal }] }),
      );
      const saved = await service.rejectProposal(6, 'core_style', 'p1');
      expect(saved.content).not.toContain('anxiety');
      expect(saved.entries[0].status).toBe(GlossaryEntryStatus.REJECTED);
    });

    it('404s when the proposal is missing or already reviewed', async () => {
      glossaryRepository.findSection.mockResolvedValue(
        makeSection({
          entries: [{ ...proposal, status: GlossaryEntryStatus.ACCEPTED }],
        }),
      );
      await expect(
        service.acceptProposal(6, 'core_style', 'p1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('consolidation loop (overlays, auto-accept, rollback)', () => {
    const annotation = (
      id: string,
      tenantId: string,
      extra: Record<string, unknown> = {},
    ) => ({
      id,
      tenantId,
      dimension: 'dialect_lexicon',
      category: 'wrong_regional_variety',
      severity: 'major',
      evidenceQuote: 'பதட்டம்',
      aiText: 'உங்களுக்கு பதட்டம் உள்ளதா?',
      ...extra,
    });

    const twoProposalOutput = [
      {
        sectionCode: 'clinical_terms',
        title: 'Clinical terms',
        injectionMode: 'retrieved',
        proposals: [
          // Supported only by tenant-1 (unattached) → global.
          { markdown: '- global rule', sourceAnnotationIndexes: [1] },
          // Supported only by tenant-2 (attached to p1) → overlay.
          { markdown: '- overlay rule', sourceAnnotationIndexes: [2] },
        ],
      },
    ];

    beforeEach(() => {
      annotationQb.getMany.mockResolvedValue([
        annotation('a1', 'tenant-1'),
        annotation('a2', 'tenant-2'),
      ]);
      getCompletion.mockResolvedValue(JSON.stringify(twoProposalOutput));
      attachmentRepository.find.mockResolvedValue([
        { tenantId: 'tenant-2', profileId: 'p1', languageId: 6 },
      ]);
    });

    it('routes single-profile-supported entries to that profile overlay, the rest global', async () => {
      const result = await service.consolidateGlossary(6);

      expect(result.proposed).toBe(2);
      expect(result.overlayEntries).toBe(1);
      expect(result.batchId).toBe('batch-1');
      const savedSections = glossaryRepository.save.mock.calls.map(
        (c: any[]) => c[0],
      );
      const overlay = savedSections.find((s: any) => s.profileId === 'p1');
      const global = savedSections.find((s: any) => !s.profileId);
      expect(overlay.entries.map((e: any) => e.markdown)).toEqual([
        '- overlay rule',
      ]);
      expect(global.entries.map((e: any) => e.markdown)).toEqual([
        '- global rule',
      ]);
      // Every entry carries the batch id — the rollback handle.
      expect(global.entries[0].provenance.batchId).toBe('batch-1');
      // The batch records both entries with their routing.
      const finalBatch = batchRepository.save.mock.calls.at(-1)[0];
      expect(finalBatch.entries).toHaveLength(2);
      expect(finalBatch.entries.map((e: any) => e.profileId).sort()).toEqual(
        ['p1', null].sort(),
      );
    });

    it('does not persist a phantom overlay section when its only proposal dedupes against the just-copied global content', async () => {
      // No overlay copy exists yet for p1, but the global section it would be
      // seeded from already contains the one proposal routed to it.
      glossaryRepository.findSection.mockImplementation(
        (_languageId: number, sectionCode: string, profileId?: string) => {
          if (profileId) return Promise.resolve(null);
          return Promise.resolve(
            makeSection({ sectionCode, content: '- overlay rule' }),
          );
        },
      );
      getCompletion.mockResolvedValue(
        JSON.stringify([
          {
            sectionCode: 'clinical_terms',
            title: 'Clinical terms',
            injectionMode: 'retrieved',
            proposals: [
              // Supported only by tenant-2 (attached to p1) → overlay.
              { markdown: '- overlay rule', sourceAnnotationIndexes: [2] },
            ],
          },
        ]),
      );

      const result = await service.consolidateGlossary(6);

      expect(result.proposed).toBe(0);
      expect(result.skippedDuplicates).toBe(1);
      expect(result.sections).toEqual([]);
      expect(glossaryRepository.save).not.toHaveBeenCalled();
    });

    it('auto-accept publishes entries into content and records them accepted', async () => {
      const result = await service.consolidateGlossary(6, 'rsi', {
        autoAccept: true,
        trigger: 'scheduled',
      });

      expect(result.autoAccepted).toBe(2);
      const savedSections = glossaryRepository.save.mock.calls.map(
        (c: any[]) => c[0],
      );
      for (const section of savedSections) {
        expect(section.status).toBe(GlossarySectionStatus.PUBLISHED);
        expect(
          section.entries.every(
            (e: any) => e.status === GlossaryEntryStatus.ACCEPTED,
          ),
        ).toBe(true);
      }
      const globalSaved = savedSections.find((s: any) => !s.profileId);
      expect(globalSaved.content).toContain('- global rule');
      const finalBatch = batchRepository.save.mock.calls.at(-1)[0];
      expect(finalBatch.entries.every((e: any) => e.accepted)).toBe(true);
    });

    it('auto-accept falls back to proposals when the Tier 0 cap would be exceeded', async () => {
      const hugeMarkdown = `- ${'register vocabulary rule '.repeat(1500)}`;
      getCompletion.mockResolvedValue(
        JSON.stringify([
          {
            sectionCode: 'core_style',
            title: 'Core style',
            injectionMode: 'always',
            proposals: [
              { markdown: hugeMarkdown, sourceAnnotationIndexes: [1] },
            ],
          },
        ]),
      );

      const result = await service.consolidateGlossary(6, 'rsi', {
        autoAccept: true,
      });

      expect(result.proposed).toBe(1);
      expect(result.autoAccepted).toBe(0);
      const saved = glossaryRepository.save.mock.calls.at(-1)[0];
      expect(saved.entries[0].status).toBe(GlossaryEntryStatus.PROPOSED);
      expect(saved.content ?? '').not.toContain('register vocabulary rule');
    });

    it('skips the run (and the LLM) below minAnnotations', async () => {
      const result = await service.consolidateGlossary(6, undefined, {
        minAnnotations: 10,
      });
      expect(result.annotationsConsidered).toBe(2);
      expect(result.proposed).toBe(0);
      expect(result.batchId).toBeNull();
      expect(getCompletion).not.toHaveBeenCalled();
    });

    it('rollback removes accepted lines, rejects entries, keeps annotations consumed', async () => {
      batchRepository.findOne.mockResolvedValue({
        id: 'batch-9',
        languageId: 6,
        status: 'active',
        entries: [
          {
            sectionId: 'sec-9',
            sectionCode: 'clinical_terms',
            profileId: null,
            entryId: 'e1',
            markdown: '- overlay rule',
            accepted: true,
          },
        ],
      });
      glossaryRepository.findOne = jest.fn().mockResolvedValue(
        makeSection({
          id: 'sec-9',
          sectionCode: 'clinical_terms',
          content: '- existing line\n- overlay rule',
          entries: [
            {
              id: 'e1',
              markdown: '- overlay rule',
              status: GlossaryEntryStatus.ACCEPTED,
              provenance: {
                source: 'consolidation',
                annotationIds: ['a2'],
                batchId: 'batch-9',
              },
            },
          ],
        }),
      );

      const result = await service.rollbackConsolidationBatch(6, 'batch-9');

      expect(result.rolledBack).toBe(1);
      const savedSection = glossaryRepository.save.mock.calls.at(-1)[0];
      expect(savedSection.content).toBe('- existing line');
      expect(savedSection.entries[0].status).toBe(GlossaryEntryStatus.REJECTED);
      // Annotation stays in provenance → stays consumed on future runs.
      expect(savedSection.entries[0].provenance.annotationIds).toEqual(['a2']);
      const savedBatch = batchRepository.save.mock.calls.at(-1)[0];
      expect(savedBatch.status).toBe('rolled_back');
    });

    it('routes production-artifact clusters to engineering findings, and consumes them', async () => {
      annotationQb.getMany.mockResolvedValue([
        annotation('a1', 'tenant-1'),
        annotation('a2', 'tenant-1', {
          dimension: 'persona_social',
          category: 'persona_break',
        }),
      ]);
      getCompletion.mockResolvedValue(
        JSON.stringify({
          sections: [],
          engineeringFindings: [
            {
              summary:
                'Replies frequently truncated mid-sentence (TTS cutoff?)',
              sourceAnnotationIndexes: [1, 2],
            },
          ],
        }),
      );

      const result = await service.consolidateGlossary(6);

      expect(result.proposed).toBe(0);
      expect(result.batchId).toBe('batch-1'); // findings alone keep the handle
      const savedBatch = batchRepository.save.mock.calls.at(-1)[0];
      expect(savedBatch.stats.engineeringFindings).toEqual([
        {
          summary: 'Replies frequently truncated mid-sentence (TTS cutoff?)',
          annotationIds: ['a1', 'a2'],
        },
      ]);
      // No glossary section was written for the finding.
      expect(glossaryRepository.save).not.toHaveBeenCalled();

      // Next run: the finding's annotations are consumed via the batch record.
      batchRepository.find.mockResolvedValue([savedBatch]);
      getCompletion.mockClear();
      const second = await service.consolidateGlossary(6);
      expect(second.annotationsConsidered).toBe(0);
      expect(getCompletion).not.toHaveBeenCalled();
    });

    it('runs the tier pass after auto-accept (best-effort)', async () => {
      const retierSpy = jest
        .spyOn(service, 'retierGlossary')
        .mockResolvedValue({ views: [] });
      const result = await service.consolidateGlossary(6, 'rsi', {
        autoAccept: true,
      });
      expect(retierSpy).toHaveBeenCalledWith(6, { apply: true });
      expect(result.retier).toEqual({ views: [] });
      retierSpy.mockRestore();
    });

    it('refuses to roll back an already rolled-back batch', async () => {
      batchRepository.findOne.mockResolvedValue({
        id: 'batch-9',
        languageId: 6,
        status: 'rolled_back',
        entries: [],
      });
      await expect(
        service.rollbackConsolidationBatch(6, 'batch-9'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('retierGlossary', () => {
    const section = (over: Partial<LanguageGlossarySection>) =>
      makeSection({
        status: GlossarySectionStatus.PUBLISHED,
        entries: [],
        ...over,
      });

    beforeEach(() => {
      // manager.query serves two shapes: severity lookups and corpus rows.
      annotationRepository.manager.query.mockImplementation(
        async (sql: string) => {
          if (sql.includes('severity')) {
            return [{ id: 'a1', severity: 'major' }];
          }
          // Corpus: learners say டென்ஷன் a lot; nobody says அருஞ்சொல்.
          return Array.from({ length: 30 }, () => ({
            content: 'எனக்கு டென்ஷன் ஆகுது',
            senderId: 101,
          }));
        },
      );
    });

    it('promotes high-value sections, demotes zero-value ones, skips pins', async () => {
      glossaryRepository.findAllForLanguage.mockResolvedValue([
        section({
          id: 'hot',
          sectionCode: 'hot_terms',
          injectionMode: GlossaryInjectionMode.RETRIEVED,
          content: '- anxiety: say "டென்ஷன்" (avoid: "பதட்டம்")',
          entries: [
            {
              id: 'e1',
              markdown: '- anxiety: say "டென்ஷன்"',
              status: GlossaryEntryStatus.ACCEPTED,
              provenance: { source: 'consolidation', annotationIds: ['a1'] },
            },
          ],
        }),
        section({
          id: 'cold',
          sectionCode: 'cold_terms',
          injectionMode: GlossaryInjectionMode.ALWAYS,
          content: '- rare: say "அருஞ்சொல்"',
        }),
        section({
          id: 'pinned',
          sectionCode: 'pinned_terms',
          injectionMode: GlossaryInjectionMode.ALWAYS,
          content: '- also rare: say "வேறுஅருஞ்சொல்"',
          tierPinned: true,
        }),
      ]);

      const result = await service.retierGlossary(6);

      const globalView = result.views.find((v) => v.profileId === null)!;
      expect(globalView.promoted).toEqual(['hot_terms']);
      expect(globalView.demoted).toEqual(['cold_terms']);
      const savedModes = Object.fromEntries(
        glossaryRepository.save.mock.calls.map((c: any[]) => [
          c[0].sectionCode,
          c[0].injectionMode,
        ]),
      );
      expect(savedModes.hot_terms).toBe(GlossaryInjectionMode.ALWAYS);
      expect(savedModes.cold_terms).toBe(GlossaryInjectionMode.RETRIEVED);
      // Pinned zero-value section keeps Tier 0 and is never written.
      expect(savedModes.pinned_terms).toBeUndefined();
    });

    it('apply=false plans without writing', async () => {
      glossaryRepository.findAllForLanguage.mockResolvedValue([
        section({
          sectionCode: 'hot_terms',
          injectionMode: GlossaryInjectionMode.RETRIEVED,
          content: '- anxiety: say "டென்ஷன்"',
        }),
      ]);
      const result = await service.retierGlossary(6, { apply: false });
      expect(result.views[0].promoted).toEqual(['hot_terms']);
      expect(glossaryRepository.save).not.toHaveBeenCalled();
    });

    it('gives overlays only the budget the global always-set leaves', async () => {
      glossaryRepository.findAllForLanguage.mockResolvedValue([
        section({
          sectionCode: 'core',
          injectionMode: GlossaryInjectionMode.ALWAYS,
          content: '- anxiety: say "டென்ஷன்"',
        }),
        section({
          sectionCode: 'core',
          profileId: 'p1',
          injectionMode: GlossaryInjectionMode.RETRIEVED,
          content: '- anxiety overlay: say "டென்ஷன்"',
        }),
      ]);
      const result = await service.retierGlossary(6, { apply: false });
      const overlayView = result.views.find((v) => v.profileId === 'p1')!;
      const globalView = result.views.find((v) => v.profileId === null)!;
      expect(overlayView.cap).toBe(2000 - globalView.tier0Tokens);
      expect(overlayView.promoted).toEqual(['core@p1']);
    });

    it('runs after auto-accept consolidation (best-effort)', async () => {
      annotationQb.getMany.mockResolvedValue([
        {
          id: 'a9',
          tenantId: 'tenant-1',
          dimension: 'dialect_lexicon',
          category: 'wrong_regional_variety',
          severity: 'major',
          evidenceQuote: 'பதட்டம்',
        },
      ]);
      getCompletion.mockResolvedValue(
        JSON.stringify([
          {
            sectionCode: 'clinical_terms',
            title: 'Clinical terms',
            injectionMode: 'retrieved',
            proposals: [
              { markdown: '- x: say "டென்ஷன்"', sourceAnnotationIndexes: [1] },
            ],
          },
        ]),
      );
      const retierSpy = jest
        .spyOn(service, 'retierGlossary')
        .mockResolvedValue({ views: [] });
      const result = await service.consolidateGlossary(6, 'rsi', {
        autoAccept: true,
      });
      expect(retierSpy).toHaveBeenCalledWith(6, { apply: true });
      expect(result.retier).toEqual({ views: [] });
      retierSpy.mockRestore();
    });
  });

  describe('upsertSection tier pinning', () => {
    const dto = (mode: GlossaryInjectionMode, tierPinned?: boolean) =>
      ({
        title: 'Core style',
        content: '- x',
        injectionMode: mode,
        ...(tierPinned === undefined ? {} : { tierPinned }),
      }) as UpsertGlossarySectionDto;

    it('pins automatically when an admin changes the mode by hand', async () => {
      glossaryRepository.findSection.mockResolvedValue(
        makeSection({ injectionMode: GlossaryInjectionMode.ALWAYS }),
      );
      const saved = await service.upsertSection(
        6,
        'core_style',
        dto(GlossaryInjectionMode.RETRIEVED),
      );
      expect(saved.tierPinned).toBe(true);
    });

    it('does not pin on an unchanged mode; explicit false unpins', async () => {
      glossaryRepository.findSection.mockResolvedValue(
        makeSection({ injectionMode: GlossaryInjectionMode.ALWAYS }),
      );
      const unchanged = await service.upsertSection(
        6,
        'core_style',
        dto(GlossaryInjectionMode.ALWAYS),
      );
      expect(unchanged.tierPinned).toBe(false);

      glossaryRepository.findSection.mockResolvedValue(
        makeSection({
          injectionMode: GlossaryInjectionMode.ALWAYS,
          tierPinned: true,
        }),
      );
      const unpinned = await service.upsertSection(
        6,
        'core_style',
        dto(GlossaryInjectionMode.RETRIEVED, false),
      );
      expect(unpinned.tierPinned).toBe(false);
    });
  });
});
