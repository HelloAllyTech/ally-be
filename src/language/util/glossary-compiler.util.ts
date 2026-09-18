import { countTokens as countO200kTokens } from 'gpt-tokenizer/encoding/o200k_base';
import {
  GlossaryInjectionMode,
  GlossarySectionStatus,
  LanguageGlossarySection,
} from '../entity/language-glossary-section.entity';
import { GLOSSARY_SECTION_ORDER } from '../constants/glossary.constants';

/**
 * Glossary sections are plain markdown (`content`) — what admins write is what
 * the agent gets, prefixed with the section title as a `##` header. The only
 * job left for a "compiler" is header framing, ordering, and token
 * accounting. Consolidation proposals (`entries`) are never served.
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

/** One section: `## title` + its markdown body. Empty when the body is empty. */
export function compileSection(section: LanguageGlossarySection): string {
  const body = (section.content ?? '').trim();
  if (!body) return '';
  return `## ${section.title}\n${body}`;
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
 *
 * `registerPolicy`, when given, is prepended as the first block — the derived
 * `## Register` line sourced from the same target variety the judge grades
 * against (see register-policy.util.ts). It is counted against the Tier 0 token
 * cap like anything else.
 */
export function compileTier0Glossary(
  sections: LanguageGlossarySection[],
  registerPolicy?: string | null,
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
  // The derived register policy leads, so the variety instruction is read
  // before any authored section can restate it differently. See
  // compileRegisterPolicy for why it declares its own precedence.
  const policy = (registerPolicy ?? '').trim();
  return (policy ? [policy, ...compiled] : compiled).join('\n\n');
}
