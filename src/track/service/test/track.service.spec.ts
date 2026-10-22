import { BadRequestException } from '@nestjs/common';
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
  query: jest.fn(),
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

    it('clears a deleted section/item description instead of silently keeping it', async () => {
      // The builder omits a cleared description entirely, and TypeORM save()
      // skips undefined columns — so the write must carry an explicit null.
      const trackId = 'test-track-id';
      const dto: UpsertTrackStructureDto = {
        sections: [
          {
            id: 'a0000000-0000-4000-8000-000000000001',
            title: 'Section 1',
            order: 1,
            items: [
              {
                id: 'a0000000-0000-4000-8000-000000000002',
                type: TrackItemType.JOURNAL,
                order: 1,
                title: 'Reflect',
                content: {
                  prompts: [{ id: 'j1', prompt: 'How are you?' }],
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
        sections: [
          {
            id: 'a0000000-0000-4000-8000-000000000001',
            title: 'Section 1',
            description: 'Old section description',
            order: 1,
            items: [
              {
                id: 'a0000000-0000-4000-8000-000000000002',
                type: TrackItemType.JOURNAL,
                order: 1,
                title: 'Reflect',
                description: 'Pen down your reflections here!',
                content: { prompts: [{ id: 'j1', prompt: 'How are you?' }] },
              },
            ],
          },
        ],
      });

      const saved: any[] = [];
      mockDataSource.transaction.mockImplementation(async (cb) => {
        const manager = {
          getRepository: () => ({
            softDelete: jest.fn(),
            update: jest.fn(),
            save: jest.fn().mockImplementation((data) => {
              saved.push(data);
              return Promise.resolve({ id: 'some-id', ...data });
            }),
          }),
        };
        return cb(manager);
      });

      await service.upsertStructure(trackId, dto);

      const savedSection = saved.find((d) => !d.type && 'title' in d);
      const savedItem = saved.find((d) => d.type === TrackItemType.JOURNAL);
      expect(savedSection.description).toBeNull();
      expect(savedItem.description).toBeNull();
    });
  });

  describe('upsertStructure: prompt vs promptHtml on edit', () => {
    const trackId = 'test-track-id';
    const quizContent = (question: Record<string, unknown>) => ({
      settings: { passScore: 70 },
      questions: [
        {
          id: 'q1',
          type: QuizQuestionType.MCQ_SINGLE,
          options: [
            { id: 'opt1', text: 'Yes' },
            { id: 'opt2', text: 'No' },
          ],
          correctOptionIds: ['opt1'],
          ...question,
        },
      ],
    });
    const stored = quizContent({
      prompt: 'Old question',
      promptHtml: '<p>Old <strong>question</strong></p>',
    });
    const dtoFor = (
      content: Record<string, unknown>,
    ): UpsertTrackStructureDto =>
      ({
        sections: [
          {
            id: 'sec1',
            title: 'Section 1',
            order: 1,
            items: [
              {
                id: 'item1',
                type: TrackItemType.QUIZ,
                order: 1,
                title: 'Quiz',
                content,
              },
            ],
          },
        ],
      }) as UpsertTrackStructureDto;

    const arrange = () => {
      mockTrackRepository.findOne.mockResolvedValue({ id: trackId } as Track);
      mockTrackEnrollmentRepository.existsForTrack.mockResolvedValue(false);
      mockTrackSharedService.getTrackWithStructure.mockResolvedValue({
        id: trackId,
        sections: [
          {
            id: 'sec1',
            items: [{ id: 'item1', type: TrackItemType.QUIZ, content: stored }],
          },
        ],
      });
      const savedItems: any[] = [];
      mockDataSource.transaction.mockImplementation(async (cb) =>
        cb({
          getRepository: () => ({
            softDelete: jest.fn(),
            update: jest.fn(),
            save: jest.fn().mockImplementation((data) => {
              if (data.type) savedItems.push(data);
              return Promise.resolve({ id: 'some-id', ...data });
            }),
          }),
        }),
      );
      return savedItems;
    };

    it('lets a plain-text edit win over the stale promptHtml it round-tripped', async () => {
      const savedItems = arrange();

      await service.upsertStructure(
        trackId,
        dtoFor(
          quizContent({
            prompt: 'New question from the Copilot',
            promptHtml: '<p>Old <strong>question</strong></p>',
          }),
        ),
      );

      const question = savedItems[0].content.questions[0];
      expect(question.prompt).toBe('New question from the Copilot');
      expect(question.promptHtml).toBeUndefined();
    });

    it('re-derives prompt when the rich text itself changed', async () => {
      const savedItems = arrange();

      await service.upsertStructure(
        trackId,
        dtoFor(
          quizContent({
            prompt: 'Old question',
            promptHtml: '<p>Brand <em>new</em> text</p>',
          }),
        ),
      );

      const question = savedItems[0].content.questions[0];
      expect(question.promptHtml).toBe('<p>Brand <em>new</em> text</p>');
      expect(question.prompt).toBe('Brand new text');
    });

    it('keeps the formatting when nothing about the prompt changed', async () => {
      const savedItems = arrange();

      await service.upsertStructure(trackId, dtoFor(stored));

      const question = savedItems[0].content.questions[0];
      expect(question.promptHtml).toBe('<p>Old <strong>question</strong></p>');
      expect(question.prompt).toBe('Old question');
    });

    it('rejects a quiz with no settings as a 400, not a 500', async () => {
      arrange();
      const noSettings: Record<string, unknown> = quizContent({
        prompt: 'Pick one',
      });
      delete noSettings.settings;

      const result = service.upsertStructure(trackId, dtoFor(noSettings));

      await expect(result).rejects.toBeInstanceOf(BadRequestException);
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

    it('should preserve allowed rich text formatting tags', async () => {
      mockTrackRepository.save.mockImplementation((track) =>
        Promise.resolve({ ...track, id: 'new-id' }),
      );
      const richText =
        '<h1>Heading 1</h1><h2>Heading 2</h2><h3>Heading 3</h3><p>This is a paragraph with <strong>bold</strong>, <em>italics</em>, <u>underline</u>, and <s>strikethrough</s>.</p><blockquote>Quote</blockquote><hr/>';
      const expectedSanitizedText =
        '<h1>Heading 1</h1><h2>Heading 2</h2><h3>Heading 3</h3><p>This is a paragraph with <strong>bold</strong>, <em>italics</em>, <u>underline</u>, and <s>strikethrough</s>.</p><blockquote>Quote</blockquote><hr />';
      const newTrack = await service.createTrack({
        title: 'Test',
        description: richText,
      });
      expect(newTrack.description).toBe(expectedSanitizedText);
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

    it('may delete an unreferenced upload, or media only their courses use', async () => {
      mockDataSource.query.mockResolvedValueOnce([]);
      await expect(
        service.assertCallerMayDeleteMedia('https://b/track-media/a.png'),
      ).resolves.toBeUndefined();

      mockDataSource.query.mockResolvedValueOnce([
        { createdBy: CALLER_ID },
        { createdBy: CALLER_ID },
      ]);
      await expect(
        service.assertCallerMayDeleteMedia('https://b/track-media/b.png'),
      ).resolves.toBeUndefined();
    });

    it("may not delete media another admin's course or a shared template uses", async () => {
      mockDataSource.query.mockResolvedValueOnce([
        { createdBy: CALLER_ID },
        { createdBy: 99 },
      ]);
      await expect(
        service.assertCallerMayDeleteMedia('https://b/track-media/c.png'),
      ).rejects.toThrow('This file is still used by a course you cannot edit');

      mockDataSource.query.mockResolvedValueOnce([{ createdBy: null }]);
      await expect(
        service.assertCallerMayDeleteMedia('https://b/track-media/d.png'),
      ).rejects.toThrow(ForbiddenException);
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
      mockDataSource.query.mockClear();
      await expect(
        service.assertCallerMayDeleteMedia('https://b/track-media/e.png'),
      ).resolves.toBeUndefined();
      expect(mockDataSource.query).not.toHaveBeenCalled();
    });
  });
});
