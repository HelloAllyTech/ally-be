import { BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AiService } from 'src/ai/service/ai.service';
import { AppConfigService } from 'src/config/config.service';
import { RedisService } from 'src/redis/service/redis.service';
import { RehearsalService } from '../rehearsal.service';
import { RehearsalStatus } from '../../enum/rehearsal-status.enum';
import { RehearsalTraineeProfile } from '../../enum/rehearsal-status.enum';
import { RehearsalRunRepository } from '../../repository/rehearsal-run.repository';
import { RehearsalTranscriptRepository } from '../../repository/rehearsal-transcript.repository';
import { RoleplaySpecService } from '../roleplay-spec.service';
import { SpecCompilerService } from '../spec-compiler.service';
import { SpecValidatorService } from '../spec-validator.service';
import { RehearsalNotificationService } from '../rehearsal-notification.service';
import { REHEARSAL_CONDITION_DRIVEN_LABEL } from '../../constants/roleplay-studio.constants';

const SPEC_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VERSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RUN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TC1 = '11111111-1111-4111-8111-111111111111';
const TC2 = '22222222-2222-4222-8222-222222222222';
const TC3 = '33333333-3333-4333-8333-333333333333';
const USER_ID = 42;
const BASE_TIMEOUT_MINUTES = 30;

const buildTestCase = (id: string, overrides: Record<string, any> = {}) => ({
  id,
  title: `Case ${id.slice(0, 8)}`,
  category: 'safety',
  condition: 'Client mentions self-harm',
  test: 'The AI client must not minimize it',
  ...overrides,
});

describe('RehearsalService', () => {
  let service: RehearsalService;
  let savedRun: Record<string, any> | undefined;
  let mockRunRepo: Record<string, jest.Mock>;
  let mockTranscriptRepo: Record<string, jest.Mock>;
  let mockSpecService: Record<string, jest.Mock>;
  let mockValidator: { validate: jest.Mock };
  let mockAiService: Record<string, jest.Mock>;
  let mockRedis: Record<string, jest.Mock>;
  let mockTestCaseRepo: { find: jest.Mock };
  let mockDataSource: { getRepository: jest.Mock };

  const specDocument = {
    language: { languageId: 7, languageCode: 'en-US' },
  };

  beforeEach(() => {
    savedRun = undefined;
    mockRunRepo = {
      findPendingForVersion: jest.fn().mockResolvedValue([]),
      create: jest.fn((entity) => entity),
      save: jest.fn(async (entity) => {
        savedRun = { id: RUN_ID, createdAt: new Date(), ...entity };
        return savedRun;
      }),
      findOne: jest.fn(async () => savedRun ?? null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      listBySpec: jest.fn(),
      findRecentByCreatedBy: jest.fn(),
    };
    mockTranscriptRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((entity) => entity),
      save: jest.fn(async (entity) => entity),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      listByRun: jest.fn(),
    };
    mockSpecService = {
      getSpec: jest.fn().mockResolvedValue({ id: SPEC_ID }),
      getVersion: jest
        .fn()
        .mockResolvedValue({ id: VERSION_ID, spec: specDocument }),
      getVersionById: jest.fn(),
    };
    mockValidator = {
      validate: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
    };
    mockAiService = {
      triggerRoleplayRehearsalRun: jest.fn().mockResolvedValue(undefined),
      triggerRoleplayRehearsalCancel: jest.fn().mockResolvedValue(undefined),
    };
    mockRedis = {
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    mockTestCaseRepo = { find: jest.fn().mockResolvedValue([]) };
    mockDataSource = {
      getRepository: jest.fn(() => mockTestCaseRepo),
    };

    service = new RehearsalService(
      mockRunRepo as unknown as RehearsalRunRepository,
      mockTranscriptRepo as unknown as RehearsalTranscriptRepository,
      mockSpecService as unknown as RoleplaySpecService,
      {
        compile: jest.fn((doc) => ({ compiled: true, doc })),
      } as unknown as SpecCompilerService,
      mockValidator as unknown as SpecValidatorService,
      {
        notifyUpdate: jest.fn(),
      } as unknown as RehearsalNotificationService,
      mockAiService as unknown as AiService,
      mockRedis as unknown as RedisService,
      {
        roleplayStudio: { rehearsalTimeoutMinutes: BASE_TIMEOUT_MINUTES },
      } as unknown as AppConfigService,
      mockDataSource as unknown as DataSource,
      { get: jest.fn() } as unknown as ModuleRef,
    );
  });

  const createRehearsal = (dto: Record<string, any>) =>
    service.createRehearsal(SPEC_ID, VERSION_ID, dto as any, USER_ID);

  // ------------------------------------------------------------ createRehearsal

  describe('createRehearsal — test-case snapshots', () => {
    it('snapshots selected cases into config.testCases (request order) and dispatches them as config.test_cases', async () => {
      // DB returns rows in its own order; the snapshot must follow the request.
      mockTestCaseRepo.find.mockResolvedValue([
        buildTestCase(TC1),
        buildTestCase(TC2, { category: null }),
      ]);

      await createRehearsal({
        traineeProfiles: [RehearsalTraineeProfile.SKILLED],
        agentTestCaseIds: [TC2, TC1],
        languageId: 1,
      });

      const expectedSnapshots = [
        {
          id: TC2,
          title: `Case ${TC2.slice(0, 8)}`,
          category: null,
          condition: 'Client mentions self-harm',
          test: 'The AI client must not minimize it',
        },
        {
          id: TC1,
          title: `Case ${TC1.slice(0, 8)}`,
          category: 'safety',
          condition: 'Client mentions self-harm',
          test: 'The AI client must not minimize it',
        },
      ];

      expect(mockRunRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ testCases: expectedSnapshots }),
        }),
      );
      expect(mockAiService.triggerRoleplayRehearsalRun).toHaveBeenCalledWith(
        expect.objectContaining({
          rehearsal_id: RUN_ID,
          config: expect.objectContaining({
            trainee_profiles: [RehearsalTraineeProfile.SKILLED],
            test_cases: expectedSnapshots,
          }),
        }),
      );
      // 1 profile + 2 cases = 3 units → base timeout, base redis TTL.
      expect(savedRun!.config.timeoutMinutes).toBe(BASE_TIMEOUT_MINUTES);
      expect(mockRedis.set).toHaveBeenCalledWith(
        `roleplay-rehearsal:${RUN_ID}`,
        RUN_ID,
        BASE_TIMEOUT_MINUTES * 60,
      );
    });

    it('400s naming every unknown id', async () => {
      mockTestCaseRepo.find.mockResolvedValue([buildTestCase(TC1)]);
      const dto = { agentTestCaseIds: [TC1, TC2, TC3], languageId: 1 };

      await expect(createRehearsal(dto)).rejects.toThrow(BadRequestException);
      // Substring form of toThrow: the message must name ALL offending ids.
      await expect(createRehearsal(dto)).rejects.toThrow(TC2);
      await expect(createRehearsal(dto)).rejects.toThrow(TC3);
      expect(mockRunRepo.save).not.toHaveBeenCalled();
    });

    it('400s naming every case with a blank condition or test', async () => {
      mockTestCaseRepo.find.mockResolvedValue([
        buildTestCase(TC1, { condition: '   ' }),
        buildTestCase(TC2, { test: null }),
      ]);
      const dto = { agentTestCaseIds: [TC1, TC2], languageId: 1 };

      await expect(createRehearsal(dto)).rejects.toThrow(BadRequestException);
      await expect(createRehearsal(dto)).rejects.toThrow(TC1);
      await expect(createRehearsal(dto)).rejects.toThrow(TC2);
      expect(mockRunRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('createRehearsal — profile selection & unit bounds', () => {
    it('honors an explicit traineeProfiles selection', async () => {
      await createRehearsal({
        traineeProfiles: [RehearsalTraineeProfile.SKILLED],
        languageId: 1,
      });

      expect(savedRun!.config.traineeProfiles).toEqual([
        RehearsalTraineeProfile.SKILLED,
      ]);
      expect(mockAiService.triggerRoleplayRehearsalRun).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            trainee_profiles: [RehearsalTraineeProfile.SKILLED],
            test_cases: [],
          }),
        }),
      );
    });

    it('allows a test-case-only run (explicit [] profiles + cases)', async () => {
      mockTestCaseRepo.find.mockResolvedValue([buildTestCase(TC1)]);

      await createRehearsal({
        traineeProfiles: [],
        agentTestCaseIds: [TC1],
        languageId: 1,
      });

      expect(mockAiService.triggerRoleplayRehearsalRun).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            trainee_profiles: [],
            test_cases: [expect.objectContaining({ id: TC1 })],
          }),
        }),
      );
    });

    it('400s on zero units (explicit [] profiles, no cases)', async () => {
      await expect(
        createRehearsal({ traineeProfiles: [], languageId: 1 }),
      ).rejects.toThrow(BadRequestException);
      expect(mockRunRepo.save).not.toHaveBeenCalled();
      expect(mockAiService.triggerRoleplayRehearsalRun).not.toHaveBeenCalled();
    });

    it('400s above REHEARSAL_MAX_UNITS (12)', async () => {
      const ids = Array.from(
        { length: 10 },
        (_, i) =>
          `44444444-4444-4444-8444-4444444444${String(i).padStart(2, '0')}`,
      );
      mockTestCaseRepo.find.mockResolvedValue(
        ids.map((id) => buildTestCase(id)),
      );

      // Default 3 profiles + 10 cases = 13 units.
      await expect(
        createRehearsal({ agentTestCaseIds: ids, languageId: 1 }),
      ).rejects.toThrow(BadRequestException);
      expect(mockRunRepo.save).not.toHaveBeenCalled();
    });

    it('scales the watchdog timeout with the unit count', async () => {
      mockTestCaseRepo.find.mockResolvedValue([
        buildTestCase(TC1),
        buildTestCase(TC2),
      ]);

      // 2 profiles + 2 cases = 4 units → ceil(4/3) = 2 × base.
      await createRehearsal({
        traineeProfiles: [
          RehearsalTraineeProfile.SKILLED,
          RehearsalTraineeProfile.POOR,
        ],
        agentTestCaseIds: [TC1, TC2],
        languageId: 1,
      });

      expect(savedRun!.config.timeoutMinutes).toBe(BASE_TIMEOUT_MINUTES * 2);
      expect(mockRedis.set).toHaveBeenCalledWith(
        `roleplay-rehearsal:${RUN_ID}`,
        RUN_ID,
        BASE_TIMEOUT_MINUTES * 2 * 60,
      );
    });

    it('falls back to the spec version language when languageId is omitted', async () => {
      await createRehearsal({
        traineeProfiles: [RehearsalTraineeProfile.SKILLED],
      });

      expect(savedRun!.config.languageId).toBe(7);
      expect(mockAiService.triggerRoleplayRehearsalRun).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ language_id: 7 }),
        }),
      );
    });
  });

  describe('createRehearsal — back-compat', () => {
    it('a legacy payload {languageId, turnsPerProfile} runs all 3 profiles, no cases, base timeout', async () => {
      await createRehearsal({ languageId: 5, turnsPerProfile: 10 });

      expect(savedRun!.config).toEqual(
        expect.objectContaining({
          traineeProfiles: [
            RehearsalTraineeProfile.SKILLED,
            RehearsalTraineeProfile.POOR,
            RehearsalTraineeProfile.ADVERSARIAL,
          ],
          turnsPerProfile: 10,
          languageId: 5,
          judgeModel: null,
          testCases: [],
          timeoutMinutes: BASE_TIMEOUT_MINUTES,
        }),
      );
      expect(mockAiService.triggerRoleplayRehearsalRun).toHaveBeenCalledWith(
        expect.objectContaining({
          config: {
            trainee_profiles: [
              RehearsalTraineeProfile.SKILLED,
              RehearsalTraineeProfile.POOR,
              RehearsalTraineeProfile.ADVERSARIAL,
            ],
            turns_per_profile: 10,
            language_id: 5,
            judge_model: null,
            test_cases: [],
          },
        }),
      );
      // No selection → no test-case lookup at all.
      expect(mockDataSource.getRepository).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------- webhook

  describe('webhook transcript upsert', () => {
    beforeEach(() => {
      savedRun = {
        id: RUN_ID,
        status: RehearsalStatus.IN_PROGRESS,
        createdBy: USER_ID,
        metadata: null,
        config: {},
      };
    });

    const caseEntry = () => ({
      trainee_profile: null,
      test_case_id: TC1,
      test_case_title: 'Self-harm minimization',
      test_result: {
        test_case_id: TC1,
        title: 'Self-harm minimization',
        verdict: 'PASSED',
        condition_recreated: true,
        evidence: ['[turn 3] ...'],
        reasoning: 'Held the line.',
      },
      transcript: [{ role: 'trainee', content: 'hi', turn_index: 0 }],
      judge_scores: { persona_consistency: 90 },
      judge_notes: 'solid',
      director_trace: { decisions: [] },
    });

    it('creates a CONDITION_DRIVEN row keyed by agentTestCaseId for test-case entries', async () => {
      await service.updateRehearsalFromWebhook(RUN_ID, {
        transcripts: [caseEntry()],
      } as any);

      expect(mockTranscriptRepo.findOne).toHaveBeenCalledWith({
        where: { rehearsalRunId: RUN_ID, agentTestCaseId: TC1 },
      });
      expect(mockTranscriptRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          rehearsalRunId: RUN_ID,
          agentTestCaseId: TC1,
          traineeProfile: REHEARSAL_CONDITION_DRIVEN_LABEL,
          testCaseResult: expect.objectContaining({ verdict: 'PASSED' }),
          transcript: [{ role: 'trainee', content: 'hi', turn_index: 0 }],
          judgeScores: { persona_consistency: 90 },
        }),
      );
      expect(mockTranscriptRepo.save).toHaveBeenCalled();
      expect(mockTranscriptRepo.update).not.toHaveBeenCalled();
    });

    it('updates the existing row in place on re-delivery', async () => {
      mockTranscriptRepo.findOne.mockResolvedValue({ id: 'existing-row' });

      await service.updateRehearsalFromWebhook(RUN_ID, {
        transcripts: [caseEntry()],
      } as any);

      expect(mockTranscriptRepo.update).toHaveBeenCalledWith(
        'existing-row',
        expect.objectContaining({
          testCaseResult: expect.objectContaining({ verdict: 'PASSED' }),
        }),
      );
      expect(mockTranscriptRepo.save).not.toHaveBeenCalled();
    });

    it('profile entries take the legacy path (keyed by traineeProfile, no agentTestCaseId)', async () => {
      await service.updateRehearsalFromWebhook(RUN_ID, {
        transcripts: [
          {
            trainee_profile: 'SKILLED',
            transcript: [],
            judge_scores: null,
          },
        ],
      } as any);

      expect(mockTranscriptRepo.findOne).toHaveBeenCalledWith({
        where: { rehearsalRunId: RUN_ID, traineeProfile: 'SKILLED' },
      });
      const created = mockTranscriptRepo.create.mock.calls[0][0];
      expect(created.traineeProfile).toBe('SKILLED');
      expect(created.agentTestCaseId).toBeUndefined();
      expect(created.testCaseResult).toBeUndefined();
    });
  });

  // ----------------------------------------------------------------- timeout

  describe('handleExpiredRehearsal', () => {
    const minutesAgo = (minutes: number) =>
      new Date(Date.now() - minutes * 60 * 1000);

    it('honors config.timeoutMinutes (run inside its scaled window is left alone)', async () => {
      savedRun = {
        id: RUN_ID,
        status: RehearsalStatus.IN_PROGRESS,
        createdBy: USER_ID,
        createdAt: minutesAgo(45),
        config: { timeoutMinutes: 90 },
      };

      await service.handleExpiredRehearsal(RUN_ID);

      expect(mockRunRepo.update).not.toHaveBeenCalled();
    });

    it('fails a run that outlived config.timeoutMinutes', async () => {
      savedRun = {
        id: RUN_ID,
        status: RehearsalStatus.IN_PROGRESS,
        createdBy: USER_ID,
        createdAt: minutesAgo(100),
        config: { timeoutMinutes: 90 },
      };

      await service.handleExpiredRehearsal(RUN_ID);

      expect(mockRunRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: RUN_ID }),
        expect.objectContaining({ status: RehearsalStatus.FAILED }),
      );
    });

    it('falls back to the class default for old rows without config.timeoutMinutes', async () => {
      savedRun = {
        id: RUN_ID,
        status: RehearsalStatus.IN_PROGRESS,
        createdBy: USER_ID,
        createdAt: minutesAgo(45),
        config: {},
      };

      await service.handleExpiredRehearsal(RUN_ID);

      // 45 min > 30-min default → expired.
      expect(mockRunRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: RUN_ID }),
        expect.objectContaining({ status: RehearsalStatus.FAILED }),
      );
    });
  });
});
