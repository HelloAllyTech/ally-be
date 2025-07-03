import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../logger/logger.service';
import axios from 'axios';
import { writeFileSync } from 'fs';
import { ChatGateway } from '../../chat/gateway/chat.gateway';
import { TranscriptionService } from '../../ai/service/transcription.service';
@Injectable()
export class OzonetelService {
  private readonly logger = LoggerService.getInstance(OzonetelService.name);
  constructor(
    private transcriptionService: TranscriptionService,
    private chatGateway: ChatGateway,
  ) {}

  async initiateOzonetel(data: any) {
    const event = data.event;
    switch (event) {
      case 'NewCall':
        return this.handleNewCall(data);
      case 'Record':
        return this.handleRecord(data);
      case 'Hangup':
      case 'Disconnect':
        return this.handleHangup(data);
    }
    console.log(data);
    return this.handleNewCall(data);
  }
  handleHangup(data: any) {
    this.logger.info(`handleHangup ${JSON.stringify(data)}`);
  }

  async handleRecord(data: any) {
    this.logger.info(`handleRecord ${JSON.stringify(data)}`);
    const url = data.data;

    // Start processing audio asynchronously
    this.processAudio(url);

    // Respond immediately
    return this.getRecordingXML();
  }

  private async processAudio(url: string) {
    try {
      const buffer = await this.getBufferFromUrl(url);
      if (!buffer) {
        this.logger.error('No buffer found');
        return;
      }

      await this.transcriptionService.sendAudio(
        {
          id: 'user-1',
          type: 'user',
          userId: 1,
          user: {},
          role: 'client',
          room: 'user-1',
          chatId: 3,
          tenantId: '1',
        },
        buffer,
      );
    } catch (error) {
      this.logger.error(`Error processing audio: ${error.message}`);
    }
  }

  async getBufferFromUrl(url: any) {
    try {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      const audioBuffer = Buffer.from(response.data);
      writeFileSync(`audio-${new Date().getTime()}.mp3`, audioBuffer);
      return audioBuffer;
    } catch (error) {
      console.error('Error fetching audio:', error);
    }
  }
  handleNewCall(data: any) {
    this.logger.info(`handleNewCall ${JSON.stringify(data)}`);
    // TODO handle deepgram transcription and sentence completion
    this.transcriptionService.startLiveTranscription(
      {
        session: {
          id: 'user-1',
          type: 'user',
          userId: 1,
          user: {},
          role: 'client',
          room: 'user-1',
          chatId: 3,
          tenantId: '1',
        },
        chatId: 3,
      },
      this.chatGateway.handleDeepgramTranscript.bind(this.chatGateway),
    );
    return this.getStreamingXML();
  }

  private getStreamingXML() {
    return `<?xml version="1.0" encoding="UTF-8"?>
   <response>
<stream is_sip='true' url='https://api.dev.lifeline.kvsandbox.link'>513239</stream>
</response>`;
  }

  private getRecordingXML() {
    const randomName = `${new Date().getTime()}-${Math.random()
      .toString(36)
      .substring(2, 15)}`;
    return `<?xml version="1.0" encoding="UTF-8"?>
    <response sid="12345">     
    <record format="mp3" silence="3" maxduration="3" >${randomName}</record>
    </response> `;
  }

  async ingestAudio(audio: Buffer) {
    return audio;
  }
}
