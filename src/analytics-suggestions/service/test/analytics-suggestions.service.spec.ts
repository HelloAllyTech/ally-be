import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { RoadmapOpportunityType } from 'src/product-roadmap/enum/roadmap-opportunity.enum';

import { AnalyticsSuggestionsService } from '../analytics-suggestions.service';
import { AnalyticsSuggestionStatus } from '../../enum/analytics-suggestion.enum';
import { MAX_SUGGESTIONS_PER_RUN } from '../../constants/analytics-suggestions.constants';
import { AnalyticsSuggestion } from '../../entity/analytics-suggestion.entity';

const WINDOW = {
  range: '30d',
  from: '2026-07-01',
  to: '2026-07-30',
  label: 'Last 30 days',
};

const rawSuggestion = (overrides: Record<string, unknown> = {}) => ({
  title: 'Learners stall after their first session',
  body: 'Most learners who complete one roleplay never start a second.',
  rationale: 'The activation funnel drops 70% between session one and two.',
  evidence: ['1,200 learners completed one session; 340 completed two'],
  suggestedGoal: 'Engagement & Usability',
  suggestedType: 'idea',
  ...overrides,
});

/** A stored row, as the repository would hand one back. */
const storedRow = (
  overrides: Partial<AnalyticsSuggestion> = {},
): AnalyticsSuggestion =>
  ({
    id: 'sug-1',
    batchId: 'batch-1',
    title: 'Learners stall after their first session',
    body: 'Most learners who complete one roleplay never start a second.',
    rationale: 'The activation funnel drops 70%.',
    evidence: ['1,200 vs 340'],
    suggestedGoal: 'Engagement & Usability',
    suggestedType: RoadmapOpportunityType.IDEA,
    status: AnalyticsSuggestionStatus.PENDING,
    rejectedReason: null,
    opportunityId: null,
    windowRange: WINDOW.range,
    windowFrom: WINDOW.from,
    windowTo: WINDOW.to,
    windowLabel: WINDOW.label,
    model: 'claude-test',
    createdBy: 7,
    updatedBy: 7,
    createdAt: new Date('2026-07-31T00:00:00.000Z'),
    updatedAt: new Date('2026-07-31T00:00:00.000Z'),
    ...overrides,
  }) as AnalyticsSuggestion;

describe('AnalyticsSuggestionsService', () => {
  let service: AnalyticsSuggestionsService;
  let suggestionRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    listByStatus: jest.Mock;
    findRecentRejected: jest.Mock;
    findRecentOpenOrAccepted: jest.Mock;
    claimFromPending: jest.Mock;
    revertClaim: jest.Mock;
  };
  let payloadService: { collect: jest.Mock };
  let aiService: { generate: jest.Mock; model: string };
  let goalRepository: { findAllOrdered: jest.Mock; findOne: jest.Mock };
  let opportunityRepository: { find: jest.Mock };
  let opportunityService: { create: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    suggestionRepository = {
      // create() is TypeORM's entity factory: identity is enough for these tests.
      create: jest.fn((partial) => partial),
      save: jest.fn((rows) =>
        Promise.resolve(
          (Array.isArray(rows) ? rows : [rows]).map((r, i) =>
            storedRow({ ...r, id: `sug-${i + 1}` }),
          ),
        ),
      ),
      findOne: jest.fn().mockResolvedValue(storedRow()),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      listByStatus: jest.fn().mockResolvedValue([storedRow()]),
      findRecentRejected: jest.fn().mockResolvedValue([]),
      findRecentOpenOrAccepted: jest.fn().mockResolvedValue([]),
      claimFromPending: jest.fn().mockResolvedValue(true),
      revertClaim: jest.fn().mockResolvedValue(undefined),
    };
    payloadService = {
      collect: jest.fn().mockResolvedValue({
        window: WINDOW,
        sections: { platformOverview: { summary: { activeLearners: 120 } } },
        included: ['platformOverview'],
        failed: [],
      }),
    };
    aiService = {
      generate: jest.fn().mockResolvedValue([rawSuggestion()]),
      model: 'claude-test',
    };
    goalRepository = {
      findAllOrdered: jest
        .fn()
        .mockResolvedValue([
          { name: 'Engagement & Usability' },
          { name: 'Reliability & Trust' },
        ]),
      findOne: jest.fn().mockResolvedValue({ name: 'Engagement & Usability' }),
    };
    opportunityRepository = { find: jest.fn().mockResolvedValue([]) };
    opportunityService = {
      create: jest.fn().mockResolvedValue({ id: 'opp-1', stage: 'new' }),
    };

    service = new AnalyticsSuggestionsService(
      suggestionRepository as never,
      payloadService as never,
      aiService as never,
      goalRepository as never,
      opportunityRepository as never,
      opportunityService as never,
    );
  });

  describe('generate', () => {
    it('stamps one batch id, the resolved window and the model on every row', async () => {
      aiService.generate.mockResolvedValue([
        rawSuggestion(),
        rawSuggestion({ title: 'Second' }),
      ]);

      const result = await service.generate(7, { range: '30d' });

      const saved = suggestionRepository.save.mock.calls[0][0];
      expect(saved).toHaveLength(2);
      const batchIds = new Set(
        saved.map((r: AnalyticsSuggestion) => r.batchId),
      );
      expect(batchIds.size).toBe(1);
      for (const row of saved) {
        expect(row).toMatchObject({
          model: 'claude-test',
          windowRange: '30d',
          windowFrom: WINDOW.from,
          windowTo: WINDOW.to,
          windowLabel: WINDOW.label,
          createdBy: 7,
          updatedBy: 7,
          status: AnalyticsSuggestionStatus.PENDING,
        });
      }
      expect(result.window).toEqual(WINDOW);
      expect(result.sections).toEqual({
        included: ['platformOverview'],
        failed: [],
      });
    });

    it('caps a run at ten suggestions', async () => {
      aiService.generate.mockResolvedValue(
        Array.from({ length: 14 }, (_, i) =>
          rawSuggestion({ title: `Suggestion ${i}` }),
        ),
      );

      await service.generate(7, {});

      expect(suggestionRepository.save.mock.calls[0][0]).toHaveLength(
        MAX_SUGGESTIONS_PER_RUN,
      );
    });

    it('discards a goal the taxonomy does not contain rather than storing it', async () => {
      aiService.generate.mockResolvedValue([
        rawSuggestion({ suggestedGoal: 'Invented Goal' }),
      ]);

      await service.generate(7, {});

      expect(suggestionRepository.save.mock.calls[0][0][0].suggestedGoal).toBe(
        null,
      );
    });

    it('drops a suggestion with no title or no body', async () => {
      aiService.generate.mockResolvedValue([
        rawSuggestion({ title: '   ' }),
        rawSuggestion({ body: null }),
        rawSuggestion({ title: 'Keeps this one' }),
      ]);

      await service.generate(7, {});

      const saved = suggestionRepository.save.mock.calls[0][0];
      expect(saved).toHaveLength(1);
      expect(saved[0].title).toBe('Keeps this one');
    });

    it('coerces an unrecognised type to idea and keeps an explicit bug', async () => {
      aiService.generate.mockResolvedValue([
        rawSuggestion({ suggestedType: 'nonsense' }),
        rawSuggestion({ title: 'Broken thing', suggestedType: 'bug' }),
      ]);

      await service.generate(7, {});

      const saved = suggestionRepository.save.mock.calls[0][0];
      expect(saved[0].suggestedType).toBe(RoadmapOpportunityType.IDEA);
      expect(saved[1].suggestedType).toBe(RoadmapOpportunityType.BUG);
    });

    it('caps evidence to five items and normalises non-strings away', async () => {
      aiService.generate.mockResolvedValue([
        rawSuggestion({
          evidence: ['a', 'b', 'c', 'd', 'e', 'f', 42, null, '  '],
        }),
      ]);

      await service.generate(7, {});

      expect(suggestionRepository.save.mock.calls[0][0][0].evidence).toEqual([
        'a',
        'b',
        'c',
        'd',
        'e',
      ]);
    });

    it('fails the run and saves nothing when the model output is unreadable', async () => {
      aiService.generate.mockResolvedValue(null);

      await expect(service.generate(7, {})).rejects.toBeInstanceOf(
        BadGatewayException,
      );
      expect(suggestionRepository.save).not.toHaveBeenCalled();
    });

    it('treats zero suggestions as a successful run, not an error', async () => {
      aiService.generate.mockResolvedValue([]);

      const result = await service.generate(7, {});

      expect(result.suggestions).toEqual([]);
      expect(suggestionRepository.save).not.toHaveBeenCalled();
    });

    it('passes previous decisions to the prompt so they are not re-proposed', async () => {
      suggestionRepository.findRecentRejected.mockResolvedValue([
        storedRow({
          title: 'Add streaks to the learner home',
          rejectedReason: 'Gamification is off the table this year',
        }),
      ]);
      suggestionRepository.findRecentOpenOrAccepted.mockResolvedValue([
        storedRow({ title: 'Already queued idea' }),
      ]);
      opportunityRepository.find.mockResolvedValue([
        {
          type: 'idea',
          productGoal: 'Reliability & Trust',
          stage: 'new',
          description: 'Existing roadmap item',
        },
      ]);

      await service.generate(7, {});

      const prompt = aiService.generate.mock.calls[0][0] as string;
      expect(prompt).toContain('Gamification is off the table this year');
      expect(prompt).toContain('Already queued idea');
      expect(prompt).toContain('Existing roadmap item');
      expect(prompt).toContain('Engagement & Usability');
    });

    it('names unavailable sections in the prompt instead of omitting them', async () => {
      payloadService.collect.mockResolvedValue({
        window: WINDOW,
        sections: { platformOverview: {} },
        included: ['platformOverview'],
        failed: ['scribeOverview: query failed'],
      });

      const result = await service.generate(7, {});

      expect(aiService.generate.mock.calls[0][0]).toContain(
        'scribeOverview: query failed',
      );
      expect(result.sections.failed).toEqual(['scribeOverview: query failed']);
    });
  });

  describe('accept', () => {
    it('files the reviewer’s edited values and links the opportunity', async () => {
      suggestionRepository.findOne
        .mockResolvedValueOnce(storedRow())
        .mockResolvedValueOnce(
          storedRow({
            status: AnalyticsSuggestionStatus.ACCEPTED,
            opportunityId: 'opp-1',
          }),
        );

      const result = await service.accept(7, 'sug-1', {
        description: 'Edited by the reviewer before filing',
        productGoal: 'Engagement & Usability',
        type: RoadmapOpportunityType.BUG,
      });

      expect(opportunityService.create).toHaveBeenCalledWith(7, {
        description: 'Edited by the reviewer before filing',
        type: RoadmapOpportunityType.BUG,
        productGoal: 'Engagement & Usability',
      });
      expect(suggestionRepository.update).toHaveBeenCalledWith('sug-1', {
        opportunityId: 'opp-1',
        updatedBy: 7,
      });
      expect(result.suggestion.status).toBe(AnalyticsSuggestionStatus.ACCEPTED);
      expect(result.suggestion.opportunityId).toBe('opp-1');
    });

    it('falls back to the suggested type when the reviewer sends none', async () => {
      await service.accept(7, 'sug-1', {
        description: 'Body',
        productGoal: 'Engagement & Usability',
      });

      expect(opportunityService.create).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ type: RoadmapOpportunityType.IDEA }),
      );
    });

    it('404s for a suggestion that does not exist', async () => {
      suggestionRepository.findOne.mockResolvedValue(null);

      await expect(
        service.accept(7, 'missing', {
          description: 'Body',
          productGoal: 'Engagement & Usability',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409s for a suggestion that was already decided', async () => {
      suggestionRepository.findOne.mockResolvedValue(
        storedRow({ status: AnalyticsSuggestionStatus.REJECTED }),
      );

      await expect(
        service.accept(7, 'sug-1', {
          description: 'Body',
          productGoal: 'Engagement & Usability',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(opportunityService.create).not.toHaveBeenCalled();
    });

    it('409s when another reviewer claimed the row first', async () => {
      suggestionRepository.claimFromPending.mockResolvedValue(false);

      await expect(
        service.accept(7, 'sug-1', {
          description: 'Body',
          productGoal: 'Engagement & Usability',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(opportunityService.create).not.toHaveBeenCalled();
    });

    it('422s on a dead product goal, without claiming the row', async () => {
      goalRepository.findOne.mockResolvedValue(null);

      await expect(
        service.accept(7, 'sug-1', {
          description: 'Body',
          productGoal: 'Retired Goal',
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(suggestionRepository.claimFromPending).not.toHaveBeenCalled();
      expect(opportunityService.create).not.toHaveBeenCalled();
    });

    it('returns the claim to the queue when filing throws', async () => {
      opportunityService.create.mockRejectedValue(new Error('roadmap is down'));

      await expect(
        service.accept(7, 'sug-1', {
          description: 'Body',
          productGoal: 'Engagement & Usability',
        }),
      ).rejects.toThrow('roadmap is down');
      expect(suggestionRepository.revertClaim).toHaveBeenCalledWith(
        'sug-1',
        AnalyticsSuggestionStatus.ACCEPTED,
      );
    });
  });

  describe('reject', () => {
    it('stores a trimmed reason', async () => {
      suggestionRepository.findOne.mockResolvedValue(
        storedRow({
          status: AnalyticsSuggestionStatus.REJECTED,
          rejectedReason: 'Already covered by the tracks work',
        }),
      );

      const result = await service.reject(7, 'sug-1', {
        reason: '  Already covered by the tracks work  ',
      });

      expect(suggestionRepository.claimFromPending).toHaveBeenCalledWith(
        'sug-1',
        {
          status: AnalyticsSuggestionStatus.REJECTED,
          updatedBy: 7,
          rejectedReason: 'Already covered by the tracks work',
        },
      );
      expect(result.rejectedReason).toBe('Already covered by the tracks work');
    });

    it('accepts a rejection with no reason, storing null', async () => {
      suggestionRepository.findOne.mockResolvedValue(
        storedRow({ status: AnalyticsSuggestionStatus.REJECTED }),
      );

      await service.reject(7, 'sug-1', {});

      expect(suggestionRepository.claimFromPending).toHaveBeenCalledWith(
        'sug-1',
        expect.objectContaining({ rejectedReason: null }),
      );
    });

    it('treats whitespace as no reason at all', async () => {
      suggestionRepository.findOne.mockResolvedValue(
        storedRow({ status: AnalyticsSuggestionStatus.REJECTED }),
      );

      await service.reject(7, 'sug-1', { reason: '   ' });

      expect(suggestionRepository.claimFromPending).toHaveBeenCalledWith(
        'sug-1',
        expect.objectContaining({ rejectedReason: null }),
      );
    });

    it('409s for an already-decided suggestion and 404s for a missing one', async () => {
      suggestionRepository.claimFromPending.mockResolvedValue(false);
      suggestionRepository.findOne.mockResolvedValue(
        storedRow({ status: AnalyticsSuggestionStatus.ACCEPTED }),
      );
      await expect(service.reject(7, 'sug-1', {})).rejects.toBeInstanceOf(
        ConflictException,
      );

      suggestionRepository.findOne.mockResolvedValue(null);
      await expect(service.reject(7, 'missing', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('maps stored rows to the wire shape, window included', async () => {
      const { items, count } = await service.list(
        AnalyticsSuggestionStatus.PENDING,
      );

      expect(count).toBe(1);
      expect(items[0]).toMatchObject({
        id: 'sug-1',
        batchId: 'batch-1',
        status: AnalyticsSuggestionStatus.PENDING,
        window: WINDOW,
        model: 'claude-test',
      });
    });
  });
});
