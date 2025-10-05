import { HttpStatus } from '@nestjs/common';
import {
  DocumentArchiveFailedException,
  DocumentUnarchiveFailedException,
  DocumentUpdateFailedException,
  SearchOperationFailedException,
} from '../reference-document.exception';

describe('Reference Document Exceptions', () => {
  it('SearchOperationFailedException should set correct message and status', () => {
    const error = new Error('original error');
    const exception = new SearchOperationFailedException('public', error);

    expect(exception.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(exception.message).toBeDefined();
    expect(exception.originalError).toBe(error);
  });

  it('DocumentUpdateFailedException should set correct message and status', () => {
    const error = new Error('update failed');
    const exception = new DocumentUpdateFailedException('123', error);

    expect(exception.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(exception.message).toBeDefined();
    expect(exception.originalError).toBe(error);
  });

  it('DocumentArchiveFailedException should set correct message and status', () => {
    const error = new Error('archive failed');
    const exception = new DocumentArchiveFailedException('456', error);

    expect(exception.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(exception.message).toBeDefined();
    expect(exception.originalError).toBe(error);
  });

  it('DocumentUnarchiveFailedException should set correct message and status', () => {
    const error = new Error('unarchive failed');
    const exception = new DocumentUnarchiveFailedException('789', error);

    expect(exception.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(exception.message).toBeDefined();
    expect(exception.originalError).toBe(error);
  });
});
