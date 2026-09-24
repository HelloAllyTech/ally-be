import axios from 'axios';

import { AppConfigService } from 'src/config/config.service';

import { GithubActionsService } from '../github-actions.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockLogger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
jest.mock('src/logger/logger.service', () => ({
  LoggerService: { getInstance: jest.fn(() => mockLogger) },
}));

describe('GithubActionsService.hasCommitsSince', () => {
  let service: GithubActionsService;
  const configService = {
    githubToken: 'gh-token',
    githubOrg: 'helloallytech',
  } as unknown as AppConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GithubActionsService(configService);
  });

  it('is true when master has at least one commit since the given time', async () => {
    mockedAxios.get.mockResolvedValue({ data: [{ sha: 'abc123' }] });

    const result = await service.hasCommitsSince(
      'ally-web',
      new Date('2026-09-14T00:00:00.000Z'),
    );

    expect(result).toBe(true);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.github.com/repos/helloallytech/ally-web/commits',
      expect.objectContaining({
        params: {
          sha: 'master',
          since: '2026-09-14T00:00:00.000Z',
          per_page: 1,
        },
      }),
    );
  });

  it('is false when the compare comes back empty', async () => {
    mockedAxios.get.mockResolvedValue({ data: [] });

    const result = await service.hasCommitsSince(
      'ally-web',
      new Date('2026-09-14T00:00:00.000Z'),
    );

    expect(result).toBe(false);
  });

  it('fails open (true) on a GitHub error, rather than silently skipping every sweep forever', async () => {
    mockedAxios.get.mockRejectedValue(new Error('rate limited'));

    const result = await service.hasCommitsSince(
      'ally-web',
      new Date('2026-09-14T00:00:00.000Z'),
    );

    expect(result).toBe(true);
  });
});

/**
 * Choosing the next release tag.
 *
 * ally-web carries three independently-released apps in one repo, so its tags
 * interleave three prefixes. Its first 100 — GitHub's first page — are ALL
 * `helpline-v*`, so a single-page read found no `admin-v*` whatsoever, fell
 * into the "never released" branch and proposed `admin-v0.0.1` for an app on
 * 1.88. The release workflow's version validation rejected it, which is the
 * only reason that was a failed release rather than a catastrophic one.
 */
describe('GithubActionsService.nextPatchTag', () => {
  let service: GithubActionsService;
  const configService = {
    githubToken: 'gh-token',
    githubOrg: 'helloallytech',
  } as unknown as AppConfigService;

  const page = (names: string[]) => ({ data: names.map((name) => ({ name })) });
  const filler = (n: number) =>
    Array.from({ length: n }, (_, i) => `helpline-v1.0.${i}`);

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GithubActionsService(configService);
  });

  it('bumps the patch of the highest matching tag', async () => {
    mockedAxios.get.mockResolvedValueOnce(
      page(['admin-v1.88.0', 'admin-v1.9.0', 'helpline-v2.0.0']) as any,
    );

    await expect(service.nextPatchTag('ally-web', 'admin-v')).resolves.toBe(
      'admin-v1.88.1',
    );
  });

  /** The real failure: a full first page carrying none of the prefix. */
  it('reads past a full page of other prefixes', async () => {
    mockedAxios.get
      .mockResolvedValueOnce(page(filler(100)) as any)
      .mockResolvedValueOnce(page(['admin-v1.88.0']) as any);

    await expect(service.nextPatchTag('ally-web', 'admin-v')).resolves.toBe(
      'admin-v1.88.1',
    );
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  /** A genuinely unreleased prefix — provable, because the page came back short. */
  it('proposes a first release only when it has seen every tag', async () => {
    mockedAxios.get.mockResolvedValueOnce(page(['helpline-v1.0.0']) as any);

    await expect(service.nextPatchTag('ally-web', 'admin-v')).resolves.toBe(
      'admin-v0.0.1',
    );
  });

  /**
   * The distinction that matters. "No tag with this prefix" and "I did not look
   * far enough" produce the same empty list and mean opposite things, so they
   * must not share an answer.
   */
  it('refuses to guess when there are still tags it has not read', async () => {
    mockedAxios.get.mockResolvedValue(page(filler(100)) as any);

    await expect(service.nextPatchTag('ally-web', 'admin-v')).rejects.toThrow(
      /Refusing to guess/,
    );
  });

  it('does not confuse a longer prefix for a shorter one', async () => {
    mockedAxios.get.mockResolvedValueOnce(
      page(['admin-v1.5.0', 'v9.9.9']) as any,
    );

    await expect(service.nextPatchTag('ally-be', 'v')).resolves.toBe('v9.9.10');
  });
});
