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
  ListMultipartUploadsCommand,
  ListPartsCommand,
  CopyObjectCommand,
  CopyObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from 'src/logger/logger.service';

@Injectable()
export class S3Service {
  private readonly s3: S3Client;
  private readonly presignS3: S3Client;
  private readonly internalPresignS3: S3Client;
  private readonly logger = LoggerService.getInstance(S3Service.name);

  constructor(private readonly config: AppConfigService) {
    const { region, accessKeyId, secretAccessKey, sessionToken } = config.aws;
    const baseConfig: S3ClientConfig = { region };
    if (accessKeyId && secretAccessKey) {
      baseConfig.credentials = {
        accessKeyId,
        secretAccessKey,
        ...(sessionToken && { sessionToken }),
      };
    }
    // When AWS_ENDPOINT_URL is set we're talking to a custom endpoint
    // (LocalStack in dev). Force path-style addressing so direct S3 calls
    // hit `<endpoint>/<bucket>/<key>` instead of the virtual-host
    // `<bucket>.<endpoint>/<key>` form, which fails DNS lookup against
    // hostnames like "localstack".
    const usingCustomEndpoint = !!config.aws.endpointUrl;
    this.s3 = new S3Client({
      ...baseConfig,
      ...(usingCustomEndpoint && { forcePathStyle: true }),
    });

    // For local dev: AWS_ENDPOINT_URL points at localstack inside the docker
    // network, but presigned URLs returned to the browser need a host the
    // browser can resolve. AWS_S3_PRESIGN_ENDPOINT_URL overrides just the
    // presign endpoint when set; otherwise the default S3 client is reused.
    // requestChecksumCalculation=WHEN_REQUIRED disables AWS SDK v3's default
    // CRC32 checksum auto-injection — its placeholder value is signed into
    // the URL and then never matches the actual upload body, breaking PUTs.
    const presignEndpoint = process.env.AWS_S3_PRESIGN_ENDPOINT_URL;
    this.presignS3 = presignEndpoint
      ? new S3Client({
          ...baseConfig,
          endpoint: presignEndpoint,
          forcePathStyle: true,
          requestChecksumCalculation: 'WHEN_REQUIRED',
        })
      : new S3Client({
          ...baseConfig,
          requestChecksumCalculation: 'WHEN_REQUIRED',
        });

    // Service-to-service presigned URLs (e.g. audio_url sent to ally-ai via
    // SQS) need a host the *consuming container* can reach. In dev, the
    // browser-facing presign endpoint (localhost:4566) doesn't resolve from
    // inside another container. AWS_S3_INTERNAL_PRESIGN_ENDPOINT_URL lets us
    // hand out a different hostname (host.docker.internal:4566) for that
    // audience. Falls back to the browser-facing presign client when unset,
    // so prod (where neither var is set) signs against the default S3 host.
    const internalPresignEndpoint =
      process.env.AWS_S3_INTERNAL_PRESIGN_ENDPOINT_URL;
    this.internalPresignS3 = internalPresignEndpoint
      ? new S3Client({
          ...baseConfig,
          endpoint: internalPresignEndpoint,
          forcePathStyle: true,
          requestChecksumCalculation: 'WHEN_REQUIRED',
        })
      : this.presignS3;
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
    /**
     * Who consumes the URL. 'browser' (default) — returned to a frontend
     * client. 'internal' — consumed by another backend service (e.g. an
     * audio_url forwarded to ally-ai via SQS). In dev these may sign over
     * different hostnames; in prod both resolve to the same default S3 host.
     */
    audience?: 'browser' | 'internal';
  }): Promise<string> {
    const {
      bucket,
      key,
      operation,
      expiresIn = 600,
      contentType,
      metadata,
      audience = 'browser',
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

    const signer =
      audience === 'internal' ? this.internalPresignS3 : this.presignS3;

    try {
      const presignedUrl = await getSignedUrl(signer, command, {
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

  /**
   * Find the most-recent still-in-progress multipart upload for an exact key.
   * Used to recover a live-session recording whose upload was never completed
   * (abnormal session end): the parts are still in S3 as an in-progress upload
   * even though no readable object exists at the key yet. Returns the uploadId
   * or null if there is no in-progress upload (e.g. already completed/aborted).
   */
  async findInProgressMultipartUploadId(params: {
    bucket: string;
    key: string;
  }): Promise<string | null> {
    const { bucket, key } = params;
    try {
      const res = await this.s3.send(
        new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: key }),
      );
      const matches = (res.Uploads ?? [])
        .filter((u) => u.Key === key && u.UploadId)
        .sort(
          (a, b) =>
            (b.Initiated?.getTime() ?? 0) - (a.Initiated?.getTime() ?? 0),
        );
      return matches[0]?.UploadId ?? null;
    } catch (error) {
      throw new Error(
        `Failed to list in-progress multipart uploads: ${error.message}`,
      );
    }
  }

  /**
   * List the already-uploaded parts of an in-progress multipart upload
   * (paginated). Returns them in the shape completeMultipartUploadWithParts
   * expects. An empty list means nothing was ever flushed as a part (the audio
   * only lived in the in-memory buffer and is unrecoverable).
   */
  async listMultipartParts(params: {
    bucket: string;
    key: string;
    uploadId: string;
  }): Promise<Array<{ ETag: string; PartNumber: number }>> {
    const { bucket, key, uploadId } = params;
    const parts: Array<{ ETag: string; PartNumber: number }> = [];
    let partNumberMarker: string | undefined;
    try {
      do {
        const res = await this.s3.send(
          new ListPartsCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            PartNumberMarker: partNumberMarker,
          }),
        );
        for (const p of res.Parts ?? []) {
          if (p.ETag && p.PartNumber != null) {
            parts.push({ ETag: p.ETag, PartNumber: p.PartNumber });
          }
        }
        partNumberMarker = res.IsTruncated
          ? res.NextPartNumberMarker
          : undefined;
      } while (partNumberMarker);
      return parts;
    } catch (error) {
      throw new Error(`Failed to list multipart parts: ${error.message}`);
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

  /** Server-side copy an object within the same bucket. */
  async copyObject(params: {
    bucket: string;
    sourceKey: string;
    destKey: string;
  }): Promise<CopyObjectCommandOutput> {
    const { bucket, sourceKey, destKey } = params;
    try {
      return await this.s3.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${encodeURIComponent(sourceKey)}`,
          Key: destKey,
        }),
      );
    } catch (error) {
      throw new Error(
        `Failed to copy object ${sourceKey} -> ${destKey} in bucket ${bucket}: ${error.message}`,
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

  getS3Url(bucket: string, region: string, path: string): string {
    return `https://${bucket}.s3.${region}.amazonaws.com/${path}`;
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
    maxFileSizeBytes = 2 * 1024 * 1024, // 2 MB default (images); callers may raise it
  ): Promise<{ presignedUrl: string; imageUrl: string }> {
    const maxFileSize = maxFileSizeBytes;
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

  /**
   * Download an object into memory as a Buffer.
   *
   * Added for knowledge-base ingest, which needs the bytes of an uploaded PDF/DOCX/EPUB after the
   * browser has PUT them straight to S3 via a presigned URL. Every other read path here is a
   * presign or a stream, and fetching the public HTTPS URL instead would only work while the
   * bucket happens to be public-read — a fragile thing for an ingest pipeline to depend on.
   *
   * Buffers rather than streams on purpose: the parsers (pdfjs, mammoth, jszip) all take a whole
   * buffer, and the upload cap is already enforced at 50 MB, so peak memory is bounded by the same
   * limit an admin was allowed to upload.
   */
  async getObjectBuffer(params: {
    bucket: string;
    key: string;
  }): Promise<Buffer> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: params.bucket, Key: params.key }),
    );
    const body = response.Body;
    if (!body) {
      throw new BadRequestException(
        `S3 object ${params.key} returned no content`,
      );
    }
    // transformToByteArray is the SDK v3 helper on the streaming body; it works the same in Node
    // and avoids hand-rolling a stream-to-buffer collector.
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  /**
   * Split one of our own object URLs back into bucket and key.
   *
   * The knowledge-base stores the public URL on the row (matching comfort-audio), but ingest needs
   * the key to read the object back. Kept next to deleteS3Image, which parses the same shape.
   */
  parseS3Url(url: string): { bucket: string; key: string } | null {
    const match = /^https:\/\/([^.]+)\.s3\.[^.]+\.amazonaws\.com\/(.+)$/.exec(
      url,
    );
    if (match) return { bucket: match[1], key: decodeURIComponent(match[2]) };

    // LocalStack (and path-style S3) serve http://host:port/bucket/key instead.
    const pathStyle = /^https?:\/\/[^/]+\/([^/]+)\/(.+)$/.exec(url);
    if (pathStyle) {
      return {
        bucket: pathStyle[1],
        key: decodeURIComponent(pathStyle[2]),
      };
    }
    return null;
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
