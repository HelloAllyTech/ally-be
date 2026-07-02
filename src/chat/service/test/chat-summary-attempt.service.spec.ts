import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChatSummaryAttemptService } from '../chat-summary-attempt.service';
import { Chat, ChatSummaryStatus } from '../../entity/chat.entity';
import {
  ChatSummaryAttempt,
  ScribeAttemptOutcome,
  ScribeAttemptTrigger,
  ScribePhaseReached,
} from '../../entity/chat-summary-attempt.entity';

describe('ChatSummaryAttemptService', () => {
  let service: ChatSummaryAttemptService;
  let attemptRepo: { insert: jest.Mock; count: jest.Mock };
  let firstAttemptUpdate: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    execute: jest.Mock;
  };
  let chatRepo: { createQueryBuilder: jest.Mock };

  beforeEach(async () => {
    attemptRepo = {
      insert: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(0),
    };
    firstAttemptUpdate = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    chatRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(firstAttemptUpdate),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatSummaryAttemptService,
        {
          provide: getRepositoryToken(ChatSummaryAttempt),
          useValue: attemptRepo,
        },
        { provide: getRepositoryToken(Chat), useValue: chatRepo },
      ],
    }).compile();

    service = module.get(ChatSummaryAttemptService);
    jest.clearAllMocks();
    attemptRepo.count.mockResolvedValue(0);
    firstAttemptUpdate.update.mockReturnThis();
    firstAttemptUpdate.set.mockReturnThis();
    firstAttemptUpdate.where.mockReturnThis();
    firstAttemptUpdate.andWhere.mockReturnThis();
    firstAttemptUpdate.execute.mockResolvedValue({ affected: 1 });
  });

  describe('phaseForFailureStage', () => {
    it('returns DIARIZED whenever a transcript was saved (failure is at summarize)', () => {
      expect(
        ChatSummaryAttemptService.phaseForFailureStage('transcribe', true),
      ).toBe(ScribePhaseReached.DIARIZED);
      expect(
        ChatSummaryAttemptService.phaseForFailureStage('summarize', true),
      ).toBe(ScribePhaseReached.DIARIZED);
    });

    it('maps ally-ai stages to the furthest phase reached when no transcript', () => {
      expect(
        ChatSummaryAttemptService.phaseForFailureStage('transcribe', false),
      ).toBe(ScribePhaseReached.AUDIO_UPLOADED);
      expect(
        ChatSummaryAttemptService.phaseForFailureStage('diarize', false),
      ).toBe(ScribePhaseReached.TRANSCRIBED);
      expect(
        ChatSummaryAttemptService.phaseForFailureStage('summarize', false),
      ).toBe(ScribePhaseReached.DIARIZED);
      expect(
        ChatSummaryAttemptService.phaseForFailureStage(
          'summary-timeout',
          false,
        ),
      ).toBe(ScribePhaseReached.DIARIZED);
    });

    it('falls back to AUDIO_UPLOADED for an unknown stage with no transcript', () => {
      expect(
        ChatSummaryAttemptService.phaseForFailureStage(undefined, false),
      ).toBe(ScribePhaseReached.AUDIO_UPLOADED);
    });
  });

  describe('recordAttempt', () => {
    it('inserts a row with the next attempt number', async () => {
      attemptRepo.count.mockResolvedValue(2); // two prior attempts

      await service.recordAttempt({
        chatId: 42,
        tenantId: 't1',
        trigger: ScribeAttemptTrigger.CRON_RETRY,
        outcome: ScribeAttemptOutcome.SUCCESS,
        phaseReached: ScribePhaseReached.DELIVERED,
      });

      expect(attemptRepo.insert).toHaveBeenCalledTimes(1);
      const row = attemptRepo.insert.mock.calls[0][0];
      expect(row).toMatchObject({
        chatId: 42,
        tenantId: 't1',
        attemptNo: 3,
        trigger: ScribeAttemptTrigger.CRON_RETRY,
        outcome: ScribeAttemptOutcome.SUCCESS,
        phaseReached: ScribePhaseReached.DELIVERED,
      });
    });

    it('sets the write-once first-attempt columns on an INITIAL attempt', async () => {
      await service.recordAttempt({
        chatId: 7,
        tenantId: 't1',
        trigger: ScribeAttemptTrigger.INITIAL,
        outcome: ScribeAttemptOutcome.FAILED,
        failureStage: 'transcribe',
      });

      expect(chatRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(firstAttemptUpdate.set).toHaveBeenCalledWith({
        firstAttemptStatus: ChatSummaryStatus.FAILED,
        firstFailureStage: 'transcribe',
      });
      // Guarded so it never overwrites an already-set first outcome.
      expect(firstAttemptUpdate.andWhere).toHaveBeenCalledWith(
        '"firstAttemptStatus" IS NULL',
      );
    });

    it('does NOT touch first-attempt columns for a retry/reprocess trigger', async () => {
      await service.recordAttempt({
        chatId: 7,
        tenantId: 't1',
        trigger: ScribeAttemptTrigger.CRON_RETRY,
        outcome: ScribeAttemptOutcome.SUCCESS,
      });
      await service.recordAttempt({
        chatId: 7,
        tenantId: 't1',
        trigger: ScribeAttemptTrigger.REPROCESS,
        outcome: ScribeAttemptOutcome.FAILED,
      });

      expect(chatRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('is best-effort: a repository failure never throws into the pipeline', async () => {
      attemptRepo.insert.mockRejectedValue(new Error('db down'));

      await expect(
        service.recordAttempt({
          chatId: 1,
          tenantId: 't1',
          trigger: ScribeAttemptTrigger.INITIAL,
          outcome: ScribeAttemptOutcome.SUCCESS,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
