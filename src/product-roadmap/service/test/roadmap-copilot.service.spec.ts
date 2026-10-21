import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  AgentStreamRequest,
  AgentTurnResult,
} from 'src/llm-agent/type/agent-llm.type';

import {
  CopilotFrame,
  RoadmapCopilotService,
} from '../roadmap-copilot.service';
import {
  ROADMAP_COPILOT,
  ROADMAP_READINESS_CRITERIA,
} from '../../constants/product-roadmap.constants';
import { RoadmapOpportunityEffort } from '../../enum/roadmap-opportunity.enum';
import { RoadmapBriefRating } from '../../type/roadmap-brief.type';
import { normaliseOpportunityBrief } from '../../util/roadmap-brief.util';

const allIds = ROADMAP_READINESS_CRITERIA.map((c) => c.id);

const submit = (
  input: Record<string, any>,
  id = 'submit-1',
): AgentTurnResult => ({
  content: [{ type: 'tool_use', id, name: 'submit_turn', input }],
  stopReason: 'tool_use',
  usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 80 },
});

const research = (
  name: string,
  input: Record<string, any>,
  id = `use-${name}`,
): AgentTurnResult => ({
  content: [{ type: 'tool_use', id, name, input }],
  stopReason: 'tool_use',
  usage: { inputTokens: 100, outputTokens: 10 },
});

const prose = (text: string): AgentTurnResult => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage: { inputTokens: 100, outputTokens: 10 },
});

const allMet = (over: Record<string, any> = {}) => ({
  reply: 'You can file this now; a baseline would make it stronger.',
  gates: allIds.map((id) => ({ id, met: true, note: 'Covered.' })),
  draft: {
    description:
      'As a counsellor, retyping the name wastes a minute — so that…',
    productGoal: 'Reliability & Trust',
    effort: 'm',
  },
  brief: {
    strategicFit: [{ goal: 'Cut time-to-first-value', why: 'Fewer steps.' }],
    evidence: [{ source: 'admin', claim: 'They retype it daily.', ref: null }],
    assessment: {
      rating: 'promising',
      summary: 'Clear and on-strategy; no data yet.',
      openRecommendations: ['Size it with analytics.'],
    },
  },
  ...over,
});

/**
 * The copilot replaced a single-shot interview call with a tool loop. What matters here is the
 * same as before — what happens to answers the model gave badly, and whether a token can ever
 * be minted for something the five criteria did not clear — plus the new loop's guarantees:
 * research is run and reported, a turn always ends in exactly one `turn` or `error`, and a
 * model that will not call `submit_turn` cannot loop forever.
 */
describe('RoadmapCopilotService', () => {
  const build = (
    script: AgentTurnResult[],
    options: {
      configured?: string[];
      promptRow?: Record<string, any>;
      /** Models whose calls throw, as a provider outage or an exhausted balance would. */
      failing?: string[];
    } = {},
  ) => {
    const requests: AgentStreamRequest[] = [];
    let call = 0;
    const provider = {
      name: 'fake',
      async *stream(request: AgentStreamRequest) {
        // Snapshot: the service keeps appending to the same array.
        requests.push({ ...request, messages: [...request.messages] });
        if (options.failing?.includes(request.model)) {
          throw new Error('400 Your credit balance is too low');
        }
        const next = script[Math.min(call, script.length - 1)];
        call += 1;
        yield { type: 'final' as const, message: next };
      },
    };
    const configured = new Set(options.configured ?? ['anthropic', 'openai']);
    const factory = {
      create: jest.fn(() => provider),
      isConfigured: jest.fn((name: string) => configured.has(name)),
    };
    const tools = {
      getToolDefinitions: jest.fn(() => [
        { name: 'search_roadmap', description: '', input_schema: {} },
        { name: 'submit_turn', description: '', input_schema: {} },
      ]),
      describe: jest.fn((name: string) => `Doing ${name}`),
      execute: jest.fn(async () => ({
        modelResult: '{"ok":true,"matches":[]}',
        summary: '0 related opportunit(ies)',
        ok: true,
      })),
    };
    const issue = jest.fn((input) => JSON.stringify(input));
    const llmUsage = { record: jest.fn() };
    const prompts = {
      getPromptByCode: jest.fn(async () => 'SYSTEM PROMPT'),
      getPromptLlmConfig: jest.fn(async () => options.promptRow ?? {}),
    };
    const service = new RoadmapCopilotService(
      {
        roadmapCopilot: {
          model: 'claude-sonnet-5-5',
          fallbackModel: 'gpt-5',
        },
      } as any,
      prompts as any,
      llmUsage as any,
      factory as any,
      tools as any,
      {
        renderForCopilot: jest.fn(
          async () => '### Product vision\nHelp helpers.',
        ),
      } as any,
      {
        list: jest.fn(async () => ({
          items: [
            {
              code: 'OPP-0714',
              stage: 'prioritised',
              productGoal: 'Scribe',
              effort: 'm',
              priorityScore: 12,
              description: 'Supervisors review flagged sessions.',
            },
          ],
        })),
      } as any,
      {
        findAllOrdered: jest.fn(async () => [{ name: 'Reliability & Trust' }]),
      } as any,
      {
        findAllOrdered: jest.fn(async () => [
          { name: 'Cut time-to-first-value' },
        ]),
      } as any,
      { issue } as any,
      {
        render: jest.fn(
          async () =>
            "# Ally as built — the product map\n- Roleplay Logs (`roleplay_logs`) — every learner's sessions.",
        ),
      } as any,
    );
    return { service, requests, tools, issue, llmUsage, factory, prompts };
  };

  const collect = async (
    stream: AsyncGenerator<CopilotFrame>,
  ): Promise<CopilotFrame[]> => {
    const frames: CopilotFrame[] = [];
    for await (const frame of stream) frames.push(frame);
    return frames;
  };

  const turnOf = (frames: CopilotFrame[]) => {
    const last = frames[frames.length - 1];
    if (last.event !== 'turn') throw new Error(`ended with ${last.event}`);
    return last.data;
  };

  describe('the loop', () => {
    it('runs research, reports it, feeds the result back, then returns the submitted turn', async () => {
      const { service, requests, tools } = build([
        research('search_roadmap', { query: 'retyping names' }),
        submit(allMet()),
      ]);

      const frames = await collect(
        service.streamTurn(
          {
            messages: [{ role: 'admin', content: 'Counsellors retype names.' }],
          },
          7,
        ),
      );

      expect(frames.map((f) => f.event)).toEqual([
        'activity',
        'activity_done',
        'turn',
      ]);
      expect(tools.execute).toHaveBeenCalledWith(
        'search_roadmap',
        { query: 'retyping names' },
        { userId: 7 },
      );
      // The second pass carries the call and its result, paired by id.
      const second = requests[1].messages;
      expect(second[second.length - 1]).toEqual({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'use-search_roadmap',
            content: '{"ok":true,"matches":[]}',
          },
        ],
      });
      expect(turnOf(frames).draft?.effort).toBe(RoadmapOpportunityEffort.M);
    });

    it('nudges once when a pass ends in prose, then offers only submit_turn', async () => {
      const { service, requests } = build([
        prose('Here is what I think…'),
        submit(allMet()),
      ]);

      const frames = await collect(service.streamTurn({ messages: [] }, 1));

      expect(turnOf(frames).reply).toContain('You can file this now');
      expect(requests[1].tools?.map((t) => t.name)).toEqual(['submit_turn']);
      const nudge = requests[1].messages[requests[1].messages.length - 1];
      expect(nudge.content).toMatch(/Call submit_turn now/);
    });

    it('fails closed with an error frame when the model never submits', async () => {
      const { service } = build([prose('…'), prose('still prose')]);

      const frames = await collect(service.streamTurn({ messages: [] }, 1));

      expect(frames).toEqual([
        { event: 'error', data: { message: expect.any(String) } },
      ]);
    });

    it('caps research: the last pass can only submit', async () => {
      const script = [
        ...Array.from(
          { length: ROADMAP_COPILOT.MAX_TOOL_ITERATIONS - 1 },
          (_, i) => research('search_roadmap', { query: `q${i}` }, `use-${i}`),
        ),
        submit(allMet()),
      ];
      const { service, requests } = build(script);

      const frames = await collect(service.streamTurn({ messages: [] }, 1));

      expect(turnOf(frames)).toBeTruthy();
      const last = requests[requests.length - 1];
      expect(last.tools?.map((t) => t.name)).toEqual(['submit_turn']);
      expect(requests).toHaveLength(ROADMAP_COPILOT.MAX_TOOL_ITERATIONS);
    });

    it('does not run a tool call cut off at max_tokens', async () => {
      const truncated: AgentTurnResult = {
        ...research('search_roadmap', { query: 'half a' }),
        stopReason: 'max_tokens',
      };
      const { service, tools } = build([truncated, submit(allMet())]);

      await collect(service.streamTurn({ messages: [] }, 1));

      expect(tools.execute).not.toHaveBeenCalled();
    });

    it('records one usage row per pass under its own task', async () => {
      const { service, llmUsage } = build([
        research('search_roadmap', { query: 'x' }),
        submit(allMet()),
      ]);

      await collect(service.streamTurn({ messages: [] }, 1));

      expect(llmUsage.record).toHaveBeenCalledTimes(2);
      expect(llmUsage.record.mock.calls[0][0]).toMatchObject({
        task: LlmTask.ROADMAP_OPPORTUNITY_COPILOT,
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        cachedTokens: undefined,
      });
      expect(llmUsage.record.mock.calls[1][0].metadata.iteration).toBe(2);
    });
  });

  describe('context', () => {
    it('caches the strategy, goals, criteria and board, and keeps the conversation after it', async () => {
      const { service, requests } = build([submit(allMet())]);

      await collect(
        service.streamTurn(
          {
            messages: [
              { role: 'agent', content: 'Who is this for?' },
              { role: 'admin', content: 'Counsellors.' },
            ],
          },
          1,
        ),
      );

      const system = requests[0].system as { text: string; cache?: boolean }[];
      expect(system).toHaveLength(3);
      expect(system[0]).toEqual({ text: 'SYSTEM PROMPT' });
      // The product map first: it changes least, so a board change re-pays only the block after.
      expect(system[1].cache).toBe(true);
      expect(system[1].text).toContain('Ally as built');
      expect(system[1].text).toContain('Roleplay Logs');
      const context = system[2];
      expect(context.cache).toBe(true);
      expect(context.text).toContain('Help helpers.');
      expect(context.text).toContain('Cut time-to-first-value');
      expect(context.text).toContain('OPP-0714');
      for (const id of allIds) expect(context.text).toContain(`id: ${id}`);

      // Speaker labels, so the model can tell its own words from the admin's — and nothing
      // volatile inside either cached block.
      const user = requests[0].messages[0].content as string;
      expect(user).toContain('YOU: Who is this for?');
      expect(user).toContain('ADMIN: Counsellors.');
      expect(system[1].text).not.toContain('Counsellors.');
      expect(context.text).not.toContain('Counsellors.');
    });

    it('returns no brief before the admin has said anything', async () => {
      const { service } = build([submit(allMet({ draft: null }))]);

      const frames = await collect(service.streamTurn({ messages: [] }, 1));

      expect(turnOf(frames).brief).toBeNull();
    });

    it('asks the model to open the conversation when there are no messages', async () => {
      const { service, requests } = build([submit(allMet({ draft: null }))]);

      await collect(service.streamTurn({ messages: [] }, 1));

      expect(requests[0].messages[0].content).toContain(
        'this is the first turn',
      );
    });

    it('hands the previous brief back to the model', async () => {
      const { service, requests } = build([submit(allMet())]);

      await collect(
        service.streamTurn({ messages: [], brief: allMet().brief }, 1),
      );

      expect(requests[0].messages[0].content).toContain(
        'Cut time-to-first-value',
      );
    });

    it('falls back to the configured fallback model when the resolved provider has no key', async () => {
      const { service, factory } = build([submit(allMet())], {
        configured: ['openai'],
      });

      await collect(service.streamTurn({ messages: [] }, 1));

      expect(factory.create).toHaveBeenCalledWith('openai', 'gpt-5');
    });

    /** The only way to file — a provider having a bad hour must not close the roadmap. */
    it('reruns the turn on the fallback model when the primary model call fails', async () => {
      const { service, requests } = build([submit(allMet())], {
        failing: ['claude-sonnet-5-5'],
      });

      const frames = await collect(service.streamTurn({ messages: [] }, 1));

      expect(frames.map((f) => f.event)).toEqual(['turn']);
      expect(requests.map((r) => r.model)).toEqual([
        'claude-sonnet-5-5',
        'gpt-5',
      ]);
    });

    it('fails closed when the fallback fails too', async () => {
      const { service } = build([submit(allMet())], {
        failing: ['claude-sonnet-5-5', 'gpt-5'],
      });

      const frames = await collect(service.streamTurn({ messages: [] }, 1));

      expect(frames).toEqual([
        { event: 'error', data: { message: expect.any(String) } },
      ]);
    });

    it('lets the prompt row choose the model', async () => {
      const { service, factory } = build([submit(allMet())], {
        promptRow: { model: 'claude-opus-5-5', provider: 'anthropic' },
      });

      await collect(service.streamTurn({ messages: [] }, 1));

      expect(factory.create).toHaveBeenCalledWith(
        'anthropic',
        'claude-opus-5-5',
      );
    });
  });

  describe('buildTurn — what the model said, made safe to show and to sign', () => {
    const goals = ['Reliability & Trust'];
    const { service, issue } = build([]);

    beforeEach(() => issue.mockClear());

    it('returns one gate per criterion, in the criteria order', () => {
      const turn = service.buildTurn(allMet(), goals, null);
      expect(turn.gates.map((g) => g.id)).toEqual(allIds);
    });

    it('fails closed on a missing gate, a non-boolean one, and no answer at all', () => {
      const turn = service.buildTurn(
        allMet({
          gates: [
            { id: allIds[0], met: true, note: 'Covered.' },
            { id: allIds[1], met: 'yes', note: 'Sure.' },
          ],
        }),
        goals,
        null,
      );
      expect(turn.gates.map((g) => g.met)).toEqual([
        true,
        false,
        false,
        false,
        false,
      ]);
      expect(turn.draft).toBeNull();
      expect(turn.readinessToken).toBeNull();

      const dead = service.buildTurn(null, goals, null);
      expect(dead.gates.every((g) => !g.met)).toBe(true);
      expect(dead.reply).toContain('Could you say it again?');
    });

    it('signs the draft AND its brief, only when every gate is met', () => {
      const turn = service.buildTurn(allMet(), goals, null);

      expect(turn.draft?.productGoal).toBe('Reliability & Trust');
      expect(issue).toHaveBeenCalledWith({
        description: turn.draft?.description,
        productGoal: 'Reliability & Trust',
        failedCriteria: [],
        proposedEffort: RoadmapOpportunityEffort.M,
        brief: turn.brief,
      });
      expect(turn.brief?.assessment.rating).toBe(RoadmapBriefRating.PROMISING);
    });

    /**
     * The copilot advises; it does not block. A draft that meets the five is handed over
     * whatever the copilot thinks of the case — its doubts travel in the brief.
     */
    it('hands over a draft the copilot rates needs-work, with its doubts in the brief', () => {
      const turn = service.buildTurn(
        allMet({
          brief: {
            assessment: {
              rating: 'needs_work',
              summary: 'Collides with a non-goal.',
              openRecommendations: ['Say why this is an exception.'],
            },
          },
        }),
        goals,
        null,
      );

      expect(turn.draft).not.toBeNull();
      expect(turn.readinessToken).toBeTruthy();
      expect(turn.brief?.assessment.openRecommendations).toEqual([
        'Say why this is an exception.',
      ]);
    });

    it('keeps interviewing when every gate is met but no draft came back', () => {
      const turn = service.buildTurn(allMet({ draft: null }), goals, null);
      expect(turn.draft).toBeNull();
      expect(issue).not.toHaveBeenCalled();
    });

    it('drops a product goal that is not a live one rather than inventing taxonomy', () => {
      const turn = service.buildTurn(
        allMet({
          draft: {
            description: 'A draft',
            productGoal: 'Made Up',
            effort: 's',
          },
        }),
        goals,
        null,
      );
      expect(turn.draft?.productGoal).toBeNull();
      expect(turn.draft?.description).toBe('A draft');
    });

    /**
     * An opportunity does not have to be narrow to be well defined: a broad one is handed over
     * at its honest size rather than withheld until it is cut down to a slice.
     */
    it.each(['l', 'xl', 'xxl'])(
      'hands over a %s draft rather than asking to narrow it',
      (effort) => {
        const turn = service.buildTurn(
          allMet({
            reply: 'Here is your draft.',
            draft: { description: 'A draft', productGoal: null, effort },
          }),
          goals,
          null,
        );
        expect(turn.draft).toMatchObject({ description: 'A draft', effort });
        expect(turn.readinessToken).toBeTruthy();
        expect(turn.reply).toBe('Here is your draft.');
      },
    );

    it.each([
      ['not a live size', 'medium-ish'],
      ['unsized', null],
    ])(
      'withholds a draft that is %s and asks about scope',
      (_label, effort) => {
        const turn = service.buildTurn(
          allMet({
            reply: 'Here is your draft.',
            draft: { description: 'A draft', productGoal: null, effort },
          }),
          goals,
          null,
        );
        expect(turn.draft).toBeNull();
        expect(turn.readinessToken).toBeNull();
        expect(turn.reply).toMatch(/can't put a size on this/);
        expect(turn.reply).not.toMatch(/single piece|narrow/);
      },
    );

    it('keeps the previous brief when a turn writes none', () => {
      const previous = normaliseOpportunityBrief(allMet().brief);
      const turn = service.buildTurn(
        allMet({ brief: undefined, draft: null }),
        goals,
        previous,
      );
      expect(turn.brief).toEqual(previous);
    });
  });
});
