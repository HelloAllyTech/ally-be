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
import { ApiBearerAuth, ApiTags, ApiSecurity } from '@nestjs/swagger';
import {
  AddReferenceDocument,
  SearchPublicDocuments,
  SearchTenantDocuments,
  UpdateReferenceDocument,
  BulkUploadCsv,
  GetCategories,
  GetPublicDocument,
  GetPrivateDocument,
  DeleteReferenceDocument,
  ArchiveDocument,
  UnarchiveDocument,
} from '../decorator/api-documentation.decorator';
import { ReferenceDocumentService } from '../service/reference-document.service';
import {
  AddDocumentDto,
  SearchDocumentsDto,
  UpdateReferenceDocumentDto,
} from '../dto/reference-document.dto';
import { CurrentUser } from '../../auth/decorators/user.decorator';
import { TokenUser } from '../../auth/type/auth.types';
import { Public } from '../../auth/decorators/auth.metadata';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

@ApiTags('Reference Documents')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/reference-document')
export class ReferenceDocumentController {
  constructor(private readonly documentService: ReferenceDocumentService) {}

  @AddReferenceDocument()
  @Post('')
  @AuthPermissions([PERMISSIONS.EDIT_REFERENCE_DOCUMENT])
  async addDocument(
    @CurrentUser() tokenUser: TokenUser,
    @Body() documentDto: AddDocumentDto,
  ) {
    return this.documentService.addReferenceDocument(tokenUser.id, documentDto);
  }

  @SearchPublicDocuments()
  @Public()
  @Post('search/public')
  async searchPublicDocuments(@Body() searchDto: SearchDocumentsDto) {
    return this.documentService.searchPublicDocuments(searchDto);
  }

  @SearchTenantDocuments()
  @Post('search')
  @AuthPermissions([PERMISSIONS.VIEW_REFERENCE_DOCUMENT])
  async searchTenantDocuments(@Body() searchDto: SearchDocumentsDto) {
    return this.documentService.searchTenantDocuments(searchDto);
  }

  @UpdateReferenceDocument()
  @Put(':id')
  @AuthPermissions([PERMISSIONS.EDIT_REFERENCE_DOCUMENT])
  async updateDocument(
    @Param('id') id: string,
    @Body() updateDto: UpdateReferenceDocumentDto,
  ) {
    return this.documentService.updateReferenceDocument(id, updateDto);
  }

  @BulkUploadCsv()
  @Post('upload-csv')
  @AuthPermissions([PERMISSIONS.UPLOAD_REFERENCE_DOCUMENT])
  @UseInterceptors(FileInterceptor('file'))
  async uploadCsv(
    @CurrentUser() tokenUser: TokenUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documentService.bulkCreateFromCsv(tokenUser.id, file);
  }

  @GetCategories()
  @Public()
  @Get('categories')
  async getCategories() {
    return this.documentService.getDistinctCategories();
  }

  @GetPublicDocument()
  @Public()
  @Get('public/:id')
  async getDocument(@Param('id') id: string) {
    return this.documentService.getPublicReferenceDocument(id);
  }

  @GetPrivateDocument()
  @Get(':id')
  @AuthPermissions([PERMISSIONS.VIEW_REFERENCE_DOCUMENT])
  async getPrivateDocument(@Param('id') id: string) {
    return this.documentService.getPrivateReferenceDocument(id);
  }

  @DeleteReferenceDocument()
  @Delete(':id')
  @AuthPermissions([PERMISSIONS.DELETE_REFERENCE_DOCUMENT])
  async deleteDocument(@Param('id') id: string) {
    return this.documentService.deleteReferenceDocument(id);
  }

  @ArchiveDocument()
  @Post(':id/archive')
  @AuthPermissions([PERMISSIONS.UPDATE_REFERENCE_DOCUMENT_ARCHIVE])
  async archiveDocument(@Param('id') id: string) {
    return this.documentService.archiveReferenceDocument(id);
  }

  @UnarchiveDocument()
  @Post(':id/unarchive')
  @AuthPermissions([PERMISSIONS.UPDATE_REFERENCE_DOCUMENT_ARCHIVE])
  async unarchiveDocument(@Param('id') id: string) {
    return this.documentService.unarchiveReferenceDocument(id);
  }
}
