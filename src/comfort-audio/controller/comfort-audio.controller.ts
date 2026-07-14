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
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from '../../auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { ComfortAudioService } from '../service/comfort-audio.service';
import {
  GetComfortAudioTracksQueryDto,
  GetComfortAudioTracksResponseDto,
} from '../dto/get-comfort-audio-tracks.dto';
import { ComfortAudioTrackResponseDto } from '../dto/comfort-audio-track-response.dto';
import {
  UploadComfortAudioUrlRequestDto,
  UploadComfortAudioUrlResponseDto,
} from '../dto/upload-comfort-audio-url.dto';
import { AddComfortAudioTrackDto } from '../dto/add-comfort-audio-track.dto';
import { UpdateComfortAudioTrackDto } from '../dto/update-comfort-audio-track.dto';

@ApiTags('Comfort Audio')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/comfort-audio')
export class ComfortAudioController {
  constructor(private readonly comfortAudioService: ComfortAudioService) {}

  @Post('upload-url')
  @AuthPermissions([PERMISSIONS.EDIT_COMFORT_AUDIO_LIBRARY])
  @ApiOperation({
    summary: 'Create a presigned URL for a comfort-audio upload',
    description:
      'Returns a presigned S3 PUT URL and the resulting public audio URL.',
  })
  @ApiBody({ type: UploadComfortAudioUrlRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Returns the presigned URL and the audio URL',
    type: UploadComfortAudioUrlResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid file type or size' })
  async createUploadUrl(
    @Body() dto: UploadComfortAudioUrlRequestDto,
  ): Promise<UploadComfortAudioUrlResponseDto> {
    return this.comfortAudioService.createUploadUrl(dto);
  }

  @Post()
  @AuthPermissions([PERMISSIONS.EDIT_COMFORT_AUDIO_LIBRARY])
  @ApiOperation({
    summary: 'Add an uploaded track to the comfort-audio library',
    description:
      'Persists a named track pointing at an S3 (or public) audio URL.',
  })
  @ApiBody({ type: AddComfortAudioTrackDto })
  @ApiResponse({
    status: 201,
    description: 'Returns the created track',
    type: ComfortAudioTrackResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid URL format' })
  async addTrack(
    @Body() dto: AddComfortAudioTrackDto,
  ): Promise<ComfortAudioTrackResponseDto> {
    return this.comfortAudioService.addTrack(dto);
  }

  @Get()
  @AuthPermissions([PERMISSIONS.VIEW_COMFORT_AUDIO_LIBRARY])
  @ApiOperation({ summary: 'List comfort-audio tracks with pagination' })
  @ApiResponse({
    status: 200,
    description: 'Returns a paginated list of tracks',
    type: GetComfortAudioTracksResponseDto,
  })
  async getTracks(
    @Query() query: GetComfortAudioTracksQueryDto,
  ): Promise<GetComfortAudioTracksResponseDto> {
    return this.comfortAudioService.getTracks(query);
  }

  @Get(':id')
  @AuthPermissions([PERMISSIONS.VIEW_COMFORT_AUDIO_LIBRARY])
  @ApiOperation({ summary: 'Get one comfort-audio track by ID' })
  @ApiParam({ name: 'id', description: 'Track UUID' })
  @ApiResponse({
    status: 200,
    description: 'Returns the track',
    type: ComfortAudioTrackResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getById(
    @Param('id') id: string,
  ): Promise<ComfortAudioTrackResponseDto> {
    return this.comfortAudioService.getById(id);
  }

  @Patch(':id')
  @AuthPermissions([PERMISSIONS.EDIT_COMFORT_AUDIO_LIBRARY])
  @ApiOperation({
    summary: 'Rename and/or archive/unarchive a comfort-audio track',
    description:
      'Archiving hides the track from the roleplay picker going forward but keeps it working for scenarios already using it. Reversible.',
  })
  @ApiParam({ name: 'id', description: 'Track UUID' })
  @ApiBody({ type: UpdateComfortAudioTrackDto })
  @ApiResponse({
    status: 200,
    description: 'Returns the updated track',
    type: ComfortAudioTrackResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateComfortAudioTrackDto,
  ): Promise<ComfortAudioTrackResponseDto> {
    return this.comfortAudioService.updateTrack(id, dto);
  }

  @Delete(':id')
  @AuthPermissions([PERMISSIONS.DELETE_COMFORT_AUDIO_LIBRARY])
  @ApiOperation({ summary: 'Delete a comfort-audio track from S3 and library' })
  @ApiParam({ name: 'id', description: 'Track UUID' })
  @ApiResponse({
    status: 200,
    description: 'Returns success status',
    schema: { type: 'object', properties: { success: { type: 'boolean' } } },
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  async delete(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.comfortAudioService.delete(id);
  }
}
