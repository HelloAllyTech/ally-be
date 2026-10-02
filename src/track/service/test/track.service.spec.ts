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
import { UpsertTrackStructureDto } from '../../dto/upsert-track-structure.dto';
import { TrackItemType } from '../../type/track.type';
import { QuizQuestionType } from '../../type/quiz.type';
import { Track } from '../../entity/track.entity';
import { UserService } from 'src/user/service/user.service';
import { TrackItemRepository } from 'src/track/repository/track-item.repository';
import * as trackStructureValidator from '../track-structure.validator';

const mockDataSource = {
  transaction: jest.fn(),
};

const mockTrackRepository = {
  findOne: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};

const mockTrackItemRepository = {
  findOne: jest.fn(),
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

const mockUserService = {
  getUsersByIds: jest.fn(),
};

describe('TrackService', () => {
  let service: TrackService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: TrackRepository, useValue: mockTrackRepository },
        { provide: TrackItemRepository, useValue: mockTrackItemRepository },
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
        { provide: UserService, useValue: mockUserService },
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

    it('should create a version when completionCriteria changes on a live course', async () => {
      const trackId = 'test-track-id';
      const itemId = 'item-1';
      const existingSections = [
        {
          id: 'section-1',
          title: 'Section 1',
          description: 'sec-desc',
          order: 1,
          items: [
            {
              id: itemId,
              type: TrackItemType.ROLEPLAY,
              order: 1,
              title: 'Roleplay',
              description: 'item-desc',
              scenarioId: 123,
              caseId: null,
              content: null,
              completionCriteria: { minScore: 80 },
              hasDiscussion: false,
            },
          ],
        },
      ];

      const dto: UpsertTrackStructureDto = {
        sections: JSON.parse(JSON.stringify(existingSections)),
      };
      dto.sections[0].items[0].completionCriteria = { minScore: 90 };

      mockTrackRepository.findOne.mockResolvedValue({ id: trackId } as Track);
      mockTrackEnrollmentRepository.existsForTrack.mockResolvedValue(true);
      mockTrackSharedService.getTrackWithStructure.mockResolvedValue({
        id: trackId,
        sections: existingSections,
      } as any);
      mockScenarioSharedService.getScenarioByIds.mockResolvedValue([
        { id: 123 },
      ] as any);

      const signatureSpy = jest.spyOn(
        trackStructureValidator,
        'computeStructuralSignature',
      );
      signatureSpy.mockReturnValue('same-signature');

      const mockCriteriaVersionRepo = {
        save: jest.fn(),
      };

      mockDataSource.transaction.mockImplementation((cb) =>
        cb({
          getRepository: (repo: any) => {
            if (
              repo.name === 'TrackItemCompletionCriteriaVersion'
            ) {
              return mockCriteriaVersionRepo;
            }
            return {
              softDelete: jest.fn(),
              update: jest.fn(),
              save: jest.fn().mockResolvedValue({ id: 'new-section-id' }),
            };
          },
        }),
      );

      await service.upsertStructure(trackId, dto);

      expect(mockCriteriaVersionRepo.save).toHaveBeenCalledWith({
        trackItemId: itemId,
        completionCriteria: { minScore: 80 }, // old value
        createdById: undefined, // userId is not set in test context
      });

      signatureSpy.mockRestore();
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
});
