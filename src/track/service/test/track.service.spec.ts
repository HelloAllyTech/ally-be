import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { TrackService } from '../track.service';
import { TrackRepository } from '../../repository/track.repository';
import { TrackEnrollmentRepository } from '../../repository/track-enrollment.repository';
import { TrackSharedService } from '../track-shared.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { CaseSharedService } from 'src/case/service/case-shared.service';
import { TenantService } from 'src/tenant/service/tenant.service';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { TrackTranslationService } from '../track-translation.service';
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

const mockPermissionValidator = {
  validatePermissions: jest.fn(),
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
          provide: TrackTranslationService,
          useValue: mockTrackTranslationService,
        },
        {
          provide: PermissionValidator,
          useValue: mockPermissionValidator,
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
});
