import { truncateTitle } from '../truncate-title.util';

describe('truncateTitle', () => {
  it('returns short text unchanged', () => {
    expect(truncateTitle('A short title')).toBe('A short title');
  });

  it('never cuts mid-word', () => {
    const text =
      "The system is repeatedly failing to communicate with the 'Bey Presence API' " +
      'for the video avatar, which can lead to the video actor not functioning ' +
      'correctly for users. This can result in a degraded user experience during live sessions.';

    const result = truncateTitle(text, 200);
    const withoutEllipsis = result.replace(/…$/, '');

    expect(result.length).toBeLessThanOrEqual(201); // 200 + ellipsis at most
    expect(text.startsWith(withoutEllipsis)).toBe(true);
    // The character right after the cut in the ORIGINAL text must be a word
    // boundary (whitespace or end of string) — proof the cut did not land
    // inside a word.
    const nextChar = text[withoutEllipsis.length];
    expect(nextChar === undefined || /\s/.test(nextChar)).toBe(true);
  });

  it('prefers a sentence boundary over a mid-sentence word boundary when one falls late enough', () => {
    const firstSentence = `This is the first sentence and it runs long enough on its own ${'word '.repeat(14).trim()}.`;
    const text = `${firstSentence} Followed by a second sentence that pushes the whole thing well past the two hundred character limit for sure.`;

    const result = truncateTitle(text, 200);

    expect(result).toBe(firstSentence);
  });

  it('ignores an opening sentence boundary that falls too early, rather than cutting the title to almost nothing', () => {
    const text = 'Short opening sentence. ' + `${'filler '.repeat(40).trim()}.`;

    const result = truncateTitle(text, 200);

    expect(result).not.toBe('Short opening sentence.');
    expect(result.length).toBeGreaterThan(100);
  });

  it('falls back to a word boundary with an ellipsis when no sentence boundary is close enough', () => {
    const text = 'word '.repeat(60).trim();

    const result = truncateTitle(text, 200);

    expect(result.endsWith('…')).toBe(true);
    expect(result).not.toMatch(/\sword$/); // not cut inside the last word
  });

  it('trims surrounding whitespace before measuring length', () => {
    expect(truncateTitle('   padded   ', 200)).toBe('padded');
  });
});
