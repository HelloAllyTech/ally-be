import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CourseDiscussionService } from 'src/course-discussion/service/course-discussion.service';
import { CourseDiscussion } from 'src/course-discussion/entity/course-discussion.entity';
import { CourseDiscussionPost } from 'src/course-discussion/entity/course-discussion-post.entity';
import { TrackItem } from 'src/track/entity/track-item.entity';
import { User } from 'src/user/entity/user.entity';
import { InAppNotificationService } from 'src/notification/service/in-app-notification.service';
import { TrackService } from 'src/track/service/track.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('CourseDiscussionService', () => {
  let service: CourseDiscussionService;
  let discussionRepository: Repository<CourseDiscussion>;
  let postRepository: Repository<CourseDiscussionPost>;
  let trackItemRepository: Repository<TrackItem>;
  let inAppNotificationService: InAppNotificationService;
  let trackService: TrackService;

  const mockDiscussionRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockPostRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    softDelete: jest.fn(),
  };

  const mockTrackItemRepository = {
    findOne: jest.fn(),
  };

  const mockInAppNotificationService = {
    create: jest.fn(),
  };

  const mockTrackService = {
    isUserTrackCreator: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseDiscussionService,
        {
          provide: getRepositoryToken(CourseDiscussion),
          useValue: mockDiscussionRepository,
        },
        {
          provide: getRepositoryToken(CourseDiscussionPost),
          useValue: mockPostRepository,
        },
        {
          provide: getRepositoryToken(TrackItem),
          useValue: mockTrackItemRepository,
        },
        {
          provide: InAppNotificationService,
          useValue: mockInAppNotificationService,
        },
        {
          provide: TrackService,
          useValue: mockTrackService,
        },
      ],
    }).compile();

    service = module.get<CourseDiscussionService>(CourseDiscussionService);
    discussionRepository = module.get<Repository<CourseDiscussion>>(
      getRepositoryToken(CourseDiscussion),
    );
    postRepository = module.get<Repository<CourseDiscussionPost>>(
      getRepositoryToken(CourseDiscussionPost),
    );
    trackItemRepository = module.get<Repository<TrackItem>>(
      getRepositoryToken(TrackItem),
    );
    inAppNotificationService = module.get<InAppNotificationService>(
      InAppNotificationService,
    );
    trackService = module.get<TrackService>(TrackService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDiscussion', () => {
    it('should return a discussion', async () => {
      const trackItem = { id: 'trackItemId', hasDiscussion: true };
      const discussion = { id: 'discussionId', trackItemId: 'trackItemId' };
      mockTrackItemRepository.findOne.mockResolvedValue(trackItem);
      mockDiscussionRepository.findOne.mockResolvedValue(discussion);

      const result = await service.getDiscussion('trackItemId', new User());
      expect(result).toEqual(discussion);
    });

    it('should throw NotFoundException if track item not found', async () => {
      mockTrackItemRepository.findOne.mockResolvedValue(null);
      await expect(
        service.getDiscussion('trackItemId', new User()),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if discussion not enabled', async () => {
      const trackItem = { id: 'trackItemId', hasDiscussion: false };
      mockTrackItemRepository.findOne.mockResolvedValue(trackItem);
      await expect(
        service.getDiscussion('trackItemId', new User()),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create a new discussion if not found', async () => {
      const trackItem = { id: 'trackItemId', hasDiscussion: true };
      const user = new User();
      user.id = 1;
      const newDiscussion = {
        id: 'newDiscussionId',
        trackItemId: 'trackItemId',
      };

      mockTrackItemRepository.findOne.mockResolvedValue(trackItem);
      mockDiscussionRepository.findOne.mockResolvedValue(null);
      mockDiscussionRepository.create.mockReturnValue(newDiscussion);
      mockDiscussionRepository.save.mockResolvedValue(newDiscussion);

      const result = await service.getDiscussion('trackItemId', user);
      expect(result).toEqual(newDiscussion);
      expect(mockDiscussionRepository.create).toHaveBeenCalledWith({
        trackItemId: 'trackItemId',
        createdById: user.id,
      });
    });
  });

  describe('createPost', () => {
    it('should create a post', async () => {
      const user = new User();
      user.id = 1;
      const discussion = { id: 'discussionId', isLocked: false };
      const createPostDto = { content: 'test' };
      const newPost = {
        ...createPostDto,
        discussionId: discussion.id,
        authorId: user.id,
      };

      jest.spyOn(service, 'getDiscussion').mockResolvedValue(discussion as any);
      mockPostRepository.create.mockReturnValue(newPost);
      mockPostRepository.save.mockResolvedValue(newPost);

      const result = await service.createPost(
        'trackItemId',
        createPostDto,
        user,
      );
      expect(result).toEqual(newPost);
    });

    it('should throw ForbiddenException if discussion is locked', async () => {
      const user = new User();
      const discussion = { id: 'discussionId', isLocked: true };
      const createPostDto = { content: 'test' };

      jest.spyOn(service, 'getDiscussion').mockResolvedValue(discussion as any);

      await expect(
        service.createPost('trackItemId', createPostDto, user),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createReply', () => {
    it('should create a reply and send notification', async () => {
      const user = new User();
      user.id = 1;
      user.name = 'John Doe';
      const parentPost = {
        id: 'parentId',
        authorId: 2,
        discussionId: 'discussionId',
        discussion: { isLocked: false, trackItemId: 'trackItemId' },
        tenantId: 'tenant-id',
      };
      const createPostDto = { content: 'test reply' };
      const newReply = {
        ...createPostDto,
        discussionId: parentPost.discussionId,
        authorId: user.id,
        parentPostId: parentPost.id,
      };

      mockPostRepository.findOne.mockResolvedValue(parentPost);
      mockPostRepository.create.mockReturnValue(newReply);
      mockPostRepository.save.mockResolvedValue(newReply);

      const result = await service.createReply('parentId', createPostDto, user);
      expect(result).toEqual(newReply);
      expect(mockInAppNotificationService.create).toHaveBeenCalled();
    });
  });

  describe('updatePost', () => {
    it('should allow author to update post within 15 mins', async () => {
      const user = new User();
      user.id = 2;
      const post = {
        id: 'postId',
        authorId: 2,
        content: 'original',
        createdAt: new Date(),
        discussion: { trackItem: { trackId: 'trackId' } },
      };
      const updateDto = { content: 'updated' };

      jest.spyOn(service as any, 'findPost').mockResolvedValue(post as any);
      mockTrackService.isUserTrackCreator.mockResolvedValue(false);
      mockPostRepository.save.mockResolvedValue({
        ...post,
        ...updateDto,
        isEdited: true,
      });

      const result = await service.updatePost('postId', updateDto, user);
      expect(result.content).toEqual('updated');
      expect(result.isEdited).toBe(true);
    });

    it('should not allow author to update post after 15 mins', async () => {
      const user = new User();
      user.id = 2;
      const post = {
        id: 'postId',
        authorId: 2,
        content: 'original',
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
        discussion: { trackItem: { trackId: 'trackId' } },
      };
      const updateDto = { content: 'updated' };

      jest.spyOn(service as any, 'findPost').mockResolvedValue(post as any);
      mockTrackService.isUserTrackCreator.mockResolvedValue(false);

      await expect(
        service.updatePost('postId', updateDto, user),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow creator to update post anytime', async () => {
      const user = new User();
      user.id = 3;
      const post = {
        id: 'postId',
        authorId: 2,
        content: 'original',
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
        discussion: { trackItem: { trackId: 'trackId' } },
      };
      const updateDto = { content: 'updated' };

      jest.spyOn(service as any, 'findPost').mockResolvedValue(post as any);
      mockTrackService.isUserTrackCreator.mockResolvedValue(true);
      mockPostRepository.save.mockResolvedValue({
        ...post,
        ...updateDto,
        isEdited: true,
      });

      const result = await service.updatePost('postId', updateDto, user);
      expect(result.content).toEqual('updated');
    });
  });
});
