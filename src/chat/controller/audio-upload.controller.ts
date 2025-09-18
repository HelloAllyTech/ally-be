import { Controller, Post, Body } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/user.decorator';
import { TokenUser } from '../../auth/type/auth.types';
import { AuthRoles } from '../../auth/decorators/auth-roles.decorator';
import { UserRole } from '../../common/constants/user.constants';
import { AudioUploadService } from '../service/audio-upload.service';
import {
  AudioUploadRequestDto,
  ConfirmUploadDto,
  AudioUploadResponseDto,
  ConfirmUploadResponseDto,
} from '../dto/audio-upload.dto';

@ApiTags('Chat Audio Upload')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chats')
export class AudioUploadController {
  constructor(private readonly audioUploadService: AudioUploadService) {}

  @Post('upload-url')
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Get presigned URL for audio upload' })
  @ApiResponse({
    status: 201,
    description: 'Presigned URL generated successfully',
    type: AudioUploadResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid file type' })
  async getPresignedUploadUrl(
    @CurrentUser() user: TokenUser,
    @Body() audioUploadRequestDto: AudioUploadRequestDto,
  ): Promise<AudioUploadResponseDto> {
    return this.audioUploadService.getPresignedUploadUrl(
      user.id,
      audioUploadRequestDto,
    );
  }

  @Post('confirm-upload')
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Confirm upload and start audio processing' })
  @ApiResponse({
    status: 200,
    description: 'Upload confirmed and processing started',
    type: ConfirmUploadResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'File not found or invalid request',
  })
  async confirmUpload(
    @Body() confirmUploadDto: ConfirmUploadDto,
    @CurrentUser() tokenUser: TokenUser,
  ) {
    return this.audioUploadService.confirmUploadAndStartProcessing(
      confirmUploadDto,
      tokenUser.id,
    );
  }
}
