import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  Version,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { VoicePreviewService } from './voice-preview.service';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';

@Controller('voice-preview')
@ApiTags('Voice Preview')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class VoicePreviewController {
  constructor(private readonly voicePreviewService: VoicePreviewService) {}

  @Get('generate/:voiceId')
  @Version('1')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_VOICES])
  async generate(
    @Param('voiceId', ParseUUIDPipe) voiceId: string,
    @Query('text') text: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const voice =
      await this.voicePreviewService.getVoiceWithLanguageCode(voiceId);

    const { audioBuffer } = await this.voicePreviewService.generatePreview({
      provider: voice.provider,
      config: voice.config,
      languageCode: voice.languageCode,
      text,
    });

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': 'inline; filename=preview.mp3',
    });

    res.send(audioBuffer);
  }
}
