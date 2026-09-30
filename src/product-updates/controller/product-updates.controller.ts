import {
  Body,
  Controller,
  Get,
  HttpCode,
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

import {
  GetProductUpdatesDto,
  GetProductUpdatesResponseDto,
  GetPublicProductUpdatesDto,
  GetPublicProductUpdatesResponseDto,
  ProductUpdateDto,
  ProductUpdatesStatusDto,
  TriggerProductUpdatesRunDto,
  TriggerProductUpdatesRunResponseDto,
  UpdateProductUpdateDto,
} from '../dto/product-update.dto';
import { ProductUpdatesService } from '../service/product-updates.service';

/**
 * Feature-level product updates: the public changelog feed, and the admin
 * surface for correcting it.
 *
 * Admin routes reuse `edit:blog`. Whoever may publish a blog post may correct
 * the changelog — same audience, the public page, and no permission migration.
 * Permissions are applied per route, never on the class, because the public
 * route must stay open (`AuthPermissions` ignores `@Public()`). The public
 * route and the fixed paths are declared before `:id` so neither is captured
 * as an id.
 */
@ApiTags('Product updates')
@Controller('v1/product-updates')
export class ProductUpdatesController {
  constructor(private readonly productUpdatesService: ProductUpdatesService) {}

  @Get('public')
  @Public()
  @ApiOperation({
    summary:
      'Public product updates that are live, newest first (no auth required)',
  })
  @ApiResponse({ status: 200, type: GetPublicProductUpdatesResponseDto })
  async listPublic(
    @Query() query: GetPublicProductUpdatesDto,
  ): Promise<GetPublicProductUpdatesResponseDto> {
    return this.productUpdatesService.listPublic(query);
  }

  @Get('status')
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @AuthPermissions([PERMISSIONS.EDIT_BLOG])
  @ApiOperation({
    summary: 'Pipeline state: merges by status, update counts, the last run',
  })
  @ApiResponse({ status: 200, type: ProductUpdatesStatusDto })
  async status(): Promise<ProductUpdatesStatusDto> {
    return this.productUpdatesService.status();
  }

  @Post('run')
  @HttpCode(202)
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @AuthPermissions([PERMISSIONS.EDIT_BLOG])
  @ApiOperation({
    summary:
      'Start a pipeline pass now, or a backfill of the whole journal, in the background',
  })
  @ApiResponse({ status: 202, type: TriggerProductUpdatesRunResponseDto })
  async run(
    @Body() body: TriggerProductUpdatesRunDto,
  ): Promise<TriggerProductUpdatesRunResponseDto> {
    return this.productUpdatesService.triggerRun(Boolean(body?.backfill));
  }

  @Get()
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @AuthPermissions([PERMISSIONS.EDIT_BLOG])
  @ApiOperation({ summary: 'List product updates, most recently merged first' })
  @ApiResponse({ status: 200, type: GetProductUpdatesResponseDto })
  async list(
    @Query() query: GetProductUpdatesDto,
  ): Promise<GetProductUpdatesResponseDto> {
    return this.productUpdatesService.listAdmin(query);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @AuthPermissions([PERMISSIONS.EDIT_BLOG])
  @ApiParam({ name: 'id', description: 'Product update UUID' })
  @ApiOperation({ summary: 'One product update with the merges behind it' })
  @ApiResponse({ status: 200, type: ProductUpdateDto })
  async get(@Param('id') id: string): Promise<ProductUpdateDto> {
    return this.productUpdatesService.get(id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @AuthPermissions([PERMISSIONS.EDIT_BLOG])
  @ApiParam({ name: 'id', description: 'Product update UUID' })
  @ApiOperation({
    summary:
      'Correct or hide a product update; edited fields are never rewritten automatically',
  })
  @ApiResponse({ status: 200, type: ProductUpdateDto })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateProductUpdateDto,
  ): Promise<ProductUpdateDto> {
    return this.productUpdatesService.update(id, body);
  }
}
