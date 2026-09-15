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
