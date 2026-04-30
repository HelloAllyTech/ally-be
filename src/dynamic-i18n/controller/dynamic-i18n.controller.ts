import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { I18nAuditLogQueryDto } from '../dto/audit-log-query.dto';
import { ListTranslationsQueryDto } from '../dto/list-translations-query.dto';
import { PublishI18nDto } from '../dto/publish-i18n.dto';
import { RollbackI18nDto } from '../dto/rollback-i18n.dto';
import { UpdateTranslationDto } from '../dto/update-translation.dto';
import { DynamicI18nService } from '../service/dynamic-i18n.service';

@ApiTags('Dynamic i18n')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'i18n',
  version: '1',
})
export class DynamicI18nController {
  constructor(private readonly dynamicI18nService: DynamicI18nService) {}

  @ApiOperation({ summary: 'Get i18n manifest, draft languages, and versions' })
  @AuthPermissions([PERMISSIONS.VIEW_I18N_TRANSLATIONS])
  @Get('status')
  async getStatus() {
    return this.dynamicI18nService.getStatus();
  }

  @ApiOperation({ summary: 'List draft translations for a language namespace' })
  @AuthPermissions([PERMISSIONS.VIEW_I18N_TRANSLATIONS])
  @Get('translations')
  async listTranslations(@Query() query: ListTranslationsQueryDto) {
    return this.dynamicI18nService.listTranslations(
      query.language,
      query.namespace,
      query.search,
    );
  }

  @ApiOperation({ summary: 'Update draft translation keys' })
  @AuthPermissions([PERMISSIONS.EDIT_I18N_TRANSLATIONS])
  @Put('translations')
  async updateTranslations(@Body() updateTranslationDto: UpdateTranslationDto) {
    return this.dynamicI18nService.updateTranslations(updateTranslationDto);
  }

  @ApiOperation({ summary: 'Get draft diff against current live version' })
  @AuthPermissions([PERMISSIONS.VIEW_I18N_TRANSLATIONS])
  @Get('diff')
  async getDiff(@Query() query: ListTranslationsQueryDto) {
    return this.dynamicI18nService.getDiff(query.language, query.namespace);
  }

  @ApiOperation({
    summary: 'Publish draft translations as a new static version',
  })
  @AuthPermissions([PERMISSIONS.EDIT_I18N_TRANSLATIONS])
  @Post('publish')
  async publish(@Body() publishI18nDto: PublishI18nDto) {
    return this.dynamicI18nService.publish(publishI18nDto.note);
  }

  @ApiOperation({ summary: 'Rollback current manifest to a retained version' })
  @AuthPermissions([PERMISSIONS.EDIT_I18N_TRANSLATIONS])
  @Post('rollback')
  async rollback(@Body() rollbackI18nDto: RollbackI18nDto) {
    return this.dynamicI18nService.rollback(
      rollbackI18nDto.version,
      rollbackI18nDto.note,
    );
  }

  @ApiOperation({ summary: 'List dynamic i18n audit log entries' })
  @AuthPermissions([PERMISSIONS.VIEW_I18N_TRANSLATIONS])
  @Get('audit-log')
  async getAuditLogs(@Query() query: I18nAuditLogQueryDto) {
    return this.dynamicI18nService.getAuditLogs(query.limit, query.offset);
  }
}
