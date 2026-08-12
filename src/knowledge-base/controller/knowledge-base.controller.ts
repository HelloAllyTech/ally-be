import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from '../../auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import {
  CreateKbDocumentDto,
  CreateKbUploadUrlDto,
  GetKbChunksResponseDto,
  GetKbDocumentsQueryDto,
  GetKbDocumentsResponseDto,
  KbDocumentResponseDto,
  KbSearchDto,
  KbStatsResponseDto,
  KbUploadUrlResponseDto,
  ReplaceKbDocumentContentDto,
  UpdateKbDocumentDto,
} from '../dto/knowledge-base.dto';
import { KnowledgeBaseService } from '../service/knowledge-base.service';

/**
 * Knowledge corpus for the WhatsApp Q&A bot.
 *
 * Gated to SUPER_DUPER_ADMIN via the knowledge-base permissions (migration 1892000000007).
 * Everything here is admin-only: the corpus is what the bot tells mental healthcare workers, so
 * write access is the ability to change clinical guidance at scale.
 */
@ApiTags('Knowledge Base')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/knowledge-base')
export class KnowledgeBaseController {
  constructor(private readonly knowledgeBaseService: KnowledgeBaseService) {}

  @Post('documents/upload-url')
  @AuthPermissions([PERMISSIONS.UPLOAD_KNOWLEDGE_BASE])
  @ApiOperation({
    summary: 'Presigned S3 PUT for a corpus document (pdf/docx/epub)',
    description:
      'The browser uploads straight to S3 and passes the returned fileUrl to POST /documents. ' +
      'Presigned rather than multipart because the global express.json limit is 1 MB.',
  })
  @ApiResponse({ status: 201, type: KbUploadUrlResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Unsupported type or oversized file',
  })
  createUploadUrl(
    @Body() dto: CreateKbUploadUrlDto,
  ): Promise<KbUploadUrlResponseDto> {
    return this.knowledgeBaseService.createUploadUrl(dto);
  }

  @Post('documents')
  @AuthPermissions([PERMISSIONS.EDIT_KNOWLEDGE_BASE])
  @ApiOperation({
    summary: 'Create a document and queue it for indexing',
    description:
      'Returns immediately at status=pending. Extraction, chunking and indexing run on the ' +
      'ingest queue, so poll the document (or the list) to watch progress.',
  })
  @ApiResponse({ status: 201, type: KbDocumentResponseDto })
  create(@Body() dto: CreateKbDocumentDto): Promise<KbDocumentResponseDto> {
    return this.knowledgeBaseService.create(dto);
  }

  @Get('documents')
  @AuthPermissions([PERMISSIONS.VIEW_KNOWLEDGE_BASE])
  @ApiOperation({ summary: 'List corpus documents' })
  @ApiResponse({ status: 200, type: GetKbDocumentsResponseDto })
  list(
    @Query() dto: GetKbDocumentsQueryDto,
  ): Promise<GetKbDocumentsResponseDto> {
    return this.knowledgeBaseService.list(dto);
  }

  @Get('stats')
  @AuthPermissions([PERMISSIONS.VIEW_KNOWLEDGE_BASE])
  @ApiOperation({ summary: 'Corpus totals by status, for the stats strip' })
  @ApiResponse({ status: 200, type: KbStatsResponseDto })
  stats(): Promise<KbStatsResponseDto> {
    return this.knowledgeBaseService.stats();
  }

  @Post('search')
  @AuthPermissions([PERMISSIONS.VIEW_KNOWLEDGE_BASE])
  @ApiOperation({
    summary: 'Retrieval preview — no LLM call',
    description:
      'Returns exactly the passages the agent would retrieve, so thresholds can be tuned ' +
      'without spending generation tokens or being confounded by the prompt.',
  })
  search(@Body() dto: KbSearchDto) {
    return this.knowledgeBaseService.search(dto);
  }

  // ORDER MATTERS: 'chunks/:chunkId' must stay above 'documents/:id' patterns that could also
  // match a two-segment path. Kept adjacent so the ordering is visible rather than incidental.
  @Get('chunks/:chunkId')
  @AuthPermissions([PERMISSIONS.VIEW_KNOWLEDGE_BASE])
  @ApiOperation({
    summary: 'Resolve one chunk',
    description:
      'How the conversation log turns a citation into the exact passage that was quoted.',
  })
  getChunk(@Param('chunkId', ParseUUIDPipe) chunkId: string) {
    return this.knowledgeBaseService.getChunk(chunkId);
  }

  @Get('documents/:id')
  @AuthPermissions([PERMISSIONS.VIEW_KNOWLEDGE_BASE])
  @ApiOperation({ summary: 'One document, with its ingest status' })
  @ApiResponse({ status: 200, type: KbDocumentResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<KbDocumentResponseDto> {
    return this.knowledgeBaseService.get(id);
  }

  @Get('documents/:id/chunks')
  @AuthPermissions([PERMISSIONS.VIEW_KNOWLEDGE_BASE])
  @ApiOperation({
    summary: 'A document chunks — what the bot can actually see',
  })
  @ApiResponse({ status: 200, type: GetKbChunksResponseDto })
  listChunks(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<GetKbChunksResponseDto> {
    return this.knowledgeBaseService.listChunks(id, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Patch('documents/:id')
  @AuthPermissions([PERMISSIONS.EDIT_KNOWLEDGE_BASE])
  @ApiOperation({
    summary: 'Update metadata only',
    description: 'Title, tags and language. Never triggers a re-index.',
  })
  @ApiResponse({ status: 200, type: KbDocumentResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKbDocumentDto,
  ): Promise<KbDocumentResponseDto> {
    return this.knowledgeBaseService.update(id, dto);
  }

  @Put('documents/:id/content')
  @AuthPermissions([PERMISSIONS.EDIT_KNOWLEDGE_BASE])
  @ApiOperation({
    summary: 'Replace a pasted document body and re-index',
    description:
      'Pasted documents only — for a file-backed document the file is the content. A no-op when ' +
      'the text is unchanged, so an accidental save does not re-embed hundreds of passages.',
  })
  @ApiResponse({ status: 200, type: KbDocumentResponseDto })
  @ApiResponse({ status: 400, description: 'Not a pasted document' })
  replaceContent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceKbDocumentContentDto,
  ): Promise<KbDocumentResponseDto> {
    return this.knowledgeBaseService.replaceContent(id, dto);
  }

  @Post('documents/:id/reindex')
  @AuthPermissions([PERMISSIONS.EDIT_KNOWLEDGE_BASE])
  @ApiOperation({
    summary:
      'Re-chunk and re-index; also the Retry action for a failed document',
  })
  @ApiResponse({ status: 200, type: KbDocumentResponseDto })
  reindex(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<KbDocumentResponseDto> {
    return this.knowledgeBaseService.reindex(id);
  }

  @Post('documents/:id/archive')
  @AuthPermissions([PERMISSIONS.EDIT_KNOWLEDGE_BASE_ARCHIVE])
  @ApiOperation({
    summary: 'Archive: stop retrieving it, keep its rows',
    description:
      'Deletes the vectors so the bot stops using it, while keeping the chunks so citations ' +
      'already in the conversation log still resolve.',
  })
  @ApiResponse({ status: 200, type: KbDocumentResponseDto })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<KbDocumentResponseDto> {
    return this.knowledgeBaseService.archive(id);
  }

  @Post('documents/:id/unarchive')
  @AuthPermissions([PERMISSIONS.EDIT_KNOWLEDGE_BASE_ARCHIVE])
  @ApiOperation({
    summary: 'Unarchive and re-index (archiving removed the vectors)',
  })
  @ApiResponse({ status: 200, type: KbDocumentResponseDto })
  unarchive(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<KbDocumentResponseDto> {
    return this.knowledgeBaseService.unarchive(id);
  }

  @Delete('documents/:id')
  @AuthPermissions([PERMISSIONS.EDIT_KNOWLEDGE_BASE_ARCHIVE])
  @ApiOperation({
    summary: 'Refused — always 409, pointing at archive',
    description:
      'Deleting a document orphans every citation recorded against it, so the conversation log ' +
      'would show answers whose sources cannot be resolved. Exists as an endpoint so the ' +
      'refusal is explicit rather than a 404.',
  })
  @ApiResponse({ status: 409, description: 'Archive the document instead' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<never> {
    return this.knowledgeBaseService.remove(id);
  }
}
