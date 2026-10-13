import {
  buildFeatureMapPrompt,
  renderFeatureCards,
} from '../bug-feature-map-prompt';
import { renderToolbox } from '../bug-hunter-toolbox';
import {
  renderRepairBrief,
  repairableDataFault,
  repoForFault,
} from '../bug-hunter-repair';

const verdicts = (fault: Record<string, unknown>) => ({
  findingVerdicts: [{ verdict: 'confirmed', fault }],
});

describe('the toolbox every protocol renders', () => {
  const text = renderToolbox({
    apiBaseUrl: 'https://api.example.com',
    repo: 'ally-web',
    runId: 'run-1',
    authHeader: '-H "x-api-key: K"',
    findingId: 'f-1',
  }).join('\n');

  it('lists public probes, data probes, sibling repos and what Bug Hunter knows', () => {
    expect(text).toContain('https://api.example.com/i18n/manifest.json');
    expect(text).toContain(
      'https://api.example.com/api/v1/bug-hunter/pipeline/probes/<name>?<params>&runId=run-1',
    );
    expect(text).toContain('scenario-translations');
    expect(text).toContain(
      '/tmp/siblings/<repo> (ally-be, ally-ai, ally-ai-learn, ally-mobile)',
    );
    expect(text).not.toMatch(/\(ally-web,/);
    expect(text).toContain('pipeline/precedents?findingId=f-1&runId=run-1');
    expect(text).toContain('pipeline/feature-maps?q=');
  });

  it('demands evidence for a claim about data', () => {
    expect(text).toContain('"probably missing" is not evidence');
  });
});

describe('data repairs', () => {
  it('repairs data a fixable repo owns, never config or data nobody owns', () => {
    expect(
      repairableDataFault(verdicts({ layer: 'data', repo: 'ally-be' }))?.repo,
    ).toBe('ally-be');
    expect(
      repairableDataFault(verdicts({ layer: 'config', repo: 'ally-be' })),
    ).toBeNull();
    expect(
      repairableDataFault(verdicts({ layer: 'data', repo: null })),
    ).toBeNull();
    expect(
      repairableDataFault(verdicts({ layer: 'data', repo: 'some-sheet' })),
    ).toBeNull();
  });

  it('sends the fix where the fault is, not where the symptom was filed', () => {
    expect(repoForFault(verdicts({ layer: 'code', repo: 'ally-be' }))).toBe(
      'ally-be',
    );
    expect(repoForFault(verdicts({ layer: 'data', repo: 'ally-be' }))).toBe(
      'ally-be',
    );
    expect(
      repoForFault(verdicts({ layer: 'config', repo: 'ally-be' })),
    ).toBeNull();
    expect(
      repoForFault(verdicts({ layer: 'unknown', repo: 'ally-be' })),
    ).toBeNull();
    expect(repoForFault({})).toBeNull();
  });

  it('briefs a repair as an idempotent, dry-run backfill that never merges itself', () => {
    const text = renderRepairBrief({
      layer: 'data',
      repo: 'ally-be',
      evidence: 'mr missing for 188',
      repair: 'backfill',
    }).join('\n');
    expect(text).toContain('DATA REPAIR');
    expect(text).toMatch(/idempotent/);
    expect(text).toMatch(/dry run/);
    expect(text).toMatch(/Never run it against production/);
    expect(text).toMatch(/never merges itself/);
  });
});

describe('the feature map run', () => {
  it('is read-only, uses the siblings, and refreshes cards rather than rewriting them', () => {
    const p = buildFeatureMapPrompt({
      repo: 'ally-be',
      runId: 'map-1',
      apiBaseUrl: 'https://api.example.com',
      existing: [
        {
          slug: 'simulation-translations',
          title: 'Simulation titles',
          entryPoints: ['src/learn'],
          sourceSha: 'abc',
        },
      ],
    });
    expect(p).toContain('Do NOT edit, commit or push anything');
    expect(p).toContain('/tmp/siblings/<repo>');
    expect(p).toContain(
      'simulation-translations: Simulation titles (mapped at abc',
    );
    expect(p).toContain('git diff --name-only <sha>..HEAD');
    expect(p).toContain(
      'https://api.example.com/api/v1/bug-hunter/pipeline/feature-maps',
    );
    expect(p).toContain('/runs/map-1/close');
  });

  it('renders cards as something to check, not to trust', () => {
    const text = renderFeatureCards([
      {
        repo: 'ally-be',
        title: 'Simulation titles',
        summary: 'Stored in scenarios.translations.',
        entryPoints: ['src/learn/service/scenario.service.ts'],
        endpoints: [],
        dataHomes: ['scenarios.translations'],
        writtenBy: 'persistTranslationsForScenarios',
        relatedRepos: [],
        gotchas: [],
        sourceSha: 'abcdef1234',
      },
    ] as never).join('\n');
    expect(text).toContain('### Simulation titles (ally-be @ abcdef12)');
    expect(text).toContain('CHECK them');
    expect(text).toContain('- Values live in: scenarios.translations');
  });
});
