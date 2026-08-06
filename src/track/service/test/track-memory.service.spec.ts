import { TrackMemoryService } from '../track-memory.service';

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

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: (...args: any[]) => mockCreate(...args) },
  })),
}));

describe('TrackMemoryService', () => {
  const configService = {
    anthropic: { apiKey: 'test-key', autofillModel: 'claude-test' },
  };
  const promptSharedService = {
    getPromptByCode: jest
      .fn()
      .mockResolvedValue('Fold these:\n{{sessionMemories}}'),
  };
  const llmUsage = { record: jest.fn() };
  const trackEnrollmentRepository = { findOne: jest.fn(), update: jest.fn() };
  const trackItemProgressRepository = { findOne: jest.fn() };
  const trackItemRepository = { find: jest.fn() };
  const trackSectionRepository = { find: jest.fn() };

  const service = new TrackMemoryService(
    configService as any,
    promptSharedService as any,
    llmUsage as any,
    trackEnrollmentRepository as any,
    trackItemProgressRepository as any,
    trackItemRepository as any,
    trackSectionRepository as any,
  );

  const progress = {
    id: 'tip-2',
    trackItemId: 'item-2',
    trackEnrollmentId: 'enr-1',
  };
  const track = {
    sections: [{ id: 's1', order: 1 }],
    items: [
      { id: 'item-1', trackSectionId: 's1', order: 1 },
      { id: 'item-2', trackSectionId: 's1', order: 2 },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    trackItemProgressRepository.findOne.mockResolvedValue(progress);
    trackSectionRepository.find.mockResolvedValue(track.sections);
    trackItemRepository.find.mockResolvedValue(track.items);
    promptSharedService.getPromptByCode.mockResolvedValue(
      'Fold these:\n{{sessionMemories}}',
    );
  });

  it('first fold stores the item entry and uses the memory verbatim (no LLM)', async () => {
    trackEnrollmentRepository.findOne.mockResolvedValue({
      id: 'enr-1',
      trackId: 't1',
      memory: null,
    });

    await service.foldSessionMemory({
      trackItemProgressId: 'tip-2',
      scenarioSessionId: 'sess-1',
      summary: 'first session memory',
    });

    expect(mockCreate).not.toHaveBeenCalled();
    const [, patch] = trackEnrollmentRepository.update.mock.calls[0];
    expect(patch.memory.summary).toBe('first session memory');
    expect(patch.memory.items['item-2'].sessionId).toBe('sess-1');
  });

  it('multi-item fold merges via the LLM in track order and records usage', async () => {
    trackEnrollmentRepository.findOne.mockResolvedValue({
      id: 'enr-1',
      trackId: 't1',
      memory: {
        items: {
          'item-1': {
            sessionId: 'sess-0',
            summary: 'memory of item one',
            updatedAt: 'x',
          },
        },
      },
    });
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'consolidated memory' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await service.foldSessionMemory({
      trackItemProgressId: 'tip-2',
      scenarioSessionId: 'sess-1',
      summary: 'memory of item two',
    });

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt.indexOf('memory of item one')).toBeLessThan(
      prompt.indexOf('memory of item two'),
    );
    expect(llmUsage.record).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'track_memory_fold', totalTokens: 150 }),
    );
    const [, patch] = trackEnrollmentRepository.update.mock.calls[0];
    expect(patch.memory.summary).toBe('consolidated memory');
    expect(Object.keys(patch.memory.items)).toHaveLength(2);
  });

  it('falls back to a deterministic join when the LLM fails', async () => {
    trackEnrollmentRepository.findOne.mockResolvedValue({
      id: 'enr-1',
      trackId: 't1',
      memory: {
        items: {
          'item-1': {
            sessionId: 's0',
            summary: 'older memory',
            updatedAt: 'x',
          },
        },
      },
    });
    mockCreate.mockRejectedValue(new Error('llm down'));

    await service.foldSessionMemory({
      trackItemProgressId: 'tip-2',
      scenarioSessionId: 'sess-1',
      summary: 'newer memory',
    });

    const [, patch] = trackEnrollmentRepository.update.mock.calls[0];
    expect(patch.memory.summary).toContain('older memory');
    expect(patch.memory.summary).toContain('newer memory');
  });

  it('a replay replaces its own item entry instead of double-counting', async () => {
    trackEnrollmentRepository.findOne.mockResolvedValue({
      id: 'enr-1',
      trackId: 't1',
      memory: {
        items: {
          'item-2': {
            sessionId: 'sess-old',
            summary: 'old attempt',
            updatedAt: 'x',
          },
        },
      },
    });

    await service.foldSessionMemory({
      trackItemProgressId: 'tip-2',
      scenarioSessionId: 'sess-new',
      summary: 'new attempt',
    });

    expect(mockCreate).not.toHaveBeenCalled(); // still a single item
    const [, patch] = trackEnrollmentRepository.update.mock.calls[0];
    expect(patch.memory.items['item-2'].sessionId).toBe('sess-new');
    expect(patch.memory.summary).toBe('new attempt');
  });

  it('never throws: missing progress or enrollment is a silent no-op', async () => {
    trackItemProgressRepository.findOne.mockResolvedValue(null);
    await expect(
      service.foldSessionMemory({
        trackItemProgressId: 'missing',
        scenarioSessionId: 's',
        summary: 'm',
      }),
    ).resolves.toBeUndefined();
    expect(trackEnrollmentRepository.update).not.toHaveBeenCalled();
  });

  describe('getConsolidatedMemory', () => {
    it('returns the stored summary', async () => {
      trackEnrollmentRepository.findOne.mockResolvedValue({
        id: 'enr-1',
        memory: { summary: ' the fold ', items: {} },
      });
      await expect(service.getConsolidatedMemory('tip-2')).resolves.toBe(
        'the fold',
      );
    });

    it('returns null when absent', async () => {
      trackEnrollmentRepository.findOne.mockResolvedValue({
        id: 'enr-1',
        memory: null,
      });
      await expect(service.getConsolidatedMemory('tip-2')).resolves.toBeNull();
    });
  });
});
