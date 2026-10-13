import { BugHunterMode } from '../../enum/bug-finding.enum';
import { BugHuntRunStatus, BugHuntTrigger } from '../../enum/bug-hunt-run.enum';
import { BugHunterFeatureMapService } from '../bug-hunter-feature-map.service';

const card = (over: Record<string, unknown> = {}) => ({
  slug: 'simulation-titles-translated',
  title: 'Simulation titles in the learner language',
  valueSource: 'database',
  summary:
    'Titles live in scenarios.translations keyed by translationCode, written by persistTranslationsForScenarios on save; getScenariosV2 applies them per languageCode; the helpline Learn tab renders them.',
  entryPoints: ['src/learn/service/scenario.service.ts'],
  endpoints: ['GET /v2/learn/scenarios'],
  dataHomes: ['scenarios.translations', 'scenario_translations.metadata'],
  writtenBy: 'Simulation Studio save, via persistTranslationsForScenarios',
  relatedRepos: ['ally-web: renders the list'],
  gotchas: ['Adding a voice later never translated the new language'],
  ...over,
});

describe('BugHunterFeatureMapService', () => {
  let repository: {
    upsert: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let memory: { write: jest.Mock };
  let bugHunterService: {
    getSettings: jest.Mock;
    startRun: jest.Mock;
    closeRun: jest.Mock;
  };
  let github: { dispatchWorkflow: jest.Mock };
  let service: BugHunterFeatureMapService;

  beforeEach(() => {
    repository = {
      upsert: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    memory = { write: jest.fn() };
    bugHunterService = {
      getSettings: jest.fn().mockResolvedValue({ mode: BugHunterMode.AI }),
      startRun: jest.fn().mockResolvedValue({ id: 'map-1' }),
      closeRun: jest.fn(),
    };
    github = { dispatchWorkflow: jest.fn().mockResolvedValue(new Date()) };
    service = new BugHunterFeatureMapService(
      repository as never,
      bugHunterService as never,
      github as never,
      { publicApiBaseUrl: 'https://api.example.com' } as never,
      memory as never,
    );
  });

  const save = (repo: string, over: Record<string, unknown> = {}) =>
    service.save({ repo, runId: null, sourceSha: null, cards: [card(over)] });

  it('upserts a valid card by slug, owned by the posting repo, with its commit and run', async () => {
    const r = await service.save({
      repo: 'ally-be',
      runId: 'map-1',
      sourceSha: 'abc123',
      cards: [card()],
    });
    expect(r).toEqual({
      saved: 1,
      merged: 0,
      slugs: ['simulation-titles-translated'],
    });
    const [row, opts] = repository.upsert.mock.calls[0];
    expect(opts).toMatchObject({ conflictPaths: ['slug'] });
    expect(row).toMatchObject({
      repo: 'ally-be',
      valueSource: 'database',
      sourceSha: 'abc123',
      runId: 'map-1',
      endpoints: ['GET /v2/learn/scenarios'],
    });
  });

  it("adds another repo's part to an existing card instead of writing a duplicate", async () => {
    repository.findOne.mockResolvedValue({
      id: 'c-1',
      repo: 'ally-be',
      slug: 'simulation-titles-translated',
      entryPoints: ['src/learn/service/scenario.service.ts'],
      endpoints: ['GET /v2/learn/scenarios'],
      dataHomes: ['scenarios.translations'],
      relatedRepos: [],
      gotchas: [],
    });
    const r = await save('ally-web', {
      entryPoints: ['apps/ally-helpline-dashboard/src/pages/learn/Learn.tsx'],
      relatedRepos: ['ally-be: stores and translates the titles'],
    });
    expect(r).toMatchObject({ saved: 0, merged: 1 });
    expect(repository.upsert).not.toHaveBeenCalled();
    const [id, patch] = repository.update.mock.calls[0];
    expect(id).toBe('c-1');
    expect(patch.entryPoints).toEqual([
      'src/learn/service/scenario.service.ts',
      'apps/ally-helpline-dashboard/src/pages/learn/Learn.tsx',
    ]);
    expect(patch.summary).toBeUndefined();
    expect(patch.valueSource).toBeUndefined();
  });

  it('makes every card say where its value comes from, and a database card name its endpoint and backend', async () => {
    await expect(save('ally-be', { valueSource: undefined })).rejects.toThrow(
      /valueSource must be one of/,
    );
    await expect(save('ally-be', { valueSource: 'api' })).rejects.toThrow(
      /valueSource must be one of/,
    );
    await expect(save('ally-be', { dataHomes: [] })).rejects.toThrow(
      /dataHomes must name/,
    );
    await expect(save('ally-be', { endpoints: [] })).rejects.toThrow(
      /name the endpoint/,
    );
    // The 2026-10-13 wrong card: a client card for content with no backend named.
    await expect(
      save('ally-web', { relatedRepos: ['ally-web: renders it'] }),
    ).rejects.toThrow(/name the backend repo/);
    // A label card in a client repo needs neither.
    await expect(
      save('ally-web', {
        slug: 'ui-labels-translated',
        valueSource: 'locale_file',
        endpoints: [],
        relatedRepos: [],
        dataHomes: ['apps/ally-helpline-dashboard/src/i18n/locales/*.json'],
      }),
    ).resolves.toMatchObject({ saved: 1 });
  });

  it('refuses cards a study could not use: bad slug, thin summary, unknown repo, too many', async () => {
    await expect(save('ally-be', { slug: 'Not A Slug' })).rejects.toThrow(
      /kebab-case/,
    );
    await expect(save('ally-be', { summary: 'short' })).rejects.toThrow(
      /stored to where it is shown/,
    );
    await expect(save('not-ally')).rejects.toThrow(/not an Ally repo/);
    await expect(
      service.save({
        repo: 'ally-be',
        runId: null,
        sourceSha: null,
        cards: Array(16).fill(card()),
      }),
    ).rejects.toThrow(/At most 15/);
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('removes a wrong card and writes the reason as a notebook lesson the next map run reads', async () => {
    repository.findOne.mockResolvedValue({
      id: 'c-9',
      repo: 'ally-web',
      slug: 'simulation-translations',
      title: 'Simulation Translations',
    });
    await service.remove(
      'c-9',
      136,
      'Describes UI label bundles; simulation titles come translated from ally-be.',
    );
    expect(repository.delete).toHaveBeenCalledWith('c-9');
    expect(memory.write).toHaveBeenCalledWith(
      expect.objectContaining({
        repos: ['ally-web'],
        tags: ['feature-map', 'wrong-card'],
        createdBy: 136,
        curated: true,
        body: expect.stringContaining(
          'was removed as wrong: Describes UI label bundles',
        ),
      }),
    );
    memory.write.mockClear();
    await service.remove('c-9', 136);
    expect(memory.write).not.toHaveBeenCalled();
    repository.findOne.mockResolvedValue(null);
    await expect(service.remove('nope', 136)).rejects.toThrow(
      /No feature card/,
    );
  });

  it('dispatches a read-only map run on the sweep workflow in map mode', async () => {
    expect(await service.dispatch('ally-web')).toBe('map-1');
    expect(bugHunterService.startRun).toHaveBeenCalledWith(
      BugHuntTrigger.FEATURE_MAP,
      'ally-web',
    );
    expect(github.dispatchWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: 'ally-web',
        workflow: 'bug-hunt-sweep.yml',
        inputs: expect.objectContaining({ mode: 'map', run_id: 'map-1' }),
      }),
    );
  });

  it('starts nothing while Bug Hunter is off, and closes the run when GitHub refuses', async () => {
    bugHunterService.getSettings.mockResolvedValueOnce({
      mode: BugHunterMode.OFF,
    });
    expect(await service.dispatch('ally-be')).toBeNull();
    expect(bugHunterService.startRun).not.toHaveBeenCalled();

    github.dispatchWorkflow.mockRejectedValueOnce(new Error('422'));
    expect(await service.dispatch('ally-be')).toBeNull();
    expect(bugHunterService.closeRun).toHaveBeenCalledWith(
      'map-1',
      BugHuntRunStatus.FAILED,
      expect.anything(),
      expect.stringContaining('422'),
    );
  });

  it('refreshes every repo once a week and survives one failing', async () => {
    github.dispatchWorkflow.mockRejectedValueOnce(new Error('boom'));
    await service.refreshAll();
    expect(github.dispatchWorkflow).toHaveBeenCalledTimes(5);
  });

  it("finds cards by the bug's words, and by a file the bug names", async () => {
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['where', 'orderBy', 'orWhere', 'limit'])
      qb[m] = jest.fn(() => qb);
    qb.getMany = jest.fn().mockResolvedValue([]);
    repository.createQueryBuilder.mockReturnValue(qb);
    await service.forBug({
      title: 'Simulation titles English in Marathi',
      description: 'titles stay english',
      file: 'src/learn/service/scenario.service.ts',
    });
    expect(qb.where.mock.calls[0][1].q).toContain('simulation');
    expect(qb.orWhere).toHaveBeenCalledWith(
      expect.stringContaining('entry_points'),
      { file: '%src/learn/service/scenario.service.ts%' },
    );
  });
});
