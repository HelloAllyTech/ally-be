import { Test, TestingModule } from '@nestjs/testing';
import { TrackDropoffAnalyticsService } from '../track-dropoff-analytics.service';
import {
  MIN_TRACK_GROUP_SIZE,
  TrackDropoffAnalyticsRepository,
  TrackDropoffItemTypeRow,
  TrackDropoffSectionRow,
  TrackDropoffSummaryRow,
} from '../../repository/track-dropoff-analytics.repository';
import { TrackItemType } from '../../../track/type/track.type';

const emptySummary: TrackDropoffSummaryRow = {
  enrollments: 0,
  learners: 0,
  itemsTracked: 0,
  completedEnrollments: 0,
};

describe('TrackDropoffAnalyticsService', () => {
  let service: TrackDropoffAnalyticsService;
  let repository: jest.Mocked<TrackDropoffAnalyticsRepository>;

  const setup = async (opts?: {
    itemTypes?: TrackDropoffItemTypeRow[];
    sections?: TrackDropoffSectionRow[];
    summary?: TrackDropoffSummaryRow;
  }) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackDropoffAnalyticsService,
        {
          provide: TrackDropoffAnalyticsRepository,
          useValue: {
            getItemTypeProgress: jest
              .fn()
              .mockResolvedValue(opts?.itemTypes ?? []),
            getSectionProgress: jest
              .fn()
              .mockResolvedValue(opts?.sections ?? []),
            getSummary: jest
              .fn()
              .mockResolvedValue(opts?.summary ?? emptySummary),
          },
        },
      ],
    }).compile();

    service = module.get(TrackDropoffAnalyticsService);
    repository = module.get(TrackDropoffAnalyticsRepository);
  };

  afterEach(() => jest.clearAllMocks());

  it('returns every item format, in enum declaration order, even with no data', async () => {
    await setup();

    const result = await service.getTrackDropoff({});

    // An ordered category list keeps its order AND its members between requests,
    // or the legend colours move under the reader.
    expect(result.itemTypes.map((t) => t.type)).toEqual([
      TrackItemType.ROLEPLAY,
      TrackItemType.CASE,
      TrackItemType.QUIZ,
      TrackItemType.ARTICLE,
      TrackItemType.VIDEO,
      TrackItemType.JOURNAL,
    ]);
    expect(result.minGroupSize).toBe(MIN_TRACK_GROUP_SIZE);
    expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
  });

  it('keeps the enum order even when the repository ranks formats by volume', async () => {
    await setup({
      itemTypes: [
        { type: TrackItemType.VIDEO, reached: 90, completed: 80, learners: 40 },
        { type: TrackItemType.QUIZ, reached: 60, completed: 15, learners: 30 },
        {
          type: TrackItemType.ROLEPLAY,
          reached: 20,
          completed: 10,
          learners: 12,
        },
      ],
    });

    const result = await service.getTrackDropoff({});

    expect(result.itemTypes.map((t) => t.type)).toEqual(
      Object.values(TrackItemType),
    );
    const quiz = result.itemTypes.find((t) => t.type === TrackItemType.QUIZ)!;
    expect(quiz.reached).toBe(60);
    expect(quiz.completed).toBe(15);
    expect(quiz.completionRatePct).toBe(25);
  });

  it('leaves the completion rate NULL over a zero denominator, not 0%', async () => {
    await setup({
      itemTypes: [
        // Nobody has unlocked a journal yet: reached = 0, so the rate is
        // undefined. Drawing it as 0% would report an unopened format as the
        // most abandoned one on the chart.
        { type: TrackItemType.JOURNAL, reached: 0, completed: 0, learners: 0 },
      ],
    });

    const result = await service.getTrackDropoff({});

    const journal = result.itemTypes.find(
      (t) => t.type === TrackItemType.JOURNAL,
    )!;
    expect(journal.reached).toBe(0);
    expect(journal.completionRatePct).toBeNull();
    // Formats with no progress at all are also below the floor, by definition.
    expect(journal.belowFloor).toBe(true);
  });

  it('suppresses the rate below the group-size floor but keeps the row and its counts', async () => {
    await setup({
      itemTypes: [
        {
          type: TrackItemType.CASE,
          reached: 4,
          completed: 0,
          learners: MIN_TRACK_GROUP_SIZE - 1,
        },
        {
          type: TrackItemType.ARTICLE,
          reached: 10,
          completed: 7,
          learners: MIN_TRACK_GROUP_SIZE,
        },
      ],
    });

    const result = await service.getTrackDropoff({});

    const below = result.itemTypes.find((t) => t.type === TrackItemType.CASE)!;
    // The row survives: dropping it would understate the totals and hide the
    // tail this chart exists to show.
    expect(below.belowFloor).toBe(true);
    expect(below.reached).toBe(4);
    expect(below.completed).toBe(0);
    expect(below.learners).toBe(MIN_TRACK_GROUP_SIZE - 1);
    // "0% of cases completed" over four learners is a statement about four people.
    expect(below.completionRatePct).toBeNull();

    const atFloor = result.itemTypes.find(
      (t) => t.type === TrackItemType.ARTICLE,
    )!;
    expect(atFloor.belowFloor).toBe(false);
    expect(atFloor.completionRatePct).toBe(70);
  });

  it('carries sections through in repository order and applies the same floor', async () => {
    await setup({
      sections: [
        {
          trackId: 't1',
          trackTitle: 'Crisis basics',
          sectionId: 's1',
          sectionTitle: 'Foundations',
          order: 1,
          reached: 40,
          completed: 30,
          learners: 20,
        },
        {
          trackId: 't1',
          trackTitle: 'Crisis basics',
          sectionId: 's2',
          sectionTitle: 'Escalation',
          order: 2,
          reached: 6,
          completed: 1,
          learners: 3,
        },
      ],
    });

    const result = await service.getTrackDropoff({});

    // The curriculum's own sequence is the only axis a drop-off is visible along,
    // so the service must not re-sort by rate.
    expect(result.sections.map((s) => s.sectionId)).toEqual(['s1', 's2']);
    expect(result.sections[0].completionRatePct).toBe(75);
    expect(result.sections[1].belowFloor).toBe(true);
    expect(result.sections[1].reached).toBe(6);
    expect(result.sections[1].completionRatePct).toBeNull();
    // The per-section learner count is deliberately not part of the contract.
    expect(result.sections[1]).not.toHaveProperty('learners');
  });

  it('passes the summary straight through', async () => {
    await setup({
      summary: {
        enrollments: 120,
        learners: 85,
        itemsTracked: 46,
        completedEnrollments: 31,
      },
    });

    const result = await service.getTrackDropoff({});

    expect(result.summary).toEqual({
      enrollments: 120,
      learners: 85,
      itemsTracked: 46,
      completedEnrollments: 31,
    });
  });

  it('passes a trimmed tenant filter to every query and echoes it in the scoping', async () => {
    await setup();

    const result = await service.getTrackDropoff({ tenantId: '  ally  ' });

    expect(repository.getItemTypeProgress).toHaveBeenCalledWith('ally');
    expect(repository.getSectionProgress).toHaveBeenCalledWith('ally');
    expect(repository.getSummary).toHaveBeenCalledWith('ally');
    expect(result.scoping).toEqual({ tenantId: 'ally', unscopedSections: [] });
  });

  it('treats a blank tenant filter as no filter', async () => {
    await setup();

    await service.getTrackDropoff({ tenantId: '   ' });

    expect(repository.getItemTypeProgress).toHaveBeenCalledWith(undefined);
  });
});
