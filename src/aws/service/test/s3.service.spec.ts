import { Test, TestingModule } from '@nestjs/testing';
import { S3Service } from '../s3.service';
import { AppConfigService } from '../../../config/config.service';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  PutObjectCommandOutput,
  CreateMultipartUploadCommandOutput,
  UploadPartCommandOutput,
  CompleteMultipartUploadCommandOutput,
  AbortMultipartUploadCommandOutput,
  DeleteObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');

describe('S3Service', () => {
  let service: S3Service;
  let mockConfig: jest.Mocked<AppConfigService>;
  let mockS3Client: {
    send: jest.Mock;
  };

  const mockAwsConfig = {
    region: 'us-east-1',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
  };

  beforeEach(async () => {
    // Mock S3Client
    mockS3Client = {
      send: jest.fn(),
    } as any;

    (S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      () => mockS3Client as any,
    );

    // Mock configuration
    mockConfig = {
      aws: mockAwsConfig,
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3Service,
        {
          provide: AppConfigService,
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<S3Service>(S3Service);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize S3Client with credentials when provided', () => {
      expect(S3Client).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
      });
    });

    it('should initialize S3Client without credentials when not provided', async () => {
      const configWithoutCredentials = {
        aws: {
          region: 'us-west-2',
          accessKeyId: undefined,
          secretAccessKey: undefined,
        },
      };

      await Test.createTestingModule({
        providers: [
          S3Service,
          {
            provide: AppConfigService,
            useValue: configWithoutCredentials,
          },
        ],
      }).compile();

      expect(S3Client).toHaveBeenLastCalledWith({
        region: 'us-west-2',
      });
    });

    it('should initialize S3Client without credentials when only access key provided', async () => {
      const configWithPartialCredentials = {
        aws: {
          region: 'eu-west-1',
          accessKeyId: 'test-key',
          secretAccessKey: undefined,
        },
      };

      await Test.createTestingModule({
        providers: [
          S3Service,
          {
            provide: AppConfigService,
            useValue: configWithPartialCredentials,
          },
        ],
      }).compile();

      expect(S3Client).toHaveBeenLastCalledWith({
        region: 'eu-west-1',
      });
    });
  });

  describe('uploadStream', () => {
    it('should upload stream successfully', async () => {
      const mockParams = {
        Bucket: 'test-bucket',
        Key: 'test-key',
        Body: Buffer.from('test content'),
      };

      const mockResponse: PutObjectCommandOutput = {
        ETag: '"test-etag"',
        $metadata: {},
      };

      mockS3Client.send.mockResolvedValue(mockResponse);

      const result = await service.uploadStream(mockParams);

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(PutObjectCommand),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle upload stream error', async () => {
      const mockParams = {
        Bucket: 'test-bucket',
        Key: 'test-key',
        Body: Buffer.from('test content'),
      };

      const error = new Error('Upload failed');
      mockS3Client.send.mockRejectedValue(error);

      await expect(service.uploadStream(mockParams)).rejects.toThrow(
        'Upload failed',
      );
    });

    it('should handle upload stream with different parameters', async () => {
      const mockParams = {
        Bucket: 'another-bucket',
        Key: 'path/to/file.txt',
        Body: 'string content',
        ContentType: 'text/plain',
        Metadata: { userId: '123' },
      };

      const mockResponse: PutObjectCommandOutput = {
        ETag: '"another-etag"',
        $metadata: {},
      };

      mockS3Client.send.mockResolvedValue(mockResponse);

      const result = await service.uploadStream(mockParams);

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(PutObjectCommand),
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('generatePresignedUrl', () => {
    beforeEach(() => {
      (getSignedUrl as jest.Mock).mockResolvedValue(
        'https://presigned-url.com',
      );
    });

    it('should generate presigned URL for GET operation', async () => {
      const params = {
        bucket: 'test-bucket',
        key: 'test-key',
        operation: 'get' as const,
      };

      const result = await service.generatePresignedUrl(params);

      expect(getSignedUrl).toHaveBeenCalledWith(
        mockS3Client,
        expect.any(GetObjectCommand),
        { expiresIn: 3600 },
      );
      expect(result).toBe('https://presigned-url.com');
    });

    it('should generate presigned URL for PUT operation', async () => {
      const params = {
        bucket: 'test-bucket',
        key: 'test-key',
        operation: 'put' as const,
      };

      const result = await service.generatePresignedUrl(params);

      expect(getSignedUrl).toHaveBeenCalledWith(
        mockS3Client,
        expect.any(PutObjectCommand),
        { expiresIn: 3600 },
      );
      expect(result).toBe('https://presigned-url.com');
    });

    it('should generate presigned URL with custom expiration', async () => {
      const params = {
        bucket: 'test-bucket',
        key: 'test-key',
        operation: 'get' as const,
        expiresIn: 7200,
      };

      const result = await service.generatePresignedUrl(params);

      expect(getSignedUrl).toHaveBeenCalledWith(
        mockS3Client,
        expect.any(GetObjectCommand),
        { expiresIn: 7200 },
      );
      expect(result).toBe('https://presigned-url.com');
    });

    it('should handle presigned URL generation error', async () => {
      const params = {
        bucket: 'test-bucket',
        key: 'test-key',
        operation: 'get' as const,
      };

      const error = new Error('Presigned URL generation failed');
      (getSignedUrl as jest.Mock).mockRejectedValue(error);

      await expect(service.generatePresignedUrl(params)).rejects.toThrow(
        'Failed to generate presigned URL: Presigned URL generation failed',
      );
    });
  });

  describe('createMultipartUpload', () => {
    it('should create multipart upload successfully', async () => {
      const mockParams = {
        Bucket: 'test-bucket',
        Key: 'large-file.zip',
      };

      const mockResponse: CreateMultipartUploadCommandOutput = {
        UploadId: 'test-upload-id',
        Bucket: 'test-bucket',
        Key: 'large-file.zip',
        $metadata: {},
      };

      mockS3Client.send.mockResolvedValue(mockResponse);

      const result = await service.createMultipartUpload(mockParams);

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(CreateMultipartUploadCommand),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle create multipart upload error', async () => {
      const mockParams = {
        Bucket: 'test-bucket',
        Key: 'large-file.zip',
      };

      const error = new Error('Multipart upload creation failed');
      mockS3Client.send.mockRejectedValue(error);

      await expect(service.createMultipartUpload(mockParams)).rejects.toThrow(
        'Failed to create multipart upload: Multipart upload creation failed',
      );
    });

    it('should create multipart upload with metadata', async () => {
      const mockParams = {
        Bucket: 'test-bucket',
        Key: 'large-file.zip',
        ContentType: 'application/zip',
        Metadata: { uploadedBy: 'user123' },
      };

      const mockResponse: CreateMultipartUploadCommandOutput = {
        UploadId: 'test-upload-id-with-metadata',
        Bucket: 'test-bucket',
        Key: 'large-file.zip',
        $metadata: {},
      };

      mockS3Client.send.mockResolvedValue(mockResponse);

      const result = await service.createMultipartUpload(mockParams);

      expect(result).toEqual(mockResponse);
    });
  });

  describe('uploadPart', () => {
    it('should upload part successfully', async () => {
      const mockParams = {
        Bucket: 'test-bucket',
        Key: 'large-file.zip',
        UploadId: 'test-upload-id',
        PartNumber: 1,
        Body: Buffer.from('part content'),
      };

      const mockResponse: UploadPartCommandOutput = {
        ETag: '"part-etag"',
        $metadata: {},
      };

      mockS3Client.send.mockResolvedValue(mockResponse);

      const result = await service.uploadPart(mockParams);

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(UploadPartCommand),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle upload part error', async () => {
      const mockParams = {
        Bucket: 'test-bucket',
        Key: 'large-file.zip',
        UploadId: 'test-upload-id',
        PartNumber: 2,
        Body: Buffer.from('part content'),
      };

      const error = new Error('Part upload failed');
      mockS3Client.send.mockRejectedValue(error);

      await expect(service.uploadPart(mockParams)).rejects.toThrow(
        'Failed to upload part 2: Part upload failed',
      );
    });

    it('should upload multiple parts with different part numbers', async () => {
      const mockParams1 = {
        Bucket: 'test-bucket',
        Key: 'large-file.zip',
        UploadId: 'test-upload-id',
        PartNumber: 1,
        Body: Buffer.from('part 1 content'),
      };

      const mockParams2 = {
        Bucket: 'test-bucket',
        Key: 'large-file.zip',
        UploadId: 'test-upload-id',
        PartNumber: 2,
        Body: Buffer.from('part 2 content'),
      };

      const mockResponse1: UploadPartCommandOutput = {
        ETag: '"part1-etag"',
        $metadata: {},
      };

      const mockResponse2: UploadPartCommandOutput = {
        ETag: '"part2-etag"',
        $metadata: {},
      };

      mockS3Client.send
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2);

      const result1 = await service.uploadPart(mockParams1);
      const result2 = await service.uploadPart(mockParams2);

      expect(result1).toEqual(mockResponse1);
      expect(result2).toEqual(mockResponse2);
      expect(mockS3Client.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('completeMultipartUpload', () => {
    it('should complete multipart upload successfully', async () => {
      const mockParams = {
        Bucket: 'test-bucket',
        Key: 'large-file.zip',
        UploadId: 'test-upload-id',
        MultipartUpload: {
          Parts: [
            { ETag: '"part1-etag"', PartNumber: 1 },
            { ETag: '"part2-etag"', PartNumber: 2 },
          ],
        },
      };

      const mockResponse: CompleteMultipartUploadCommandOutput = {
        Location: 'https://test-bucket.s3.amazonaws.com/large-file.zip',
        Bucket: 'test-bucket',
        Key: 'large-file.zip',
        ETag: '"final-etag"',
        $metadata: {},
      };

      mockS3Client.send.mockResolvedValue(mockResponse);

      const result = await service.completeMultipartUpload(mockParams);

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(CompleteMultipartUploadCommand),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle complete multipart upload error', async () => {
      const mockParams = {
        Bucket: 'test-bucket',
        Key: 'large-file.zip',
        UploadId: 'test-upload-id',
        MultipartUpload: {
          Parts: [{ ETag: '"part1-etag"', PartNumber: 1 }],
        },
      };

      const error = new Error('Complete multipart upload failed');
      mockS3Client.send.mockRejectedValue(error);

      await expect(service.completeMultipartUpload(mockParams)).rejects.toThrow(
        'Failed to complete multipart upload: Complete multipart upload failed',
      );
    });
  });

  describe('abortMultipartUpload', () => {
    it('should abort multipart upload successfully', async () => {
      const mockParams = {
        Bucket: 'test-bucket',
        Key: 'large-file.zip',
        UploadId: 'test-upload-id',
      };

      const mockResponse: AbortMultipartUploadCommandOutput = {
        $metadata: {},
      };

      mockS3Client.send.mockResolvedValue(mockResponse);

      const result = await service.abortMultipartUpload(mockParams);

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(AbortMultipartUploadCommand),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle abort multipart upload error', async () => {
      const mockParams = {
        Bucket: 'test-bucket',
        Key: 'large-file.zip',
        UploadId: 'test-upload-id',
      };

      const error = new Error('Abort multipart upload failed');
      mockS3Client.send.mockRejectedValue(error);

      await expect(service.abortMultipartUpload(mockParams)).rejects.toThrow(
        'Failed to abort multipart upload: Abort multipart upload failed',
      );
    });
  });

  describe('completeMultipartUploadWithParts', () => {
    it('should complete multipart upload with parts successfully', async () => {
      const mockParams = {
        bucket: 'test-bucket',
        key: 'large-file.zip',
        uploadId: 'test-upload-id',
        parts: [
          { ETag: '"part2-etag"', PartNumber: 2 },
          { ETag: '"part1-etag"', PartNumber: 1 },
          { ETag: '"part3-etag"', PartNumber: 3 },
        ],
      };

      const mockResponse: CompleteMultipartUploadCommandOutput = {
        Location: 'https://test-bucket.s3.amazonaws.com/large-file.zip',
        Bucket: 'test-bucket',
        Key: 'large-file.zip',
        ETag: '"final-etag"',
        $metadata: {},
      };

      mockS3Client.send.mockResolvedValue(mockResponse);

      const result = await service.completeMultipartUploadWithParts(mockParams);

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(CompleteMultipartUploadCommand),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle single part', async () => {
      const mockParams = {
        bucket: 'test-bucket',
        key: 'small-file.txt',
        uploadId: 'test-upload-id',
        parts: [{ ETag: '"single-part-etag"', PartNumber: 1 }],
      };

      const mockResponse: CompleteMultipartUploadCommandOutput = {
        Location: 'https://test-bucket.s3.amazonaws.com/small-file.txt',
        Bucket: 'test-bucket',
        Key: 'small-file.txt',
        ETag: '"final-etag"',
        $metadata: {},
      };

      mockS3Client.send.mockResolvedValue(mockResponse);

      const result = await service.completeMultipartUploadWithParts(mockParams);

      expect(result).toEqual(mockResponse);
    });

    it('should handle empty parts array', async () => {
      const mockParams = {
        bucket: 'test-bucket',
        key: 'empty-file.txt',
        uploadId: 'test-upload-id',
        parts: [],
      };

      const mockResponse: CompleteMultipartUploadCommandOutput = {
        Location: 'https://test-bucket.s3.amazonaws.com/empty-file.txt',
        Bucket: 'test-bucket',
        Key: 'empty-file.txt',
        ETag: '"empty-etag"',
        $metadata: {},
      };

      mockS3Client.send.mockResolvedValue(mockResponse);

      const result = await service.completeMultipartUploadWithParts(mockParams);

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(CompleteMultipartUploadCommand),
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('deleteObject', () => {
    it('should delete object successfully', async () => {
      const mockParams = {
        bucket: 'test-bucket',
        key: 'file-to-delete.txt',
      };

      const mockResponse: DeleteObjectCommandOutput = {
        $metadata: {},
      };

      mockS3Client.send.mockResolvedValue(mockResponse);

      const result = await service.deleteObject(mockParams);

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(DeleteObjectCommand),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle delete object error', async () => {
      const mockParams = {
        bucket: 'test-bucket',
        key: 'file-to-delete.txt',
      };

      const error = new Error('Delete object failed');
      mockS3Client.send.mockRejectedValue(error);

      await expect(service.deleteObject(mockParams)).rejects.toThrow(
        'Failed to delete object file-to-delete.txt from bucket test-bucket: Delete object failed',
      );
    });

    it('should delete object with special characters in key', async () => {
      const mockParams = {
        bucket: 'test-bucket',
        key: 'folder/sub-folder/file with spaces & special chars.txt',
      };

      const mockResponse: DeleteObjectCommandOutput = {
        $metadata: {},
      };

      mockS3Client.send.mockResolvedValue(mockResponse);

      const result = await service.deleteObject(mockParams);

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(DeleteObjectCommand),
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('error handling edge cases', () => {
    it('should handle error without message property in uploadStream', async () => {
      const mockParams = {
        Bucket: 'test-bucket',
        Key: 'test-key',
        Body: Buffer.from('test content'),
      };

      const errorWithoutMessage = { code: 'UNKNOWN_ERROR' };
      mockS3Client.send.mockRejectedValue(errorWithoutMessage);

      await expect(service.uploadStream(mockParams)).rejects.toBe(
        errorWithoutMessage,
      );
    });

    it('should handle error without message property in generatePresignedUrl', async () => {
      const params = {
        bucket: 'test-bucket',
        key: 'test-key',
        operation: 'get' as const,
      };

      const errorWithoutMessage = { status: 500 };
      (getSignedUrl as jest.Mock).mockRejectedValue(errorWithoutMessage);

      await expect(service.generatePresignedUrl(params)).rejects.toThrow(
        'Failed to generate presigned URL: undefined',
      );
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete multipart upload workflow', async () => {
      // Create multipart upload
      const createResponse: CreateMultipartUploadCommandOutput = {
        UploadId: 'workflow-upload-id',
        Bucket: 'workflow-bucket',
        Key: 'workflow-file.zip',
        $metadata: {},
      };

      // Upload parts
      const part1Response: UploadPartCommandOutput = {
        ETag: '"workflow-part1-etag"',
        $metadata: {},
      };

      const part2Response: UploadPartCommandOutput = {
        ETag: '"workflow-part2-etag"',
        $metadata: {},
      };

      // Complete upload
      const completeResponse: CompleteMultipartUploadCommandOutput = {
        Location: 'https://workflow-bucket.s3.amazonaws.com/workflow-file.zip',
        Bucket: 'workflow-bucket',
        Key: 'workflow-file.zip',
        ETag: '"workflow-final-etag"',
        $metadata: {},
      };

      mockS3Client.send
        .mockResolvedValueOnce(createResponse)
        .mockResolvedValueOnce(part1Response)
        .mockResolvedValueOnce(part2Response)
        .mockResolvedValueOnce(completeResponse);

      // Execute workflow
      const createResult = await service.createMultipartUpload({
        Bucket: 'workflow-bucket',
        Key: 'workflow-file.zip',
      });

      const part1Result = await service.uploadPart({
        Bucket: 'workflow-bucket',
        Key: 'workflow-file.zip',
        UploadId: createResult.UploadId!,
        PartNumber: 1,
        Body: Buffer.from('part 1'),
      });

      const part2Result = await service.uploadPart({
        Bucket: 'workflow-bucket',
        Key: 'workflow-file.zip',
        UploadId: createResult.UploadId!,
        PartNumber: 2,
        Body: Buffer.from('part 2'),
      });

      const finalResult = await service.completeMultipartUploadWithParts({
        bucket: 'workflow-bucket',
        key: 'workflow-file.zip',
        uploadId: createResult.UploadId!,
        parts: [
          { ETag: part1Result.ETag!, PartNumber: 1 },
          { ETag: part2Result.ETag!, PartNumber: 2 },
        ],
      });

      expect(finalResult).toEqual(completeResponse);
      expect(mockS3Client.send).toHaveBeenCalledTimes(4);
    });
  });
});
