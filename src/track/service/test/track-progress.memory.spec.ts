import { TrackProgressService } from '../track-progress.service';
import { TrackItemType } from '../../type/track.type';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    })),
  },
}));

describe('TrackProgressService.getPreviousMemoryCandidates', () => {
  const sectionRepo = { find: jest.fn() };
  const dataSource = { getRepository: jest.fn(() => sectionRepo) };
  const trackItemProgressRepository = { findOne: jest.fn(), find: jest.fn() };
  const trackItemRepository = { findOne: jest.fn(), find: jest.fn() };

  const service = new TrackProgressService(
    dataSource as any,
    {} as any,
    { emit: jest.fn() } as any,
    trackItemProgressRepository as any,
    trackItemRepository as any,
  );

  const item = (
    id: string,
    sectionId: string,
    order: number,
    type: TrackItemType,
  ) => ({ id, trackId: 't1', trackSectionId: sectionId, order, type });

  beforeEach(() => {
    jest.clearAllMocks();
    dataSource.getRepository.mockReturnValue(sectionRepo);
  });

  const arrange = ({
    items,
    progressRows,
    currentItemId,
  }: {
    items: any[];
    progressRows: any[];
    currentItemId: string;
  }) => {
    trackItemProgressRepository.findOne.mockResolvedValue({
      id: 'tip-current',
      trackItemId: currentItemId,
      trackEnrollmentId: 'enr-1',
    });
    trackItemRepository.findOne.mockResolvedValue(
      items.find((i) => i.id === currentItemId),
    );
    sectionRepo.find.mockResolvedValue([
      { id: 's1', order: 1 },
      { id: 's2', order: 2 },
    ]);
    trackItemRepository.find.mockResolvedValue(items);
    trackItemProgressRepository.find.mockResolvedValue(progressRows);
  };

  it('walks backwards over conversation items only, most recent first', async () => {
    arrange({
      items: [
        item('i-roleplay1', 's1', 1, TrackItemType.ROLEPLAY),
        item('i-quiz', 's1', 2, TrackItemType.QUIZ),
        item('i-case', 's1', 3, TrackItemType.CASE),
        item('i-article', 's2', 1, TrackItemType.ARTICLE),
        item('i-current', 's2', 2, TrackItemType.ROLEPLAY),
      ],
      progressRows: [
        { id: 'tip-r1', trackItemId: 'i-roleplay1' },
        { id: 'tip-quiz', trackItemId: 'i-quiz' },
        { id: 'tip-case', trackItemId: 'i-case', caseSessionId: 'cs-9' },
        { id: 'tip-current', trackItemId: 'i-current' },
      ],
      currentItemId: 'i-current',
    });

    await expect(
      service.getPreviousMemoryCandidates('tip-current'),
    ).resolves.toEqual([
      { caseSessionId: 'cs-9' },
      { trackItemProgressId: 'tip-r1' },
    ]);
  });

  it('skips CASE items whose progress has no caseSessionId and items without progress rows', async () => {
    arrange({
      items: [
        item('i-roleplay1', 's1', 1, TrackItemType.ROLEPLAY),
        item('i-case', 's1', 2, TrackItemType.CASE),
        item('i-roleplay2', 's1', 3, TrackItemType.ROLEPLAY),
        item('i-current', 's2', 1, TrackItemType.ROLEPLAY),
      ],
      progressRows: [
        // i-roleplay1 has no progress row at all
        { id: 'tip-case', trackItemId: 'i-case' }, // case never started
        { id: 'tip-r2', trackItemId: 'i-roleplay2' },
        { id: 'tip-current', trackItemId: 'i-current' },
      ],
      currentItemId: 'i-current',
    });

    await expect(
      service.getPreviousMemoryCandidates('tip-current'),
    ).resolves.toEqual([{ trackItemProgressId: 'tip-r2' }]);
  });

  it('returns [] for the first item of a track and for unknown progress rows', async () => {
    arrange({
      items: [
        item('i-current', 's1', 1, TrackItemType.ROLEPLAY),
        item('i-later', 's1', 2, TrackItemType.ROLEPLAY),
      ],
      progressRows: [{ id: 'tip-current', trackItemId: 'i-current' }],
      currentItemId: 'i-current',
    });
    await expect(
      service.getPreviousMemoryCandidates('tip-current'),
    ).resolves.toEqual([]);

    trackItemProgressRepository.findOne.mockResolvedValue(null);
    await expect(
      service.getPreviousMemoryCandidates('missing'),
    ).resolves.toEqual([]);
  });

  it('caps the candidate list', async () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      item(`i-${i}`, 's1', i + 1, TrackItemType.ROLEPLAY),
    ).concat([item('i-current', 's2', 1, TrackItemType.ROLEPLAY)]);
    arrange({
      items,
      progressRows: items.map((it) => ({
        id: `tip-${it.id}`,
        trackItemId: it.id,
      })),
      currentItemId: 'i-current',
    });

    const candidates = await service.getPreviousMemoryCandidates(
      'tip-i-current',
      3,
    );
    expect(candidates).toHaveLength(3);
    // Nearest preceding first.
    expect(candidates[0]).toEqual({ trackItemProgressId: 'tip-i-7' });
  });
});
