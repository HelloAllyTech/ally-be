import axios from 'axios';
import { BuilderGithubReadService } from '../builder-github-read.service';
import { BUILDER_GITHUB_TREE_MAX_ENTRIES } from '../../constants/builder.constants';

jest.mock('axios');
const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>;

describe('BuilderGithubReadService.listDocs', () => {
  const build = (githubToken: string | undefined = 'ghp_x') =>
    new BuilderGithubReadService({
      githubToken,
      githubOrg: 'helloallytech',
    } as never);

  const tree = (paths: string[], extra: Record<string, any> = {}) =>
    ({
      data: {
        tree: paths.map((path) => ({
          path,
          type: path.endsWith('/') ? 'tree' : 'blob',
        })),
        ...extra,
      },
    }) as never;

  beforeEach(() => jest.clearAllMocks());

  it('lists root markdown and everything under docs/, and nothing else', async () => {
    mockedGet.mockResolvedValue(
      tree([
        'README.md',
        'CLAUDE.md',
        'CHANGELOG.md',
        'package.json',
        'docs/ai-task-registry.md',
        'docs/adr/0001-queues.md',
        'docs/diagram.png',
        'src/prompts/README.md',
        'scripts/builder/review/common.md',
      ]),
    );

    const result = await build().listDocs('ally-be');

    expect(mockedGet.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/helloallytech/ally-be/git/trees/master',
    );
    expect(result).toMatchObject({ ok: true, repo: 'ally-be' });
    expect(result.files).toEqual([
      'README.md',
      'CLAUDE.md',
      'docs/ai-task-registry.md',
      'docs/adr/0001-queues.md',
    ]);
  });

  /**
   * The reason this is not `repoTree(repo, 'docs')` plus a root listing: `repoTree` caps the
   * whole repo before a caller can filter it, and in a 3,700-file repo the docs go first.
   */
  it('filters before it caps, so a large repo still lists its docs', async () => {
    const noise = Array.from(
      { length: BUILDER_GITHUB_TREE_MAX_ENTRIES + 50 },
      (_, i) => `src/module-${i}/index.ts`,
    );
    mockedGet.mockResolvedValue(tree([...noise, 'docs/late-page.md']));

    const result = await build().listDocs('ally-be');

    expect(result.files).toEqual(['docs/late-page.md']);
    expect(result.truncated).toBe(false);
  });

  it('reads the wiki repo too', async () => {
    mockedGet.mockResolvedValue(tree(['README.md']));

    const result = await build().listDocs('helloallytech.github.io');

    expect(result.ok).toBe(true);
  });

  it('refuses a repo outside the readable set without calling GitHub', async () => {
    const result = await build().listDocs('infra');

    expect(result).toEqual({ ok: false, error: 'unknown_repo', repo: 'infra' });
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('says plainly when there is no token, rather than returning an empty list', async () => {
    const result = await build('').listDocs('ally-be');

    expect(result).toMatchObject({ ok: false, error: 'github_not_configured' });
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('returns a failure the caller can read when GitHub errors', async () => {
    mockedGet.mockRejectedValue(new Error('Request failed with status 403'));

    const result = await build().listDocs('ally-web');

    expect(result).toMatchObject({
      ok: false,
      error: 'docs_failed',
      message: 'Request failed with status 403',
    });
  });
});
