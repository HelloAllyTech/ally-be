import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { FHS_RUBRIC } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  FoundationalSkillsJudgeService,
  HELPLINE_QA_JUDGE_TASK_ID,
  buildJudgeSystemPrompt,
} from 'src/foundational-skills/service/foundational-skills-judge.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  HelplineChatStatus,
  HelplineMessageType,
  HelplineQaStatus,
  HelplineSenderRole,
} from '../../constants/helpline.constants';
import {
  HELPLINE_QA,
  HELPLINE_QA_RUBRIC_VERSION,
  HelplineQaService,
  buildQaTranscript,
  qaEligible,
  quoteOffsets,
} from '../helpline-qa.service';

const TENANT = { id: 't-uuid', code: 'acme', name: 'Acme', logoUrl: null };
const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const LISTENER = 7;
const PREVIOUS = 5;

const text = (
  id: number,
  role: HelplineSenderRole,
  content: string,
  userId: number | null = null,
) => ({
  id,
  type: HelplineMessageType.TEXT,
  senderRole: role,
  senderUserId: userId,
  content,
  erasedAt: null as Date | null,
});

const LONG =
  'That sounds really heavy to carry on your own, and I am glad you wrote in tonight. ';
const conversation = [
  text(1, HelplineSenderRole.TALKER, 'I cannot sleep and I feel alone'),
  text(2, HelplineSenderRole.LISTENER, 'An earlier listener reply', PREVIOUS),
  text(
    3,
    HelplineSenderRole.LISTENER,
    `${LONG}What has been keeping you up?`,
    LISTENER,
  ),
  text(4, HelplineSenderRole.TALKER, 'Work, mostly. And my sister moved away.'),
  text(
    5,
    HelplineSenderRole.LISTENER,
    `${LONG}How are you feeling about her moving?`,
    LISTENER,
  ),
  text(6, HelplineSenderRole.TALKER, 'Lonely.'),
  text(
    7,
    HelplineSenderRole.LISTENER,
    `${LONG}Tell me more about the loneliness.`,
    LISTENER,
  ),
];

describe('QA transcript and eligibility', () => {
  it('helper = listener of record only; client = talker; others left out', () => {
    const t = buildQaTranscript(
      {
        id: CHAT_ID,
        tenantId: TENANT.id,
        listenerId: LISTENER,
        endedAt: new Date(),
      },
      conversation,
    );
    expect(t.session.turns.map((x) => [x.messageId, x.speaker])).toEqual([
      [1, 'client'],
      [3, 'helper'],
      [4, 'client'],
      [5, 'helper'],
      [6, 'client'],
      [7, 'helper'],
    ]);
    expect(t.listenerMessages).toBe(3);
    expect(t.listenerChars).toBeGreaterThan(300);
  });

  it('≥ 3 listener messages AND ≥ 300 listener characters', () => {
    expect(qaEligible({ listenerMessages: 2, listenerChars: 900 })).toBe(false);
    expect(qaEligible({ listenerMessages: 3, listenerChars: 299 })).toBe(false);
    expect(qaEligible({ listenerMessages: 3, listenerChars: 300 })).toBe(true);
  });

  it('quotes are stored as offsets into their line', () => {
    expect(quoteOffsets('Tell me more about it', 'more about')).toEqual({
      start: 8,
      end: 18,
    });
    expect(quoteOffsets('Tell me MORE', 'more')).toEqual({ start: 8, end: 12 });
    expect(quoteOffsets('abc', 'zzz')).toEqual({ start: 0, end: 3 });
  });
});

describe('the judge prompt framing', () => {
  it('the roleplay prompt is unchanged; the helpline one differs only in its opening', () => {
    const roleplay = buildJudgeSystemPrompt();
    const helpline = buildJudgeSystemPrompt('helpline');
    expect(roleplay).toBe(buildJudgeSystemPrompt('roleplay'));
    expect(roleplay).toContain('transcript of roleplay practice');
    expect(roleplay).toContain(
      'The CLIENT is a simulated person played by an AI',
    );
    expect(helpline).toContain('a real text chat on a support helpline');
    expect(helpline).not.toContain('played by an AI');
    const rest = (p: string) => p.slice(p.indexOf('## What you are given'));
    expect(rest(helpline)).toBe(rest(roleplay));
  });
});

/**
 * The real judge (prompt, parsing, validation, deriveLevel) over a fake
 * completion — so "levels come from the existing deterministic code" is
 * proved end to end rather than asserted.
 */
function realJudge(reply: unknown) {
  const llm = {
    complete: jest.fn().mockResolvedValue({
      text: JSON.stringify(reply),
      provider: 'openai',
      model: 'gpt-5-mini',
      source: 'explicit',
      usage: { inputTokens: 10, outputTokens: 10 },
    }),
  };
  return { judge: new FoundationalSkillsJudgeService(llm as never), llm };
}

const allSkills = (overrides: Record<string, unknown>) =>
  FHS_RUBRIC.map(
    (skill) =>
      overrides[skill.key] ?? {
        skill: skill.key,
        opportunity: false,
        observed: [],
        notApplicable: [],
      },
  );

function build(
  o: {
    claimed?: boolean;
    chat?: Record<string, unknown> | null;
    turns?: unknown[];
    judge?: FoundationalSkillsJudgeService;
  } = {},
) {
  const chatRow =
    o.chat === null
      ? null
      : {
          id: CHAT_ID,
          tenantId: TENANT.id,
          listenerId: LISTENER,
          status: HelplineChatStatus.ENDED,
          endedAt: new Date('2026-10-06T10:00:00Z'),
          erasedAt: null,
          ...o.chat,
        };
  const deps = {
    chats: {
      claimQa: jest.fn().mockResolvedValue(o.claimed ?? true),
      findById: jest.fn().mockResolvedValue(chatRow),
      setQaStatus: jest.fn().mockResolvedValue(undefined),
      findQaCandidatesAcrossTenants: jest
        .fn()
        .mockResolvedValue([{ id: CHAT_ID, tenantId: TENANT.id }]),
    },
    messages: {
      listTextTurns: jest.fn().mockResolvedValue(o.turns ?? conversation),
      findByIds: jest.fn(async (_t: string, ids: number[]) =>
        conversation.filter((m) => ids.includes(m.id)),
      ),
    },
    scores: {
      create: (x: unknown) => x,
      save: jest.fn(async (x: unknown) => x),
      findOne: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    },
    judge: o.judge ?? { judgeHelpline: jest.fn() },
    profiles: {
      aliases: jest.fn().mockResolvedValue(new Map([[LISTENER, 'Ravi']])),
    },
  };
  const service = new HelplineQaService(
    deps.chats as never,
    deps.messages as never,
    deps.scores as never,
    deps.judge as never,
    deps.profiles as never,
  );
  return { service, deps };
}

describe('HelplineQaService.scoreChat', () => {
  it('scores with the helpline judge; levels come from deriveLevel (one unhelpful → 1)', async () => {
    const { judge, llm } = realJudge({
      skills: allSkills({
        verbal: {
          skill: 'verbal',
          opportunity: true,
          observed: [
            {
              code: 'verbal.b1',
              line: 'H1',
              quote: 'What has been keeping you up',
            },
            { code: 'verbal.b2', line: 'H2', quote: 'How are you feeling' },
            {
              code: 'verbal.a1',
              line: 'H3',
              quote: 'Tell me more about the loneliness',
            },
            // One unhelpful behaviour overrides everything (§3.1).
            {
              code: 'verbal.u2',
              line: 'H2',
              quote: 'How are you feeling about her moving',
            },
          ],
          notApplicable: [],
        },
      }),
    });
    const { service, deps } = build({ judge });
    await expect(service.scoreChat(TENANT.id, CHAT_ID)).resolves.toBe(
      HelplineQaStatus.DONE,
    );
    const call = llm.complete.mock.calls[0][0];
    expect(call.taskId).toBe(HELPLINE_QA_JUDGE_TASK_ID);
    expect(call.task).toBe(LlmTask.HELPLINE_QA_JUDGE);
    expect(call.system).toContain('support helpline');
    // The previous listener's line never reaches the judge.
    expect(call.prompt).not.toContain('An earlier listener reply');

    const saved = deps.scores.save.mock.calls[0][0] as {
      verdicts: { skills: { skill: string; evidence: unknown[] }[] };
    };
    expect(saved).toMatchObject({
      tenantId: TENANT.id,
      chatId: CHAT_ID,
      listenerId: LISTENER,
      rubricVersion: HELPLINE_QA_RUBRIC_VERSION,
      levels: { verbal: 1 },
      compositeScore: 1,
      hasUnhelpfulBehaviour: true,
    });
    const verbal = saved.verdicts.skills.find(
      (s: { skill: string }) => s.skill === 'verbal',
    );
    // Evidence maps judge line ids back to message ids, as offsets — no text.
    expect(verbal?.evidence).toContainEqual({
      code: 'verbal.a1',
      messageId: 7,
      start: LONG.length,
      end: LONG.length + 'Tell me more about the loneliness'.length,
    });
    expect(JSON.stringify(saved.verdicts)).not.toContain('loneliness');
    expect(deps.chats.setQaStatus).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      HelplineQaStatus.DONE,
    );
  });

  it('too little listener text is SKIPPED with no judge call', async () => {
    const judge = { judgeHelpline: jest.fn() };
    const { service, deps } = build({
      judge: judge as never,
      turns: conversation.slice(0, 4),
    });
    await expect(service.scoreChat(TENANT.id, CHAT_ID)).resolves.toBe(
      HelplineQaStatus.SKIPPED,
    );
    expect(judge.judgeHelpline).not.toHaveBeenCalled();
    expect(deps.scores.save).not.toHaveBeenCalled();
  });

  it('a chat nobody took is SKIPPED', async () => {
    const { service } = build({ chat: { listenerId: null } });
    await expect(service.scoreChat(TENANT.id, CHAT_ID)).resolves.toBe(
      HelplineQaStatus.SKIPPED,
    );
  });

  it('a judge failure is FAILED, never thrown', async () => {
    const judge = {
      judgeHelpline: jest.fn().mockRejectedValue(new Error('timeout')),
    };
    const { service, deps } = build({ judge: judge as never });
    await expect(service.scoreChat(TENANT.id, CHAT_ID)).resolves.toBe(
      HelplineQaStatus.FAILED,
    );
    expect(deps.chats.setQaStatus).toHaveBeenLastCalledWith(
      TENANT.id,
      CHAT_ID,
      HelplineQaStatus.FAILED,
    );
  });

  it('a chat another replica already took is left alone', async () => {
    const judge = { judgeHelpline: jest.fn() };
    const { service, deps } = build({ claimed: false, judge: judge as never });
    await expect(service.scoreChat(TENANT.id, CHAT_ID)).resolves.toBeNull();
    expect(deps.chats.findById).not.toHaveBeenCalled();
  });
});

describe('HelplineQaService.tick', () => {
  const env = process.env.HELPLINE_QA_SCHEDULE;
  afterEach(() => {
    process.env.HELPLINE_QA_SCHEDULE = env;
  });

  it('takes ≤ 10 chats ended ≥ 5 min ago', async () => {
    delete process.env.HELPLINE_QA_SCHEDULE;
    const { service, deps } = build({ turns: [] });
    const now = new Date('2026-10-06T12:00:00Z');
    await service.tick(now);
    expect(deps.chats.findQaCandidatesAcrossTenants).toHaveBeenCalledWith(
      new Date(now.getTime() - HELPLINE_QA.SETTLE_MS),
      HELPLINE_QA.BATCH_SIZE,
    );
    expect(HELPLINE_QA.BATCH_SIZE).toBeLessThanOrEqual(10);
  });

  it('HELPLINE_QA_SCHEDULE=off stops it', async () => {
    process.env.HELPLINE_QA_SCHEDULE = 'off';
    const { service, deps } = build();
    await service.tick();
    expect(deps.chats.findQaCandidatesAcrossTenants).not.toHaveBeenCalled();
  });
});

describe('QA read side', () => {
  const storedScore = {
    chatId: CHAT_ID,
    listenerId: LISTENER,
    rubricVersion: HELPLINE_QA_RUBRIC_VERSION,
    compositeScore: 3,
    hasUnhelpfulBehaviour: false,
    createdAt: new Date(),
    verdicts: {
      skills: [
        {
          skill: 'verbal',
          opportunity: true,
          level: 3,
          observed: ['verbal.b1', 'verbal.b2'],
          notApplicable: [],
          evidence: [{ code: 'verbal.b1', messageId: 3, start: 0, end: 21 }],
        },
        {
          skill: 'harm',
          opportunity: false,
          level: null,
          observed: [],
          notApplicable: [],
          evidence: [],
        },
      ],
    },
  };

  it('the listener sees their own: skills with behaviour text and quoted evidence', async () => {
    const { service, deps } = build();
    deps.scores.findOne.mockResolvedValue(storedScore);
    const dto = await service.detail(
      TENANT,
      CHAT_ID,
      { id: LISTENER, tenantId: TENANT.id },
      [PERMISSIONS.VIEW_HELPLINE_LOBBY],
    );
    expect(dto).toMatchObject({
      chatId: CHAT_ID,
      listenerName: 'Ravi',
      compositeScore: 3,
      rubricVersion: HELPLINE_QA_RUBRIC_VERSION,
    });
    expect(dto.skills).toEqual([
      {
        key: 'verbal',
        label: 'Verbal communication',
        tier: 'Engage',
        level: 3,
        unhelpful: [],
        basicMet: [
          'Uses open-ended questions',
          'Summarises or paraphrases what the client said',
        ],
        basicMissing: [],
        advanced: [],
        evidence: [{ messageId: 3, quote: 'That sounds really he' }],
      },
    ]);
    expect(deps.scores.findOne).toHaveBeenCalledWith({
      where: { tenantId: TENANT.id, chatId: CHAT_ID },
    });
  });

  it("another listener's score is a 404 without view:helpline:qa; a supervisor may read it", async () => {
    const { service, deps } = build();
    deps.scores.findOne.mockResolvedValue(storedScore);
    await expect(
      service.detail(TENANT, CHAT_ID, { id: 99, tenantId: TENANT.id }, [
        PERMISSIONS.VIEW_HELPLINE_LOBBY,
      ]),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.detail(TENANT, CHAT_ID, { id: 99, tenantId: TENANT.id }, [
        PERMISSIONS.VIEW_HELPLINE_QA,
      ]),
    ).resolves.toMatchObject({ chatId: CHAT_ID });
  });

  it('an erased chat keeps its scores but shows no quotes', async () => {
    const { service, deps } = build();
    deps.scores.findOne.mockResolvedValue(storedScore);
    deps.messages.findByIds.mockResolvedValue([
      {
        ...text(3, HelplineSenderRole.LISTENER, '[erased]', LISTENER),
        erasedAt: new Date(),
      },
    ]);
    const dto = await service.detail(
      TENANT,
      CHAT_ID,
      { id: LISTENER, tenantId: TENANT.id },
      [],
    );
    expect(dto.skills[0].evidence).toEqual([{ messageId: 3, quote: '' }]);
  });

  it('mine is the caller only; lists are by date, never by score', async () => {
    const { service, deps } = build();
    await service.mine(TENANT, { id: LISTENER, tenantId: TENANT.id });
    expect(deps.scores.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT.id, listenerId: LISTENER },
        order: { createdAt: 'DESC' },
      }),
    );
    await service.list(TENANT, {});
    expect(deps.scores.findAndCount.mock.calls[1][0].where).toEqual({
      tenantId: TENANT.id,
    });
    expect(deps.scores.findAndCount.mock.calls[1][0].order).toEqual({
      createdAt: 'DESC',
    });
  });
});
