import { countTokens as countO200kTokens } from 'gpt-tokenizer/encoding/o200k_base';
import {
  GlossaryEntry,
  GlossaryEntryStatus,
  GlossaryInjectionMode,
  GlossarySectionStatus,
  LanguageGlossarySection,
} from '../entity/language-glossary-section.entity';
import { GLOSSARY_SECTION_ORDER } from '../constants/glossary.constants';

/**
 * Deterministic compiler from glossary sections (typed `entries` jsonb) to the
 * prompt text served to the live agent. The jsonb is the source of truth; the
 * rendered block is never hand-edited (LANGUAGE_GLOSSARY_DESIGN.md §4, §8).
 *
 * Only `published` entries render — `proposed`/`rejected` entries (consolidation
 * drafts) are invisible to runtime until a reviewer accepts them.
 */

/**
 * Token counter for the Tier 0 budget guard. o200k_base is the budget
 * *currency*, not an exact prefill prediction — sessions run on OpenAI or
 * Gemini, whose tokenizers count Indic text differently (§13).
 */
export function countGlossaryTokens(text: string): number {
  if (!text) return 0;
  return countO200kTokens(text);
}

function renderEntry(entry: GlossaryEntry): string[] {
  const lines: string[] = [];
  switch (entry.type) {
    case 'term_pair': {
      if (!entry.english || !entry.preferred) return [];
      let line = `- ${entry.english}: say "${entry.preferred}"`;
      if (entry.avoid) line += `; avoid "${entry.avoid}"`;
      if (entry.note) line += ` (${entry.note})`;
      lines.push(line);
      break;
    }
    case 'rule':
    case 'pattern': {
      if (!entry.text) return [];
      lines.push(`- ${entry.text}`);
      for (const example of entry.examples ?? []) {
        lines.push(`  e.g. ${example}`);
      }
      break;
    }
  }
  return lines;
}

/** Compile one section: title header + its published entries. Empty string when
 * nothing renders (no published entries with renderable content). */
export function compileSection(section: LanguageGlossarySection): string {
  const entries = (section.entries ?? []).filter(
    (e) => e.status === GlossaryEntryStatus.PUBLISHED,
  );
  const lines = entries.flatMap(renderEntry);
  if (lines.length === 0) return '';
  return `## ${section.title}\n${lines.join('\n')}`;
}

function sectionOrderKey(sectionCode: string): [number, string] {
  const idx = (GLOSSARY_SECTION_ORDER as readonly string[]).indexOf(
    sectionCode,
  );
  return [idx === -1 ? GLOSSARY_SECTION_ORDER.length : idx, sectionCode];
}

/**
 * Compile the Tier 0 style card: every `published` + `always` section, in the
 * fixed deterministic order (stable prompt prefix → prompt-cache friendly).
 */
export function compileTier0Glossary(
  sections: LanguageGlossarySection[],
): string {
  const compiled = sections
    .filter(
      (s) =>
        s.status === GlossarySectionStatus.PUBLISHED &&
        s.injectionMode === GlossaryInjectionMode.ALWAYS,
    )
    .sort((a, b) => {
      const [ai, ac] = sectionOrderKey(a.sectionCode);
      const [bi, bc] = sectionOrderKey(b.sectionCode);
      return ai - bi || ac.localeCompare(bc);
    })
    .map(compileSection)
    .filter((text) => text.length > 0);
  return compiled.join('\n\n');
}
