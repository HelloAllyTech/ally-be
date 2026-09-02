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

  it('treats a single-line rule with no pair as prose, not buried', () => {
    expect(classifyRuleForm('- Speak colloquially at all times.')).toBe(
      'no_substitution',
    );
  });
});
