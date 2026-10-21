import { BadRequestException } from '@nestjs/common';
import { TrackItemType } from '../../type/track.type';
import { applyPromptHtml, storedPromptsOf } from '../prompt-html.util';

const OLD_HTML = '<p>Old <strong>text</strong></p>';

describe('prompt-html.util', () => {
  describe('applyPromptHtml', () => {
    it('sanitizes promptHtml and derives prompt for a quiz question', () => {
      const content = {
        questions: [
          { id: 'q', prompt: '', promptHtml: '<p>Hi</p><script>x()</script>' },
        ],
      };

      applyPromptHtml(TrackItemType.QUIZ, content);

      expect(content.questions[0].promptHtml).toBe('<p>Hi</p>');
      expect(content.questions[0].prompt).toBe('Hi');
    });

    it.each([
      [TrackItemType.QUIZ, (q: any) => ({ questions: [q] })],
      [TrackItemType.ARTICLE, (q: any) => ({ questions: [q] })],
      [
        TrackItemType.VIDEO,
        (q: any) => ({ interjections: [{ id: 'i', question: q }] }),
      ],
      [TrackItemType.JOURNAL, (q: any) => ({ prompts: [q] })],
    ])('%s: a plain-text edit beats a stale promptHtml', (type, wrap) => {
      const before = wrap({
        id: 'q',
        prompt: 'Old text',
        promptHtml: OLD_HTML,
      });
      const incoming = wrap({
        id: 'q',
        prompt: 'Edited',
        promptHtml: OLD_HTML,
      });

      applyPromptHtml(type, incoming, storedPromptsOf(type, before));

      const q = JSON.stringify(incoming);
      expect(q).toContain('"prompt":"Edited"');
      expect(q).not.toContain('promptHtml');
    });

    it('re-derives prompt when promptHtml changed, even if prompt also did', () => {
      const type = TrackItemType.JOURNAL;
      const before = {
        prompts: [{ id: 'q', prompt: 'Old text', promptHtml: OLD_HTML }],
      };
      const incoming = {
        prompts: [{ id: 'q', prompt: 'Whatever', promptHtml: '<p>New</p>' }],
      };

      applyPromptHtml(type, incoming, storedPromptsOf(type, before));

      expect(incoming.prompts[0]).toMatchObject({
        prompt: 'New',
        promptHtml: '<p>New</p>',
      });
    });

    it('treats a prompt with nothing stored as the HTML being the truth', () => {
      const content = {
        prompts: [{ id: 'new', prompt: 'stale', promptHtml: '<p>Fresh</p>' }],
      };

      applyPromptHtml(TrackItemType.JOURNAL, content, new Map());

      expect(content.prompts[0].prompt).toBe('Fresh');
    });

    it('derives prompt when the client sent promptHtml but no prompt', () => {
      const type = TrackItemType.JOURNAL;
      const before = {
        prompts: [{ id: 'q', prompt: 'Old', promptHtml: OLD_HTML }],
      };
      const content = { prompts: [{ id: 'q', promptHtml: OLD_HTML } as any] };

      applyPromptHtml(type, content, storedPromptsOf(type, before));

      expect(content.prompts[0].prompt).toBe('Old text');
      expect(content.prompts[0].promptHtml).toBe(OLD_HTML);
    });

    it('leaves a prompt without promptHtml untouched', () => {
      const content = { prompts: [{ id: 'q', prompt: 'Plain' }] };

      applyPromptHtml(TrackItemType.JOURNAL, content);

      expect(content.prompts[0]).toEqual({ id: 'q', prompt: 'Plain' });
    });

    it('rejects a non-string promptHtml', () => {
      const content = { prompts: [{ id: 'q', prompt: 'x', promptHtml: 5 }] };

      expect(() => applyPromptHtml(TrackItemType.JOURNAL, content)).toThrow(
        BadRequestException,
      );
    });

    it('ignores content that is not an object or has no carriers', () => {
      expect(() => applyPromptHtml(TrackItemType.QUIZ, null)).not.toThrow();
      expect(() => applyPromptHtml(TrackItemType.GAME, {})).not.toThrow();
      expect(() =>
        applyPromptHtml(TrackItemType.QUIZ, { questions: 'nope' }),
      ).not.toThrow();
    });
  });
});
