import { NotFoundException } from '@nestjs/common';
import {
  GlossaryInjectionMode,
  GlossarySectionStatus,
  LanguageGlossarySection,
} from '../../entity/language-glossary-section.entity';
import { GlossaryAdherenceService } from '../glossary-adherence.service';

const makeSection = (
  overrides: Partial<LanguageGlossarySection> = {},
): LanguageGlossarySection =>
  ({
    id: 'sec-1',
    languageId: 9,
    sectionCode: 'core_style',
    title: 'Core style',
    content: '',
    entries: [],
    injectionMode: GlossaryInjectionMode.ALWAYS,
    status: GlossarySectionStatus.PUBLISHED,
    version: 1,
    ...overrides,
  }) as LanguageGlossarySection;

describe('GlossaryAdherenceService', () => {
  let service: GlossaryAdherenceService;
  let glossaryRepository: any;
  let reportRepository: any;
  let dataSource: any;

  beforeEach(() => {
    glossaryRepository = {
      findPublishedByLanguage: jest.fn().mockResolvedValue([]),
    };
    reportRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => v),
    };
    dataSource = { query: jest.fn().mockResolvedValue([]) };
    service = new GlossaryAdherenceService(
      glossaryRepository,
      reportRepository,
      dataSource,
    );
  });

  describe('parseAvoidTerms', () => {
    it('extracts double-quoted terms (v2-era content)', () => {
      const terms = service.parseAvoidTerms([
        makeSection({
          content:
            '- worry: say "ടെൻഷൻ" (avoid: "ആശങ്ക", "ഉത്കണ്ഠ")\n' +
            '- doctor: say "ഡോക്ടർ" (avoid: "വൈദ്യൻ")',
        }),
      ]);
      expect(terms.map((t) => t.term)).toEqual(['ആശങ്ക', 'ഉത്കണ്ഠ', 'വൈദ്യൻ']);
      expect(terms[0].sectionCode).toBe('core_style');
    });

    it('extracts backtick-quoted terms (v3-era content)', () => {
      const terms = service.parseAvoidTerms([
        makeSection({
          content:
            '- talk: say `बात करना` (avoid: `वार्तालाप करना`)\n' +
            '- very: say `बहुत` (avoid: `अत्यधिक`)',
        }),
      ]);
      expect(terms.map((t) => t.term)).toEqual(['वार्तालाप करना', 'अत्यधिक']);
    });

    it('dedupes across sections, first section owns the term', () => {
      const terms = service.parseAvoidTerms([
        makeSection({ content: '- a: say "x" (avoid: "y")' }),
        makeSection({
          sectionCode: 'clinical_terms',
          content: '- b: say "z" (avoid: "y", "w")',
        }),
      ]);
      expect(terms).toEqual([
        { term: 'y', sectionCode: 'core_style' },
        { term: 'w', sectionCode: 'clinical_terms' },
      ]);
    });

    it('ignores say-terms and lines without an avoid group', () => {
      const terms = service.parseAvoidTerms([
        makeSection({
          content: '- Always speak colloquially.\n- greet: say "நமஸ்காரம்"',
        }),
      ]);
      expect(terms).toEqual([]);
    });
  });

  describe('scanMessages', () => {
    const avoid = [
      { term: 'ആശങ്ക', sectionCode: 'core_style' },
      { term: 'വളരെ', sectionCode: 'core_style' },
    ];

    it('counts occurrences across messages with example snippets', () => {
      const violations = service.scanMessages(
        ['എനിക്ക് വളരെ ആശങ്കയും പേടിയും ഉണ്ട്.', 'അത് ശരിയാണ്. ആശങ്ക വേണ്ട.'],
        avoid,
      );
      expect(violations).toEqual([
        expect.objectContaining({ term: 'ആശങ്ക', count: 2 }),
        expect.objectContaining({ term: 'വളരെ', count: 1 }),
      ]);
      expect(violations[0].examples[0]).toContain('ആശങ്ക');
    });

    it('returns empty for clean transcripts', () => {
      expect(service.scanMessages(['എനിക്ക് ടെൻഷൻ ഉണ്ട്.'], avoid)).toEqual([]);
    });

    it('matches across NFC/NFD normalization differences', () => {
      // The same Devanagari text in decomposed form must still match.
      const decomposed = 'वार्तालाप करना'.normalize('NFD');
      const violations = service.scanMessages(
        [`हम ${decomposed} करेंगे`],
        [{ term: 'वार्तालाप करना', sectionCode: 'core_style' }],
      );
      expect(violations).toHaveLength(1);
    });
  });

  describe('analyzeSession', () => {
    const sessionRow = { id: 'sess-1', languageId: 9 };

    it('404s on a missing session', async () => {
      dataSource.query.mockResolvedValueOnce([]);
      await expect(service.analyzeSession('nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns null for sessions without a language or glossary', async () => {
      dataSource.query.mockResolvedValueOnce([{ id: 's', languageId: null }]);
      expect(await service.analyzeSession('s')).toBeNull();

      dataSource.query.mockResolvedValueOnce([sessionRow]);
      glossaryRepository.findPublishedByLanguage.mockResolvedValue([]);
      expect(await service.analyzeSession('sess-1')).toBeNull();
    });

    it('scans agent messages and upserts a report with start_metrics provenance', async () => {
      dataSource.query
        .mockResolvedValueOnce([sessionRow]) // session lookup
        .mockResolvedValueOnce([
          { content: 'എനിക്ക് ആശങ്ക ഉണ്ട്' },
          { content: 'ശരി.' },
        ]) // agent messages
        .mockResolvedValueOnce([{ versions: { core_style: 4 } }]); // start_metrics
      glossaryRepository.findPublishedByLanguage.mockResolvedValue([
        makeSection({ content: '- worry: say "ടെൻഷൻ" (avoid: "ആശങ്ക")' }),
      ]);

      const report = await service.analyzeSession('sess-1');
      expect(report).toMatchObject({
        scenarioSessionId: 'sess-1',
        languageId: 9,
        glossaryVersions: { core_style: 4 },
        agentMessageCount: 2,
        totalViolations: 1,
      });
      expect(report!.violations[0]).toMatchObject({
        term: 'ആശങ്ക',
        sectionCode: 'core_style',
        count: 1,
      });
      expect(reportRepository.save).toHaveBeenCalled();
    });

    it('falls back to current published versions without start_metrics', async () => {
      dataSource.query
        .mockResolvedValueOnce([sessionRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]); // no start_metrics row
      glossaryRepository.findPublishedByLanguage.mockResolvedValue([
        makeSection({
          content: '- worry: say "ടെൻഷൻ" (avoid: "ആശങ്ക")',
          version: 7,
        }),
      ]);

      const report = await service.analyzeSession('sess-1');
      expect(report!.glossaryVersions).toEqual({ core_style: 7 });
      expect(report!.totalViolations).toBe(0);
    });
  });

  describe('backfillLanguage', () => {
    it('scans listed sessions, counting reports vs skips, never throwing', async () => {
      dataSource.query.mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }]);
      const analyze = jest
        .spyOn(service, 'analyzeSession')
        .mockResolvedValueOnce({ id: 'r1' } as any)
        .mockRejectedValueOnce(new Error('boom'));

      const result = await service.backfillLanguage(9);
      expect(result).toEqual({ scanned: 2, reported: 1, skipped: 1 });
      expect(analyze).toHaveBeenCalledTimes(2);
    });
  });
});
