import { Injectable } from '@nestjs/common';
import { Brackets, DataSource, Repository } from 'typeorm';

import {
  BlogSortBy,
  BlogSortOrder,
  GetBlogsQueryDto,
  GetPublicBlogsQueryDto,
} from '../dto/get-blogs.dto';
import { Blog } from '../entity/blog.entity';
import { BlogStatus } from '../enum/blog-status.enum';

@Injectable()
export class BlogRepository extends Repository<Blog> {
  constructor(private readonly dataSource: DataSource) {
    super(Blog, dataSource.createEntityManager());
  }

  // Admin listing — all statuses, optional search/status/category filters.
  async getBlogs(
    options: GetBlogsQueryDto,
  ): Promise<{ blogs: Blog[]; count: number }> {
    const {
      search,
      status,
      category,
      limit = 20,
      offset = 0,
      sortBy = BlogSortBy.CREATED_AT,
      sortOrder = BlogSortOrder.DESC,
    } = options;

    const qb = this.createQueryBuilder('blog');

    if (search) {
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('blog.title ILIKE :search', { search: `%${search}%` })
            .orWhere('blog.tldr ILIKE :search', { search: `%${search}%` });
        }),
      );
    }
    if (status) {
      qb.andWhere('blog.status = :status', { status });
    }
    if (category) {
      qb.andWhere('blog.category = :category', { category });
    }

    qb.orderBy(`blog.${sortBy}`, sortOrder.toUpperCase() as 'ASC' | 'DESC')
      .limit(limit)
      .offset(offset);

    const [blogs, count] = await qb.getManyAndCount();
    return { blogs, count };
  }

  // Public listing — only published posts, newest first.
  async getPublishedBlogs(
    options: GetPublicBlogsQueryDto,
  ): Promise<{ blogs: Blog[]; count: number }> {
    const { search, category, tag, limit = 20, offset = 0 } = options;

    const qb = this.createQueryBuilder('blog').where('blog.status = :status', {
      status: BlogStatus.PUBLISHED,
    });

    if (search) {
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('blog.title ILIKE :search', { search: `%${search}%` })
            .orWhere('blog.tldr ILIKE :search', { search: `%${search}%` });
        }),
      );
    }
    if (category) {
      qb.andWhere('blog.category = :category', { category });
    }
    if (tag) {
      // tags is a jsonb string array — match membership.
      qb.andWhere('blog.tags @> :tag::jsonb', { tag: JSON.stringify([tag]) });
    }

    qb.orderBy('blog.publishedAt', 'DESC')
      .addOrderBy('blog.createdAt', 'DESC')
      .limit(limit)
      .offset(offset);

    const [blogs, count] = await qb.getManyAndCount();
    return { blogs, count };
  }

  async findPublishedBySlug(slug: string): Promise<Blog | null> {
    return this.findOne({ where: { slug, status: BlogStatus.PUBLISHED } });
  }

  // Whether a slug is already taken (optionally excluding a given post id).
  async slugExists(slug: string, excludeId?: string): Promise<boolean> {
    const qb = this.createQueryBuilder('blog').where('blog.slug = :slug', {
      slug,
    });
    if (excludeId) {
      qb.andWhere('blog.id != :excludeId', { excludeId });
    }
    return (await qb.getCount()) > 0;
  }
}
