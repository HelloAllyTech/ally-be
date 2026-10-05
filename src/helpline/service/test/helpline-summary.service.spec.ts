import {
  HelplineMessageType,
  HelplineSenderRole,
  HelplineSummaryKind,
} from '../../constants/helpline.constants';
import { HELPLINE_DEFAULT_SETTINGS } from '../../constants/helpline-settings.defaults';
import {
  HelplineSummaryService,
  coerceSummaryFields,
  toSummaryHistory,
  validateSummaryEdit,
} from '../helpline-summary.service';

const turn = (senderRole: HelplineSenderRole, content: string, id: number) =>
  ({
    id,
    senderRole,
    content,
    type: HelplineMessageType.TEXT,
    erasedAt: null,
  }) as never;

describe('helpline summaries', () => {
  it('sends TEXT turns as CLIENT / COUNSELOR, the roles existing callers use', () => {
    expect(
      toSummaryHistory([
        turn(HelplineSenderRole.TALKER, 'I feel low', 1),
        turn(HelplineSenderRole.LISTENER, 'Tell me more', 2),
        turn(HelplineSenderRole.SUPERVISOR, 'I am here too', 3),
      ]),
    ).toEqual([
      { role: 'CLIENT', content: 'I feel low' },
      { role: 'COUNSELOR', content: 'Tell me more' },
      { role: 'COUNSELOR', content: 'I am here too' },
    ]);
  });

  it('keeps only the org’s keys from the dynamic `{ fields }` response, as strings', () => {
    expect(
      coerceSummaryFields(
        {
          fields: {
            presenting_concern: ' exams ',
            risk: null,
            extra: 'x',
            next_step: 3,
          },
        },
        HELPLINE_DEFAULT_SETTINGS.summaryFields,
      ),
    ).toEqual({ presenting_concern: 'exams', next_step: '3' });
    expect(
      coerceSummaryFields(undefined, HELPLINE_DEFAULT_SETTINGS.summaryFields),
    ).toBeNull();
    expect(
      coerceSummaryFields(
        { fields: {} },
        HELPLINE_DEFAULT_SETTINGS.summaryFields,
      ),
    ).toBeNull();
  });

  it('validates a listener edit', () => {
    expect(validateSummaryEdit({ risk: 'none discussed' })).toEqual({
      risk: 'none discussed',
    });
    expect(() => validateSummaryEdit({ 'Bad Key': 'x' })).toThrow();
    expect(() => validateSummaryEdit({ risk: 5 })).toThrow();
    expect(() => validateSummaryEdit(['x'])).toThrow();
  });

  describe('generateFinal', () => {
    const build = (
      aiResult: unknown,
      chat: unknown = { id: 'c-1', tenantId: 't-1', erasedAt: null },
    ) => {
      const deps = {
        summaries: {
          query: jest.fn().mockResolvedValue([[{ id: 's-1' }], 1]),
          findOne: jest.fn().mockResolvedValue({
            id: 's-1',
            tenantId: 't-1',
            kind: HelplineSummaryKind.FINAL,
            fields: { risk: 'x' },
            throughMessageId: 2,
            editedBy: null,
            version: 1,
            updatedAt: new Date(),
          }),
        },
        chats: { findById: jest.fn().mockResolvedValue(chat) },
        messages: {
          listTextTurns: jest
            .fn()
            .mockResolvedValue([
              turn(HelplineSenderRole.TALKER, 'hi', 1),
              turn(HelplineSenderRole.LISTENER, 'hello', 2),
            ]),
        },
        tenants: {
          resolve: jest.fn().mockResolvedValue({ id: 't-1', code: 'acme' }),
        },
        settings: {
          getSettings: jest.fn().mockResolvedValue(HELPLINE_DEFAULT_SETTINGS),
        },
        views: { summaryDto: jest.fn().mockResolvedValue({ kind: 'FINAL' }) },
        realtime: { emit: jest.fn().mockResolvedValue(undefined) },
        ai: {
          generateSummaryAndTags:
            aiResult instanceof Error
              ? jest.fn().mockRejectedValue(aiResult)
              : jest.fn().mockResolvedValue(aiResult),
        },
      };
      const service = new HelplineSummaryService(
        deps.summaries as never,
        deps.chats as never,
        deps.messages as never,
        deps.tenants as never,
        deps.settings as never,
        deps.views as never,
        deps.realtime as never,
        deps.ai as never,
      );
      return { service, ...deps };
    };

    it('calls ally-ai with the org’s summary fields as keys and upserts FINAL', async () => {
      const { service, ai, summaries, realtime } = build({
        fields: { risk: 'none' },
      });
      await service.generateFinal('t-1', 'c-1');
      const [history, mode, keys, descriptions] =
        ai.generateSummaryAndTags.mock.calls[0];
      expect(history).toHaveLength(2);
      expect(mode).toBeUndefined();
      expect(keys).toEqual(
        HELPLINE_DEFAULT_SETTINGS.summaryFields.map((f) => f.key),
      );
      expect(descriptions.risk).toBe(
        'Risk: Any risk discussed, and what was agreed',
      );
      const [sql, params] = summaries.query.mock.calls[0];
      expect(sql).toContain(`"helpline_chat_summaries"."edited_by" IS NULL`);
      expect(sql).toContain(`"erased_at" IS NOT NULL`);
      expect(params).toEqual([
        't-1',
        'c-1',
        'FINAL',
        JSON.stringify({ risk: 'none' }),
        2,
      ]);
      expect(realtime.emit).toHaveBeenCalledWith(
        'staff:c-1',
        'SUMMARY_UPDATED',
        {
          chatId: 'c-1',
          summary: { kind: 'FINAL' },
        },
      );
    });

    it('a failed or empty ally-ai answer leaves no row and emits nothing', async () => {
      for (const result of [undefined, new Error('down'), { fields: {} }]) {
        const { service, summaries, realtime } = build(result);
        await expect(service.generateFinal('t-1', 'c-1')).resolves.toBeNull();
        expect(summaries.query).not.toHaveBeenCalled();
        expect(realtime.emit).not.toHaveBeenCalled();
      }
    });

    it('never summarises an erased chat', async () => {
      const { service, ai } = build(
        { fields: { risk: 'x' } },
        { id: 'c-1', tenantId: 't-1', erasedAt: new Date() },
      );
      await expect(service.generateFinal('t-1', 'c-1')).resolves.toBeNull();
      expect(ai.generateSummaryAndTags).not.toHaveBeenCalled();
    });
  });
});
