import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { TrackService } from '../track.service';
import { TrackRepository } from '../../repository/track.repository';
import { TrackEnrollmentRepository } from '../../repository/track-enrollment.repository';
import { TrackSharedService } from '../track-shared.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { CaseSharedService } from 'src/case/service/case-shared.service';
import { TenantService } from 'src/tenant/service/tenant.service';
import { TrackTranslationService } from '../track-translation.service';
import { TenantScopeService } from 'src/authorization/service/tenant-scope.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UpsertTrackStructureDto } from '../../dto/upsert-track-structure.dto';
import { TrackItemType } from '../../type/track.type';
import { QuizQuestionType } from '../../type/quiz.type';
import { Track } from '../../entity/track.entity';

const mockDataSource = {
  transaction: jest.fn(),
};

const mockTrackRepository = {
  findOne: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};

const mockTrackEnrollmentRepository = {
  existsForTrack: jest.fn(),
};

const mockTrackSharedService = {
  getTrackWithStructure: jest.fn(),
};

const mockScenarioSharedService = {
  getScenarioByIds: jest.fn(),
};

const mockCaseSharedService = {
  getActiveCaseById: jest.fn(),
};

const mockTenantService = {
  findById: jest.fn(),
};

const mockTrackTranslationService = {
  handleSourceChanged: jest.fn(),
};

// An unrestricted caller unless a test says otherwise.
const mockTenantScopeService = {
  isRestricted: jest.fn().mockResolvedValue(false),
};

describe('TrackService', () => {
  let service: TrackService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: TrackRepository, useValue: mockTrackRepository },
        {
          provide: TrackEnrollmentRepository,
          useValue: mockTrackEnrollmentRepository,
        },
        { provide: TrackSharedService, useValue: mockTrackSharedService },
        {
          provide: ScenarioSharedService,
          useValue: mockScenarioSharedService,
        },
        { provide: CaseSharedService, useValue: mockCaseSharedService },
        { provide: TenantService, useValue: mockTenantService },
        {
          provide: TenantScopeService,
          useValue: mockTenantScopeService,
        },
        {
          provide: TrackTranslationService,
          useValue: mockTrackTranslationService,
        },
      ],
    }).compile();

    service = module.get<TrackService>(TrackService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('upsertStructure', () => {
    it('should add missing ids to quiz options and not throw', async () => {
      const trackId = 'test-track-id';
      const dto: UpsertTrackStructureDto = {
        sections: [
          {
            title: 'Section 1',
            order: 1,
            items: [
              {
                type: TrackItemType.QUIZ,
                order: 1,
                title: 'Quiz',
                content: {
                  settings: { passScore: 70 },
                  questions: [
                    {
                      id: 'q1',
                      type: QuizQuestionType.MCQ_SINGLE,
                      prompt: 'Pick one',
                      options: [
                        { text: 'Option A' }, // Missing id
                        { id: 'opt2', text: 'Option B' },
                      ],
                      correctOptionIds: ['opt2'],
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      mockTrackRepository.findOne.mockResolvedValue({ id: trackId } as Track);
      mockTrackEnrollmentRepository.existsForTrack.mockResolvedValue(false);
      mockTrackSharedService.getTrackWithStructure.mockResolvedValue({
        id: trackId,
        sections: [],
      });
      mockDataSource.transaction.mockImplementation((cb) =>
        cb({
          getRepository: () => ({
            softDelete: jest.fn(),
            update: jest.fn(),
            save: jest.fn().mockResolvedValue({ id: 'new-section-id' }),
          }),
        }),
      );

      await expect(
        service.upsertStructure(trackId, dto),
      ).resolves.not.toThrow();
    });
  });

  describe('description sanitization', () => {
    const maliciousDescription =
      '<p>Hello <script>alert("xss")</script><a href="javascript:alert(1)">link</a></p>';
    const sanitizedDescription = '<p>Hello <a>link</a></p>';

    it('should sanitize description on create', async () => {
      mockTrackRepository.save.mockImplementation((track) =>
        Promise.resolve({ ...track, id: 'new-id' }),
      );
      const newTrack = await service.createTrack({
        title: 'Test',
        description: maliciousDescription,
      });
      expect(newTrack.description).toBe(sanitizedDescription);
    });

    it('should sanitize description on update', async () => {
      const trackId = 'test-track-id';
      mockTrackRepository.findOne.mockResolvedValue({
        id: trackId,
        description: 'old',
      } as Track);
      mockTrackRepository.update.mockResolvedValue({} as any);

      await service.updateTrack(trackId, {
        description: maliciousDescription,
      });

      const updateCall = mockTrackRepository.update.mock.calls[0];
      expect(updateCall[0]).toBe(trackId);
      expect(updateCall[1].description).toBe(sanitizedDescription);
    });

    it('should convert newlines to <br> tags in plain text', async () => {
      mockTrackRepository.save.mockImplementation((track) =>
        Promise.resolve({ ...track, id: 'new-id' }),
      );
      const plainText = 'Hello\nworld';
      const newTrack = await service.createTrack({
        title: 'Test',
        description: plainText,
      });
      expect(newTrack.description).toBe('Hello<br />world');
    });

    it('should not convert newlines if HTML is present', async () => {
      mockTrackRepository.save.mockImplementation((track) =>
        Promise.resolve({ ...track, id: 'new-id' }),
      );
      const htmlText = '<p>Hello\nworld</p>';
      const newTrack = await service.createTrack({
        title: 'Test',
        description: htmlText,
      });
      expect(newTrack.description).toBe('<p>Hello\nworld</p>');
    });
  });

  describe('as a platform admin restricted to some organizations', () => {
    const CALLER_ID = 31;

    beforeEach(() => {
      jest
        .spyOn(ExecutionManager, 'getUserId')
        .mockReturnValue(String(CALLER_ID));
      mockTenantScopeService.isRestricted.mockResolvedValue(true);
    });

    afterEach(() => {
      mockTenantScopeService.isRestricted.mockResolvedValue(false);
      jest.restoreAllMocks();
    });

    it('may edit a course they created', async () => {
      mockTrackRepository.findOne.mockResolvedValueOnce({
        id: 't1',
        createdBy: CALLER_ID,
      });

      await expect(service.assertCallerMayEdit('t1')).resolves.toBeUndefined();
    });

    it('may not edit a course someone else created', async () => {
      mockTrackRepository.findOne.mockResolvedValueOnce({
        id: 't1',
        createdBy: 99,
      });

      await expect(service.assertCallerMayEdit('t1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('gets a 404 for a course that does not exist', async () => {
      mockTrackRepository.findOne.mockResolvedValueOnce(null);

      await expect(service.assertCallerMayEdit('t1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('may not make a course global', async () => {
      await expect(service.assertCallerMayMakeGlobal(true)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        service.assertCallerMayMakeGlobal(false),
      ).resolves.toBeUndefined();
      await expect(
        service.assertCallerMayMakeGlobal(undefined),
      ).resolves.toBeUndefined();
    });

    it('leaves an unrestricted admin free to edit any course or make it global', async () => {
      mockTenantScopeService.isRestricted.mockResolvedValue(false);
      mockTrackRepository.findOne.mockClear();

      await expect(service.assertCallerMayEdit('t1')).resolves.toBeUndefined();
      await expect(
        service.assertCallerMayMakeGlobal(true),
      ).resolves.toBeUndefined();
      expect(mockTrackRepository.findOne).not.toHaveBeenCalled();
    });
  });
});
