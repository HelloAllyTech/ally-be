import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { TrackEnrollmentService } from '../service/track-enrollment.service';
import { TrackQuizService } from '../service/track-quiz.service';
import { TrackJournalService } from '../service/track-journal.service';
import { TrackAnnotationService } from '../service/track-annotation.service';
import { TrackGameService } from '../service/track-game.service';
import { VideoProgressDto } from '../dto/video-progress.dto';
import { SubmitQuizAttemptDto } from '../dto/submit-quiz-attempt.dto';
import { SubmitAnnotationAttemptDto } from '../dto/submit-annotation-attempt.dto';
import { SaveJournalDraftsDto } from '../dto/journal-entry.dto';
import { GameResultDto } from '../dto/game-result.dto';
import {
  EnrollTrackDto,
  SetTrackLanguageDto,
} from '../dto/track-translation.dto';

@ApiTags('Learn Tracks')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/learn')
export class TrackLearnerController {
  constructor(
    private readonly trackEnrollmentService: TrackEnrollmentService,
    private readonly trackQuizService: TrackQuizService,
    private readonly trackJournalService: TrackJournalService,
    private readonly trackAnnotationService: TrackAnnotationService,
    private readonly trackGameService: TrackGameService,
  ) {}

  @ApiOperation({ summary: 'List tracks available to the learner' })
  @AuthPermissions([PERMISSIONS.VIEW_TRACKS])
  @Get('tracks')
  async getTracks(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('languageCode') languageCode?: string,
  ) {
    return this.trackEnrollmentService.getTracksForLearner({
      limit,
      offset,
      languageCode,
    });
  }

  @ApiOperation({
    summary: 'Track detail with per-component progress (no answer keys)',
  })
  @AuthPermissions([PERMISSIONS.VIEW_TRACK])
  @Get('tracks/:trackId')
  async getTrackDetail(
    @Param('trackId', ParseUUIDPipe) trackId: string,
    @Query('languageCode') languageCode?: string,
  ) {
    return this.trackEnrollmentService.getTrackDetailForLearner(
      trackId,
      languageCode,
    );
  }

  @ApiOperation({ summary: 'Enroll in a track (idempotent)' })
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @Post('tracks/:trackId/enroll')
  async enroll(
    @Param('trackId', ParseUUIDPipe) trackId: string,
    @Body() dto?: EnrollTrackDto,
  ) {
    // The app language seeds the course's language when it is published in it.
    return this.trackEnrollmentService.enroll(trackId, dto?.languageCode);
  }

  @ApiOperation({
    summary: 'Languages this course is published in, plus the learner’s choice',
  })
  @AuthPermissions([PERMISSIONS.VIEW_TRACK])
  @Get('tracks/:trackId/languages')
  async getTrackLanguages(@Param('trackId', ParseUUIDPipe) trackId: string) {
    return this.trackEnrollmentService.getTrackLanguages(trackId);
  }

  @ApiOperation({
    summary:
      'Choose the language for this course. Persists on the enrollment and is the language answers are marked in.',
  })
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @Put('tracks/:trackId/language')
  async setTrackLanguage(
    @Param('trackId', ParseUUIDPipe) trackId: string,
    @Body() dto: SetTrackLanguageDto,
  ) {
    return this.trackEnrollmentService.setTrackLanguage(
      trackId,
      dto.languageCode,
    );
  }

  @ApiOperation({ summary: 'Next unlocked component in the track' })
  @AuthPermissions([PERMISSIONS.VIEW_TRACK])
  @Get('tracks/:trackId/next-item')
  async getNextItem(@Param('trackId', ParseUUIDPipe) trackId: string) {
    return this.trackEnrollmentService.getNextItem(trackId);
  }

  @ApiOperation({
    summary:
      'Open a component; returns the type-specific payload the player renders',
  })
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @Post('tracks/items/:itemId/start')
  async startItem(@Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.trackEnrollmentService.startItem(itemId);
  }

  @ApiOperation({ summary: 'Mark an article as read (completes the item)' })
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @Post('tracks/items/:itemId/article-read')
  async markArticleRead(@Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.trackEnrollmentService.markArticleRead(itemId);
  }

  @ApiOperation({
    summary: 'Report video watch progress (completes at the required pct)',
  })
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @Post('tracks/items/:itemId/video-progress')
  async reportVideoProgress(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: VideoProgressDto,
  ) {
    return this.trackEnrollmentService.reportVideoProgress(
      itemId,
      dto.watchedPct,
    );
  }

  @ApiOperation({
    summary:
      'Submit a quiz attempt; server grades (incl. LLM for open-ended) and returns per-question results',
  })
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @Post('tracks/items/:itemId/quiz-attempts')
  async submitQuizAttempt(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: SubmitQuizAttemptDto,
  ) {
    return this.trackQuizService.submitAttempt(itemId, dto.answers);
  }

  @ApiOperation({
    summary: 'Retry LLM grading for a PENDING_GRADING attempt',
  })
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @Post('tracks/items/:itemId/quiz-attempts/:attemptId/regrade')
  async regradeQuizAttempt(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
  ) {
    return this.trackQuizService.regradeAttempt(itemId, attemptId);
  }

  @ApiOperation({
    summary:
      'Submit annotation marks; server grades against the key and returns per-mark verdicts',
  })
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @Post('tracks/items/:itemId/annotation-attempts')
  async submitAnnotationAttempt(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: SubmitAnnotationAttemptDto,
  ) {
    return this.trackAnnotationService.submitAttempt(itemId, dto.marks);
  }

  @ApiOperation({
    summary: "Record a finished game run as the learner's personal best",
    description:
      'Scoreboard only — a game component completes when it is opened, so ' +
      'this never unlocks, gates or grades anything.',
  })
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @Post('tracks/items/:itemId/game-result')
  async recordGameResult(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: GameResultDto,
  ) {
    return this.trackGameService.recordResult(itemId, dto.score);
  }

  @ApiOperation({ summary: 'Autosave journal drafts' })
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @Post('tracks/items/:itemId/journal')
  async saveJournalDrafts(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: SaveJournalDraftsDto,
  ) {
    return this.trackJournalService.saveDrafts(itemId, dto.responses);
  }

  @ApiOperation({
    summary: 'Submit the journal (validates required prompts, completes item)',
  })
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @Post('tracks/items/:itemId/journal/submit')
  async submitJournal(@Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.trackJournalService.submit(itemId);
  }
}
