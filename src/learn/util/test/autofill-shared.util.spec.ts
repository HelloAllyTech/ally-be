import { stripMarkdownFences } from '../autofill-shared.util';

describe('stripMarkdownFences', () => {
  it('returns plain text unchanged', () => {
    expect(stripMarkdownFences('hello world')).toBe('hello world');
  });

  it('trims surrounding whitespace', () => {
    expect(stripMarkdownFences('  hello  ')).toBe('hello');
  });

  it('strips a leading ``` fence with no language tag', () => {
    expect(stripMarkdownFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips a ```json fenced block', () => {
    expect(stripMarkdownFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips a ```html fenced block around HTML output', () => {
    const input = '```html\n<p>Hello <strong>world</strong></p>\n```';
    expect(stripMarkdownFences(input)).toBe(
      '<p>Hello <strong>world</strong></p>',
    );
  });

  it('strips arbitrary language tags on the opening fence', () => {
    expect(stripMarkdownFences('```ts\nconst x = 1;\n```')).toBe(
      'const x = 1;',
    );
  });

  it('matches the language tag case-insensitively', () => {
    expect(stripMarkdownFences('```HTML\n<p>x</p>\n```')).toBe('<p>x</p>');
  });

  it('strips fences when only a leading fence is present', () => {
    expect(stripMarkdownFences('```html\n<p>x</p>')).toBe('<p>x</p>');
  });

  it('strips a trailing fence when only it is present', () => {
    expect(stripMarkdownFences('<p>x</p>\n```')).toBe('<p>x</p>');
  });

  it('leaves unfenced HTML untouched', () => {
    const html = '<p>Hello</p><ul><li>a</li><li>b</li></ul>';
    expect(stripMarkdownFences(html)).toBe(html);
  });

  it('does not strip inline backticks inside content', () => {
    const input = 'use `npm install` to add deps';
    expect(stripMarkdownFences(input)).toBe(input);
  });
});
