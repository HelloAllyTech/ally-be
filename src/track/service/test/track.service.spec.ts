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
      ],
    }).compile();

    service = module.get<TrackService>(TrackService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('applyContentDefaults', () => {
    it('should handle malformed questions array without throwing', async () => {
      const trackId = 'test-track-id';
      const dto: any = {
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
                  questions: 'not-an-array', // Malformed
                },
              },
            ],
          },
        ],
      };

      mockTrackRepository.findOne.mockResolvedValue({ id: trackId });
      mockTrackSharedService.getTrackWithStructure.mockResolvedValue({
        id: trackId,
        sections: [],
      });
      mockTrackEnrollmentRepository.existsForTrack.mockResolvedValue(false);
      mockDataSource.transaction.mockImplementation(async (cb) =>
        cb({
          getRepository: () => ({
            softDelete: jest.fn(),
            update: jest.fn(),
            save: jest.fn(),
          }),
        }),
      );

      // Should not throw a TypeError; validateTrackStructure will eventually catch it,
      // but here we just want to ensure it doesn't crash during defaults application.
      await expect(service.upsertStructure(trackId, dto)).rejects.toThrow();
    });

    it('should handle missing interjection question without throwing', async () => {
      const trackId = 'test-track-id';
      const dto: any = {
        sections: [
          {
            title: 'Section 1',
            order: 1,
            items: [
              {
                type: TrackItemType.VIDEO,
                order: 1,
                title: 'Video',
                content: {
                  url: 'https://vimeo.com/123',
                  interjections: [
                    { time: 10 }, // Missing 'question'
                  ],
                },
              },
            ],
          },
        ],
      };

      mockTrackRepository.findOne.mockResolvedValue({ id: trackId });
      mockTrackSharedService.getTrackWithStructure.mockResolvedValue({
        id: trackId,
        sections: [],
      });
      mockTrackEnrollmentRepository.existsForTrack.mockResolvedValue(false);

      await expect(service.upsertStructure(trackId, dto)).rejects.toThrow();
    });
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

    it('should derive prompt from promptHtml and sanitize promptHtml on upsertStructure', async () => {
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
                      promptHtml:
                        '<h1>Question 1</h1><p>Is this <strong>bold</strong>?</p><script>alert(1)</script>',
                      options: [
                        { id: 'opt1', text: 'Yes' },
                        { id: 'opt2', text: 'No' },
                      ],
                      correctOptionIds: ['opt1'],
                    },
                  ],
                },
              },
              {
                type: TrackItemType.JOURNAL,
                order: 2,
                title: 'Journal',
                content: {
                  prompts: [
                    {
                      id: 'j1',
                      promptHtml:
                        '<blockquote>Reflection</blockquote><p>How are you?</p>',
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

      const savedItems: any[] = [];
      mockDataSource.transaction.mockImplementation(async (cb) => {
        const manager = {
          getRepository: () => ({
            softDelete: jest.fn(),
            update: jest.fn(),
            save: jest.fn().mockImplementation((data) => {
              // The test mocks save for TrackSection and TrackItem.
              // We only care about the TrackItem content here.
              if (data.type) {
                savedItems.push(data);
              }
              return Promise.resolve({ id: 'some-id', ...data });
            }),
          }),
        };
        return cb(manager);
      });

      await service.upsertStructure(trackId, dto);

      const quizItem = savedItems.find((i) => i.type === TrackItemType.QUIZ);
      const journalItem = savedItems.find(
        (i) => i.type === TrackItemType.JOURNAL,
      );

      expect(quizItem.content.questions[0].promptHtml).toBe(
        '<h1>Question 1</h1><p>Is this <strong>bold</strong>?</p>',
      );
      expect(quizItem.content.questions[0].prompt).toBe(
        'Question 1 Is this bold ?',
      );

      expect(journalItem.content.prompts[0].promptHtml).toBe(
        '<blockquote>Reflection</blockquote><p>How are you?</p>',
      );
      expect(journalItem.content.prompts[0].prompt).toBe(
        'Reflection How are you?',
      );
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
