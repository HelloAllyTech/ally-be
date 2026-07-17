import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RateLimit } from 'src/rate-limit/decorator/rate-limit.decorator';
import { LabEvaluatorGuard } from '../guard/lab-evaluator.guard';
import { LabEvaluatorService } from '../service/lab-evaluator.service';
import { LabEvalService } from '../service/lab-eval.service';
import { EvaluatorLoginDto, SubmitEvaluationDto } from '../dto/lab-eval.dto';

interface EvaluatorRequest {
  evaluator: { id: string; email: string };
}

/**
 * The evaluator-facing portal behind the /evaluate micro-app. Authenticated
 * with evaluator JWTs (LabEvaluatorGuard) — platform-user tokens are NOT
 * accepted here, and evaluator tokens are not accepted on platform routes.
 */
@ApiTags('AI Lab - Evaluation Portal')
@Controller('/v1/lab/eval')
export class LabEvalPortalController {
  constructor(
    private readonly evaluatorService: LabEvaluatorService,
    private readonly evalService: LabEvalService,
  ) {}

  @Post('login')
  @RateLimit({
    name: 'otp',
    key: 'ip',
    errorMessage: 'Too many login attempts. Please try again later.',
  })
  @ApiOperation({ summary: 'Evaluator login (email + admin-shared password)' })
  login(@Body() dto: EvaluatorLoginDto) {
    return this.evaluatorService.login(dto);
  }

  @Get('assignments')
  @UseGuards(LabEvaluatorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Records assigned to the authenticated evaluator' })
  assignments(@Req() req: EvaluatorRequest) {
    return this.evalService.assignmentsForEvaluator(req.evaluator.id);
  }

  @Get('assignments/:id')
  @UseGuards(LabEvaluatorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'One assigned record with its questions (and answers if submitted)',
  })
  assignment(@Req() req: EvaluatorRequest, @Param('id') id: string) {
    return this.evalService.assignmentDetail(req.evaluator.id, id);
  }

  @Post('assignments/:id/submit')
  @UseGuards(LabEvaluatorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Submit the evaluation (all questions required; immutable afterwards)',
  })
  submit(
    @Req() req: EvaluatorRequest,
    @Param('id') id: string,
    @Body() dto: SubmitEvaluationDto,
  ) {
    return this.evalService.submit(req.evaluator.id, id, dto);
  }
}
