import { BuilderCatalogService } from '../builder-catalog.service';

const catalogRows = [
  {
    repo: 'ally-be',
    generatedAt: new Date('2026-10-18T03:00:00Z'),
    entries: [
      {
        kind: 'module',
        name: 'skill-experiment',
        path: 'src/skill-experiment',
      },
      { kind: 'module', name: 'learn', path: 'src/learn' },
      {
        kind: 'module',
        name: 'brand-new-feature',
        path: 'src/brand-new-feature',
      },
      { kind: 'module', name: 'redis', path: 'src/redis' },
      {
        kind: 'table',
        name: 'scenario_session_feedbacks',
        path: 'src/learn/entity/scenario-session-feedbacks.entity.ts',
      },
    ],
  },
  {
    repo: 'ally-web',
    entries: [
      {
        kind: 'component',
        name: 'DebriefTab',
        path: 'apps/ally-helpline-dashboard/src/components/debrief-tab/DebriefTab.tsx',
        app: 'ally-helpline-dashboard',
      },
      {
        kind: 'component',
        name: 'Button',
        path: 'apps/ally-helpline-dashboard/src/components/button/Button.tsx',
        app: 'ally-helpline-dashboard',
      },
      {
        // Admin console, not a learner surface: never a twin.
        kind: 'component',
        name: 'TranscriptTab',
        path: 'apps/ally-admin-dashboard/src/components/TranscriptTab.tsx',
        app: 'ally-admin-dashboard',
      },
    ],
  },
  {
    repo: 'ally-mobile',
    entries: [
      {
        kind: 'component',
        name: 'DebriefTab',
        path: 'src/screens/SimulationFeedbackScreen/components/Debrief/DebriefTab.tsx',
        app: 'mobile',
      },
      {
        kind: 'component',
        name: 'Button',
        path: 'src/components/Button/Button.tsx',
        app: 'mobile',
      },
      {
        kind: 'component',
        name: 'TranscriptTab',
        path: 'src/screens/X/TranscriptTab.tsx',
        app: 'mobile',
      },
    ],
  },
];

const build = (rows: any[] = catalogRows) => {
  const repository = {
    listAll: jest.fn(async () => rows),
    findByRepo: jest.fn(async () => null),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ id: 'new', ...value })),
    update: jest.fn(),
    findOneOrFail: jest.fn(),
  };
  return { service: new BuilderCatalogService(repository as any), repository };
};

/**
 * Session 2bc3a5cf asked to "A/B test challenger prompts and make the winner
 * the default" and the interview proposed building Auto-improve again. These
 * are the lookups that would have stopped it.
 */
describe('BuilderCatalogService', () => {
  it('finds Auto-improve first for a request phrased in its own words', async () => {
    const hits = await build().service.search('a/b test challenger prompts');
    expect(hits[0]).toMatchObject({ kind: 'capability' });
    expect(hits[0].name).toContain('Auto-improve');
    expect(hits[0].detail).toContain('Reuse when');
  });

  it('finds generated entries by name and path', async () => {
    const hits = await build().service.search('scenario session feedbacks');
    expect(hits.some((hit) => hit.name === 'scenario_session_feedbacks')).toBe(
      true,
    );
  });

  it('returns nothing for a query with no usable words', async () => {
    expect(await build().service.search('a b')).toEqual([]);
  });

  it('connects the debrief to Auto-improve through the connected skills', () => {
    const hits = build().service.aiTasksLookup('debrief');
    const connected = hits.filter((hit) => hit.kind === 'connected_skill');
    expect(connected.map((hit) => hit.name)).toEqual(
      expect.arrayContaining(['ally_ai_scenario_scenario_evaluation']),
    );
    expect(connected[0].detail).toContain('Auto-improve');
  });

  it('pairs learner components that exist on web and mobile, ignoring UI primitives and the admin app', async () => {
    const twins = await build().service.parityTwins();
    expect(twins).toEqual([
      {
        name: 'DebriefTab',
        web: 'apps/ally-helpline-dashboard/src/components/debrief-tab/DebriefTab.tsx',
        mobile:
          'src/screens/SimulationFeedbackScreen/components/Debrief/DebriefTab.tsx',
      },
    ]);
  });

  it('has no twins until both catalogs exist', async () => {
    expect(await build([catalogRows[0]]).service.parityTwins()).toEqual([]);
  });

  it('renders the systems and the twins for the interview context', async () => {
    const text = await build().service.renderContextSection();
    expect(text).toContain('# Reusable platform systems');
    expect(text).toContain('**Auto-improve');
    expect(text).toContain('capability_lookup');
    expect(text).toContain('# Learner surfaces on both web and mobile');
    expect(text).toContain('DebriefTab');
  });

  it('reports modules no reuse line covers, leaving plumbing out', async () => {
    const coverage = await build().service.coverage();
    expect(coverage.uncoveredModules).toEqual(['brand-new-feature']);
    expect(coverage.coveredModules).toEqual(
      expect.arrayContaining(['skill-experiment', 'learn']),
    );
  });

  it('fails soft to no catalog when the table cannot be read', async () => {
    const repository = {
      listAll: jest.fn(async () => Promise.reject(new Error('db down'))),
    };
    const service = new BuilderCatalogService(repository as any);
    expect(await service.listCatalogs()).toEqual([]);
    expect(await service.parityTwins()).toEqual([]);
  });

  it('replaces a repo catalog whole and drops the cache', async () => {
    const { service, repository } = build();
    await service.listCatalogs();
    await service.upsert({ repo: 'ally-ai', entries: [] });
    await service.listCatalogs();
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'ally-ai', entries: [] }),
    );
    expect(repository.listAll).toHaveBeenCalledTimes(2);
  });
});
