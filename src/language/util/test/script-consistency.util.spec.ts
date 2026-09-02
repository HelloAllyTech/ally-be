import {
  excludeForeignScripts,
  foreignScriptsFor,
  scriptForLanguage,
} from '../script-consistency.util';

describe('scriptForLanguage', () => {
  it('maps the platform languages to their scripts', () => {
    expect(scriptForLanguage('ta-IN')).toBe('tamil');
    expect(scriptForLanguage('hi-IN')).toBe('devanagari');
    expect(scriptForLanguage('mr-IN')).toBe('devanagari');
    expect(scriptForLanguage('kn-IN')).toBe('kannada');
    expect(scriptForLanguage('en-IN')).toBe('latin');
    expect(scriptForLanguage('en-GB')).toBe('latin');
  });

  it('returns null for an unknown code rather than guessing', () => {
    expect(scriptForLanguage('zz-ZZ')).toBeNull();
    expect(scriptForLanguage('')).toBeNull();
  });
});

describe('foreignScriptsFor', () => {
  it('never treats Latin as foreign — every language code-mixes English', () => {
    for (const lang of ['ta-IN', 'hi-IN', 'kn-IN', 'ml-IN']) {
      expect(foreignScriptsFor(lang)).not.toContain('latin');
    }
  });

  it('excludes a language own script but not the others', () => {
    expect(foreignScriptsFor('ta-IN')).not.toContain('tamil');
    expect(foreignScriptsFor('ta-IN')).toContain('devanagari');
    expect(foreignScriptsFor('hi-IN')).not.toContain('devanagari');
    expect(foreignScriptsFor('hi-IN')).toContain('tamil');
  });

  // Hindi and Marathi share Devanagari, so neither may exclude it.
  it('treats Marathi and Hindi as the same script', () => {
    expect(foreignScriptsFor('mr-IN')).not.toContain('devanagari');
  });

  it('filters nothing for an unknown language instead of everything', () => {
    expect(foreignScriptsFor('zz-ZZ')).toEqual([]);
  });
});

describe('excludeForeignScripts', () => {
  it('returns null when there is nothing to exclude', () => {
    expect(excludeForeignScripts('a."aiText"', 'zz-ZZ')).toBeNull();
  });

  it('keeps the SQL pure ASCII — it travels through base64/SSM/docker', () => {
    const sql = excludeForeignScripts('a."aiText"', 'en-IN');
    expect(sql).not.toBeNull();
    expect(/^[\x00-\x7F]*$/.test(sql as string)).toBe(true);
  });

  it('keeps NULL evidence: it cannot contain a foreign script', () => {
    const sql = excludeForeignScripts('a."aiText"', 'en-IN') as string;
    expect(sql).toContain('a."aiText" IS NULL OR');
  });

  it('builds the Tamil block bounds for English via chr()', () => {
    const sql = excludeForeignScripts('a."aiText"', 'en-IN') as string;
    // Tamil U+0B80-0BFF = 2944-3071 — the block that contaminated en-IN.
    expect(sql).toContain('chr(2944)');
    expect(sql).toContain('chr(3071)');
  });

  it('omits Tamil bounds for Tamil itself', () => {
    const sql = excludeForeignScripts('a."aiText"', 'ta-IN') as string;
    expect(sql).not.toContain('chr(2944)');
    expect(sql).toContain('chr(2304)'); // Devanagari lower bound
  });
});
