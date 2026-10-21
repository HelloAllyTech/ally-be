import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { BuilderSessionStatus } from '../../enum/builder.enum';
import { BuilderEvalSandboxFactory } from '../sandbox/builder-eval-sandbox.factory';
import { computeEvalGates } from '../util/builder-eval-scoring.util';

/**
 * One real interview turn, through the real orchestrator, tools and readiness,
 * inside the sandbox — with a scripted model. What it pins:
 *
 * - nothing reaches a builder table: the only stores the turn can write to
 *   are the sandbox's own, and the test hands it no real repository at all;
 * - a candidate prompt replaces the live one for this sandbox only;
 * - file reads go to the fixture's pinned commit;
 * - spend is relabelled as eval spend, keeping what it would have been;
 * - every model pass is captured, which is what the batch gates read.
 */
describe('BuilderEvalSandboxFactory', () => {
  const pass = (content: any[], stopReason: string) => ({
    type: 'final',
    message: {
      content,
      stopReason,
      usage: { inputTokens: 1000, outputTokens: 200 },
    },
  });

  const build = () => {
    const script = [
      pass(
        [
          {
            type: 'tool_use',
            id: 'read-1',
            name: 'github_read_file',
            input: {
              repo: 'ally-be',
              path: 'src/skill-experiment/skill-experiment.module.ts',
            },
          },
          {
            type: 'tool_use',
            id: 'edit-1',
            name: 'update_prd',
            input: {
              ops: [
                {
                  op: 'replace',
                  path: '/summary',
                  value:
                    'Let learners rate the debrief, and feed ratings to Auto-improve.',
                },
              ],
            },
          },
        ],
        'tool_use',
      ),
      pass(
        [
          { type: 'text', text: 'I have updated the summary.' },
          {
            type: 'tool_use',
            id: 'ask-1',
            name: 'ask_admin',
            input: {
              prompt: 'Guardrail or weight?',
              kind: 'freeText',
              allowCustom: true,
            },
          },
        ],
        'tool_use',
      ),
    ];
    const requests: any[] = [];
    const agentLlmFactory = {
      create: jest.fn(() => ({
        name: 'anthropic',
        stream: async function* (request: any) {
          requests.push(request);
          yield script.shift();
        },
      })),
      isConfigured: jest.fn(() => false),
    };
    const promptSharedService = {
      getPromptByCode: jest.fn(async (code: string) => `LIVE ${code}`),
      getPromptLlmConfig: jest.fn(async () => ({})),
    };
    const llmUsage = { record: jest.fn().mockResolvedValue(undefined) };
    const githubRead = {
      readFile: jest.fn(async () => ({ ok: true, content: '@Module({})' })),
      repoTree: jest.fn(),
      searchCode: jest.fn(),
    };
    const factory = new BuilderEvalSandboxFactory(
      {
        builder: { interviewModel: 'claude-opus-5', maxToolIterations: 6 },
      } as any,
      promptSharedService as any,
      llmUsage as any,
      agentLlmFactory as any,
      { resolve: jest.fn() } as any,
      { listAll: jest.fn().mockResolvedValue([]) } as any,
      {
        listActiveForRepos: jest.fn().mockResolvedValue([]),
        listRecent: jest.fn().mockResolvedValue([]),
      } as any,
      githubRead as any,
      {} as any,
      {} as any,
      {
        parityTwins: jest.fn().mockResolvedValue([]),
        renderContextSection: jest.fn().mockResolvedValue(''),
      } as any,
      { render: jest.fn().mockResolvedValue('') } as any,
    );
    return { factory, requests, promptSharedService, llmUsage, githubRead };
  };

  const playOneTurn = async (sandbox: any) => {
    for await (const frame of sandbox.orchestrator.streamTurn(
      sandbox.session.id,
      { message: 'Let learners rate the debrief.' },
      7,
    )) {
      void frame;
    }
    // Usage and evidence writes are fire-and-forget; let them land.
    await new Promise((resolve) => setImmediate(resolve));
  };

  it('plays a turn entirely in memory, with the candidate prompt and pinned reads', async () => {
    const { factory, requests, llmUsage, githubRead } = build();
    const sandbox = factory.create({
      evalRunId: 'run-1',
      title: 'Rate the debrief',
      userId: 7,
      overrides: {
        prompts: { builder_interviewer_system: 'CANDIDATE PROMPT' },
      },
      pins: { 'ally-be': 'abc1234' },
    });

    await playOneTurn(sandbox);

    // The candidate, not the live prompt, is what the model was given.
    expect(requests[0].system[0].text).toContain('CANDIDATE PROMPT');
    expect(requests[0].system[0].text).not.toContain(
      'LIVE builder_interviewer_system',
    );

    // Pinned to the fixture's commit.
    expect(githubRead.readFile).toHaveBeenCalledWith(
      'ally-be',
      'src/skill-experiment/skill-experiment.module.ts',
      'abc1234',
    );

    // Everything landed in the sandbox's own stores.
    const messages = await sandbox.stores.messageRepository.listBySession(
      sandbox.session.id,
    );
    expect(messages.map((message: any) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    const doc = await sandbox.stores.docRepository.findBySession(
      sandbox.session.id,
    );
    expect(doc?.draft.summary).toContain('rate the debrief');
    expect(sandbox.stores.versions).toHaveLength(1);
    expect(sandbox.stores.evidence.map((row) => row.source)).toEqual([
      'ally-be:src/skill-experiment/skill-experiment.module.ts',
    ]);
    expect(sandbox.session.status).toBe(BuilderSessionStatus.INTERVIEWING);

    // Spend is eval spend, and remembers what it would have been.
    expect(llmUsage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        task: LlmTask.BUILDER_EVAL,
        metadata: expect.objectContaining({
          evalRunId: 'run-1',
          evalOf: LlmTask.BUILDER_INTERVIEW,
        }),
      }),
    );
    expect(sandbox.costUsd()).toBeGreaterThan(0);

    // Both passes captured; the question went out on its own, after the read.
    expect(sandbox.passes).toHaveLength(2);
    const readiness = await sandbox.readiness.assess(sandbox.session.id, doc!);
    const gates = computeEvalGates(sandbox.passes, messages, readiness);
    expect(gates.unseenFailures).toBe(0);
    expect(gates.askedBeforeReading).toBe(0);
    expect(gates.falseUpdateClaims).toBe(0);
  });

  it('keeps each sandbox to itself — a second one reads the live prompt', async () => {
    const { factory, requests } = build();
    factory.create({
      evalRunId: 'run-1',
      title: 'Candidate',
      userId: 7,
      overrides: {
        prompts: { builder_interviewer_system: 'CANDIDATE PROMPT' },
      },
    });
    const live = factory.create({
      evalRunId: 'run-2',
      title: 'Live',
      userId: 7,
    });

    await playOneTurn(live);

    expect(requests[0].system[0].text).toContain(
      'LIVE builder_interviewer_system',
    );
  });

  /**
   * Every suite stamps the loop it runs. One with no stamp was started before
   * validated turns existed, and must keep replaying the loop it began on — a
   * suite resumed across that deploy would otherwise switch loops halfway and
   * measure neither.
   */
  it('replays the legacy loop for a suite with no loop stamped', async () => {
    const { factory, requests } = build();
    const sandbox = factory.create({
      evalRunId: 'run-1',
      title: 'Old',
      userId: 7,
    });

    await playOneTurn(sandbox);

    expect(sandbox.validatedTurns).toBe(false);
    expect(requests[0].system[0].text).not.toContain('# How a turn ends');
    expect(requests[0].tools.map((tool: any) => tool.name)).not.toContain(
      'finish_turn',
    );
  });

  it('replays validated turns when the suite was stamped with them', async () => {
    const { factory, requests } = build();
    const sandbox = factory.create({
      evalRunId: 'run-1',
      title: 'New',
      userId: 7,
      overrides: { validatedTurns: true },
    });

    await playOneTurn(sandbox);

    expect(sandbox.validatedTurns).toBe(true);
    expect(requests[0].system[0].text).toContain('# How a turn ends');
    expect(requests[0].tools.map((tool: any) => tool.name)).toContain(
      'finish_turn',
    );
  });
});
