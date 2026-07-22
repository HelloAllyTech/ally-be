import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { UpsertGlossarySectionDto } from '../dto/glossary-section.dto';
import { LanguageGlossaryService } from '../service/language-glossary.service';

@ApiTags('Language')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'language',
  version: '1',
})
export class LanguageGlossaryController {
  constructor(private readonly glossaryService: LanguageGlossaryService) {}

  @ApiOperation({
    summary: 'List glossary sections for a language (with token counts)',
  })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_LANGUAGES])
  @Get(':id/glossary')
  async listSections(@Param('id') id: number) {
    return this.glossaryService.listSections(Number(id));
  }

  @ApiOperation({ summary: 'Create or update a glossary section (draft edit)' })
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @Put(':id/glossary/:sectionCode')
  async upsertSection(
    @Param('id') id: number,
    @Param('sectionCode') sectionCode: string,
    @Body() dto: UpsertGlossarySectionDto,
  ) {
    return this.glossaryService.upsertSection(Number(id), sectionCode, dto);
  }

  @ApiOperation({ summary: 'Publish a glossary section (Tier 0 cap enforced)' })
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @Post(':id/glossary/:sectionCode/publish')
  async publishSection(
    @Param('id') id: number,
    @Param('sectionCode') sectionCode: string,
  ) {
    return this.glossaryService.publishSection(Number(id), sectionCode);
  }

  @ApiOperation({ summary: 'Archive a glossary section' })
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @Post(':id/glossary/:sectionCode/archive')
  async archiveSection(
    @Param('id') id: number,
    @Param('sectionCode') sectionCode: string,
  ) {
    return this.glossaryService.archiveSection(Number(id), sectionCode);
  }

  @ApiOperation({
    summary: 'Generate a draft glossary for a language (seed job, drafts only)',
  })
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @Post(':id/glossary/generate')
  async generateDraftGlossary(@Param('id') id: number) {
    return this.glossaryService.generateDraftGlossary(Number(id));
  }
}
