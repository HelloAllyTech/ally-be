import {
  fallbackDiscoveryQueries,
  foundLines,
  normaliseDiscoveryQueries,
  planDiscovery,
  renderDiscoveryBlock,
  runDiscovery,
} from '../builder-discovery.util';

describe('the discovery sweep', () => {
  describe('normaliseDiscoveryQueries', () => {
    it('keeps known tools, cuts every query to three words and drops repeats', () => {
      expect(
        normaliseDiscoveryQueries([
          {
            tool: 'capability_lookup',
            query: 'Debrief learner rating feedback',
          },
          { tool: 'capability_lookup', query: 'debrief learner rating' },
          { tool: 'docs_search', query: 'skill experiments!', repo: 'ally-be' },
          { tool: 'wiki_search', query: 'auto improve', repo: 'ally-be' },
          { tool: 'github_read_file', query: 'x' },
          { tool: 'docs_search', query: '   ' },
        ]),
      ).toEqual([
        { tool: 'capability_lookup', query: 'Debrief learner rating' },
        { tool: 'docs_search', query: 'skill experiments', repo: 'ally-be' },
        // The wiki has one repo of its own; a repo on a wiki search is dropped.
        { tool: 'wiki_search', query: 'auto improve' },
      ]);
    });

    it('caps the sweep at twelve, and the GitHub-backed searches at eight', () => {
      const many = Array.from({ length: 20 }, (_, index) => ({
        tool: 'github_search_code',
        query: `term${index}`,
      }));
      const queries = normaliseDiscoveryQueries([
        ...many,
        ...Array.from({ length: 10 }, (_, index) => ({
          tool: 'capability_lookup',
          query: `cap${index}`,
        })),
      ]);
      expect(queries).toHaveLength(12);
      expect(
        queries.filter((q) => q.tool === 'github_search_code'),
      ).toHaveLength(8);
    });
  });

  it('falls back to the request words, still covering the map, docs, wiki, code and AI tasks', () => {
    const queries = fallbackDiscoveryQueries(
      'Debrief rating',
      'Learners should rate the debrief they get after a roleplay.',
    );
    const tools = new Set(queries.map((q) => q.tool));
    expect(tools).toEqual(
      new Set([
        'capability_lookup',
        'docs_search',
        'wiki_search',
        'github_search_code',
        'ai_tasks_lookup',
      ]),
    );
    expect(queries[0]).toEqual({
      tool: 'capability_lookup',
      query: 'debrief rating',
    });
    expect(fallbackDiscoveryQueries('', 'please add it')).toEqual([]);
  });

  describe('planDiscovery', () => {
    const plan = (text: string | Error) => ({
      complete: jest.fn(async () => {
        if (text instanceof Error) throw text;
        return { text };
      }),
    });

    it("uses the planner's queries when it returns enough of them", async () => {
      const llm = plan(
        JSON.stringify({
          queries: [
            { tool: 'capability_lookup', query: 'debrief' },
            { tool: 'capability_lookup', query: 'skill experiments' },
            { tool: 'docs_search', query: 'debrief rating' },
            { tool: 'github_search_code', query: 'DebriefTab' },
          ],
        }),
      );
      const result = await planDiscovery(llm as any, {
        sessionId: 's-1',
        title: 'Debrief rating',
        opening: 'Rate the debrief',
      });
      expect(result.planned).toBe('model');
      expect(result.queries).toHaveLength(4);
      expect(llm.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'builder-discovery-plan',
          jsonMode: true,
        }),
      );
    });

    it('falls back rather than skipping discovery when the planner fails or says too little', async () => {
      const onError = jest.fn();
      const failed = await planDiscovery(
        plan(new Error('timeout')) as any,
        {
          sessionId: 's-1',
          title: 'Debrief rating',
          opening: 'Rate the debrief',
        },
        onError,
      );
      expect(failed.planned).toBe('fallback');
      expect(failed.queries.length).toBeGreaterThan(3);
      expect(onError).toHaveBeenCalledWith('timeout');

      const thin = await planDiscovery(
        plan('{"queries":[{"tool":"docs_search","query":"x"}]}') as any,
        {
          sessionId: 's-1',
          title: 'Debrief rating',
          opening: 'Rate the debrief',
        },
      );
      expect(thin.planned).toBe('fallback');
    });
  });

  it('reads what a lookup found as one line per hit', () => {
    expect(
      foundLines({
        ok: true,
        results: [
          { repo: 'ally-be', path: 'docs/skill-experiments.md' },
          {
            kind: 'capability',
            repo: 'ally-be',
            name: 'Auto-improve',
            path: 'ally-be:src/skill-experiment',
          },
          'plain line',
        ],
      }),
    ).toEqual([
      'ally-be:docs/skill-experiments.md',
      'capability Auto-improve (ally-be:src/skill-experiment)',
      'plain line',
    ]);
  });

  it('runs every query through the interview tools, announcing each, and numbers what came back', async () => {
    const execute = jest.fn(async (name: string, input: any) =>
      name === 'docs_search'
        ? {
            modelResult: {
              ok: false,
              error: 'search_failed',
              message: 'rate limited',
            },
            summary: 'Lookup failed',
          }
        : {
            modelResult: {
              ok: true,
              results:
                input.query === 'nothing'
                  ? []
                  : [{ repo: 'ally-be', path: 'src/x.ts' }],
            },
            summary: `${name} done`,
          },
    );
    const frames: any[] = [];
    const generator = runDiscovery(
      [
        { tool: 'capability_lookup', query: 'debrief' },
        { tool: 'docs_search', query: 'debrief' },
        { tool: 'github_search_code', query: 'nothing' },
      ],
      execute as any,
      'model',
    );
    let next = await generator.next();
    while (!next.done) {
      frames.push(next.value);
      next = await generator.next();
    }
    const discovery = next.value;

    expect(frames.map((frame) => frame.event)).toEqual([
      'tool_call',
      'tool_call',
      'tool_call',
      'tool_result',
      'tool_result',
      'tool_result',
    ]);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(discovery.items).toEqual([
      expect.objectContaining({
        ref: 'E1',
        ok: true,
        found: ['ally-be:src/x.ts'],
      }),
      expect.objectContaining({
        ref: 'E2',
        ok: false,
        failure: 'rate limited',
      }),
      expect.objectContaining({ ref: 'E3', ok: true, found: [] }),
    ]);

    const block = renderDiscoveryBlock(discovery);
    expect(block).toContain(
      'E1 capability_lookup "debrief" — ally-be:src/x.ts',
    );
    expect(block).toContain('E2 docs_search "debrief" — FAILED: rate limited');
    expect(block).toContain('E3 github_search_code "nothing" — nothing');
  });
});
