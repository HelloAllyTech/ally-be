import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AudioUploadResponseDto } from '../dto/audio-upload.dto';

export const GetPresignedUploadUrl = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get presigned URL for audio upload' }),
    ApiResponse({
      status: 201,
      description: 'Presigned URL generated successfully',
      type: AudioUploadResponseDto,
    }),
    ApiResponse({ status: 400, description: 'Invalid file type' }),
  );

export const CancelAudioUpload = () =>
  applyDecorators(
    ApiOperation({ summary: 'Cancel audio upload' }),
    ApiResponse({ status: 200, description: 'Audio upload cancelled' }),
  );
