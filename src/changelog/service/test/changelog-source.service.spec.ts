import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';

import { AppConfigService } from 'src/config/config.service';
import { RedisService } from 'src/redis/service/redis.service';

import { ChangelogSourceService } from '../changelog-source.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockLogger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
jest.mock('src/logger/logger.service', () => ({
  LoggerService: { getInstance: jest.fn(() => mockLogger) },
}));

const MARKDOWN = `# Ally Changelog

<!-- ENTRIES -->

## 2026-09-15T08:19:30Z — ally-be
- **For release notes:** A newer thing.
- **Technical:** 1 commit(s) · @someone


## 2026-09-14T07:02:08Z — ally-web (ally-admin-dashboard)
- **For release notes:** An older thing.
- **Technical:** 1 commit(s) · @someone
`;

describe('ChangelogSourceService', () => {
  let service: ChangelogSourceService;
  let redis: { get: jest.Mock; set: jest.Mock };

  const build = async (token = 'gh-token') => {
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChangelogSourceService,
        {
          provide: AppConfigService,
          useValue: { changelogSourceToken: token, githubOrg: 'HelloAllyTech' },
        },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    service = module.get(ChangelogSourceService);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await build();
  });

  it('reads the markdown from GitHub and parses it, newest first', async () => {
    mockedAxios.get.mockResolvedValue({ data: MARKDOWN });

    const entries = await service.getEntries();

    expect(entries.map((e) => e.releaseNoteText)).toEqual([
      'A newer thing.',
      'An older thing.',
    ]);
    const [url, config] = mockedAxios.get.mock.calls[0];
    expect(url).toContain(
      '/repos/HelloAllyTech/ally-changelog/contents/CHANGELOG.md',
    );
    // The JSON representation caps at 1 MB; the raw one does not.
    expect((config as any).headers.Accept).toBe('application/vnd.github.raw');
  });

  it('serves the parsed copy without calling GitHub again', async () => {
    mockedAxios.get.mockResolvedValue({ data: MARKDOWN });

    await service.getEntries();
    await service.getEntries();

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('caches the parse so a cold process does not have to fetch', async () => {
    mockedAxios.get.mockResolvedValue({ data: MARKDOWN });
    await service.getEntries();

    const cached = JSON.parse(redis.set.mock.calls[0][1]);
    expect(cached.entries).toHaveLength(2);

    await build();
    redis.get.mockResolvedValue(JSON.stringify(cached));
    mockedAxios.get.mockClear();

    const entries = await service.getEntries();

    expect(entries[0].releaseNoteText).toBe('A newer thing.');
    expect(entries[0].mergedAt).toBeInstanceOf(Date);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('serves the stale copy when a refresh fails, rather than an error', async () => {
    const stale = {
      fetchedAt: Date.now() - 60 * 60 * 1000,
      entries: [
        {
          id: 'abc',
          repo: 'ally-be',
          releaseNoteText: 'From the cache.',
          mergedAt: '2026-09-15T08:19:30.000Z',
        },
      ],
    };
    redis.get.mockResolvedValue(JSON.stringify(stale));
    mockedAxios.get.mockRejectedValue(new Error('GitHub is down'));

    const entries = await service.getEntries();

    expect(entries.map((e) => e.releaseNoteText)).toEqual(['From the cache.']);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('answers 503 when it can neither fetch nor fall back', async () => {
    mockedAxios.get.mockRejectedValue(new Error('GitHub is down'));

    await expect(service.getEntries()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  // The 503 is all CloudWatch used to hold, which made a token problem,
  // an outage and a format change look identical from production.
  it('logs the underlying cause on the branch that answers 503', async () => {
    mockedAxios.get.mockRejectedValue(new Error('GitHub is down'));

    await expect(service.getEntries()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('GitHub is down'),
      expect.anything(),
    );
  });

  it('names the token and the repo when GitHub answers 404', async () => {
    mockedAxios.get.mockRejectedValue({ response: { status: 404 } });

    await expect(service.getEntries()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    const [logged] = mockLogger.error.mock.calls[0];
    // A private repo 404s for a token that cannot see it, so the message has
    // to point at the token rather than at a missing file.
    expect(logged).toContain('Contents: read');
    expect(logged).toContain('HelloAllyTech/ally-changelog');
  });

  it('calls a rejected token what it is rather than a missing file', async () => {
    mockedAxios.get.mockRejectedValue({ response: { status: 403 } });

    await expect(service.getEntries()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('rejected, expired or rate-limited'),
      expect.anything(),
    );
  });

  it('refuses a parse of zero entries instead of publishing an empty feed', async () => {
    mockedAxios.get.mockResolvedValue({ data: '# Ally Changelog\n' });

    await expect(service.getEntries()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('refuses to call GitHub with no token', async () => {
    await build('');

    await expect(service.getEntries()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  // Otherwise the first sign is a generic error on a public page, which
  // points nowhere near a missing environment variable.
  it('warns at boot when no token is configured', async () => {
    await build('');

    service.onModuleInit();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('GITHUB_CHANGELOG_TOKEN'),
    );
  });

  it('stays quiet at boot when a token is configured', async () => {
    service.onModuleInit();

    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('shares one refresh across concurrent requests', async () => {
    mockedAxios.get.mockResolvedValue({ data: MARKDOWN });

    await Promise.all([
      service.getEntries(),
      service.getEntries(),
      service.getEntries(),
    ]);

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});
