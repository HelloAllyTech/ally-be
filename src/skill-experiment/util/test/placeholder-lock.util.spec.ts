import {
  checkPlaceholderLock,
  contentHash,
  countLoneBraces,
  extractPlaceholderTokens,
} from '../placeholder-lock.util';

/** Shaped like ally-ai's scenario_evaluation.txt: str.format slots, `{{` escapes. */
const PY_TEMPLATE = [
  'You are a supervisor.',
  '{SUPERVISOR_NOTE_SECTION}',
  'Transcript:',
  '{chat_history}',
  'Reply as JSON: {{"summary": "..."}}',
].join('\n');

/** Shaped like ally-be's track quiz grader: `{{var}}` slots and a literal JSON example. */
const BE_TEMPLATE = [
  'Question: {{question}}',
  'Answer: {{answer}}',
  'Respond with { "score": <number up to {{maxScore}}> }',
].join('\n');

describe('extractPlaceholderTokens', () => {
  it('returns every slot syntax exactly as written, deduplicated', () => {
    expect(
      extractPlaceholderTokens('{a} {{ b }} <c> {a} {{d}} <not a tag>'),
    ).toEqual(['<c>', '{a}', '{{ b }}', '{{d}}']);
  });

  it('reads {{x}} as one token rather than {x} inside braces', () => {
    expect(extractPlaceholderTokens('{{maxScore}}')).toEqual(['{{maxScore}}']);
  });
});

describe('countLoneBraces', () => {
  it('ignores placeholder tokens and {{ }} escapes', () => {
    expect(countLoneBraces(PY_TEMPLATE)).toBe(0);
  });

  it('counts braces a str.format render would choke on', () => {
    expect(countLoneBraces('Reply {"a": 1}')).toBe(2);
  });
});

describe('checkPlaceholderLock', () => {
  it('accepts a rewrite that keeps every slot', () => {
    const candidate = PY_TEMPLATE.replace(
      'You are a supervisor.',
      'You are a warm, precise clinical supervisor.',
    );
    expect(checkPlaceholderLock(PY_TEMPLATE, candidate)).toMatchObject({
      ok: true,
      errors: [],
    });
  });

  it('rejects a dropped slot', () => {
    const result = checkPlaceholderLock(
      PY_TEMPLATE,
      PY_TEMPLATE.replace('{SUPERVISOR_NOTE_SECTION}', ''),
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['{SUPERVISOR_NOTE_SECTION}']);
  });

  it('rejects a renamed slot as one missing and one added', () => {
    const result = checkPlaceholderLock(
      PY_TEMPLATE,
      PY_TEMPLATE.replace('{chat_history}', '{transcript}'),
    );
    expect(result.missing).toEqual(['{chat_history}']);
    expect(result.added).toEqual(['{transcript}']);
  });

  it('rejects a slot whose syntax changed — {x} and {{x}} are different contracts', () => {
    const result = checkPlaceholderLock(
      BE_TEMPLATE,
      BE_TEMPLATE.replace('{{answer}}', '{answer}'),
    );
    expect(result.ok).toBe(false);
    expect(result.added).toEqual(['{answer}']);
  });

  it('rejects a lone brace in a template that had none (str.format would raise)', () => {
    const result = checkPlaceholderLock(
      PY_TEMPLATE,
      `${PY_TEMPLATE}\nExample: {"score": 3}`,
    );
    expect(result.introducedLoneBraces).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('allows literal braces where the original already used them', () => {
    const result = checkPlaceholderLock(
      BE_TEMPLATE,
      `${BE_TEMPLATE}\nNever wrap the object in prose: {"score": 1}`,
    );
    expect(result.ok).toBe(true);
  });

  it('allows a slot to be used more or fewer times as long as it survives', () => {
    const result = checkPlaceholderLock(
      BE_TEMPLATE,
      `${BE_TEMPLATE}\nRe-read: {{question}}`,
    );
    expect(result.ok).toBe(true);
  });
});

describe('contentHash', () => {
  it('ignores surrounding whitespace only', () => {
    expect(contentHash('  abc \n')).toBe(contentHash('abc'));
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
  });
});
