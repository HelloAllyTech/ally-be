import { BuilderEvidenceLogService } from '../builder-evidence-log.service';

const flush = () => new Promise((resolve) => setImmediate(resolve));

const build = (rows: any[] = []) => {
  const repository = {
    insert: jest.fn(async () => undefined),
    listBySession: jest.fn(async () => rows),
  };
  return {
    service: new BuilderEvidenceLogService(repository as any),
    repository,
  };
};

/**
 * The record of what a session actually read. In session 2bc3a5cf two reads
 * returned 404 and the PRD described the module anyway; with this, a failed
 * read is on file as failed.
 */
describe('BuilderEvidenceLogService', () => {
  it('records a successful read with its repo:path and an excerpt', async () => {
    const { service, repository } = build();
    service.recordToolResult(
      'session-1',
      'github_read_file',
      {
        repo: 'ally-be',
        path: 'src/skill-experiment/entity/skill-experiment.entity.ts',
      },
      {
        ok: true,
        content:
          '@Entity("skill_experiments")\nexport class SkillExperiment {}',
      },
    );
    await flush();
    expect(repository.insert).toHaveBeenCalledWith({
      sessionId: 'session-1',
      tool: 'github_read_file',
      source: 'ally-be:src/skill-experiment/entity/skill-experiment.entity.ts',
      ok: true,
      excerpt: expect.stringContaining('skill_experiments'),
    });
  });

  it('records a failed read as failed, with the error', async () => {
    const { service, repository } = build();
    service.recordToolResult(
      'session-1',
      'github_read_file',
      {
        repo: 'ally-be',
        path: 'src/skill-experiment/entities/skill-experiment.entity.ts',
      },
      {
        ok: false,
        error: 'read_failed',
        message: 'Request failed with status code 404',
      },
    );
    await flush();
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        excerpt: 'Request failed with status code 404',
      }),
    );
  });

  it('records a search by its query and the paths it returned', async () => {
    const { service, repository } = build();
    service.recordToolResult(
      'session-1',
      'docs_search',
      { query: 'challenger' },
      {
        ok: true,
        results: [{ repo: 'ally-be', path: 'docs/skill-experiments.md' }],
      },
    );
    await flush();
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'challenger',
        excerpt: 'ally-be:docs/skill-experiments.md',
      }),
    );
  });

  /** Catalog hits carry the repo in their path; the excerpt used to print it twice. */
  it('names a catalog hit once, as repo:path', async () => {
    const { service, repository } = build();
    service.recordToolResult(
      'session-1',
      'capability_lookup',
      { query: 'debrief rating' },
      {
        ok: true,
        results: [
          { kind: 'capability', repo: 'ally-be', path: 'ally-be:src/learn' },
          { kind: 'module', repo: 'ally-be', path: 'src/skill-experiment' },
        ],
      },
    );
    await flush();
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        excerpt: 'ally-be:src/learn, ally-be:src/skill-experiment',
      }),
    );
  });

  it('ignores tools that are not lookups', async () => {
    const { service, repository } = build();
    service.recordToolResult(
      'session-1',
      'update_prd',
      { ops: [] },
      { ok: true },
    );
    service.recordToolResult(
      'session-1',
      'ask_admin',
      { prompt: 'x' },
      { ok: true },
    );
    await flush();
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('never throws when the write fails', async () => {
    const repository = {
      insert: jest.fn(async () => Promise.reject(new Error('db down'))),
    };
    const service = new BuilderEvidenceLogService(repository as any);
    expect(() =>
      service.recordToolResult(
        's',
        'wiki_read',
        { path: 'wiki/x.md' },
        { ok: true, content: 'x' },
      ),
    ).not.toThrow();
    await flush();
  });

  it('lists only successful reads as read paths', async () => {
    const { service } = build([
      {
        tool: 'github_read_file',
        source: 'ally-be:docs/skill-experiments.md',
        ok: true,
      },
      { tool: 'github_read_file', source: 'ally-be:src/missing.ts', ok: false },
      { tool: 'docs_search', source: 'challenger', ok: true },
      {
        tool: 'github_read_file',
        source: 'ally-be:docs/skill-experiments.md',
        ok: true,
      },
    ]);
    expect(await service.readPaths('s')).toEqual([
      'ally-be:docs/skill-experiments.md',
    ]);
  });

  it('renders the log for a prompt with failures marked', async () => {
    const { service } = build([
      {
        tool: 'github_read_file',
        source: 'ally-be:src/missing.ts',
        ok: false,
        excerpt: '404',
      },
      {
        tool: 'docs_search',
        source: 'challenger',
        ok: true,
        excerpt: 'ally-be:docs/skill-experiments.md',
      },
    ]);
    const text = await service.renderForPrompt('s');
    expect(text).toContain(
      '- [FAILED] github_read_file: ally-be:src/missing.ts — 404',
    );
    expect(text).toContain(
      '- docs_search: challenger — ally-be:docs/skill-experiments.md',
    );
  });
});
