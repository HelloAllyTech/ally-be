import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderCorrectionService } from '../service/builder-correction.service';
import {
  BUILDER_CORRECTION_CATEGORIES,
  BuilderCorrectionCategory,
} from '../entity/builder-correction.entity';

export class ScanBuilderCorrectionsDto {
  @ApiPropertyOptional({ description: 'ISO date; default three days ago' })
  @IsOptional()
  @IsDateString()
  since?: string;

  @ApiPropertyOptional({ description: 'Only this session' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}

export class ReviewBuilderCorrectionDto {
  @ApiProperty({ enum: ['reviewed', 'dismissed'] })
  @IsIn(['reviewed', 'dismissed'])
  status!: 'reviewed' | 'dismissed';

  @ApiPropertyOptional({
    description: 'Why — kept, and for a dismissal it is classifier eval data',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/**
 * The learning loop's admin surface: the corrections admins made in Builder
 * interviews, what each was routed to, and the north-star count — corrections
 * per session. EDIT_BUILDER throughout: rows hold production admin text.
 */
@ApiTags('Builder corrections')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'builder/corrections', version: '1' })
export class BuilderCorrectionsController {
  private readonly logger = LoggerService.getInstance(
    BuilderCorrectionsController.name,
  );

  constructor(private readonly corrections: BuilderCorrectionService) {}

  @Get()
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary:
      'Corrections in a window (default 30 days), with corrections per session',
  })
  list(
    @Query('since') since?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
  ) {
    return this.corrections.list({
      since: since ? new Date(since) : undefined,
      category: BUILDER_CORRECTION_CATEGORIES.includes(
        category as BuilderCorrectionCategory,
      )
        ? (category as BuilderCorrectionCategory)
        : undefined,
      status: ['new', 'reviewed', 'dismissed'].includes(String(status))
        ? (status as 'new' | 'reviewed' | 'dismissed')
        : undefined,
    });
  }

  @Post('scan')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary:
      'Classify admin replies not yet classified (runs daily on its own); returns at once',
  })
  scan(@Body() dto: ScanBuilderCorrectionsDto) {
    // In the background: a backfill is one model call per reply, and the
    // load balancer cuts a request at a minute. The list endpoint shows the
    // rows as they land.
    void this.corrections
      .scan({
        since: dto.since ? new Date(dto.since) : undefined,
        sessionId: dto.sessionId,
      })
      .catch((error: unknown) =>
        this.logger.error(
          `Corrections scan failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    return { started: true };
  }

  @Patch(':id')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Mark a correction reviewed, or dismiss it as not a correction',
  })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewBuilderCorrectionDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.corrections.review(id, dto.status, dto.note ?? null, user.id);
  }
}
