import { Body, Controller, Get, Post, Put, Query, Res } from '@nestjs/common';
import { AudioIngestService } from '../service/audio-ingest.service';

@Controller('v1/audio-ingest')
export class AudioIngestController {
  constructor(private readonly audioIngestService: AudioIngestService) {}

  @Get('ozonetel')
  async ozonetel(@Query() query: Record<string, string>, @Res() res: any) {
    try {
      const response = await this.audioIngestService.initiateOzonetel(query);
      res.setHeader('Content-Type', 'text/xml');
      return res.send(response);
    } catch (error) {
      console.error('Error in ozonetel:', error);
      return res
        .status(500)
        .send('<Response><Error>Internal Server Error</Error></Response>');
    }
  }

  @Post('ozonetel')
  async ozonetelPost(@Body() body: any) {
    return this.audioIngestService.initiateOzonetel(body);
  }

  @Put('ozonetel')
  async ozonetelPut(@Body() body: any) {
    return this.audioIngestService.initiateOzonetel(body);
  }
}
