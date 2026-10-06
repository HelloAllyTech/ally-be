import {
  HelplineChatStatus,
  HelplineMessageType,
  HelplineRiskFlagLevel,
  HelplineRiskSource,
  HelplineSenderRole,
  HelplineServerEvents,
} from '../../constants/helpline.constants';
import { HELPLINE_DEFAULT_SETTINGS } from '../../constants/helpline-settings.defaults';
import {
  HELPLINE_COPILOT,
  classifierAddsFlag,
  cleanNudge,
  cleanSuggestions,
  copilotStatusFor,
  isRollingSummaryTurn,
  latestStage,
  mapRiskVerdict,
  normalisedEditDistance,
  shouldIncludeNudge,
  signalOffsets,
  toCopilotTurns,
} from '../../util/helpline-copilot.util';
import { editDistance } from '../../util/helpline-serializers';
import {
  HelplineCopilotService,
  SUGGESTION_CONTENT,
} from '../helpline-copilot.service';
import { HelplineMessageService } from '../helpline-message.service';

const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const TENANT = { id: 't-1', code: 'acme', name: 'Acme', logoUrl: null };

const settings = (
  copilot: Partial<typeof HELPLINE_DEFAULT_SETTINGS.copilot> = {},
) => ({
  ...structuredClone(HELPLINE_DEFAULT_SETTINGS),
  copilot: { ...HELPLINE_DEFAULT_SETTINGS.copilot, ...copilot },
});

// ── Pure rules ───────────────────────────────────────────────────────────────

describe('copilot rules', () => {
  it('maps the classifier verdict onto the org threshold', () => {
    const v = (is_crisis: boolean, confidence: number, failed = false) => ({
      is_crisis,
      confidence,
      failed,
    });
    expect(mapRiskVerdict(v(true, 0.7), 0.7)).toBe(HelplineRiskFlagLevel.HIGH);
    expect(mapRiskVerdict(v(true, 0.95), 0.7)).toBe(HelplineRiskFlagLevel.HIGH);
    expect(mapRiskVerdict(v(true, 0.69), 0.7)).toBe(
      HelplineRiskFlagLevel.ELEVATED,
    );
    expect(mapRiskVerdict(v(true, 0.2), 0.7)).toBe(
      HelplineRiskFlagLevel.ELEVATED,
    );
    expect(mapRiskVerdict(v(false, 0.99), 0.7)).toBeNull();
    // failed → no flag, whatever else the body says
    expect(mapRiskVerdict(v(true, 0.99, true), 0.7)).toBeNull();
  });

  it('dedupes classifier flags against the keyword screen', () => {
    const kw = (level: HelplineRiskFlagLevel) => ({
      source: HelplineRiskSource.KEYWORD,
      level,
    });
    const HIGH = HelplineRiskFlagLevel.HIGH;
    const ELEVATED = HelplineRiskFlagLevel.ELEVATED;
    expect(classifierAddsFlag([], HIGH)).toBe(true);
    expect(classifierAddsFlag([kw(HIGH)], HIGH)).toBe(false);
    expect(classifierAddsFlag([kw(HIGH)], ELEVATED)).toBe(false);
    expect(classifierAddsFlag([kw(ELEVATED)], ELEVATED)).toBe(false);
    // an escalation is recorded
    expect(classifierAddsFlag([kw(ELEVATED)], HIGH)).toBe(true);
    // never a second classifier flag for one message
    expect(
      classifierAddsFlag(
        [{ source: HelplineRiskSource.CLASSIFIER, level: ELEVATED }],
        HIGH,
      ),
    ).toBe(false);
  });

  it('nudges are sparse: never the first turn, ≥ 2 talker turns apart, ≤ 10 a chat', () => {
    const chat = (o: Record<string, number>) => ({
      nudgeCount: 0,
      talkerTurnsSinceNudge: 2,
      talkerMessageCount: 2,
      ...o,
    });
    const on = settings();
    expect(shouldIncludeNudge(on, chat({}))).toBe(true);
    expect(
      shouldIncludeNudge(
        on,
        chat({ talkerMessageCount: 1, talkerTurnsSinceNudge: 1 }),
      ),
    ).toBe(false);
    expect(shouldIncludeNudge(on, chat({ talkerTurnsSinceNudge: 1 }))).toBe(
      false,
    );
    expect(shouldIncludeNudge(on, chat({ nudgeCount: 9 }))).toBe(true);
    expect(shouldIncludeNudge(on, chat({ nudgeCount: 10 }))).toBe(false);
    expect(shouldIncludeNudge(settings({ nudges: false }), chat({}))).toBe(
      false,
    );
  });

  it('a nudge is used only when requested, and capped at 240 characters', () => {
    expect(cleanNudge('Try reflecting the feeling', false)).toBeNull();
    expect(cleanNudge('   ', true)).toBeNull();
    expect(cleanNudge('x'.repeat(500), true)).toHaveLength(
      HELPLINE_COPILOT.NUDGE_MAX_CHARS,
    );
  });

  it('suggestions are indexed, capped, and an unknown skill key becomes ""', () => {
    expect(cleanSuggestions([])).toEqual([]);
    expect(cleanSuggestions(undefined)).toEqual([]);
    const out = cleanSuggestions([
      { text: '  It sounds really heavy.  ', skill_key: 'empathy' },
      { text: '', skill_key: 'harm' },
      { text: 'Are you safe right now?', skill_key: 'harm' },
      { text: 'x'.repeat(400), skill_key: 'made_up' },
      { text: 'fourth', skill_key: 'verbal' },
    ]);
    expect(out.map((s) => [s.index, s.skillKey])).toEqual([
      [0, 'empathy'],
      [1, 'harm'],
      [2, ''],
    ]);
    expect(out[0].text).toBe('It sounds really heavy.');
    expect(out[2].text).toHaveLength(HELPLINE_COPILOT.SUGGESTION_MAX_CHARS);
  });

  it('finds the verbatim signal for offsets, or none when paraphrased', () => {
    const text = "I've been giving my things away and saying goodbye";
    expect(signalOffsets(text, 'giving my things away')).toEqual({
      start: 10,
      end: 31,
    });
    expect(signalOffsets(text, 'GIVING MY THINGS AWAY')).toEqual({
      start: 10,
      end: 31,
    });
    expect(signalOffsets(text, 'wants to die')).toBeNull();
    expect(signalOffsets(text, '')).toBeNull();
  });

  it('rolling summary every N talker turns', () => {
    expect([1, 2, 3, 4, 5, 8].map((n) => isRollingSummaryTurn(n, 4))).toEqual([
      false,
      false,
      false,
      true,
      false,
      true,
    ]);
    expect(isRollingSummaryTurn(4, 0)).toBe(false);
  });

  it('edit distance is normalised 0…1', () => {
    expect(normalisedEditDistance('abc', 'abc', editDistance)).toBe(0);
    expect(normalisedEditDistance('abcd', 'abXd', editDistance)).toBe(0.25);
    expect(normalisedEditDistance('', '', editDistance)).toBe(0);
    expect(normalisedEditDistance('abc', 'xyz', editDistance)).toBe(1);
  });

  it('status is OFF only when every part is off; stage is the newest STAGE row', () => {
    expect(
      copilotStatusFor(
        settings({ suggestions: false, nudges: false, riskClassifier: false }),
        'OK',
      ),
    ).toBe('OFF');
    expect(copilotStatusFor(settings(), null)).toBe('OK');
    expect(copilotStatusFor(settings(), 'UNAVAILABLE')).toBe('UNAVAILABLE');
    expect(
      latestStage([
        { type: HelplineMessageType.STAGE, metadata: { stage: 'Engage' } },
        { type: HelplineMessageType.TEXT, metadata: null },
        { type: HelplineMessageType.STAGE, metadata: { stage: 'Support' } },
      ] as never),
    ).toBe('Support');
    expect(latestStage([])).toBeNull();
  });

  it('turns: TEXT only, erased dropped, roles talker/listener', () => {
    expect(
      toCopilotTurns([
        { type: 'TEXT', senderRole: 'TALKER', content: 'hi', erasedAt: null },
        { type: 'SYSTEM', senderRole: 'SYSTEM', content: 'x', erasedAt: null },
        {
          type: 'TEXT',
          senderRole: 'SUPERVISOR',
          content: 'hey',
          erasedAt: null,
        },
        {
          type: 'TEXT',
          senderRole: 'TALKER',
          content: '[erased]',
          erasedAt: new Date(),
        },
      ] as never),
    ).toEqual([
      { role: 'talker', content: 'hi' },
      { role: 'listener', content: 'hey' },
    ]);
  });
});

// ── Orchestration ────────────────────────────────────────────────────────────

const talkerMessage = (id: number, content = 'I feel so alone') =>
  ({
    id,
    chatId: CHAT_ID,
    tenantId: TENANT.id,
    type: HelplineMessageType.TEXT,
    senderRole: HelplineSenderRole.TALKER,
    content,
    metadata: null,
    erasedAt: null,
    createdAt: new Date(),
  }) as never;

function build(
  o: {
    chat?: Record<string, unknown>;
    settings?: ReturnType<typeof settings>;
    risk?: unknown;
    turn?: unknown;
    existingFlags?: unknown[];
    typing?: () => boolean;
    previousStage?: string | null;
  } = {},
) {
  const chatRow = {
    id: CHAT_ID,
    tenantId: TENANT.id,
    status: HelplineChatStatus.ACTIVE,
    language: 'en',
    riskLevel: 'NONE',
    nudgeCount: 0,
    talkerTurnsSinceNudge: 2,
    talkerMessageCount: 2,
    ...o.chat,
  };
  const redis = new Map<string, unknown>();
  const emits: { room: string; event: string; payload: unknown }[] = [];
  let nextId = 100;
  const deps = {
    ai: {
      classifyHelplineRisk: jest.fn<Promise<unknown>, [unknown]>(async () =>
        o.risk instanceof Error
          ? Promise.reject(o.risk)
          : (o.risk ?? { is_crisis: false, confidence: 0, failed: false }),
      ),
      generateHelplineTurn: jest.fn<Promise<unknown>, [unknown]>(async () =>
        o.turn instanceof Error
          ? Promise.reject(o.turn)
          : (o.turn ?? {
              stage: 'Engage',
              nudge: '',
              suggestions: [{ text: 'Tell me more?', skill_key: 'verbal' }],
              failed: false,
            }),
      ),
    },
    prompts: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
    chats: {
      findById: jest.fn(async () => ({ ...chatRow })),
      recordNudge: jest.fn().mockResolvedValue(undefined),
    },
    messages: {
      recentTextTurns: jest.fn().mockResolvedValue([]),
      latestOfType: jest.fn(async () =>
        o.previousStage
          ? {
              type: HelplineMessageType.STAGE,
              metadata: { stage: o.previousStage },
            }
          : null,
      ),
      markSuggestionAccepted: jest.fn().mockResolvedValue(true),
    },
    writer: {
      staffOnly: jest.fn(
        async (
          chat: unknown,
          type: string,
          content: string,
          metadata: unknown,
          options: Record<string, unknown>,
        ) => ({
          id: nextId++,
          chatId: CHAT_ID,
          tenantId: TENANT.id,
          type,
          content,
          metadata,
          senderRole: options.senderRole,
          senderUserId: null,
          systemKind: null,
          parentMessageId: options.parentMessageId,
          clientMessageId: null,
          visibleToTalker: false,
          createdAt: new Date(),
          erasedAt: null,
        }),
      ),
    },
    risk: {
      hitsForMessage: jest.fn().mockResolvedValue(o.existingFlags ?? []),
      raiseFlag: jest.fn().mockResolvedValue({}),
      latestSubject: jest.fn().mockResolvedValue(null),
    },
    presence: {
      setCopilotLatest: jest.fn(async (chatId: string, id: number) => {
        redis.set(`latest:${chatId}`, id);
      }),
      getCopilotLatest: jest.fn(
        async (chatId: string) =>
          (redis.get(`latest:${chatId}`) as number) ?? null,
      ),
      swapCopilotStatus: jest.fn(async (chatId: string, status: string) => {
        const prev = (redis.get(`status:${chatId}`) as string) ?? null;
        redis.set(`status:${chatId}`, status);
        return prev;
      }),
      getCopilotStatus: jest.fn(),
      isListenerTyping: jest.fn(async () => (o.typing ? o.typing() : false)),
    },
    realtime: {
      emit: jest.fn(async (room: string, event: string, payload: unknown) => {
        emits.push({ room, event, payload });
      }),
    },
    settings: {
      getSettings: jest.fn().mockResolvedValue(o.settings ?? settings()),
    },
    tenants: { resolve: jest.fn().mockResolvedValue(TENANT) },
    summaries: {
      scheduleRolling: jest.fn(),
      readFields: jest.fn().mockResolvedValue(null),
    },
  };
  const service = new HelplineCopilotService(
    deps.ai as never,
    deps.prompts as never,
    deps.chats as never,
    deps.messages as never,
    deps.writer as never,
    deps.risk as never,
    deps.presence as never,
    deps.realtime as never,
    deps.settings as never,
    deps.tenants as never,
    deps.summaries as never,
  );
  return { service, deps, emits, chatRow, redis };
}

const eventsOf = (
  emits: { event: string; payload?: unknown }[],
  event: string,
) => emits.filter((e) => e.event === event);

describe('HelplineCopilotService — risk classifier', () => {
  it('HIGH at or above the org threshold → a CLASSIFIER flag with offsets, through raiseFlag', async () => {
    const content = "I've been giving my things away and saying goodbye";
    const { service, deps } = build({
      risk: {
        is_crisis: true,
        confidence: 0.86,
        signal: 'giving my things away',
        subject: 'SELF',
        failed: false,
      },
    });
    const message = talkerMessage(5, content);
    await service.classify(
      { id: CHAT_ID, tenantId: TENANT.id, language: 'en' } as never,
      message,
      settings(),
    );
    expect(deps.risk.raiseFlag).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHAT_ID }),
      message,
      {
        level: HelplineRiskFlagLevel.HIGH,
        source: HelplineRiskSource.CLASSIFIER,
        confidence: 0.86,
        subject: 'SELF',
        ruleId: null,
        signalStart: 10,
        signalEnd: 31,
      },
    );
  });

  it('is_crisis below the threshold → ELEVATED', async () => {
    const { service, deps } = build({
      risk: {
        is_crisis: true,
        confidence: 0.4,
        signal: '',
        subject: 'OTHER',
        failed: false,
      },
    });
    await service.classify(
      { id: CHAT_ID, tenantId: TENANT.id } as never,
      talkerMessage(5),
      settings(),
    );
    expect(deps.risk.raiseFlag.mock.calls[0][2]).toMatchObject({
      level: HelplineRiskFlagLevel.ELEVATED,
      subject: 'OTHER',
      signalStart: null,
    });
  });

  it('failed → no flag, COPILOT_STATUS UNAVAILABLE to the staff room only', async () => {
    const { service, deps, emits } = build({
      risk: { is_crisis: true, confidence: 0.99, failed: true },
    });
    await service.classify(
      { id: CHAT_ID, tenantId: TENANT.id } as never,
      talkerMessage(5),
      settings(),
    );
    expect(deps.risk.raiseFlag).not.toHaveBeenCalled();
    expect(emits).toEqual([
      {
        room: `staff:${CHAT_ID}`,
        event: HelplineServerEvents.COPILOT_STATUS,
        payload: { chatId: CHAT_ID, status: 'UNAVAILABLE' },
      },
    ]);
  });

  it('an unreachable classifier is the same as failed, and never throws', async () => {
    const { service, deps, emits } = build({
      risk: new Error('timeout of 3000ms exceeded'),
    });
    await expect(
      service.classify(
        { id: CHAT_ID, tenantId: TENANT.id } as never,
        talkerMessage(5),
        settings(),
      ),
    ).resolves.toBeUndefined();
    expect(deps.risk.raiseFlag).not.toHaveBeenCalled();
    expect(eventsOf(emits, 'COPILOT_STATUS')[0].payload).toEqual({
      chatId: CHAT_ID,
      status: 'UNAVAILABLE',
    });
  });

  it('records nothing new when the keyword screen already flagged this message as high', async () => {
    const { service, deps } = build({
      risk: {
        is_crisis: true,
        confidence: 0.9,
        signal: '',
        subject: 'SELF',
        failed: false,
      },
      existingFlags: [
        {
          source: HelplineRiskSource.KEYWORD,
          level: HelplineRiskFlagLevel.HIGH,
        },
      ],
    });
    await service.classify(
      { id: CHAT_ID, tenantId: TENANT.id } as never,
      talkerMessage(5),
      settings(),
    );
    expect(deps.risk.raiseFlag).not.toHaveBeenCalled();
  });

  it('sends the last 4 earlier TEXT turns, not the message itself', async () => {
    const { service, deps } = build();
    deps.messages.recentTextTurns.mockResolvedValue(
      [1, 2, 3, 4, 5].map((id) => ({
        ...(talkerMessage(id, `m${id}`) as object),
      })),
    );
    await service.classify(
      { id: CHAT_ID, tenantId: TENANT.id, language: 'hi' } as never,
      talkerMessage(5, 'm5'),
      settings(),
    );
    const request = deps.ai.classifyHelplineRisk.mock.calls[0][0] as {
      message: string;
      recent: { content: string }[];
      language: string;
    };
    expect(request.message).toBe('m5');
    expect(request.recent.map((r) => r.content)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
    ]);
    expect(request.language).toBe('hi');
  });

  it('skipped entirely when the org turns the classifier off', async () => {
    const { service, deps } = build({
      settings: settings({ riskClassifier: false }),
    });
    await service.handleTalkerMessage(
      {
        id: CHAT_ID,
        tenantId: TENANT.id,
        status: HelplineChatStatus.WAITING,
        talkerMessageCount: 1,
      } as never,
      talkerMessage(5),
    );
    expect(deps.ai.classifyHelplineRisk).not.toHaveBeenCalled();
  });
});

describe('HelplineCopilotService — copilot turn', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const activeChat = (o: Record<string, unknown> = {}) =>
    ({
      id: CHAT_ID,
      tenantId: TENANT.id,
      status: HelplineChatStatus.ACTIVE,
      language: 'en',
      talkerMessageCount: 2,
      ...o,
    }) as never;

  it('debounces 2.5 s per burst: a newer talker message cancels the pending turn', async () => {
    const { service, deps } = build();
    service.onTalkerMessage(activeChat(), talkerMessage(5));
    await jest.advanceTimersByTimeAsync(1_000);
    service.onTalkerMessage(
      activeChat({ talkerMessageCount: 3 }),
      talkerMessage(6),
    );
    await jest.advanceTimersByTimeAsync(2_000);
    expect(deps.ai.generateHelplineTurn).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(600);
    expect(deps.ai.generateHelplineTurn).toHaveBeenCalledTimes(1);
  });

  it('a turn superseded on another replica does not run', async () => {
    const { service, deps, redis } = build();
    redis.set(`latest:${CHAT_ID}`, 9);
    await service.runTurn(TENANT.id, CHAT_ID, 5);
    expect(deps.ai.generateHelplineTurn).not.toHaveBeenCalled();
  });

  it('no turn while the chat is WAITING', async () => {
    const { service, deps } = build();
    service.onTalkerMessage(
      activeChat({ status: HelplineChatStatus.WAITING }),
      talkerMessage(5),
    );
    await jest.advanceTimersByTimeAsync(5_000);
    expect(deps.ai.generateHelplineTurn).not.toHaveBeenCalled();
  });

  it('persists ONE staff-only SUGGESTION row and emits SUGGESTIONS, STAGE and COPILOT_STATUS OK', async () => {
    const { service, deps, emits } = build({
      turn: {
        stage: 'Understand',
        nudge: '',
        suggestions: [
          { text: 'Are you safe right now?', skill_key: 'harm' },
          { text: 'That sounds exhausting.', skill_key: 'empathy' },
        ],
        failed: false,
      },
    });
    await service.runTurn(TENANT.id, CHAT_ID, 5);
    const suggestionCalls = deps.writer.staffOnly.mock.calls.filter(
      (c) => c[1] === HelplineMessageType.SUGGESTION,
    );
    expect(suggestionCalls).toHaveLength(1);
    const [, , content, metadata, options] = suggestionCalls[0];
    expect(content).toBe(SUGGESTION_CONTENT);
    expect(metadata).toEqual({
      suggestions: [
        { index: 0, text: 'Are you safe right now?', skillKey: 'harm' },
        { index: 1, text: 'That sounds exhausting.', skillKey: 'empathy' },
      ],
    });
    expect(options).toMatchObject({
      senderRole: HelplineSenderRole.COPILOT,
      parentMessageId: 5,
      emit: false,
    });
    expect(emits.map((e) => e.event)).toEqual([
      'SUGGESTIONS',
      'STAGE',
      'COPILOT_STATUS',
    ]);
    expect(emits.every((e) => e.room === `staff:${CHAT_ID}`)).toBe(true);
    expect(eventsOf(emits, 'STAGE')[0].payload).toEqual({
      chatId: CHAT_ID,
      stage: 'Understand',
    });
  });

  it('sends the chat risk level and latest subject to the turn', async () => {
    const { service, deps } = build({ chat: { riskLevel: 'HIGH' } });
    deps.risk.latestSubject.mockResolvedValue('SELF');
    await service.runTurn(TENANT.id, CHAT_ID, 5);
    expect(deps.ai.generateHelplineTurn.mock.calls[0][0]).toMatchObject({
      risk_level: 'HIGH',
      risk_subject: 'SELF',
      include_nudge: true,
    });
  });

  it('never persists an empty suggestion list', async () => {
    const { service, deps, emits } = build({
      turn: { stage: '', nudge: '', suggestions: [], failed: false },
    });
    await service.runTurn(TENANT.id, CHAT_ID, 5);
    expect(deps.writer.staffOnly).not.toHaveBeenCalled();
    expect(eventsOf(emits, 'SUGGESTIONS')).toEqual([]);
  });

  it('a returned nudge is persisted (≤ 240), counted, and emitted as NUDGE', async () => {
    const { service, deps, emits } = build({
      turn: {
        stage: '',
        nudge: 'n'.repeat(300),
        suggestions: [],
        failed: false,
      },
    });
    await service.runTurn(TENANT.id, CHAT_ID, 5);
    const nudge = deps.writer.staffOnly.mock.calls.find(
      (c) => c[1] === HelplineMessageType.NUDGE,
    );
    expect((nudge?.[2] as string).length).toBe(240);
    expect(deps.chats.recordNudge).toHaveBeenCalledWith(TENANT.id, CHAT_ID);
    expect(eventsOf(emits, 'NUDGE')).toHaveLength(1);
  });

  it('a nudge the turn was not asked for is dropped (first talker turn)', async () => {
    const { service, deps } = build({
      chat: { talkerMessageCount: 1, talkerTurnsSinceNudge: 1 },
      turn: { stage: '', nudge: 'unasked', suggestions: [], failed: false },
    });
    await service.runTurn(TENANT.id, CHAT_ID, 5);
    expect(deps.ai.generateHelplineTurn.mock.calls[0][0]).toMatchObject({
      include_nudge: false,
    });
    expect(deps.writer.staffOnly).not.toHaveBeenCalled();
    expect(deps.chats.recordNudge).not.toHaveBeenCalled();
  });

  it('STAGE is written only when it changed', async () => {
    const { service, deps, emits } = build({
      previousStage: 'Engage',
      turn: { stage: 'Engage', nudge: '', suggestions: [], failed: false },
    });
    await service.runTurn(TENANT.id, CHAT_ID, 5);
    expect(deps.writer.staffOnly).not.toHaveBeenCalled();
    expect(eventsOf(emits, 'STAGE')).toEqual([]);
  });

  it('a failed turn emits COPILOT_STATUS UNAVAILABLE and nothing else', async () => {
    const { service, deps, emits } = build({
      turn: {
        failed: true,
        stage: 'Engage',
        nudge: 'x',
        suggestions: [{ text: 'a', skill_key: 'verbal' }],
      },
    });
    await service.runTurn(TENANT.id, CHAT_ID, 5);
    expect(deps.writer.staffOnly).not.toHaveBeenCalled();
    expect(
      emits.map((e) => [e.event, (e.payload as { status?: string }).status]),
    ).toEqual([['COPILOT_STATUS', 'UNAVAILABLE']]);
  });

  it('holds the emits while the listener types, then emits after 4 s anyway', async () => {
    const { service, emits } = build({ typing: () => true });
    const done = service.runTurn(TENANT.id, CHAT_ID, 5);
    await jest.advanceTimersByTimeAsync(3_500);
    expect(eventsOf(emits, 'SUGGESTIONS')).toEqual([]);
    await jest.advanceTimersByTimeAsync(1_000);
    await done;
    expect(eventsOf(emits, 'SUGGESTIONS')).toHaveLength(1);
  });

  it('stops holding as soon as the listener stops typing', async () => {
    let typing = true;
    const { service, emits } = build({ typing: () => typing });
    const done = service.runTurn(TENANT.id, CHAT_ID, 5);
    await jest.advanceTimersByTimeAsync(500);
    typing = false;
    await jest.advanceTimersByTimeAsync(300);
    await done;
    expect(eventsOf(emits, 'SUGGESTIONS')).toHaveLength(1);
  });

  it('a rolling summary is scheduled on every Nth talker turn', async () => {
    const { service, deps } = build();
    await service.handleTalkerMessage(
      activeChat({ talkerMessageCount: 4, status: HelplineChatStatus.WAITING }),
      talkerMessage(8),
    );
    expect(deps.summaries.scheduleRolling).toHaveBeenCalledTimes(1);
    await service.handleTalkerMessage(
      activeChat({ talkerMessageCount: 5, status: HelplineChatStatus.WAITING }),
      talkerMessage(9),
    );
    expect(deps.summaries.scheduleRolling).toHaveBeenCalledTimes(1);
  });

  it('a claim drafts replies to the latest talker message once', async () => {
    const { service, deps, redis } = build();
    redis.set(`latest:${CHAT_ID}`, 5);
    service.onChatClaimed(activeChat({ talkerMessageCount: 3 }), null);
    await jest.advanceTimersByTimeAsync(10);
    expect(deps.ai.generateHelplineTurn).toHaveBeenCalledTimes(1);
  });

  it('a listener message sent from a suggestion marks it accepted', async () => {
    const { service, deps } = build();
    service.onListenerMessage(activeChat(), {
      id: 20,
      metadata: {
        fromSuggestion: { messageId: 12, index: 1, editedDistance: 0.1 },
      },
    } as never);
    await jest.advanceTimersByTimeAsync(1);
    expect(deps.messages.markSuggestionAccepted).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      12,
      1,
    );
  });
});

describe('delivery is never delayed by the copilot (invariant 3)', () => {
  it('sendTalkerText resolves while the classifier is still hanging', async () => {
    let releaseClassifier: () => void = () => undefined;
    const hanging = new Promise<never>((_, reject) => {
      releaseClassifier = () => reject(new Error('late'));
    });
    const { service: copilot, deps } = build();
    deps.ai.classifyHelplineRisk.mockReturnValue(hanging as never);

    const stored = {
      id: 5,
      chatId: CHAT_ID,
      tenantId: TENANT.id,
      type: HelplineMessageType.TEXT,
      senderRole: HelplineSenderRole.TALKER,
      content: 'hello',
      metadata: null,
    };
    const messageService = new HelplineMessageService(
      { recordTalkerMessage: jest.fn().mockResolvedValue(2) } as never,
      {
        findByClientMessageId: jest.fn().mockResolvedValue(null),
        insert: jest.fn().mockResolvedValue(stored),
      } as never,
      { emit: jest.fn().mockResolvedValue(undefined) } as never,
      { screenTalkerMessage: jest.fn().mockResolvedValue(null) } as never,
      { queueChanged: jest.fn() } as never,
      copilot,
    );
    let copilotSettled = false;
    void hanging.catch(() => {
      copilotSettled = true;
    });
    const result = await messageService.sendTalkerText(
      {
        id: CHAT_ID,
        tenantId: TENANT.id,
        status: HelplineChatStatus.ACTIVE,
      } as never,
      'hello',
      null,
      'Asha',
    );
    expect(result.message).toBe(stored);
    expect(copilotSettled).toBe(false);
    // The copilot had started — it just was not waited for.
    await new Promise((r) => setImmediate(r));
    expect(deps.ai.classifyHelplineRisk).toHaveBeenCalled();
    releaseClassifier();
  });
});
