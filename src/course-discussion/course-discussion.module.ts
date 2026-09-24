import { Module } from '@nestjs/common';
import { TrackModule } from 'src/track/track.module';
import { NotificationModule } from 'src/notification/notification.module';
import { CourseDiscussionController } from './controller/course-discussion.controller';
import { CourseDiscussionService } from './service/course-discussion.service';

/** Inline learner discussions on course items — see docs/course-discussions.md. */
@Module({
  imports: [TrackModule, NotificationModule],
  controllers: [CourseDiscussionController],
  providers: [CourseDiscussionService],
})
export class CourseDiscussionModule {}
