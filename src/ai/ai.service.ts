import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AppConfigService } from '../config/config.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  constructor(private config: AppConfigService) {}

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
}
