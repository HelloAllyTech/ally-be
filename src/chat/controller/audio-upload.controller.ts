import { Controller, Post, Body } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { AudioUploadService } from '../service/audio-upload.service';
import {
  AudioUploadRequestDto,
  AudioUploadResponseDto,
  CancelUploadRequestDto,
  ProcessAudioUploadRequestDto,
} from '../dto/audio-upload.dto';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
@ApiTags('Chat Audio Upload')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chats')
export class AudioUploadController {
  constructor(private readonly audioUploadService: AudioUploadService) {}

  @Post('upload-url')
  @AuthPermissions([PERMISSIONS.VIEW_AUDIO_UPLOAD])
  @ApiOperation({ summary: 'Get presigned URL for audio upload' })
  @ApiResponse({
    status: 201,
    description: 'Presigned URL generated successfully',
    type: AudioUploadResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid file type' })
  async createChatWithUploadUrl(
    @Body() audioUploadRequestDto: AudioUploadRequestDto,
  ): Promise<AudioUploadResponseDto> {
    return this.audioUploadService.createChatWithUploadUrl(
      audioUploadRequestDto,
    );
  }

  @Post('cancel-upload')
  @AuthPermissions([PERMISSIONS.CANCEL_AUDIO_UPLOAD])
  @ApiOperation({ summary: 'Cancel audio upload' })
  @ApiResponse({ status: 200, description: 'Audio upload cancelled' })
  async cancelUpload(@Body() cancelUploadRequestDto: CancelUploadRequestDto) {
    return this.audioUploadService.cancelUpload(cancelUploadRequestDto);
  }

  @Post('process-audio-upload')
  @AuthPermissions([PERMISSIONS.VIEW_AUDIO_UPLOAD])
  @ApiOperation({ summary: 'Process audio upload' })
  @ApiResponse({ status: 200, description: 'Audio upload processed' })
  async processAudioUpload(
    @Body() processAudioUploadRequestDto: ProcessAudioUploadRequestDto,
  ) {
    return this.audioUploadService.processAudioUpload(
      processAudioUploadRequestDto.s3Key,
    );
  }
}
