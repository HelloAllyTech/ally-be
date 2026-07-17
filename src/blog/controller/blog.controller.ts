import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { Public } from 'src/auth/decorators/auth.metadata';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

import { BlogResponseDto, GetBlogsResponseDto } from '../dto/blog-response.dto';
import { CreateBlogDto } from '../dto/create-blog.dto';
import { GetBlogsQueryDto, GetPublicBlogsQueryDto } from '../dto/get-blogs.dto';
import { UpdateBlogDto } from '../dto/update-blog.dto';
import {
  UploadBlogImageRequestDto,
  UploadBlogImageResponseDto,
} from '../dto/upload-blog-image.dto';
import { BlogService } from '../service/blog.service';

@ApiTags('Blogs')
@Controller('v1/blog')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  // ---- Public (ungated) read endpoints -------------------------------------
  // Placed before the admin ':id' route so 'public' is not captured as an id.

  @Get('public')
  @Public()
  @ApiOperation({
    summary: 'List published blog posts (public, no auth required)',
  })
  @ApiResponse({ status: 200, type: GetBlogsResponseDto })
  async getPublishedBlogs(
    @Query() query: GetPublicBlogsQueryDto,
  ): Promise<GetBlogsResponseDto> {
    return this.blogService.getPublishedBlogs(query);
  }

  @Get('public/:slug')
  @Public()
  @ApiOperation({
    summary: 'Get a published blog post by slug (public, no auth required)',
  })
  @ApiParam({ name: 'slug', description: 'Post slug' })
  @ApiResponse({ status: 200, type: BlogResponseDto })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getPublishedBySlug(
    @Param('slug') slug: string,
  ): Promise<BlogResponseDto> {
    return this.blogService.getPublishedBySlug(slug);
  }

  // ---- Super-admin CRUD (permission gated) ---------------------------------

  @Post('upload-url')
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @AuthPermissions([PERMISSIONS.EDIT_BLOG])
  @ApiOperation({ summary: 'Create a presigned URL for a blog image upload' })
  @ApiResponse({ status: 201, type: UploadBlogImageResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid file type or size' })
  async createImageUploadUrl(
    @Body() body: UploadBlogImageRequestDto,
  ): Promise<UploadBlogImageResponseDto> {
    return this.blogService.createImageUploadUrl(body);
  }

  @Post()
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @AuthPermissions([PERMISSIONS.EDIT_BLOG])
  @ApiOperation({ summary: 'Create a blog post (draft or published)' })
  @ApiResponse({ status: 201, type: BlogResponseDto })
  async create(@Body() body: CreateBlogDto): Promise<BlogResponseDto> {
    return this.blogService.create(body);
  }

  @Get()
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @AuthPermissions([PERMISSIONS.VIEW_BLOGS])
  @ApiOperation({ summary: 'List blog posts (all statuses) with filters' })
  @ApiResponse({ status: 200, type: GetBlogsResponseDto })
  async getBlogs(
    @Query() query: GetBlogsQueryDto,
  ): Promise<GetBlogsResponseDto> {
    return this.blogService.getBlogs(query);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @AuthPermissions([PERMISSIONS.VIEW_BLOGS])
  @ApiOperation({ summary: 'Get a blog post by ID (any status)' })
  @ApiParam({ name: 'id', description: 'Blog UUID' })
  @ApiResponse({ status: 200, type: BlogResponseDto })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getById(@Param('id') id: string): Promise<BlogResponseDto> {
    return this.blogService.getById(id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @AuthPermissions([PERMISSIONS.EDIT_BLOG])
  @ApiOperation({ summary: 'Update a blog post' })
  @ApiParam({ name: 'id', description: 'Blog UUID' })
  @ApiResponse({ status: 200, type: BlogResponseDto })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateBlogDto,
  ): Promise<BlogResponseDto> {
    return this.blogService.update(id, body);
  }

  @Post(':id/publish')
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @AuthPermissions([PERMISSIONS.EDIT_BLOG])
  @ApiOperation({ summary: 'Publish a blog post' })
  @ApiParam({ name: 'id', description: 'Blog UUID' })
  @ApiResponse({ status: 201, type: BlogResponseDto })
  async publish(@Param('id') id: string): Promise<BlogResponseDto> {
    return this.blogService.publish(id);
  }

  @Post(':id/unpublish')
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @AuthPermissions([PERMISSIONS.EDIT_BLOG])
  @ApiOperation({ summary: 'Unpublish a blog post (back to draft)' })
  @ApiParam({ name: 'id', description: 'Blog UUID' })
  @ApiResponse({ status: 201, type: BlogResponseDto })
  async unpublish(@Param('id') id: string): Promise<BlogResponseDto> {
    return this.blogService.unpublish(id);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @AuthPermissions([PERMISSIONS.DELETE_BLOG])
  @ApiOperation({ summary: 'Delete a blog post' })
  @ApiParam({ name: 'id', description: 'Blog UUID' })
  @ApiResponse({
    status: 200,
    schema: { type: 'object', properties: { success: { type: 'boolean' } } },
  })
  async delete(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.blogService.delete(id);
  }
}
