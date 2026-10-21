import { RoadmapCopilotToolsService } from '../roadmap-copilot-tools.service';
import { ROADMAP_COPILOT } from '../../constants/product-roadmap.constants';

/**
 * The copilot's research belt. What matters: a failed lookup comes back as something the model
 * can read (never an exception that ends the turn), what the admin sees in the activity feed is
 * written for them, and nothing the belt offers can write.
 */
describe('RoadmapCopilotToolsService', () => {
  const build = (over: Record<string, any> = {}) => {
    const evidence = {
      analyticsAsk: jest.fn(),
      uxSignals: jest.fn(),
      openFindings: jest.fn(),
      ...over.evidence,
    };
    const interviewNotes = {
      search: jest.fn().mockResolvedValue([[], 0]),
      ...over.interviewNotes,
    };
    const githubRead = {
      searchCode: jest.fn(),
      readFile: jest.fn(),
      repoTree: jest.fn(),
      ...over.githubRead,
    };
    const service = new RoadmapCopilotToolsService(
      {} as any,
      {} as any,
      interviewNotes as any,
      {} as any,
      githubRead as any,
      { search: jest.fn(), getChunks: jest.fn() } as any,
      evidence as any,
    );
    return { service, evidence, interviewNotes, githubRead };
  };

  /**
   * An allowlist, not a pattern: a new tool has to be added here on purpose, which is the
   * moment someone asks whether it writes anything.
   */
  it('offers exactly the read-only research tools plus the turn-ending submit_turn', () => {
    const names = build()
      .service.getToolDefinitions()
      .map((t) => t.name);

    expect(names).toEqual([
      'search_roadmap',
      'get_opportunity',
      'search_user_interviews',
      'analytics_ask',
      'ux_signals_lookup',
      'bug_findings_search',
      'docs_search',
      'github_search_code',
      'github_read_file',
      'github_repo_tree',
      'wiki_search',
      'wiki_read',
      'stacks_search',
      'stacks_get',
      'submit_turn',
    ]);
  });

  it('describes a lookup in the admin’s terms, not a tool name', () => {
    const { service } = build();
    expect(service.describe('search_roadmap', { query: 'review triage' })).toBe(
      'Searching the roadmap for "review triage"',
    );
    expect(service.describe('analytics_ask', { question: 'How many?' })).toBe(
      'Asking analytics: How many?',
    );
  });

  it('summarises results as counts a person reads', async () => {
    const { service } = build({
      evidence: {
        uxSignals: jest
          .fn()
          .mockResolvedValue({ ok: true, findings: [], suggestions: [{}] }),
      },
    });

    const outcome = await service.execute(
      'ux_signals_lookup',
      {},
      { userId: 1 },
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toBe('No friction findings, 1 suggestion');
  });

  it('returns a failed lookup to the model with its reason instead of throwing', async () => {
    const { service } = build({
      evidence: {
        analyticsAsk: jest
          .fn()
          .mockResolvedValue({ ok: false, error: 'analytics timed out' }),
      },
    });

    const outcome = await service.execute(
      'analytics_ask',
      { question: 'How many supervisors?' },
      { userId: 1 },
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toBe("Couldn't check: analytics timed out");
    expect(JSON.parse(outcome.modelResult)).toEqual({
      ok: false,
      error: 'analytics timed out',
    });
  });

  it('catches a lookup that throws', async () => {
    const { service } = build({
      githubRead: {
        searchCode: jest.fn().mockRejectedValue(new Error('boom')),
      },
    });

    const outcome = await service.execute(
      'github_search_code',
      { query: 'x' },
      { userId: 1 },
    );

    expect(outcome.ok).toBe(false);
    expect(JSON.parse(outcome.modelResult).error).toBe('boom');
  });

  it('bounds a large result so one file cannot fill the turn', async () => {
    const { service } = build({
      githubRead: {
        readFile: jest
          .fn()
          .mockResolvedValue({ ok: true, content: 'x'.repeat(50_000) }),
      },
    });

    const outcome = await service.execute(
      'github_read_file',
      { repo: 'ally-be', path: 'big.ts' },
      { userId: 1 },
    );

    expect(outcome.modelResult.length).toBeLessThan(
      ROADMAP_COPILOT.TOOL_RESULT_MAX_CHARS + 100,
    );
    expect(outcome.modelResult).toMatch(/truncated/);
  });

  describe('docs_search', () => {
    it('searches markdown only, and drops hits in repos the copilot cannot read', async () => {
      const searchCode = jest.fn().mockResolvedValue({
        ok: true,
        totalCount: 3,
        results: [
          { repo: 'ally-be', path: 'docs/course-copilot.md' },
          { repo: 'infra', path: 'README.md' },
          { repo: 'helloallytech.github.io', path: 'wiki/repos/ally-be.md' },
        ],
      });
      const { service } = build({ githubRead: { searchCode } });

      const outcome = await service.execute(
        'docs_search',
        { query: 'course copilot' },
        { userId: 1 },
      );

      expect(searchCode).toHaveBeenCalledWith(
        'course copilot extension:md',
        undefined,
      );
      expect(JSON.parse(outcome.modelResult).results).toEqual([
        { repo: 'ally-be', path: 'docs/course-copilot.md' },
        { repo: 'helloallytech.github.io', path: 'wiki/repos/ally-be.md' },
      ]);
      expect(outcome.summary).toBe('2 matching pages');
    });

    it('scopes to one repo when asked', async () => {
      const searchCode = jest.fn().mockResolvedValue({ ok: true, results: [] });
      const { service } = build({ githubRead: { searchCode } });

      const outcome = await service.execute(
        'docs_search',
        { query: 'roleplay logs', repo: 'ally-web' },
        { userId: 1 },
      );

      expect(searchCode).toHaveBeenCalledWith(
        'roleplay logs extension:md',
        'ally-web',
      );
      // Nothing found must not read as "nothing documented".
      expect(JSON.parse(outcome.modelResult).note).toMatch(/before concluding/);
    });

    it('passes a GitHub failure through as a failure, not as an empty result', async () => {
      const { service } = build({
        githubRead: {
          searchCode: jest.fn().mockResolvedValue({
            ok: false,
            error: 'github_not_configured',
          }),
        },
      });

      const outcome = await service.execute(
        'docs_search',
        { query: 'scribe' },
        { userId: 1 },
      );

      expect(outcome.ok).toBe(false);
      expect(outcome.summary).toBe("Couldn't check: github_not_configured");
    });

    it('describes itself to the admin as reading the docs', () => {
      expect(
        build().service.describe('docs_search', { query: 'debrief' }),
      ).toBe('Searching the docs for "debrief"');
    });
  });

  it('tells the model when interview notes found nothing, so it tries a shorter keyword', async () => {
    const { service } = build();

    const outcome = await service.execute(
      'search_user_interviews',
      { query: 'supervisor review queue' },
      { userId: 1 },
    );

    expect(outcome.summary).toBe('No interview notes');
    expect(JSON.parse(outcome.modelResult).note).toMatch(/shorter keyword/);
  });
});
