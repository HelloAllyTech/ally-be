import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CourseDiscussion } from '../entity/course-discussion.entity';
import { CourseDiscussionPost } from '../entity/course-discussion-post.entity';
import { TrackItem } from 'src/track/entity/track-item.entity';
import { User } from 'src/user/entity/user.entity';
import { CreateCourseDiscussionPostDto } from '../dto/create-course-discussion-post.dto';
import { UpdateCourseDiscussionPostDto } from '../dto/update-course-discussion-post.dto';
import { InAppNotificationService } from 'src/notification/service/in-app-notification.service';
import { TrackService } from 'src/track/service/track.service';

@Injectable()
export class CourseDiscussionService {
  constructor(
    @InjectRepository(CourseDiscussion)
    private readonly courseDiscussionRepository: Repository<CourseDiscussion>,
    @InjectRepository(CourseDiscussionPost)
    private readonly courseDiscussionPostRepository: Repository<CourseDiscussionPost>,
    @InjectRepository(TrackItem)
    private readonly trackItemRepository: Repository<TrackItem>,
    private readonly inAppNotificationService: InAppNotificationService,
    private readonly trackService: TrackService,
  ) {}

  async getDiscussion(
    trackItemId: string,
    user: User,
  ): Promise<CourseDiscussion> {
    const trackItem = await this.trackItemRepository.findOne({
      where: { id: trackItemId },
    });
    if (!trackItem) {
      throw new NotFoundException('Track item not found');
    }
    if (!trackItem.hasDiscussion) {
      throw new NotFoundException('Discussion not enabled for this item');
    }

    const discussion = await this.courseDiscussionRepository.findOne({
      where: { trackItemId },
      relations: ['posts', 'posts.author', 'posts.replies'],
    });

    if (!discussion) {
      // Create a discussion if one doesn't exist
      const newDiscussion = this.courseDiscussionRepository.create({
        trackItemId,
        createdById: user.id, // Or a system user? For now, the user who first views it.
      });
      return this.courseDiscussionRepository.save(newDiscussion);
    }
    return discussion;
  }

  async createPost(
    trackItemId: string,
    createPostDto: CreateCourseDiscussionPostDto,
    user: User,
  ): Promise<CourseDiscussionPost> {
    const discussion = await this.getDiscussion(trackItemId, user);
    if (discussion.isLocked) {
      throw new ForbiddenException('Discussion is locked');
    }

    const post = this.courseDiscussionPostRepository.create({
      ...createPostDto,
      discussionId: discussion.id,
      authorId: user.id,
    });

    return this.courseDiscussionPostRepository.save(post);
  }

  async createReply(
    postId: string,
    createPostDto: CreateCourseDiscussionPostDto,
    user: User,
  ): Promise<CourseDiscussionPost> {
    const parentPost = await this.courseDiscussionPostRepository.findOne({
      where: { id: postId },
      relations: ['discussion'],
    });

    if (!parentPost) {
      throw new NotFoundException('Parent post not found');
    }

    if (parentPost.discussion.isLocked) {
      throw new ForbiddenException('Discussion is locked');
    }

    const reply = this.courseDiscussionPostRepository.create({
      ...createPostDto,
      discussionId: parentPost.discussionId,
      authorId: user.id,
      parentPostId: parentPost.id,
    });

    const savedReply = await this.courseDiscussionPostRepository.save(reply);

    if (parentPost.authorId !== user.id) {
      await this.inAppNotificationService.create({
        userId: parentPost.authorId,
        tenantId: parentPost.tenantId,
        type: 'new_reply',
        title: 'You have a new reply',
        body: `${user.name} replied to your post.`,
        data: {
          trackItemId: parentPost.discussion.trackItemId,
          discussionId: parentPost.discussionId,
          postId: savedReply.id,
        },
      });
    }

    return savedReply;
  }

  async updatePost(
    postId: string,
    updatePostDto: UpdateCourseDiscussionPostDto,
    user: User,
  ): Promise<CourseDiscussionPost> {
    const post = await this.findPost(postId);

    const isAuthor = post.authorId === user.id;
    const isCreator = await this.trackService.isUserTrackCreator(
      post.discussion.trackItem.trackId,
      user.id,
    );

    if (!isAuthor && !isCreator) {
      throw new ForbiddenException('You are not allowed to edit this post');
    }

    // R7: Learners can edit their own post within 15 minutes
    if (isAuthor && !isCreator) {
      const now = new Date();
      const postDate = new Date(post.createdAt);
      const diff = now.getTime() - postDate.getTime();
      const minutes = Math.floor(diff / 1000 / 60);
      if (minutes > 15) {
        throw new ForbiddenException('You can no longer edit this post');
      }
    }

    post.content = updatePostDto.content;
    post.isEdited = true;
    return this.courseDiscussionPostRepository.save(post);
  }

  async deletePost(postId: string, user: User): Promise<void> {
    const post = await this.findPost(postId);

    const isAuthor = post.authorId === user.id;
    const isCreator = await this.trackService.isUserTrackCreator(
      post.discussion.trackItem.trackId,
      user.id,
    );

    if (!isAuthor && !isCreator) {
      throw new ForbiddenException('You are not allowed to delete this post');
    }

    // R8: If a top-level post with replies is deleted, the post content is replaced
    if (!post.parentPostId && post.replies && post.replies.length > 0) {
      post.content = '[deleted by author]';
      post.isDeletedByAuthor = true;
      await this.courseDiscussionPostRepository.save(post);
    } else {
      await this.courseDiscussionPostRepository.softDelete(postId);
    }
  }

  async lockDiscussion(
    discussionId: string,
    user: User,
  ): Promise<CourseDiscussion> {
    const discussion = await this.courseDiscussionRepository.findOne({
      where: { id: discussionId },
      relations: ['trackItem'],
    });

    if (!discussion) {
      throw new NotFoundException('Discussion not found');
    }

    const isCreator = await this.trackService.isUserTrackCreator(
      discussion.trackItem.trackId,
      user.id,
    );
    if (!isCreator) {
      throw new ForbiddenException(
        'You are not allowed to lock this discussion',
      );
    }

    discussion.isLocked = true;
    return this.courseDiscussionRepository.save(discussion);
  }

  private async findPost(postId: string): Promise<CourseDiscussionPost> {
    const post = await this.courseDiscussionPostRepository.findOne({
      where: { id: postId },
      relations: ['discussion', 'discussion.trackItem', 'replies'],
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }
    return post;
  }
}
