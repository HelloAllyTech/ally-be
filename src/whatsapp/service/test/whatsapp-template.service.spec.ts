import { WaKeywordTemplate } from '../../entity/wa-keyword-template.entity';
import { WaTemplateKind, WaTemplateMatchType } from '../../enum/whatsapp.enum';
import { WhatsAppTemplateService } from '../whatsapp-template.service';

/**
 * Template matching is the safety-critical part of the pipeline: the ordering decides whether a
 * crisis reply is sent at all, and the match type decides whether it is sent to the wrong person.
 * Both failures are silent — the bot answers something plausible either way.
 */
describe('WhatsAppTemplateService', () => {
  const template = (over: Partial<WaKeywordTemplate>): WaKeywordTemplate =>
    ({
      id: over.id ?? 'id',
      kind: WaTemplateKind.FAQ,
      name: 'test',
      matchType: WaTemplateMatchType.ANY_OF,
      patterns: [],
      languageCode: null,
      priority: 300,
      responseText: 'reply',
      bypassRag: true,
      terminal: false,
      active: true,
      mandatory: false,
      archivedAt: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      ...over,
    }) as WaKeywordTemplate;

  const serviceWith = (templates: WaKeywordTemplate[]) =>
    new WhatsAppTemplateService({
      find: jest.fn().mockResolvedValue(templates),
    } as never);

  describe('normalise', () => {
    it('folds case, punctuation and whitespace', () => {
      expect(WhatsAppTemplateService.normalise('  HELP!!  me?  ')).toBe(
        'help me',
      );
    });

    it('applies NFKC so full-width text folds to canonical form', () => {
      // Without NFKC an IME-typed or pasted keyword silently fails to match.
      expect(WhatsAppTemplateService.normalise('ＳＴＯＰ')).toBe('stop');
    });

    it('keeps non-Latin scripts intact', () => {
      // An ASCII-only strip would erase a Devanagari crisis keyword entirely and match nothing —
      // the bot answers in Hindi, Tamil and Bengali.
      expect(WhatsAppTemplateService.normalise('आत्महत्या!')).toBe('आत्महत्या');
      expect(WhatsAppTemplateService.normalise('தற்கொலை?')).toBe('தற்கொலை');
    });

    it('keeps digits', () => {
      expect(WhatsAppTemplateService.normalise('PHQ-9 score')).toBe(
        'phq 9 score',
      );
    });
  });

  describe('ordering', () => {
    it('a crisis rule wins over an FAQ rule that also matches', async () => {
      // THE test for this module. If an FAQ rule can win, a crisis reply is never sent.
      const service = serviceWith([
        template({
          id: 'crisis',
          kind: WaTemplateKind.CRISIS,
          priority: 10,
          patterns: ['suicide'],
          terminal: true,
        }),
        template({
          id: 'faq',
          kind: WaTemplateKind.FAQ,
          priority: 300,
          patterns: ['suicide'],
        }),
      ]);

      const match = await service.match('a client mentioned suicide');
      expect(match?.template.id).toBe('crisis');
      expect(match?.terminal).toBe(true);
    });

    it('breaks a priority tie deterministically by creation time', async () => {
      // Otherwise the same message could match different rules on different days.
      const service = serviceWith([
        template({
          id: 'older',
          priority: 300,
          patterns: ['hello'],
          createdAt: new Date('2026-01-01'),
        }),
        template({
          id: 'newer',
          priority: 300,
          patterns: ['hello'],
          createdAt: new Date('2026-02-01'),
        }),
      ]);

      expect((await service.match('hello'))?.template.id).toBe('older');
    });

    it('returns null when nothing matches, so retrieval runs', async () => {
      const service = serviceWith([template({ patterns: ['unrelated'] })]);
      expect(
        await service.match('how do I document a risk assessment'),
      ).toBeNull();
    });

    it('ignores an empty message', async () => {
      const service = serviceWith([template({ patterns: ['hi'] })]);
      expect(await service.match('   ')).toBeNull();
    });
  });

  describe('ANY_OF whole-word matching', () => {
    it('matches a keyword as a whole word', async () => {
      const service = serviceWith([
        template({
          patterns: ['suicide'],
          matchType: WaTemplateMatchType.ANY_OF,
        }),
      ]);
      expect(
        await service.match('client mentioned suicide today'),
      ).not.toBeNull();
    });

    it('does NOT match a keyword embedded in a longer word', async () => {
      // The reason ANY_OF is the default for crisis rules: a substring match on a short risk word is
      // how "therapist" fires a rule keyed on "rapist", sending a crisis reply to a legitimate
      // clinical question.
      const service = serviceWith([
        template({
          patterns: ['rapist'],
          matchType: WaTemplateMatchType.ANY_OF,
        }),
      ]);
      expect(await service.match('I referred them to a therapist')).toBeNull();
    });

    it('matches a multi-word phrase', async () => {
      const service = serviceWith([
        template({
          patterns: ['kill myself'],
          matchType: WaTemplateMatchType.ANY_OF,
        }),
      ]);
      expect(
        await service.match('they said they might kill myself'),
      ).not.toBeNull();
    });

    it('matches a Devanagari crisis keyword end to end', async () => {
      // The regression this guards: combining marks are Unicode category M, not L, so a
      // `\p{L}\p{N}` keep-set silently turned "आत्महत्या" into "आत महत य" and matched nothing —
      // disabling risk detection for most of this bot's audience with no error anywhere.
      const service = serviceWith([
        template({
          kind: WaTemplateKind.CRISIS,
          priority: 10,
          patterns: ['आत्महत्या'],
          matchType: WaTemplateMatchType.ANY_OF,
        }),
      ]);

      expect(await service.match('मरीज ने आत्महत्या की बात की')).not.toBeNull();
    });

    it('matches a Tamil crisis keyword end to end', async () => {
      const service = serviceWith([
        template({
          kind: WaTemplateKind.CRISIS,
          priority: 10,
          patterns: ['தற்கொலை'],
          matchType: WaTemplateMatchType.ANY_OF,
        }),
      ]);

      expect(await service.match('அவர் தற்கொலை பற்றி பேசினார்')).not.toBeNull();
    });

    it('matches at the start and end of a message', async () => {
      const service = serviceWith([
        template({ patterns: ['stop'], matchType: WaTemplateMatchType.ANY_OF }),
      ]);
      expect(await service.match('stop please')).not.toBeNull();
      expect(await service.match('please stop')).not.toBeNull();
    });
  });

  describe('other match types', () => {
    it('EXACT requires the whole message', async () => {
      const service = serviceWith([
        template({ patterns: ['stop'], matchType: WaTemplateMatchType.EXACT }),
      ]);
      expect(await service.match('stop')).not.toBeNull();
      // Important for opt-out: "stop asking me about that" is a question, not an unsubscribe.
      expect(await service.match('stop asking me about that')).toBeNull();
    });

    it('CONTAINS matches a substring', async () => {
      const service = serviceWith([
        template({
          patterns: ['risk assessment'],
          matchType: WaTemplateMatchType.CONTAINS,
        }),
      ]);
      expect(
        await service.match('how do I do a risk assessment?'),
      ).not.toBeNull();
    });

    it('REGEX matches a pattern', async () => {
      const service = serviceWith([
        template({
          patterns: ['^phq\\s?9'],
          matchType: WaTemplateMatchType.REGEX,
        }),
      ]);
      expect(await service.match('PHQ 9 scoring')).not.toBeNull();
    });

    it('skips an invalid regex instead of throwing', async () => {
      // One malformed rule an admin saved must not take down every reply — including the crisis ones.
      const service = serviceWith([
        template({
          id: 'broken',
          priority: 10,
          patterns: ['([unclosed'],
          matchType: WaTemplateMatchType.REGEX,
        }),
        template({ id: 'good', priority: 20, patterns: ['hello'] }),
      ]);

      expect((await service.match('hello'))?.template.id).toBe('good');
    });

    it('ignores a template with no patterns', async () => {
      const service = serviceWith([template({ patterns: [] })]);
      expect(await service.match('anything')).toBeNull();
    });
  });

  describe('language scoping', () => {
    it('a scoped rule only applies to its language', async () => {
      const service = serviceWith([
        template({ id: 'hi-only', languageCode: 'hi', patterns: ['madad'] }),
      ]);

      expect(await service.match('madad', 'hi')).not.toBeNull();
      expect(await service.match('madad', 'en')).toBeNull();
    });

    it('an unscoped rule applies to every language', async () => {
      const service = serviceWith([
        template({ languageCode: null, patterns: ['stop'] }),
      ]);
      expect(await service.match('stop', 'ta')).not.toBeNull();
    });

    it('a scoped rule still applies when the language is unknown', async () => {
      // Language is detected downstream, so it can legitimately be null on a first message. Skipping
      // scoped rules then would silently disable them for every first contact.
      const service = serviceWith([
        template({ languageCode: 'hi', patterns: ['madad'] }),
      ]);
      expect(await service.match('madad', null)).not.toBeNull();
    });
  });
});
