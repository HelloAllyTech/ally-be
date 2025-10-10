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

  @AddReferenceDocument()
  @AuthRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('')
  async addDocument(
    @CurrentUser() tokenUser: TokenUser,
    @Body() documentDto: AddDocumentDto,
  ) {
    return this.documentService.addReferenceDocument(
      tokenUser.id,
      documentDto,
      tokenUser.role,
    );
  }

  @SearchPublicDocuments()
  @Public()
  @Post('search/public')
  async searchPublicDocuments(@Body() searchDto: SearchDocumentsDto) {
    return this.documentService.searchPublicDocuments(searchDto);
  }

  @SearchTenantDocuments()
  @AuthRoles(UserRole.COUNSELOR)
  @Post('search')
  async searchTenantDocuments(@Body() searchDto: SearchDocumentsDto) {
    return this.documentService.searchTenantDocuments(searchDto);
  }

  @UpdateReferenceDocument()
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Put(':id')
  async updateDocument(
    @Param('id') id: string,
    @Body() updateDto: UpdateReferenceDocumentDto,
  ) {
    return this.documentService.updateReferenceDocument(id, updateDto);
  }

  @BulkUploadCsv()
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Post('upload-csv')
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
  @AuthRoles(UserRole.COUNSELOR)
  @Get(':id')
  async getPrivateDocument(@Param('id') id: string) {
    return this.documentService.getPrivateReferenceDocument(id);
  }

  @DeleteReferenceDocument()
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Delete(':id')
  async deleteDocument(@Param('id') id: string) {
    return this.documentService.deleteReferenceDocument(id);
  }

  @ArchiveDocument()
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Post(':id/archive')
  async archiveDocument(@Param('id') id: string) {
    return this.documentService.archiveReferenceDocument(id);
  }

  @UnarchiveDocument()
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Post(':id/unarchive')
  async unarchiveDocument(@Param('id') id: string) {
    return this.documentService.unarchiveReferenceDocument(id);
  }
}
