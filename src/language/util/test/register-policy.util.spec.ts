import {
  compileRegisterPolicy,
  resolveTargetVariety,
} from '../register-policy.util';
import { compileTier0Glossary } from '../glossary-compiler.util';
import {
  GlossaryInjectionMode,
  GlossarySectionStatus,
} from '../../entity/language-glossary-section.entity';

/**
 * Phase 1 of the working-memory design: the agent's register instruction and
 * the judge's grading target come from one expression.
 *
 * The bug this prevents is measured, not hypothetical — Tamil ran 3,225 agent
 * messages with zero glossary violations while the judge filed 1,507 register
 * annotations. The list and the grader wanted different things.
 */
describe('resolveTargetVariety', () => {
  it('prefers the configured target variety', () => {
    expect(
      resolveTargetVariety(
        { targetVariety: 'colloquial spoken Tamil' },
        'Tamil',
      ),
    ).toBe('colloquial spoken Tamil');
  });

  it('falls back to the language label, never to undefined', () => {
    // The old judge-side fallback was `undefined`, which the judge renders as
    // "unknown" — grading against nothing while the agent was told something.
    expect(resolveTargetVariety(null, 'Kannada')).toBe(
      'colloquial spoken Kannada',
    );
    expect(resolveTargetVariety({}, 'Kannada')).toBe(
      'colloquial spoken Kannada',
    );
  });

  it('treats a blank configured value as absent', () => {
    expect(resolveTargetVariety({ targetVariety: '   ' }, 'Hindi')).toBe(
      'colloquial spoken Hindi',
    );
  });

  it('ignores a non-string configured value', () => {
    expect(resolveTargetVariety({ targetVariety: 42 }, 'Hindi')).toBe(
      'colloquial spoken Hindi',
    );
  });

  it('degrades to a generic descriptor rather than "colloquial spoken "', () => {
    expect(resolveTargetVariety(null, null)).toBe('colloquial spoken language');
    expect(resolveTargetVariety(null, '  ')).toBe('colloquial spoken language');
  });
});

describe('compileRegisterPolicy', () => {
  it('states the variety and declares precedence', () => {
    const block = compileRegisterPolicy('colloquial spoken Tamil');
    expect(block).toContain('Speak colloquial spoken Tamil.');
    // Without an explicit winner this only adds a second opinion beside
    // core_style's generated register policy — the exact shape of the Kannada
    // core_style / pronouns_kinship conflict.
    expect(block).toContain('this line wins');
  });

  it('renders nothing for an empty descriptor', () => {
    expect(compileRegisterPolicy('')).toBe('');
    expect(compileRegisterPolicy('   ')).toBe('');
  });

  it('is byte-stable for the same descriptor', () => {
    // Tier 0 is ordered deterministically for prompt-cache stability; a block
    // that varied per turn would defeat that.
    expect(compileRegisterPolicy('colloquial spoken Hindi')).toBe(
      compileRegisterPolicy('colloquial spoken Hindi'),
    );
  });
});

describe('compileTier0Glossary with a register policy', () => {
  const section = (sectionCode: string, title: string, content: string) =>
    ({
      sectionCode,
      title,
      content,
      status: GlossarySectionStatus.PUBLISHED,
      injectionMode: GlossaryInjectionMode.ALWAYS,
    }) as any;

  it('leads with the register policy, before any authored section', () => {
    const compiled = compileTier0Glossary(
      [section('core_style', 'Core style', 'be warm and brief')],
      compileRegisterPolicy('colloquial spoken Tamil'),
    );
    expect(compiled.indexOf('## Register')).toBe(0);
    expect(compiled.indexOf('## Register')).toBeLessThan(
      compiled.indexOf('## Core style'),
    );
  });

  it('is unchanged when no policy is given', () => {
    const sections = [section('core_style', 'Core style', 'be warm')];
    expect(compileTier0Glossary(sections)).toBe(
      compileTier0Glossary(sections, null),
    );
    expect(compileTier0Glossary(sections)).not.toContain('## Register');
  });

  it('still renders the policy when no sections are published', () => {
    // A language with no glossary yet still has a variety it is graded on.
    const compiled = compileTier0Glossary(
      [],
      compileRegisterPolicy('colloquial spoken Odia'),
    );
    expect(compiled).toContain('Speak colloquial spoken Odia.');
  });

  it('keeps authored content verbatim', () => {
    const compiled = compileTier0Glossary(
      [
        section(
          'core_style',
          'Core style',
          'keep "app" and "tension" as spoken',
        ),
      ],
      compileRegisterPolicy('colloquial spoken Hindi'),
    );
    expect(compiled).toContain('keep "app" and "tension" as spoken');
  });
});
