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

  // Admin listing — all statuses, optional search/status filters.
  async getBlogs(
    options: GetBlogsQueryDto,
  ): Promise<{ blogs: Blog[]; count: number }> {
    const {
      search,
      status,
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
    const { search, tag, limit = 20, offset = 0 } = options;

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

  // Every tag used on a published post, most-used first, for the public
  // blog's tag filter. Counted here rather than from a page of posts so a tag
  // on an older post still appears once the feed has more than one page.
  async getPublishedTagCounts(): Promise<{ tag: string; count: number }[]> {
    const rows: { tag: string; count: string }[] = await this.query(
      `SELECT t.tag AS tag, COUNT(*) AS count
       FROM "blogs" b,
         jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(b."tags") = 'array' THEN b."tags" ELSE '[]'::jsonb END
         ) AS t(tag)
       WHERE b."status" = $1
         AND b."deletedAt" IS NULL
         AND btrim(t.tag) <> ''
       GROUP BY t.tag
       ORDER BY COUNT(*) DESC, lower(t.tag) ASC`,
      [BlogStatus.PUBLISHED],
    );
    return rows.map((row) => ({ tag: row.tag, count: Number(row.count) }));
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
