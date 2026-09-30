import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';

import { AppConfigService } from 'src/config/config.service';
import { RedisService } from 'src/redis/service/redis.service';

import {
  CODE_ACTIVITY_MAX_PAGES_PER_MONTH,
  CODE_ACTIVITY_REPOS,
} from '../../constants/code-activity.constants';
import {
  CodeActivityService,
  MonthBlock,
  isFresh,
  monthBounds,
} from '../code-activity.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockLogger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock('src/logger/logger.service', () => ({
  LoggerService: { getInstance: jest.fn(() => mockLogger) },
}));

const NOW = new Date('2026-09-30T12:00:00Z');
const MINUTE = 60 * 1000;

const commit = (
  committedDate: string,
  additions: number,
  deletions: number,
  parents = 1,
) => ({
  committedDate,
  additions,
  deletions,
  parents: { totalCount: parents },
});

const page = (nodes: ReturnType<typeof commit>[], next?: string) => ({
  data: {
    data: {
      repository: {
        defaultBranchRef: {
          target: {
            history: {
              pageInfo: { hasNextPage: Boolean(next), endCursor: next ?? null },
              nodes,
            },
          },
        },
      },
    },
  },
});

type Vars = {
  name: string;
  since: string;
  until: string;
  after: string | null;
};
const varsOf = (call: unknown[]): Vars =>
  (call[1] as { variables: Vars }).variables;

/** Routes each GraphQL call to a per-repo responder; unlisted repos are empty. */
const respond = (byRepo: Record<string, (vars: Vars) => unknown>): void => {
  mockedAxios.post.mockImplementation(async (_url, body) => {
    const vars = (body as { variables: Vars }).variables;
    const handler = byRepo[vars.name];
    return handler ? handler(vars) : page([]);
  });
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('CodeActivityService', () => {
  let service: CodeActivityService;
  let redis: { get: jest.Mock; set: jest.Mock };

  const build = async (token = 'gh-token') => {
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodeActivityService,
        {
          provide: AppConfigService,
          useValue: { githubToken: token, githubOrg: 'HelloAllyTech' },
        },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    service = module.get(CodeActivityService);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockedAxios.post.mockReset();
    await build();
    jest
      .useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
      .setSystemTime(NOW);
  });

  afterEach(() => jest.useRealTimers());

  it('sums every repo per UTC day on a dense 30-day axis, skipping merge commits', async () => {
    respond({
      'ally-be': () =>
        page([
          commit('2026-09-30T08:00:00Z', 7, 3),
          commit('2026-09-15T10:00:00Z', 100, 20),
          // A merge commit's diff is its branch's commits again.
          commit('2026-09-15T11:00:00Z', 5000, 5000, 2),
          // +05:30 offset: 20:30 UTC on the 15th, not the 16th.
          commit('2026-09-16T02:00:00+05:30', 1000, 0),
        ]),
      'ally-web': () => page([commit('2026-09-15T12:00:00Z', 1, 1)]),
    });

    const result = await service.getActivity();

    expect(result.from).toBe('2026-09-01');
    expect(result.until).toBe('2026-09-30');
    expect(result.today).toBe('2026-09-30');
    expect(result.days).toHaveLength(30);
    expect(result.days.find((d) => d.date === '2026-09-15')).toEqual({
      date: '2026-09-15',
      added: 1101,
      deleted: 21,
      churn: 1122,
      partial: false,
    });
    expect(result.days.find((d) => d.date === '2026-09-16')?.churn).toBe(0);
    expect(result.days[29]).toEqual({
      date: '2026-09-30',
      added: 7,
      deleted: 3,
      churn: 10,
      partial: true,
    });
    expect(result.hasOlder).toBe(true);
    expect(result.incomplete).toBe(false);
    // One month, every repo in the ship-volume population, once each.
    expect(mockedAxios.post).toHaveBeenCalledTimes(CODE_ACTIVITY_REPOS.length);
  });

  it('follows the history cursor to the end of the month', async () => {
    respond({
      'ally-be': (vars) =>
        vars.after === 'cursor-1'
          ? page([commit('2026-09-02T10:00:00Z', 5, 0)])
          : page([commit('2026-09-20T10:00:00Z', 1, 0)], 'cursor-1'),
    });

    const result = await service.getActivity();

    const beCalls = mockedAxios.post.mock.calls
      .map(varsOf)
      .filter((v) => v.name === 'ally-be');
    expect(beCalls.map((v) => v.after)).toEqual([null, 'cursor-1']);
    expect(result.days.find((d) => d.date === '2026-09-02')?.added).toBe(5);
    expect(result.days.find((d) => d.date === '2026-09-20')?.added).toBe(1);
  });

  it('reads each month a window touches, bounded to that month', async () => {
    const result = await service.getActivity({ until: '2026-09-05', days: 10 });

    expect(result.from).toBe('2026-08-27');
    expect(result.days).toHaveLength(10);
    const windows = new Set(
      mockedAxios.post.mock.calls
        .map(varsOf)
        .map((v) => `${v.since}|${v.until}`),
    );
    expect(windows).toEqual(
      new Set([
        '2026-08-01T00:00:00Z|2026-08-31T23:59:59Z',
        '2026-09-01T00:00:00Z|2026-09-30T23:59:59Z',
      ]),
    );
  });

  it('caches each repo-month without a TTL', async () => {
    respond({ 'ally-be': () => page([commit('2026-09-15T10:00:00Z', 4, 2)]) });

    await service.getActivity();

    const call = redis.set.mock.calls.find(
      ([key]) => key === 'changelog:code-activity:v1:ally-be:2026-09',
    );
    expect(call).toHaveLength(2);
    expect(JSON.parse(call![1])).toEqual({
      fetchedAt: NOW.getTime(),
      days: { '2026-09-15': [4, 2] },
    });
  });

  it('serves a fresh cached month without calling GitHub', async () => {
    const block: MonthBlock = {
      fetchedAt: NOW.getTime() - MINUTE,
      days: { '2026-09-10': [30, 10] },
    };
    redis.get.mockResolvedValue(JSON.stringify(block));

    const result = await service.getActivity();

    expect(mockedAxios.post).not.toHaveBeenCalled();
    // Every repo returned the same block, so seven times over.
    expect(result.days.find((d) => d.date === '2026-09-10')?.churn).toBe(
      40 * CODE_ACTIVITY_REPOS.length,
    );
  });

  it('answers from a stale month at once and refreshes it behind the response', async () => {
    const stale: MonthBlock = {
      fetchedAt: NOW.getTime() - 11 * MINUTE,
      days: { '2026-09-10': [1, 0] },
    };
    redis.get.mockResolvedValue(JSON.stringify(stale));
    respond({ 'ally-be': () => page([commit('2026-09-10T10:00:00Z', 9, 0)]) });

    const result = await service.getActivity();

    expect(result.days.find((d) => d.date === '2026-09-10')?.added).toBe(
      CODE_ACTIVITY_REPOS.length,
    );
    await flush();
    expect(mockedAxios.post).toHaveBeenCalledTimes(CODE_ACTIVITY_REPOS.length);
    const refreshed = redis.set.mock.calls.find(
      ([key]) => key === 'changelog:code-activity:v1:ally-be:2026-09',
    );
    expect(JSON.parse(refreshed![1]).days).toEqual({ '2026-09-10': [9, 0] });
  });

  it('flags the response incomplete when a repo can be neither read nor recovered', async () => {
    respond({
      'ally-be': () => page([commit('2026-09-15T10:00:00Z', 10, 0)]),
      'ally-mobile': () => {
        throw Object.assign(new Error('boom'), { response: { status: 502 } });
      },
    });

    const result = await service.getActivity();

    expect(result.incomplete).toBe(true);
    expect(result.days.find((d) => d.date === '2026-09-15')?.added).toBe(10);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('ally-mobile'),
    );
  });

  it('treats a GraphQL error body, or a repository the token cannot see, as a failure', async () => {
    respond({
      'ally-be': () => ({
        data: { errors: [{ message: 'Something went wrong' }] },
      }),
      infra: () => ({ data: { data: { repository: null } } }),
    });

    const result = await service.getActivity();

    expect(result.incomplete).toBe(true);
    const logged = mockLogger.error.mock.calls.map(([m]) => m).join('\n');
    expect(logged).toContain('Something went wrong');
    expect(logged).toContain('HelloAllyTech/infra');
    expect(redis.set).not.toHaveBeenCalledWith(
      'changelog:code-activity:v1:ally-be:2026-09',
      expect.anything(),
    );
  });

  it('refuses a month whose history never ends rather than caching it truncated', async () => {
    respond({
      'ally-be': () => page([commit('2026-09-15T10:00:00Z', 1, 0)], 'more'),
    });

    const result = await service.getActivity();

    const beCalls = mockedAxios.post.mock.calls
      .map(varsOf)
      .filter((v) => v.name === 'ally-be');
    expect(beCalls).toHaveLength(CODE_ACTIVITY_MAX_PAGES_PER_MONTH);
    expect(result.incomplete).toBe(true);
    expect(redis.set).not.toHaveBeenCalledWith(
      'changelog:code-activity:v1:ally-be:2026-09',
      expect.anything(),
    );
  });

  it('shares one fetch between concurrent readers of the same month', async () => {
    await Promise.all([service.getActivity(), service.getActivity()]);

    expect(mockedAxios.post).toHaveBeenCalledTimes(CODE_ACTIVITY_REPOS.length);
  });

  it('with no token, calls nothing and says the totals are incomplete', async () => {
    await build('');

    const result = await service.getActivity();

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(result.incomplete).toBe(true);
    expect(result.days.every((d) => d.churn === 0)).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });

  describe('window clamping', () => {
    it('clamps a future `until` to today and an oversized window to 92 days', async () => {
      const result = await service.getActivity({
        until: '2030-01-01',
        days: 1000,
      });

      expect(result.until).toBe('2026-09-30');
      expect(result.days).toHaveLength(92);
    });

    it('stops at the first commit and reports nothing older', async () => {
      const result = await service.getActivity({
        until: '2025-04-30',
        days: 30,
      });

      expect(result.from).toBe('2025-04-23');
      expect(result.days).toHaveLength(8);
      expect(result.hasOlder).toBe(false);
    });

    it('treats a date that does not exist as today', async () => {
      const result = await service.getActivity({
        until: '2026-02-31',
        days: 1,
      });

      expect(result.until).toBe('2026-09-30');
    });
  });

  describe('isFresh', () => {
    const at = (iso: string) => Date.parse(iso);

    it('keeps the month in progress for ten minutes', () => {
      const block = { fetchedAt: at('2026-09-30T12:00:00Z'), days: {} };
      expect(isFresh(block, '2026-09', at('2026-09-30T12:09:00Z'))).toBe(true);
      expect(isFresh(block, '2026-09', at('2026-09-30T12:11:00Z'))).toBe(false);
    });

    it('re-reads a recently closed month every six hours', () => {
      const block = { fetchedAt: at('2026-10-02T00:00:00Z'), days: {} };
      expect(isFresh(block, '2026-09', at('2026-10-02T05:00:00Z'))).toBe(true);
      expect(isFresh(block, '2026-09', at('2026-10-02T07:00:00Z'))).toBe(false);
    });

    it('never re-reads a month once it was read after settling', () => {
      const block = { fetchedAt: at('2026-11-20T00:00:00Z'), days: {} };
      expect(isFresh(block, '2026-09', at('2027-06-01T00:00:00Z'))).toBe(true);
    });

    it('re-reads a block fetched mid-month once the month has settled', () => {
      const block = { fetchedAt: at('2026-09-20T00:00:00Z'), days: {} };
      expect(isFresh(block, '2026-09', at('2027-01-01T00:00:00Z'))).toBe(false);
    });
  });

  it('bounds a month for GraphQL, inclusive at both ends', () => {
    expect(monthBounds('2026-02')).toEqual({
      since: '2026-02-01T00:00:00Z',
      until: '2026-02-28T23:59:59Z',
    });
    expect(monthBounds('2026-12')).toEqual({
      since: '2026-12-01T00:00:00Z',
      until: '2026-12-31T23:59:59Z',
    });
  });
});
