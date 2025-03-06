import { Injectable } from '@nestjs/common';
import { ITranscriptionService } from '../../ai/interfaces/transcription.interface';
import { DeepgramService } from '../../ai/service/deepgram.service';
import { LoggerService } from '../../logger/logger.service';
import axios from 'axios';
import { writeFileSync } from 'fs';
import { ChatGateway } from '../../chat/gateway/chat.gateway';
@Injectable()
export class OzonetelService {
  private readonly transcriptionService: ITranscriptionService;
  private readonly logger = LoggerService.getInstance(OzonetelService.name);
  constructor(
    private deepgramService: DeepgramService,
    private chatGateway: ChatGateway,
  ) {
    this.transcriptionService = deepgramService;
  }

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
          type: 'user',
          userId: 1,
          user: {},
          role: 'client',
          room: 'user-1',
          chatId: 3,
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
    this.transcriptionService.startLiveTranscription(
      {
        type: 'user',
        userId: 1,
        user: {},
        role: 'client',
        room: 'user-1',
        chatId: 3,
      },
      3,
      async (session, chatId, transcript) => {
        await this.chatGateway.handleDeepgramTranscript(
          session,
          chatId,
          transcript,
        );
      },
    );
    return this.getStreamingXML();
  }

  private getStreamingXML() {
    return `<?xml version="1.0" encoding="UTF-8"?>
   <response>
<stream is_sip='true' url='https://3ea6d5cc8ee2ae6f762c35973d86284d.serveo.net'>513239</stream>
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
