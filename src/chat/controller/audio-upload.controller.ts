import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import {
  GetPresignedUploadUrl,
  CancelAudioUpload,
} from '../decorators/audio-upload-api-documentation.decorators';
import { AudioUploadService } from '../service/audio-upload.service';
import {
  AudioUploadRequestDto,
  AudioUploadResponseDto,
  CancelUploadRequestDto,
} from '../dto/audio-upload.dto';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
@ApiTags('Chat Audio Upload')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chats')
export class AudioUploadController {
  constructor(private readonly audioUploadService: AudioUploadService) {}

  @GetPresignedUploadUrl()
  @AuthPermissions([PERMISSIONS.VIEW_AUDIO_UPLOAD])
  @Post('upload-url')
  async createChatWithUploadUrl(
    @Body() audioUploadRequestDto: AudioUploadRequestDto,
  ): Promise<AudioUploadResponseDto> {
    return this.audioUploadService.createChatWithUploadUrl(
      audioUploadRequestDto,
    );
  }

  @CancelAudioUpload()
  @AuthPermissions([PERMISSIONS.CANCEL_AUDIO_UPLOAD])
  @Post('cancel-upload')
  async cancelUpload(@Body() cancelUploadRequestDto: CancelUploadRequestDto) {
    return this.audioUploadService.cancelUpload(cancelUploadRequestDto);
  }
}
