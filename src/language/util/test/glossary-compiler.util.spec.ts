import {
  GlossaryEntryStatus,
  GlossaryInjectionMode,
  GlossarySectionStatus,
  LanguageGlossarySection,
} from '../../entity/language-glossary-section.entity';
import {
  compileSection,
  compileTier0Glossary,
  countGlossaryTokens,
} from '../glossary-compiler.util';

const section = (
  overrides: Partial<LanguageGlossarySection>,
): LanguageGlossarySection =>
  ({
    id: 'id',
    languageId: 6,
    sectionCode: 'core_style',
    title: 'Core style',
    entries: [],
    injectionMode: GlossaryInjectionMode.ALWAYS,
    status: GlossarySectionStatus.PUBLISHED,
    version: 1,
    ...overrides,
  }) as LanguageGlossarySection;

describe('glossary-compiler.util', () => {
  describe('compileSection', () => {
    it('renders term_pair entries with preferred/avoid/note', () => {
      const out = compileSection(
        section({
          entries: [
            {
              id: '1',
              type: 'term_pair',
              english: 'worry',
              preferred: 'டென்ஷன்',
              avoid: 'பதட்டம்',
              note: 'code-mixed',
              status: GlossaryEntryStatus.PUBLISHED,
            },
          ],
        }),
      );
      expect(out).toBe(
        '## Core style\n- worry: say "டென்ஷன்"; avoid "பதட்டம்" (code-mixed)',
      );
    });

    it('renders rule entries with indented examples', () => {
      const out = compileSection(
        section({
          entries: [
            {
              id: '1',
              type: 'rule',
              text: 'Mother: always she-forms.',
              examples: ['அம்மா சொன்னாங்க'],
              status: GlossaryEntryStatus.PUBLISHED,
            },
          ],
        }),
      );
      expect(out).toContain('- Mother: always she-forms.');
      expect(out).toContain('  e.g. அம்மா சொன்னாங்க');
    });

    it('renders pattern entries like rules', () => {
      const out = compileSection(
        section({
          entries: [
            {
              id: '1',
              type: 'pattern',
              text: 'Gentle probe',
              examples: ['என்ன ஆச்சு?'],
              status: GlossaryEntryStatus.PUBLISHED,
            },
          ],
        }),
      );
      expect(out).toContain('- Gentle probe');
    });

    it('excludes proposed and rejected entries', () => {
      const out = compileSection(
        section({
          entries: [
            {
              id: '1',
              type: 'rule',
              text: 'published rule',
              status: GlossaryEntryStatus.PUBLISHED,
            },
            {
              id: '2',
              type: 'rule',
              text: 'proposed rule',
              status: GlossaryEntryStatus.PROPOSED,
            },
            {
              id: '3',
              type: 'rule',
              text: 'rejected rule',
              status: GlossaryEntryStatus.REJECTED,
            },
          ],
        }),
      );
      expect(out).toContain('published rule');
      expect(out).not.toContain('proposed rule');
      expect(out).not.toContain('rejected rule');
    });

    it('skips malformed entries and returns empty when nothing renders', () => {
      const out = compileSection(
        section({
          entries: [
            {
              id: '1',
              type: 'term_pair',
              status: GlossaryEntryStatus.PUBLISHED,
            },
            { id: '2', type: 'rule', status: GlossaryEntryStatus.PUBLISHED },
          ],
        }),
      );
      expect(out).toBe('');
    });
  });

  describe('compileTier0Glossary', () => {
    const published = (code: string, mode: GlossaryInjectionMode) =>
      section({
        sectionCode: code,
        title: code,
        injectionMode: mode,
        entries: [
          {
            id: '1',
            type: 'rule',
            text: `rule of ${code}`,
            status: GlossaryEntryStatus.PUBLISHED,
          },
        ],
      });

    it('includes only published always-sections, in fixed order', () => {
      const out = compileTier0Glossary([
        published('zz_custom', GlossaryInjectionMode.ALWAYS),
        published('clinical_terms', GlossaryInjectionMode.RETRIEVED),
        published('pronouns_kinship', GlossaryInjectionMode.ALWAYS),
        published('core_style', GlossaryInjectionMode.ALWAYS),
        section({
          sectionCode: 'draft_one',
          status: GlossarySectionStatus.DRAFT,
        }),
      ]);
      const order = ['core_style', 'pronouns_kinship', 'zz_custom'].map((c) =>
        out.indexOf(`## ${c}`),
      );
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(out).not.toContain('clinical_terms');
      expect(out).not.toContain('draft_one');
    });

    it('returns empty string for no sections', () => {
      expect(compileTier0Glossary([])).toBe('');
    });
  });

  describe('countGlossaryTokens', () => {
    it('is zero for empty and positive for native-script text', () => {
      expect(countGlossaryTokens('')).toBe(0);
      expect(countGlossaryTokens('உங்களுக்கு டென்ஷன் இருக்கு')).toBeGreaterThan(
        0,
      );
    });
  });
});
