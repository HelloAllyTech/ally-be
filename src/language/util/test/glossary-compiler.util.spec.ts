import {
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
    content: '- worry: say "டென்ஷன்" (avoid: "பதட்டம்")',
    entries: [],
    injectionMode: GlossaryInjectionMode.ALWAYS,
    status: GlossarySectionStatus.PUBLISHED,
    version: 1,
    ...overrides,
  }) as LanguageGlossarySection;

describe('glossary-compiler.util', () => {
  describe('compileSection', () => {
    it('frames the markdown content with the title header', () => {
      const out = compileSection(section({}));
      expect(out).toBe(
        '## Core style\n- worry: say "டென்ஷன்" (avoid: "பதட்டம்")',
      );
    });

    it('returns empty string when content is empty', () => {
      expect(compileSection(section({ content: '' }))).toBe('');
      expect(compileSection(section({ content: '   \n ' }))).toBe('');
    });

    it('never renders consolidation proposals', () => {
      const out = compileSection(
        section({
          entries: [
            {
              id: 'p1',
              markdown: '- proposed line that must not leak',
              status: 'proposed' as any,
            },
          ],
        }),
      );
      expect(out).not.toContain('proposed line');
    });
  });

  describe('compileTier0Glossary', () => {
    const published = (code: string, mode: GlossaryInjectionMode) =>
      section({
        sectionCode: code,
        title: code,
        injectionMode: mode,
        content: `- rule of ${code}`,
      });

    it('includes only published always-sections, in fixed order', () => {
      const out = compileTier0Glossary([
        published('zz_custom', GlossaryInjectionMode.ALWAYS),
        published('clinical_terms', GlossaryInjectionMode.RETRIEVED),
        published('pronouns_kinship', GlossaryInjectionMode.ALWAYS),
        published('core_style', GlossaryInjectionMode.ALWAYS),
        section({
          sectionCode: 'draft_one',
          title: 'draft_one',
          content: '- draft line',
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
