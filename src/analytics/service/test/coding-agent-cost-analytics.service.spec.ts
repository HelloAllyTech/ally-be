import { Test, TestingModule } from '@nestjs/testing';

import { CodingAgentCostAnalyticsService } from '../coding-agent-cost-analytics.service';
import { LlmTask } from '../../../learn/enum/llm-task.enum';
import {
  CodingAgentCostAnalyticsRepository,
  CodingAgentUsageRow,
} from '../../repository/coding-agent-cost-analytics.repository';

const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');

/** claude-sonnet-5 is $3/1M input, $15/1M output — 1M prompt tokens is exactly $3. */
const row = (
  overrides: Partial<CodingAgentUsageRow> = {},
): CodingAgentUsageRow => ({
  bucket: '2024-05-01',
  task: LlmTask.BUG_HUNTER,
  service: 'llm',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  promptTokens: 1_000_000,
  completionTokens: 0,
  totalTokens: 1_000_000,
  cachedTokens: 0,
  audioMs: 0,
  characters: 0,
  calls: 10,
  ...overrides,
});

describe('CodingAgentCostAnalyticsService', () => {
  let service: CodingAgentCostAnalyticsService;

  const setup = async (usageRows: CodingAgentUsageRow[] = []) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodingAgentCostAnalyticsService,
        {
          provide: CodingAgentCostAnalyticsRepository,
          useValue: {
            getUsageByBucketAndTask: jest.fn().mockResolvedValue(usageRows),
            getDataFloor: jest
              .fn()
              .mockResolvedValue(new Date('2024-01-01T00:00:00.000Z')),
          },
        },
      ],
    }).compile();

    service = module.get(CodingAgentCostAnalyticsService);
  };

  const monthly = () =>
    service.getCodingAgentCost({ range: '12m', bucket: 'month' });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('attributes a bug_hunter row to Bug Hunter and a builder_* row to Builder', async () => {
    await setup([
      row({ task: LlmTask.BUG_HUNTER, model: 'claude-sonnet-5' }),
      row({ task: LlmTask.BUILDER_BUILD, model: 'claude-opus-5' }),
    ]);
    const result = await monthly();
    const may = result.points.find((p) => p.bucket === '2024-05-01');

    expect(may?.costUsd['bug-hunter']).toBeCloseTo(3, 4);
    expect(may?.costUsd.builder).toBeCloseTo(5, 4);
  });

  it('does not discount cache out of runner rows, whose prompt is already net of it', async () => {
    // A Gemini sweep or build row comes from the CI runner's own report, where
    // inputTokens EXCLUDES the cache reads. Carving the cached share out of it
    // again would price real input at the cache rate.
    await setup([
      row({
        task: LlmTask.BUILDER_BUILD,
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        promptTokens: 1_000_000,
        totalTokens: 1_000_000,
        cachedTokens: 4_000_000,
      }),
      // An in-process Builder interview turn is vendor-reported, so its cached
      // tokens ARE inside the prompt and are priced at the cached rate.
      row({
        task: LlmTask.BUILDER_INTERVIEW,
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        promptTokens: 1_000_000,
        totalTokens: 1_000_000,
        cachedTokens: 1_000_000,
      }),
    ]);
    const result = await monthly();

    // $1.25 for the runner row at the full input rate + $0.31 all-cached.
    expect(result.totalCostUsd.builder).toBeCloseTo(1.25 + 0.31, 4);
  });

  it('gap-fills a bucket with no usage to real zeros rather than omitting it', async () => {
    await setup([row({ bucket: '2024-03-01' })]);
    const result = await monthly();
    const untouchedBucket = result.points.find(
      (p) => p.bucket === '2024-05-01',
    );

    expect(untouchedBucket).toBeDefined();
    expect(untouchedBucket?.costUsd).toEqual({ 'bug-hunter': 0, builder: 0 });
  });

  it('ignores a task neither agent owns, so it cannot silently inflate either total', async () => {
    await setup([row({ task: LlmTask.AGENT_TURN })]);
    const result = await monthly();

    expect(result.totalCostUsd).toEqual({ 'bug-hunter': 0, builder: 0 });
  });

  it('breaks spend down by model within each agent, sorted most expensive first', async () => {
    await setup([
      row({
        task: LlmTask.BUG_HUNTER,
        model: 'claude-haiku-4-5',
        promptTokens: 1_000_000,
      }),
      row({
        task: LlmTask.BUG_HUNTER,
        model: 'claude-opus-5',
        promptTokens: 1_000_000,
      }),
    ]);
    const result = await monthly();

    expect(result.modelBreakdown.map((m) => m.model)).toEqual([
      'claude-opus-5',
      'claude-haiku-4-5',
    ]);
    expect(result.modelBreakdown[0].agent).toBe('bug-hunter');
  });

  it('counts an unpriced model without fabricating a cost for it', async () => {
    await setup([row({ model: 'some-unpriced-model', calls: 4 })]);
    const result = await monthly();

    expect(result.totalCostUsd['bug-hunter']).toBe(0);
    expect(result.unpricedCalls).toBe(4);
    expect(result.modelBreakdown[0].priced).toBe(false);
  });
});
