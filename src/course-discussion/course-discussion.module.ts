import { TrackItem } from 'src/track/entity/track-item.entity';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CourseDiscussion } from './entity/course-discussion.entity';
import { CourseDiscussionPost } from './entity/course-discussion-post.entity';
import { CourseDiscussionService } from './service/course-discussion.service';
import { CourseDiscussionController } from './controller/course-discussion.controller';
import { NotificationModule } from 'src/notification/notification.module';
import { TrackModule } from 'src/track/track.module';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CourseDiscussion,
      CourseDiscussionPost,
      TrackItem,
    ]),
    NotificationModule,
    TrackModule,
    UserModule,
  ],
  providers: [CourseDiscussionService],
  controllers: [CourseDiscussionController],
})
export class CourseDiscussionModule {}
