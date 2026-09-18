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

    // The regression this parser exists to prevent: Kannada core_style v6
    // reworded the platform's most-violated term from `(avoid: …)` to a BARE
    // `(not …)`, and the measured violation rate fell 47.7 -> 0.0 per 100
    // agent messages while the rule stayed in force.
    it('extracts a bare single-token term from a `not` group', () => {
      const terms = service.parseAvoidTerms([
        makeSection({
          content:
            '- contract colloquially:\n' +
            '  e.g. ಆದ್ರೆ (not ಆದರೆ), ಯಾಕಂದ್ರೆ (avoid: `ಏಕೆಂದರೆ`), ಅಂದ್ರೆ (not ಎಂದರೆ)',
        }),
      ]);
      expect(terms.map((t) => t.term)).toEqual(['ಆದರೆ', 'ಏಕೆಂದರೆ', 'ಎಂದರೆ']);
    });

    it('extracts single-quoted terms', () => {
      const terms = service.parseAvoidTerms([
        makeSection({ content: "- source: say `पासून` (not 'from')" }),
      ]);
      expect(terms.map((t) => t.term)).toEqual(['from']);
    });

    it('accepts `not:` and bare `avoid` markers', () => {
      const terms = service.parseAvoidTerms([
        makeSection({
          content:
            '- x: say `अ` (not: `ब`)\n' +
            '- y: avoid literary/archaic forms: "சொல்லினேன்"\n' +
            '- z: (avoid literary forms: "ஆகினாங்க")',
        }),
      ]);
      expect(terms.map((t) => t.term)).toEqual(['ब', 'ஆகினாங்க']);
    });

    // Bare multi-word content under the same marker is an EXAMPLE SENTENCE,
    // not a term — real content carries several of these.
    it('does not mine a bare multi-word phrase as a term', () => {
      const terms = service.parseAvoidTerms([
        makeSection({
          content:
            '- a: say `x` (not: त्याला मद्यपानाची आवड आहे.)\n' +
            '- b: say `y` (not ಅಮ್ಮನಿಗೆ ಕೆಲ್ಸಕ್ಕೆ ಹೋಗೋದು)',
        }),
      ]);
      expect(terms).toEqual([]);
    });

    it('leaves non-avoidance parentheticals alone', () => {
      const terms = service.parseAvoidTerms([
        makeSection({
          content:
            '- kinship (e.g., a caregiver)\n' +
            '- register (As a client)\n' +
            '- sample (My father says.)\n' +
            '- sample (She worries.)',
        }),
      ]);
      expect(terms).toEqual([]);
    });

    it('strips trailing sentence punctuation from a bare term', () => {
      const terms = service.parseAvoidTerms([
        makeSection({ content: '- a: say `x` (not ಆದರೆ.)' }),
      ]);
      expect(terms.map((t) => t.term)).toEqual(['ಆದರೆ']);
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

  describe('previewAdherence', () => {
    const sessionRow = { id: 'sess-1', languageId: 9 };

    it('returns the same scan as analyzeSession but never touches reportRepository', async () => {
      dataSource.query
        .mockResolvedValueOnce([sessionRow])
        .mockResolvedValueOnce([{ content: 'എനിക്ക് ആശങ്ക ഉണ്ട്' }])
        .mockResolvedValueOnce([{ versions: { core_style: 4 } }]);
      glossaryRepository.findPublishedByLanguage.mockResolvedValue([
        makeSection({ content: '- worry: say "ടെൻഷൻ" (avoid: "ആശങ്ക")' }),
      ]);

      const preview = await service.previewAdherence('sess-1');

      expect(preview).toEqual({
        agentMessageCount: 1,
        totalViolations: 1,
        violations: [
          expect.objectContaining({ term: 'ആശങ്ക', sectionCode: 'core_style' }),
        ],
      });
      // Read-only: no upsert, so the persisted table is never written.
      expect(reportRepository.findOne).not.toHaveBeenCalled();
      expect(reportRepository.create).not.toHaveBeenCalled();
      expect(reportRepository.save).not.toHaveBeenCalled();
    });

    it('returns null under the same conditions analyzeSession would (no language, no avoid-terms)', async () => {
      dataSource.query.mockResolvedValueOnce([{ id: 's', languageId: null }]);
      expect(await service.previewAdherence('s')).toBeNull();

      dataSource.query.mockResolvedValueOnce([sessionRow]);
      glossaryRepository.findPublishedByLanguage.mockResolvedValue([]);
      expect(await service.previewAdherence('sess-1')).toBeNull();
    });

    it('404s on a missing session, same as analyzeSession', async () => {
      dataSource.query.mockResolvedValueOnce([]);
      await expect(service.previewAdherence('nope')).rejects.toThrow(
        NotFoundException,
      );
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

  describe('languageSummary', () => {
    it('combines the totals row with the top-terms rows for one language', async () => {
      dataSource.query
        .mockResolvedValueOnce([
          {
            sessionCount: 16,
            totalViolations: 44,
            avgViolationsPerSession: 2.75,
            cleanSessions: 5,
          },
        ])
        .mockResolvedValueOnce([
          { term: 'ആശങ്ക', sectionCode: 'core_style', count: 20 },
          { term: 'വളരെ', sectionCode: 'core_style', count: 18 },
        ]);

      const summary = await service.languageSummary(9);

      expect(summary).toEqual({
        sessionCount: 16,
        totalViolations: 44,
        avgViolationsPerSession: 2.75,
        cleanSessions: 5,
        topTerms: [
          { term: 'ആശങ്ക', sectionCode: 'core_style', count: 20 },
          { term: 'വളരെ', sectionCode: 'core_style', count: 18 },
        ],
      });
      expect(dataSource.query.mock.calls[0][1]).toEqual([9]);
      expect(dataSource.query.mock.calls[1][1]).toEqual([9]);
    });
  });

  describe('languageSummaryOverview', () => {
    it('returns one row per language with any scanned sessions, ordered by violations', async () => {
      const rows = [
        {
          languageId: 9,
          languageLabel: 'Malayalam (India)',
          languageValue: 'ml-IN',
          sessionCount: 16,
          totalViolations: 44,
          avgViolationsPerSession: 2.75,
          cleanSessions: 5,
        },
        {
          languageId: 2,
          languageLabel: 'Hindi (India)',
          languageValue: 'hi-IN',
          sessionCount: 1,
          totalViolations: 0,
          avgViolationsPerSession: 0,
          cleanSessions: 1,
        },
      ];
      dataSource.query.mockResolvedValueOnce(rows);

      const overview = await service.languageSummaryOverview();

      expect(overview).toEqual(rows);
      // No language filter — a single unparameterised query across all rows.
      expect(dataSource.query).toHaveBeenCalledTimes(1);
      expect(dataSource.query.mock.calls[0][0]).toContain(
        'GROUP BY r."languageId"',
      );
    });

    it('returns an empty array when nothing has been scanned yet', async () => {
      dataSource.query.mockResolvedValueOnce([]);
      expect(await service.languageSummaryOverview()).toEqual([]);
    });
  });
});
