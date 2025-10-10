import { applyDecorators } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';

export const AddReferenceDocument = () =>
  ApiOperation({ summary: 'Add a new reference document' });

export const SearchPublicDocuments = () =>
  ApiOperation({ summary: 'Search public reference documents' });

export const SearchTenantDocuments = () =>
  ApiOperation({ summary: 'Search organization reference documents' });

export const UpdateReferenceDocument = () =>
  ApiOperation({ summary: 'Update an existing reference document' });

export const BulkUploadCsv = () =>
  ApiOperation({ summary: 'Bulk upload reference documents via CSV' });

export const GetCategories = () =>
  ApiOperation({ summary: 'Get all distinct categories in ascending order' });

export const GetPublicDocument = () =>
  ApiOperation({ summary: 'Get a public reference document by ID' });

export const GetPrivateDocument = () =>
  ApiOperation({ summary: 'Get a reference document by ID' });

export const DeleteReferenceDocument = () =>
  ApiOperation({ summary: 'Delete a reference document' });

export const ArchiveDocument = () =>
  ApiOperation({ summary: 'Archive a reference document' });

export const UnarchiveDocument = () =>
  ApiOperation({ summary: 'Unarchive a reference document' });
