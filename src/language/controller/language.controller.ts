import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { LanguageService } from '../service/language.service';
import { UpdateLanguageDto } from '../dto/update-language.dto';
import { CreateLanguagesDto } from '../dto/create-languages.dto';
import { SortOrder } from 'src/user/enum/user.enum';
import { Languages } from '../entity/languages.entity';

@ApiTags('Language')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'language',
  version: '1',
})
export class LanguageController {
  constructor(private readonly languageService: LanguageService) {}

  @ApiOperation({ summary: 'Get Languages' })
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_LANGUAGES])
  @Get('')
  async getLanguages(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: string,
    @Query('order') order: SortOrder = SortOrder.ASC,
    @Query('searchName') searchName?: string,
  ): Promise<Languages[]> {
    return this.languageService.getLanguages(searchName, {
      limit,
      offset,
      sortBy,
      order,
    });
  }

  @ApiOperation({ summary: 'Create language' })
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @Post('')
  async createLanguage(@Body() createLanguagesDto: CreateLanguagesDto) {
    return this.languageService.createLanguages(createLanguagesDto);
  }

  @ApiOperation({ summary: 'Update a language' })
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @Put(':id')
  async updateLanguage(
    @Param('id') id: number,
    @Body() updateLanguageDto: UpdateLanguageDto,
  ) {
    return this.languageService.updateLanguage(id, updateLanguageDto);
  }
}
