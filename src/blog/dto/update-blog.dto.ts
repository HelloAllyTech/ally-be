import { PartialType } from '@nestjs/swagger';

import { CreateBlogDto } from './create-blog.dto';

// All fields optional — mirror the create shape (title, slug, tldr, body, tags,
// authorName, coverColor, headerImageUrl, status).
export class UpdateBlogDto extends PartialType(CreateBlogDto) {}
