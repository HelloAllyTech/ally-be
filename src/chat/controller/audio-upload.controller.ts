import { Controller, Post, Body } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { AuthRoles } from '../../auth/decorators/auth-roles.decorator';
import { UserRole } from '../../common/constants/user.constants';
import { AudioUploadService } from '../service/audio-upload.service';
import {
  AudioUploadRequestDto,
  AudioUploadResponseDto,
  CancelUploadRequestDto,
} from '../dto/audio-upload.dto';

@ApiTags('Chat Audio Upload')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chats')
export class AudioUploadController {
  constructor(private readonly audioUploadService: AudioUploadService) {}

  @Post('upload-url')
  @AuthRoles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get presigned URL for audio upload' })
  @ApiResponse({
    status: 201,
    description: 'Presigned URL generated successfully',
    type: AudioUploadResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid file type' })
  async getPresignedUploadUrl(
    @Body() audioUploadRequestDto: AudioUploadRequestDto,
  ): Promise<AudioUploadResponseDto> {
    return this.audioUploadService.getPresignedUploadUrl(audioUploadRequestDto);
  }

  @Post('cancel-upload')
  @AuthRoles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Cancel audio upload' })
  @ApiResponse({ status: 200, description: 'Audio upload cancelled' })
  async cancelUpload(@Body() cancelUploadRequestDto: CancelUploadRequestDto) {
    return this.audioUploadService.cancelUpload(cancelUploadRequestDto);
  }
}
