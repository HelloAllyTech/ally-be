import { Body, Controller, Param, Post, Put } from '@nestjs/common';
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

@ApiTags('Language')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'language',
  version: '1',
})
export class LanguageController {
  constructor(private readonly languageService: LanguageService) {}

  @ApiOperation({ summary: 'Create language' })
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @Post('/')
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
