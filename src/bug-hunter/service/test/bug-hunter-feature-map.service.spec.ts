import { BugHunterMode } from '../../enum/bug-finding.enum';
import { BugHuntRunStatus, BugHuntTrigger } from '../../enum/bug-hunt-run.enum';
import { BugHunterFeatureMapService } from '../bug-hunter-feature-map.service';

const card = (over: Record<string, unknown> = {}) => ({
  slug: 'simulation-translations',
  title: 'Simulation titles in the learner language',
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
    createQueryBuilder: jest.Mock;
  };
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
      createQueryBuilder: jest.fn(),
    };
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
    );
  });

  it('upserts valid cards by repo and slug, with the commit and run they came from', async () => {
    const r = await service.save({
      repo: 'ally-be',
      runId: 'map-1',
      sourceSha: 'abc123',
      cards: [card()],
    });
    expect(r).toEqual({ saved: 1, slugs: ['simulation-translations'] });
    const [rows, opts] = repository.upsert.mock.calls[0];
    expect(opts).toMatchObject({ conflictPaths: ['repo', 'slug'] });
    expect(rows[0]).toMatchObject({
      repo: 'ally-be',
      sourceSha: 'abc123',
      runId: 'map-1',
      endpoints: ['GET /v2/learn/scenarios'],
    });
  });

  it('refuses cards a study could not use: bad slug, thin summary, unknown repo, too many', async () => {
    await expect(
      service.save({
        repo: 'ally-be',
        runId: null,
        sourceSha: null,
        cards: [card({ slug: 'Not A Slug' })],
      }),
    ).rejects.toThrow(/kebab-case/);
    await expect(
      service.save({
        repo: 'ally-be',
        runId: null,
        sourceSha: null,
        cards: [card({ summary: 'short' })],
      }),
    ).rejects.toThrow(/stored to where it is shown/);
    await expect(
      service.save({
        repo: 'not-ally',
        runId: null,
        sourceSha: null,
        cards: [card()],
      }),
    ).rejects.toThrow(/not an Ally repo/);
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
