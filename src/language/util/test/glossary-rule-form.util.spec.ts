import { classifyRuleForm, isBindingForm } from '../glossary-rule-form.util';

describe('classifyRuleForm', () => {
  it('accepts the canonical say/avoid one-liner (100% observed compliance)', () => {
    expect(classifyRuleForm('- worry: say `ಟೆನ್ಶನ್` (avoid: `ಆತಂಕ`)')).toBe(
      'canonical',
    );
    expect(classifyRuleForm('- yes: say `ஆமா` (avoid: `ஆமாம்`)')).toBe(
      'canonical',
    );
  });

  it('accepts the bare `(not X)` variant', () => {
    expect(classifyRuleForm('- but: say `ಆದ್ರೆ` (not ಆದರೆ)')).toBe('canonical');
  });

  // The exact shape that measured 3.9% and 0% compliance in Kannada.
  it('flags a rule whose pair sits only in a continuation example', () => {
    const buried =
      '- Use contracted SPOKEN forms for connectives — written Kannada keeps\n' +
      '  vowels that speech drops (schwa deletion). Apply it everywhere:\n' +
      '  e.g. ಆದ್ರೆ (not ಆದರೆ), ಅಂದ್ರೆ (not ಎಂದರೆ)';
    expect(classifyRuleForm(buried)).toBe('pair_only_in_example');
    expect(isBindingForm(buried)).toBe(false);
  });

  it('reports prose guidance with no substitution', () => {
    expect(
      classifyRuleForm('- Express thoughts naturally, not as a presentation.'),
    ).toBe('no_substitution');
    expect(classifyRuleForm('')).toBe('no_substitution');
  });

  // A canonical rule may still carry an illustrative second line; that is the
  // good shape and must not be confused with the buried one.
  it('keeps a canonical first line canonical even with an example below', () => {
    const withExample =
      '- with: say `கூட` (avoid: `உடன்`)\n' +
      '  e.g., நான் அவங்க கூட இருக்கேன்.';
    expect(classifyRuleForm(withExample)).toBe('canonical');
    expect(isBindingForm(withExample)).toBe(true);
  });

  // These six are the REAL production proposals that a first cut of this
  // classifier auto-rejected in a dry run before any model saw them. Each
  // states its substitution on the opening line, in prose rather than
  // `(avoid: …)` syntax, and each is a legitimate rule.
  it('accepts a prose substitution stated on the opening line (Hindi तुम/आप)', () => {
    const real =
      '- Use the informal pronoun `तुम` for "you", not the formal `आप`. The persona is a peer, not a formal authority.\n' +
      '  - e.g., say `तुम सही कह रहे हो।` (not `आप सही कह रहे हैं।`)';
    expect(classifyRuleForm(real)).toBe('canonical');
    expect(isBindingForm(real)).toBe(true);
  });

  it('does not call a rule buried just because it carries an example (Tamil animacy)', () => {
    const real =
      "- Verbs must agree with the subject's animacy. Use human honorific endings like `-றாங்க`/`-ங்க` for human subjects (`அவங்க`, `அம்மா`), and neuter endings like `-து`/`-ம்` for non-human subjects.\n" +
      '  e.g., தூக்கம் வருமா? (not தூக்கம் வருவாரா?)';
    // Concrete terms on line 1 but no contrast word: prose guidance, for the
    // adjudicator to weigh — NOT an automatic rejection.
    expect(classifyRuleForm(real)).not.toBe('pair_only_in_example');
  });

  it('accepts an opening line using `Avoid` in prose (Tamil passive voice)', () => {
    const real =
      '- Avoid the passive voice construction with `-படு-`. Use active voice instead.\n' +
      '  e.g., உடம்பு பாதிக்குது. (not உடம்பு பாதிக்கப்படுது.)';
    expect(classifyRuleForm(real)).toBe('canonical');
  });

  it('still catches the abstract opener with no concrete term at all', () => {
    const kannada =
      '- Use contracted SPOKEN forms for connectives — written Kannada keeps vowels that speech drops (schwa deletion). This is a pattern, apply it everywhere:\n' +
      '  e.g. ಆದ್ರೆ (not ಆದರೆ), ಅಂದ್ರೆ (not ಎಂದರೆ)';
    expect(classifyRuleForm(kannada)).toBe('pair_only_in_example');
    expect(isBindingForm(kannada)).toBe(false);
  });

  it('treats a single-line rule with no pair as prose, not buried', () => {
    expect(classifyRuleForm('- Speak colloquially at all times.')).toBe(
      'no_substitution',
    );
  });
});
