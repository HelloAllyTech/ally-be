import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

import { S3Service } from 'src/aws/service/s3.service';
import { AppConfigService } from 'src/config/config.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import isDuplicateKeyException, {
  NotFoundException,
} from 'src/exception/custom.exception';
import { LoggerService } from 'src/logger/logger.service';

import {
  BLOG_IMAGE_MAX_SIZE_BYTES,
  BLOG_IMAGE_S3_PREFIX,
} from '../constants/blog.constants';
import { BlogResponseDto, GetBlogsResponseDto } from '../dto/blog-response.dto';
import { CreateBlogDto } from '../dto/create-blog.dto';
import { GetBlogsQueryDto, GetPublicBlogsQueryDto } from '../dto/get-blogs.dto';
import { UpdateBlogDto } from '../dto/update-blog.dto';
import {
  UploadBlogImageRequestDto,
  UploadBlogImageResponseDto,
} from '../dto/upload-blog-image.dto';
import { Blog } from '../entity/blog.entity';
import { BlogImageUploadContentType } from '../enum/blog-image-upload-content-type.enum';
import { BlogStatus } from '../enum/blog-status.enum';
import { BlogRepository } from '../repository/blog.repository';
import { sanitizeBlogHtml } from '../util/sanitize-blog-html.util';
import { slugify } from '../util/slug.util';

@Injectable()
export class BlogService {
  private readonly logger = LoggerService.getInstance(BlogService.name);

  constructor(
    private readonly blogRepository: BlogRepository,
    private readonly s3Service: S3Service,
    private readonly configService: AppConfigService,
  ) {}

  private getBucket(): string {
    const bucket = this.configService.s3.assetsBucket;
    if (!bucket) {
      throw new InternalServerErrorException(
        'S3 bucket name for assetsBucket is not defined',
      );
    }
    return bucket;
  }

  private getUserId(): number {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('unauthorized access');
    }
    return Number(userId);
  }

  private toResponseDto(entity: Blog): BlogResponseDto {
    return {
      id: entity.id,
      title: entity.title,
      slug: entity.slug,
      tldr: entity.tldr ?? null,
      body: entity.body ?? null,
      tags: entity.tags ?? [],
      category: entity.category ?? null,
      authorName: entity.authorName ?? null,
      headerImageUrl: entity.headerImageUrl ?? null,
      status: entity.status,
      publishedAt: entity.publishedAt ?? null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  // Produce a unique slug, deriving from the title when none is supplied and
  // appending a numeric suffix on collision.
  private async resolveSlug(
    desired: string | undefined,
    fallbackTitle: string,
    excludeId?: string,
  ): Promise<string> {
    const base = slugify(desired || fallbackTitle) || 'post';
    let candidate = base;
    let suffix = 1;
    while (await this.blogRepository.slugExists(candidate, excludeId)) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }

  // ---- Image upload (presigned S3 URL) --------------------------------------

  async createImageUploadUrl(
    image: UploadBlogImageRequestDto,
  ): Promise<UploadBlogImageResponseDto> {
    const bucket = this.getBucket();
    if (
      !Object.values(BlogImageUploadContentType).includes(image.contentType)
    ) {
      throw new BadRequestException('Invalid file type');
    }
    this.getUserId();

    const { presignedUrl, imageUrl } =
      await this.s3Service.getPresignedUrlForImageUpload(
        bucket,
        BLOG_IMAGE_S3_PREFIX,
        image.fileName,
        image.fileSize,
        image.contentType,
        BLOG_IMAGE_MAX_SIZE_BYTES,
      );

    return { presignedUrl, imageUrl };
  }

  // ---- Admin CRUD -----------------------------------------------------------

  async create(dto: CreateBlogDto): Promise<BlogResponseDto> {
    const userId = this.getUserId();
    const status = dto.status ?? BlogStatus.DRAFT;
    const slug = await this.resolveSlug(dto.slug, dto.title);

    const blog = this.blogRepository.create({
      title: dto.title,
      slug,
      tldr: dto.tldr ?? null,
      body: sanitizeBlogHtml(dto.body) ?? null,
      tags: dto.tags ?? [],
      category: dto.category ?? null,
      authorName: dto.authorName ?? null,
      headerImageUrl: dto.headerImageUrl ?? null,
      status,
      publishedAt: status === BlogStatus.PUBLISHED ? new Date() : null,
      createdBy: userId,
      updatedBy: userId,
    });

    try {
      const saved = await this.blogRepository.save(blog);
      this.logger.info(`Blog created: ${saved.id}`);
      return this.toResponseDto(saved);
    } catch (error) {
      if (isDuplicateKeyException(error)) {
        throw new ConflictException(
          `A blog with slug '${slug}' already exists`,
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateBlogDto): Promise<BlogResponseDto> {
    const existing = await this.blogRepository.findOne({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Blog with ID ${id} not found`);
    }
    const userId = this.getUserId();

    if (dto.title !== undefined) existing.title = dto.title;
    if (dto.slug !== undefined) {
      existing.slug = await this.resolveSlug(dto.slug, existing.title, id);
    }
    if (dto.tldr !== undefined) existing.tldr = dto.tldr ?? null;
    if (dto.body !== undefined) {
      existing.body = sanitizeBlogHtml(dto.body) ?? null;
    }
    if (dto.tags !== undefined) existing.tags = dto.tags ?? [];
    if (dto.category !== undefined) existing.category = dto.category ?? null;
    if (dto.authorName !== undefined) {
      existing.authorName = dto.authorName ?? null;
    }
    if (dto.headerImageUrl !== undefined) {
      existing.headerImageUrl = dto.headerImageUrl ?? null;
    }
    if (dto.status !== undefined && dto.status !== existing.status) {
      this.applyStatusTransition(existing, dto.status);
    }
    existing.updatedBy = userId;

    try {
      const saved = await this.blogRepository.save(existing);
      this.logger.info(`Blog updated: ${saved.id}`);
      return this.toResponseDto(saved);
    } catch (error) {
      if (isDuplicateKeyException(error)) {
        throw new ConflictException(
          `A blog with slug '${existing.slug}' already exists`,
        );
      }
      throw error;
    }
  }

  // Set publishedAt on first publish; keep the original publish date on
  // re-publish; clear it on unpublish (back to draft).
  private applyStatusTransition(blog: Blog, next: BlogStatus): void {
    if (next === BlogStatus.PUBLISHED) {
      blog.publishedAt = blog.publishedAt ?? new Date();
    } else {
      blog.publishedAt = null;
    }
    blog.status = next;
  }

  async publish(id: string): Promise<BlogResponseDto> {
    return this.setStatus(id, BlogStatus.PUBLISHED);
  }

  async unpublish(id: string): Promise<BlogResponseDto> {
    return this.setStatus(id, BlogStatus.DRAFT);
  }

  private async setStatus(
    id: string,
    status: BlogStatus,
  ): Promise<BlogResponseDto> {
    const existing = await this.blogRepository.findOne({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Blog with ID ${id} not found`);
    }
    this.applyStatusTransition(existing, status);
    existing.updatedBy = this.getUserId();
    const saved = await this.blogRepository.save(existing);
    this.logger.info(`Blog ${id} status set to ${status}`);
    return this.toResponseDto(saved);
  }

  async getBlogs(query: GetBlogsQueryDto): Promise<GetBlogsResponseDto> {
    const { blogs, count } = await this.blogRepository.getBlogs(query);
    return { blogs: blogs.map((b) => this.toResponseDto(b)), count };
  }

  async getById(id: string): Promise<BlogResponseDto> {
    const blog = await this.blogRepository.findOne({ where: { id } });
    if (!blog) {
      throw new NotFoundException(`Blog with ID ${id} not found`);
    }
    return this.toResponseDto(blog);
  }

  async delete(id: string): Promise<{ success: boolean }> {
    const blog = await this.blogRepository.findOne({ where: { id } });
    if (!blog) {
      throw new NotFoundException(`Blog with ID ${id} not found`);
    }
    // Soft delete (entity has @DeleteDateColumn). Header image is intentionally
    // left in S3 so a restore keeps working; hard cleanup can be added later.
    await this.blogRepository.softDelete(id);
    this.logger.info(`Blog soft-deleted: ${id}`);
    return { success: true };
  }

  // ---- Public read ----------------------------------------------------------

  async getPublishedBlogs(
    query: GetPublicBlogsQueryDto,
  ): Promise<GetBlogsResponseDto> {
    const { blogs, count } = await this.blogRepository.getPublishedBlogs(query);
    return { blogs: blogs.map((b) => this.toResponseDto(b)), count };
  }

  async getPublishedBySlug(slug: string): Promise<BlogResponseDto> {
    const blog = await this.blogRepository.findPublishedBySlug(slug);
    if (!blog) {
      throw new NotFoundException(`Published blog '${slug}' not found`);
    }
    return this.toResponseDto(blog);
  }
}
