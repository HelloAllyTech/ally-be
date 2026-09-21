import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { User } from 'src/common/decorator/user.decorator';
import { User as UserEntity } from 'src/user/entity/user.entity';
import { CourseDiscussionService } from '../service/course-discussion.service';
import { CreateCourseDiscussionPostDto } from '../dto/create-course-discussion-post.dto';
import { UpdateCourseDiscussionPostDto } from '../dto/update-course-discussion-post.dto';

@Controller('v1/course-discussions')
@UseGuards(JwtAuthGuard)
export class CourseDiscussionController {
  constructor(
    private readonly courseDiscussionService: CourseDiscussionService,
  ) {}

  @Get('track-items/:trackItemId')
  getDiscussion(
    @Param('trackItemId') trackItemId: string,
    @User() user: UserEntity,
  ) {
    return this.courseDiscussionService.getDiscussion(trackItemId, user);
  }

  @Post('track-items/:trackItemId/posts')
  createPost(
    @Param('trackItemId') trackItemId: string,
    @Body() createPostDto: CreateCourseDiscussionPostDto,
    @User() user: UserEntity,
  ) {
    return this.courseDiscussionService.createPost(
      trackItemId,
      createPostDto,
      user,
    );
  }

  @Post('posts/:postId/replies')
  createReply(
    @Param('postId') postId: string,
    @Body() createPostDto: CreateCourseDiscussionPostDto,
    @User() user: UserEntity,
  ) {
    return this.courseDiscussionService.createReply(
      postId,
      createPostDto,
      user,
    );
  }

  @Put('posts/:postId')
  updatePost(
    @Param('postId') postId: string,
    @Body() updatePostDto: UpdateCourseDiscussionPostDto,
    @User() user: UserEntity,
  ) {
    return this.courseDiscussionService.updatePost(
      postId,
      updatePostDto,
      user,
    );
  }

  @Delete('posts/:postId')
  deletePost(@Param('postId') postId: string, @User() user: UserEntity) {
    return this.courseDiscussionService.deletePost(postId, user);
  }

  @Put(':discussionId/lock')
  lockDiscussion(
    @Param('discussionId') discussionId: string,
    @User() user: UserEntity,
  ) {
    return this.courseDiscussionService.lockDiscussion(discussionId, user);
  }
}
