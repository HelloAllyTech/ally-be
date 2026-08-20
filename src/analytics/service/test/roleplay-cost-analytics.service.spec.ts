import { Test, TestingModule } from '@nestjs/testing';

import { RoleplayCostAnalyticsService } from '../roleplay-cost-analytics.service';
import { LlmTask } from '../../../learn/enum/llm-task.enum';
import { HighlightsAnalyticsRepository } from '../../repository/highlights-analytics.repository';
import {
  COST_PER_MINUTES,
  CostUsageRow,
  RoleplayCostAnalyticsRepository,
} from '../../repository/roleplay-cost-analytics.repository';

const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');

/**
 * A priced LLM row. gpt-4o-mini is $0.15/1M in, $0.60/1M out, so 1M prompt
 * tokens is exactly $0.15 — a round number to assert against.
 */
const llmRow = (overrides: Partial<CostUsageRow> = {}): CostUsageRow => ({
  bucket: '2024-05-01',
  task: LlmTask.AGENT_TURN,
  service: 'llm',
  provider: 'openai',
  model: 'gpt-4o-mini',
  promptTokens: 1_000_000,
  completionTokens: 0,
  audioMs: 0,
  characters: 0,
  calls: 10,
  ...overrides,
});

describe('RoleplayCostAnalyticsService', () => {
  let service: RoleplayCostAnalyticsService;

  const setup = async (
    usageRows: CostUsageRow[] = [],
    practiceRows: {
      bucket: string;
      minutes: number;
      activeLearners: number;
    }[] = [],
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleplayCostAnalyticsService,
        {
          provide: RoleplayCostAnalyticsRepository,
          useValue: {
            getUsageByBucketAndTask: jest.fn().mockResolvedValue(usageRows),
            getDataFloor: jest
              .fn()
              .mockResolvedValue(new Date('2024-01-01T00:00:00.000Z')),
          },
        },
        {
          provide: HighlightsAnalyticsRepository,
          useValue: {
            getPracticeMinutesByBucket: jest
              .fn()
              .mockResolvedValue(practiceRows),
          },
        },
      ],
    }).compile();

    service = module.get(RoleplayCostAnalyticsService);
  };

  const monthly = () =>
    service.getRoleplayCost({ range: '12m', bucket: 'month' });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('quotes the unit cost per 10 minutes of practice', async () => {
    await setup(
      [llmRow()],
      [{ bucket: '2024-05-01', minutes: 100, activeLearners: 3 }],
    );
    const result = await monthly();
    const may = result.points.find((p) => p.bucket === '2024-05-01');

    expect(result.perMinutes).toBe(COST_PER_MINUTES);
    expect(may?.attributableCostUsd).toBeCloseTo(0.15, 4);
    // $0.15 over 100 minutes = $0.015 per 10 minutes.
    expect(may?.costPer10MinUsd).toBeCloseTo(0.015, 4);
  });

  it('excludes spend a learner did not cause, and reports it separately', async () => {
    await setup(
      [
        llmRow({ task: LlmTask.AGENT_TURN }),
        llmRow({ task: LlmTask.DRIFT_JUDGE }),
        llmRow({ task: LlmTask.AUTOFILL_FIELD }),
      ],
      [{ bucket: '2024-05-01', minutes: 100, activeLearners: 3 }],
    );
    const result = await monthly();
    const may = result.points.find((p) => p.bucket === '2024-05-01');

    // Only the agent turn is attributable; the judge and the authoring call are
    // real money but would make practice look more expensive in a week when
    // nobody practised.
    expect(may?.attributableCostUsd).toBeCloseTo(0.15, 4);
    expect(may?.excludedCostUsd).toBeCloseTo(0.3, 4);
    expect(may?.costPer10MinUsd).toBeCloseTo(0.015, 4);
  });

  it('splits attributable spend by area and by service', async () => {
    await setup(
      [
        llmRow({ task: LlmTask.AGENT_TURN }),
        llmRow({ task: LlmTask.SCENARIO_EVALUATION }),
        llmRow({ task: LlmTask.TRACK_QUIZ_GRADING }),
        // 60,000 ms of Deepgram STT at $0.0077/min = $0.0077.
        llmRow({
          task: LlmTask.AGENT_STT,
          service: 'stt',
          provider: 'deepgram',
          promptTokens: 0,
          audioMs: 60_000,
        }),
      ],
      [{ bucket: '2024-05-01', minutes: 100, activeLearners: 3 }],
    );
    const result = await monthly();
    const breakdown = result.points.find(
      (p) => p.bucket === '2024-05-01',
    )?.breakdown;

    expect(breakdown?.roleplay).toBeCloseTo(0.15 + 0.0077, 4);
    expect(breakdown?.feedback).toBeCloseTo(0.15, 4);
    expect(breakdown?.quiz).toBeCloseTo(0.15, 4);
    expect(breakdown?.llm).toBeCloseTo(0.45, 4);
    expect(breakdown?.stt).toBeCloseTo(0.0077, 4);
    expect(breakdown?.tts).toBe(0);

    // The two splits are two views of one total, so they must agree.
    const byArea =
      (breakdown?.roleplay ?? 0) +
      (breakdown?.feedback ?? 0) +
      (breakdown?.quiz ?? 0);
    const byService =
      (breakdown?.llm ?? 0) + (breakdown?.stt ?? 0) + (breakdown?.tts ?? 0);
    expect(byArea).toBeCloseTo(byService, 4);
  });

  it('nulls the ratio in a bucket with no practice but keeps cost at zero', async () => {
    await setup([], []);
    const result = await monthly();
    const point = result.points[0];

    expect(point.attributableCostUsd).toBe(0);
    expect(point.practiceMinutes).toBe(0);
    // A ratio with no denominator is not a cost of zero.
    expect(point.costPer10MinUsd).toBeNull();
    expect(result.overallCostPer10MinUsd).toBeNull();
  });

  it('counts unpriced attributable calls so the total can be shown as partial', async () => {
    await setup(
      [
        llmRow({ model: 'some-unreleased-model', calls: 7 }),
        // An unpriced EXCLUDED call understates a figure this chart never
        // reports, so it must not raise the attributable warning.
        llmRow({
          task: LlmTask.DRIFT_JUDGE,
          model: 'another-unknown',
          calls: 99,
        }),
      ],
      [{ bucket: '2024-05-01', minutes: 100, activeLearners: 3 }],
    );
    const result = await monthly();
    const may = result.points.find((p) => p.bucket === '2024-05-01');

    expect(may?.unpricedCalls).toBe(7);
    expect(may?.attributableCostUsd).toBe(0);
    expect(result.totalUnpricedCalls).toBe(7);
  });

  it('keeps enough precision that a sub-cent unit cost is not reported as zero', async () => {
    await setup(
      // $0.15 of spend over 30,000 practice minutes: $0.00005 per ten minutes,
      // which is exactly 0 at four decimal places. Caught against real data,
      // where the headline read "$0" while money was being spent.
      [llmRow()],
      [{ bucket: '2024-05-01', minutes: 30_000, activeLearners: 40 }],
    );
    const result = await monthly();
    const may = result.points.find((p) => p.bucket === '2024-05-01');

    expect(may?.costPer10MinUsd).toBeCloseTo(0.00005, 6);
    expect(may?.costPer10MinUsd).not.toBe(0);
    expect(result.overallCostPer10MinUsd).toBeCloseTo(0.00005, 6);
    expect(result.overallCostPer10MinUsd).not.toBe(0);
  });

  it('takes the overall ratio from totals, not by averaging bucket ratios', async () => {
    await setup(
      [llmRow({ bucket: '2024-04-01' }), llmRow({ bucket: '2024-05-01' })],
      [
        // A busy month and a quiet one. Averaging the two per-bucket ratios
        // would weight them equally and land on ~0.0825/10min.
        { bucket: '2024-04-01', minutes: 900, activeLearners: 9 },
        { bucket: '2024-05-01', minutes: 100, activeLearners: 2 },
      ],
    );
    const result = await monthly();

    // $0.30 over 1,000 minutes = $0.003 per 10 minutes.
    expect(result.overallCostPer10MinUsd).toBeCloseTo(0.003, 4);
    expect(result.totalAttributableCostUsd).toBeCloseTo(0.3, 4);
    expect(result.totalPracticeMinutes).toBe(1000);
  });

  it('stays platform-wide and says which sections did', async () => {
    await setup([], []);
    const result = await monthly();

    expect(result.scoping.tenantId).toBeNull();
    expect(result.scoping.unscopedSections).toContain('points');
    expect(result.estimateNote).toMatch(/not a billed amount/i);
  });
});
