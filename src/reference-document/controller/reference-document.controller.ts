import {
  Body,
  Controller,
  Post,
  Param,
  Put,
  UseInterceptors,
  UploadedFile,
  Get,
  Delete,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiSecurity,
} from '@nestjs/swagger';
import { ReferenceDocumentService } from '../service/reference-document.service';
import {
  AddDocumentDto,
  SearchDocumentsDto,
  UpdateReferenceDocumentDto,
} from '../dto/reference-document.dto';
import { CurrentUser } from '../../auth/decorators/user.decorator';
import { TokenUser } from '../../auth/type/auth.types';
import { AuthRoles } from '../../auth/decorators/auth-roles.decorator';
import { UserRole } from '../../common/constants/user.constants';
import { Public } from '../../auth/decorators/auth.metadata';
import { FileInterceptor } from '@nestjs/platform-express';

@ApiTags('Reference Documents')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/reference-document')
export class ReferenceDocumentController {
  constructor(private readonly documentService: ReferenceDocumentService) {}

  @Post('')
  @ApiOperation({ summary: 'Add a new reference document' })
  @AuthRoles(UserRole.SUPER_ADMIN)
  async addDocument(
    @CurrentUser() tokenUser: TokenUser,
    @Body() documentDto: AddDocumentDto,
  ) {
    return this.documentService.addReferenceDocument(tokenUser.id, documentDto);
  }

  @Public()
  @Post('search/public')
  @ApiOperation({ summary: 'Search public reference documents' })
  async searchPublicDocuments(@Body() searchDto: SearchDocumentsDto) {
    return this.documentService.searchPublicDocuments(searchDto);
  }

  @Post('search')
  @ApiOperation({
    summary: 'Search organization reference documents ',
  })
  @AuthRoles(UserRole.COUNSELOR)
  async searchTenantDocuments(@Body() searchDto: SearchDocumentsDto) {
    return this.documentService.searchTenantDocuments(searchDto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an existing reference document' })
  @AuthRoles(UserRole.SUPER_ADMIN)
  async updateDocument(
    @Param('id') id: string,
    @Body() updateDto: UpdateReferenceDocumentDto,
  ) {
    return this.documentService.updateReferenceDocument(id, updateDto);
  }

  @Post('upload-csv')
  @ApiOperation({ summary: 'Bulk upload reference documents via CSV' })
  @AuthRoles(UserRole.SUPER_ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async uploadCsv(
    @CurrentUser() tokenUser: TokenUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documentService.bulkCreateFromCsv(tokenUser.id, file);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Get all distinct categories in ascending order' })
  @Public()
  async getCategories() {
    return this.documentService.getDistinctCategories();
  }

  @Get('public/:id')
  @ApiOperation({ summary: 'Get a public reference document by ID' })
  @Public()
  async getDocument(@Param('id') id: string) {
    return this.documentService.getPublicReferenceDocument(id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a reference document by ID ',
  })
  @AuthRoles(UserRole.COUNSELOR)
  async getPrivateDocument(@Param('id') id: string) {
    return this.documentService.getPrivateReferenceDocument(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a reference document' })
  @AuthRoles(UserRole.SUPER_ADMIN)
  async deleteDocument(@Param('id') id: string) {
    return this.documentService.deleteReferenceDocument(id);
  }
}
