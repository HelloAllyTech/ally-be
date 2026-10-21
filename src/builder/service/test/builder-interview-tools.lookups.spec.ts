import { BuilderInterviewToolsService } from '../builder-interview-tools.service';

const build = () => {
  const githubRead = {
    searchCode: jest.fn(async () => ({
      ok: true,
      results: [
        { repo: 'ally-be', path: 'docs/skill-experiments.md' },
        { repo: 'some-other-repo', path: 'README.md' },
      ],
    })),
    readFile: jest.fn(async () => ({
      ok: false,
      error: 'read_failed',
      message: '404',
    })),
  };
  const catalog = {
    search: jest.fn(async () => [
      {
        kind: 'capability',
        repo: 'ally-be',
        name: 'Auto-improve',
        path: 'ally-be:src/skill-experiment',
      },
    ]),
    aiTasksLookup: jest.fn(() => [
      {
        kind: 'connected_skill',
        repo: 'ally-be',
        name: 'ally_ai_scenario_scenario_evaluation',
      },
    ]),
  };
  const evidenceLog = { recordToolResult: jest.fn() };
  const service = new BuilderInterviewToolsService(
    {} as any,
    githubRead as any,
    {} as any,
    {} as any,
    catalog as any,
    evidenceLog as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const context = { session: { id: 'session-1' }, doc: {}, userId: 1 } as any;
  return { service, githubRead, catalog, evidenceLog, context };
};

describe('BuilderInterviewToolsService — platform lookups', () => {
  it('offers capability_lookup, ai_tasks_lookup and docs_search', () => {
    const names = build()
      .service.getToolDefinitions()
      .map((tool: any) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'capability_lookup',
        'ai_tasks_lookup',
        'docs_search',
      ]),
    );
  });

  it('answers capability_lookup from the platform map and logs it as evidence', async () => {
    const { service, catalog, evidenceLog, context } = build();
    const outcome = await service.execute(
      'capability_lookup',
      { query: 'a/b test' },
      context,
    );
    expect(catalog.search).toHaveBeenCalledWith('a/b test');
    expect(outcome.modelResult).toMatchObject({
      ok: true,
      results: [{ name: 'Auto-improve' }],
    });
    expect(evidenceLog.recordToolResult).toHaveBeenCalledWith(
      'session-1',
      'capability_lookup',
      { query: 'a/b test' },
      outcome.modelResult,
    );
  });

  it('says plainly when the platform map has nothing, rather than implying nothing exists', async () => {
    const { service, catalog, context } = build();
    catalog.search.mockResolvedValueOnce([]);
    const outcome = await service.execute(
      'capability_lookup',
      { query: 'zzz' },
      context,
    );
    expect(outcome.modelResult.note).toContain(
      'before concluding nothing exists',
    );
  });

  it('answers ai_tasks_lookup from the registry and connected skills', async () => {
    const { service, context } = build();
    const outcome = await service.execute(
      'ai_tasks_lookup',
      { query: 'debrief' },
      context,
    );
    expect(outcome.modelResult.results[0].name).toBe(
      'ally_ai_scenario_scenario_evaluation',
    );
  });

  it('searches markdown only, and drops repos Builder cannot read', async () => {
    const { service, githubRead, context } = build();
    const outcome = await service.execute(
      'docs_search',
      { query: 'challenger' },
      context,
    );
    expect(githubRead.searchCode).toHaveBeenCalledWith(
      'challenger extension:md',
      undefined,
    );
    expect(outcome.modelResult.results).toEqual([
      { repo: 'ally-be', path: 'docs/skill-experiments.md' },
    ]);
  });

  it('logs a failed read as evidence too', async () => {
    const { service, evidenceLog, context } = build();
    await service.execute(
      'github_read_file',
      { repo: 'ally-be', path: 'src/skill-experiment/entities/x.ts' },
      context,
    );
    expect(evidenceLog.recordToolResult).toHaveBeenCalledWith(
      'session-1',
      'github_read_file',
      { repo: 'ally-be', path: 'src/skill-experiment/entities/x.ts' },
      expect.objectContaining({ ok: false }),
    );
  });
});
