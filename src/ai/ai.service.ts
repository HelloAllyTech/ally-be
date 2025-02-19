import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AppConfigService } from '../config/config.service';
import { GenerateSummaryRequest, MessageRequest } from './dto/ai.request.dto';
import { GenerateSummaryResponse } from './dto/ai.response.dto';
import { createClient, DeepgramClient } from '@deepgram/sdk';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly deepgramClient: DeepgramClient;
  constructor(private config: AppConfigService) {
    this.deepgramClient = createClient(config.ai.deepgramApiKey);
  }

  // async transcribeAudioWithDeepgram(liveClient: LiveClient, audioBuffer: Buffer): Promise<string> {
  //   const live = this.deepgramClient.listen.live({ model: 'nova-3' });
  //   live.
  // }

  async transcribeAudio(audioBuffer: Buffer): Promise<string> {
    try {
      this.logger.log('🔄 Sending audio for transcription...');

      const response = await axios.post(
        `${this.config.ai.apiUrl}/transcribe`,
        audioBuffer,
        {
          headers: { 'Content-Type': 'audio/webm' },
        },
      );

      this.logger.log(`✅ Transcription received: ${response.data.text}`);
      return response.data.text; // Assuming API returns `{ text: "..." }`
    } catch (error) {
      this.logger.error(`❌ AI Service Error: ${error.message}`);
      throw new Error('AI transcription failed');
    }
  }

  async getNudge(newMessage: string, previousMessage: string) {
    try {
      this.logger.log('🔄 Requesting nudge from AI service...');
      if (!this.config.ai.apiUrl) {
        return;
      }
      const response = await axios.post(`${this.config.ai.apiUrl}/nudge`, {
        newMessage,
        previousMessage,
      });

      this.logger.log(`Nudge received: ${response.data.nudge}`);
      return response.data.nudge; // Assuming API returns `{ nudge: "..." }`
    } catch (error) {
      this.logger.error(`AI Service Error: ${error.message}`);
      throw new Error('AI nudge request failed');
    }
  }

  async generateSummary(messages: MessageRequest[]) {
    const request: GenerateSummaryRequest = {
      messages,
    };
    const response = await this.makeRequest<
      GenerateSummaryResponse,
      GenerateSummaryRequest
    >('generate-summary', request);
    return response.summary;
  }

  private async makeRequest<R, T>(endpoint: string, data: T): Promise<R> {
    const response = await axios.post(
      `${this.config.ai.apiUrl}/${endpoint}`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
    return response.data;
  }
}
