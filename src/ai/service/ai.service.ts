import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AppConfigService } from '../../config/config.service';
import {
  EnhanceTextRequest,
  GenerateSummaryRequest,
  MessageRequest,
} from '../dto/ai.request.dto';
import {
  EnhanceTextResponse,
  GenerateSummaryResponse,
} from '../dto/ai.response.dto';
import { createClient, DeepgramClient } from '@deepgram/sdk';
import { ENDPOINTS } from '../constants/endpoints.constants';
import { NudgeRequest, NudgeResponse } from '../../chat/type/chat.type';

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

  async getNudge(
    newMessage: string,
    chat_history: MessageRequest[],
    requireNudge = false,
  ) {
    try {
      this.logger.log('🔄 Requesting nudge from AI service...');
      if (!this.config.ai.apiUrl) {
        return;
      }
      const response = await this.makeRequest<NudgeResponse, NudgeRequest>(
        ENDPOINTS.CONVERSATION,
        {
          latest_message: newMessage,
          chat_history: chat_history,
          //force_nudge: requireNudge,
        },
      );

      this.logger.log(
        `Nudge received: ${response.nudge} | stage: ${response.stage}`,
      );
      return response; // Assuming API returns `{ nudge: "..." }`
    } catch (error) {
      this.logger.error(`AI Service Error: ${error.message}`);
      throw new Error('AI nudge request failed');
    }
  }

  async generateSummaryAndTags(messages: MessageRequest[]) {
    const request: GenerateSummaryRequest = {
      chat_history: messages,
    };
    const response = await this.makeRequest<
      GenerateSummaryResponse,
      GenerateSummaryRequest
    >(ENDPOINTS.SUMMARY, request);
    return {
      summary_note: response.summary_note,
      tags: response.summary_note?.tags,
      call_quality: response.call_quality,
    };
  }

  private async makeRequest<R, T>(endpoint: string, data: T): Promise<R> {
    try {
      const url = `${this.config.ai.apiUrl}/${endpoint}`;
      this.logger.log(`🔄 Making request to ${url} | ${JSON.stringify(data)}`);
      const response = await axios.post(url, data, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      this.logger.log(
        `🔄 Response from ${url} | ${JSON.stringify(response.data)}`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(`AI Service Error: ${error.message}`);
      throw new Error('AI request failed');
    }
  }

  async enhance(summary: string) {
    const request: EnhanceTextRequest = {
      content: summary,
    };
    const response = await this.makeRequest<
      EnhanceTextResponse,
      EnhanceTextRequest
    >(ENDPOINTS.ENHANCE, request);
    return response;
  }
}
