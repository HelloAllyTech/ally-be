import { BadRequestException, Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  PutObjectCommandInput,
  PutObjectCommandOutput,
  GetObjectCommand,
  CreateMultipartUploadCommand,
  CreateMultipartUploadCommandInput,
  CreateMultipartUploadCommandOutput,
  UploadPartCommand,
  UploadPartCommandInput,
  UploadPartCommandOutput,
  CompleteMultipartUploadCommand,
  CompleteMultipartUploadCommandInput,
  CompleteMultipartUploadCommandOutput,
  AbortMultipartUploadCommand,
  AbortMultipartUploadCommandInput,
  AbortMultipartUploadCommandOutput,
  DeleteObjectCommand,
  DeleteObjectCommandInput,
  DeleteObjectCommandOutput,
  S3ClientConfig,
  HeadObjectCommand,
  HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from 'src/logger/logger.service';

@Injectable()
export class S3Service {
  private readonly s3: S3Client;
  private readonly logger = LoggerService.getInstance(S3Service.name);

  constructor(private readonly config: AppConfigService) {
    const { region, accessKeyId, secretAccessKey, sessionToken } = config.aws;
    const s3Config: S3ClientConfig = {
      region,
    };
    if (accessKeyId && secretAccessKey) {
      s3Config.credentials = {
        accessKeyId,
        secretAccessKey,
        ...(sessionToken && { sessionToken }),
      };
    }
    this.s3 = new S3Client(s3Config);
  }

  uploadStream(params: PutObjectCommandInput): Promise<PutObjectCommandOutput> {
    try {
      return this.s3.send(new PutObjectCommand(params));
    } catch (error) {
      throw new Error(`Failed to upload stream: ${error.message}`);
    }
  }

  async generatePresignedUrl(params: {
    bucket: string;
    key: string;
    operation: 'get' | 'put';
    expiresIn?: number; // seconds, default 600 (10 minutes)
    contentType?: string;
    metadata?: Record<string, string>;
  }): Promise<string> {
    const {
      bucket,
      key,
      operation,
      expiresIn = 600,
      contentType,
      metadata,
    } = params;

    const command =
      operation === 'get'
        ? new GetObjectCommand({ Bucket: bucket, Key: key })
        : new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ...(contentType && { ContentType: contentType }),
            ...(metadata && { Metadata: metadata }),
          });

    try {
      const presignedUrl = await getSignedUrl(this.s3, command, {
        expiresIn,
      });

      return presignedUrl;
    } catch (error) {
      throw new Error(`Failed to generate presigned URL: ${error.message}`);
    }
  }

  async createMultipartUpload(
    params: CreateMultipartUploadCommandInput,
  ): Promise<CreateMultipartUploadCommandOutput> {
    try {
      return await this.s3.send(new CreateMultipartUploadCommand(params));
    } catch (error) {
      throw new Error(`Failed to create multipart upload: ${error.message}`);
    }
  }

  async uploadPart(
    params: UploadPartCommandInput,
  ): Promise<UploadPartCommandOutput> {
    try {
      return await this.s3.send(new UploadPartCommand(params));
    } catch (error) {
      throw new Error(
        `Failed to upload part ${params.PartNumber}: ${error.message}`,
      );
    }
  }

  async completeMultipartUpload(
    params: CompleteMultipartUploadCommandInput,
  ): Promise<CompleteMultipartUploadCommandOutput> {
    try {
      return await this.s3.send(new CompleteMultipartUploadCommand(params));
    } catch (error) {
      throw new Error(`Failed to complete multipart upload: ${error.message}`);
    }
  }

  async abortMultipartUpload(
    params: AbortMultipartUploadCommandInput,
  ): Promise<AbortMultipartUploadCommandOutput> {
    try {
      return await this.s3.send(new AbortMultipartUploadCommand(params));
    } catch (error) {
      throw new Error(`Failed to abort multipart upload: ${error.message}`);
    }
  }

  async completeMultipartUploadWithParts(params: {
    bucket: string;
    key: string;
    uploadId: string;
    parts: Array<{ ETag: string; PartNumber: number }>;
  }): Promise<CompleteMultipartUploadCommandOutput> {
    const { bucket, key, uploadId, parts } = params;

    // Sort parts by part number
    const sortedParts = parts.sort((a, b) => a.PartNumber - b.PartNumber);

    return this.completeMultipartUpload({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sortedParts,
      },
    });
  }

  async deleteObject(params: {
    bucket: string;
    key: string;
  }): Promise<DeleteObjectCommandOutput> {
    const { bucket, key } = params;

    const deleteParams: DeleteObjectCommandInput = {
      Bucket: bucket,
      Key: key,
    };

    try {
      const result = await this.s3.send(new DeleteObjectCommand(deleteParams));
      return result;
    } catch (error) {
      throw new Error(
        `Failed to delete object ${key} from bucket ${bucket}: ${error.message}`,
      );
    }
  }

  async getHeadObject(params: {
    bucket: string;
    key: string;
  }): Promise<HeadObjectCommandOutput> {
    try {
      return await this.s3.send(
        new HeadObjectCommand({
          Bucket: params.bucket,
          Key: params.key,
        }),
      );
    } catch (error) {
      throw new Error(`Failed to get head object: ${error.message}`);
    }
  }

  sanitizeFileName(fileName: string, maxLength: number = 128): string {
    // Remove any path traversal attempts and dangerous characters
    return fileName
      .trim()
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/[^a-zA-Z0-9._-]/g, '') // Remove special characters
      .replace(/\.+/g, '.') // Replace multiple dots with single dot
      .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
      .replace(/\.{2,}/g, '.') // Prevent directory traversal
      .replace(/^\.+/, '') // Remove leading dots
      .toLowerCase()
      .substring(0, maxLength); // Limit length
  }

  async getPresignedUrlForImageUpload(
    bucket: string,
    storageFolder: string,
    fileName: string,
    fileSize: number,
    contentType: string,
  ): Promise<{ presignedUrl: string; imageUrl: string }> {
    const maxFileSize = 2 * 1024 * 1024; // 2 MB
    if (fileSize > maxFileSize) {
      throw new BadRequestException(
        `File size must be less than ${maxFileSize / 1024 / 1024} MB`,
      );
    }

    const sanitizedFileName = this.sanitizeFileName(fileName);

    const storageKey = `${storageFolder}/${Date.now()}-${sanitizedFileName}`;
    const presignedUrl = await this.generatePresignedUrl({
      bucket,
      key: storageKey,
      operation: 'put',
      expiresIn: 600, // 10 minutes
      contentType,
    });

    const region = this.config.aws.region;
    const imageUrl = `https://${bucket}.s3.${region}.amazonaws.com/${storageKey}`;

    return { presignedUrl, imageUrl };
  }

  async deleteS3Image(bucket: string, imageUrl: string) {
    const s3ImageUrlPattern =
      /^https:\/\/[^.]+\.s3\.[^.]+\.amazonaws\.com\/(.+)$/;
    const imageUrlMatch = imageUrl.match(s3ImageUrlPattern);

    const storageKey = imageUrlMatch ? imageUrlMatch[1] : null;
    if (!storageKey) {
      this.logger.warn(`Invalid or unrecognized S3 URL: ${imageUrl}`);
      return { success: false };
    }

    try {
      await this.deleteObject({
        bucket,
        key: storageKey,
      });
      return { success: true };
    } catch (error) {
      this.logger.error(
        `Failed to delete uploaded image with error ${JSON.stringify(error)}`,
      );
      return { success: false };
    }
  }
}
