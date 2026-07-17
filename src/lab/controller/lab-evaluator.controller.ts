import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from '../../auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { LabEvaluatorService } from '../service/lab-evaluator.service';
import { CreateLabEvaluatorDto } from '../dto/lab-eval.dto';
import { LabListQueryDto } from '../dto/lab-query.dto';

@ApiTags('AI Lab - Evaluators')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/lab/evaluators')
export class LabEvaluatorController {
  constructor(private readonly evaluatorService: LabEvaluatorService) {}

  @Get()
  @AuthPermissions([PERMISSIONS.VIEW_AI_LAB])
  @ApiOperation({ summary: 'List AI Lab human evaluators' })
  list(@Query() query: LabListQueryDto) {
    return this.evaluatorService.list(query);
  }

  @Post()
  @AuthPermissions([PERMISSIONS.EDIT_AI_LAB])
  @ApiOperation({
    summary:
      'Create an evaluator with an auto-generated password (plaintext returned once)',
  })
  create(@Body() dto: CreateLabEvaluatorDto) {
    return this.evaluatorService.create(dto);
  }

  @Post(':id/regenerate-password')
  @AuthPermissions([PERMISSIONS.EDIT_AI_LAB])
  @ApiOperation({
    summary:
      'Regenerate an evaluator password (plaintext returned once; revokes existing sessions)',
  })
  regeneratePassword(@Param('id') id: string) {
    return this.evaluatorService.regeneratePassword(id);
  }

  @Delete(':id')
  @AuthPermissions([PERMISSIONS.DELETE_AI_LAB])
  @ApiOperation({
    summary: 'Delete an evaluator (removes their assignments and answers)',
  })
  delete(@Param('id') id: string) {
    return this.evaluatorService.delete(id);
  }
}
