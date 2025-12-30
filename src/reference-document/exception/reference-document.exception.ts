import { HttpException, HttpStatus } from '@nestjs/common';

export class SearchOperationFailedException extends HttpException {
  public originalError?: any;

  constructor(contextLabel: string, originalError?: any) {
    super(
      {
        message: `Failed to search ${contextLabel} reference documents`,
        error: 'Search Operation Failed',
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    this.originalError = originalError;
  }
}

export class DocumentUpdateFailedException extends HttpException {
  public originalError?: any;

  constructor(documentId: string, originalError?: any) {
    super(
      {
        message: `Failed to update document status for ID: ${documentId}`,
        error: 'Document Update Failed',
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    this.originalError = originalError;
  }
}

export class DocumentArchiveFailedException extends HttpException {
  public originalError?: any;

  constructor(documentId: string, originalError?: any) {
    super(
      {
        message: `Failed to archive document with ID: ${documentId}`,
        error: 'Document Archive Failed',
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    this.originalError = originalError;
  }
}

export class DocumentUnarchiveFailedException extends HttpException {
  public originalError?: any;

  constructor(documentId: string, originalError?: any) {
    super(
      {
        message: `Failed to unarchive document with ID: ${documentId}`,
        error: 'Document Unarchive Failed',
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    this.originalError = originalError;
  }
}
