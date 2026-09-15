import axios from 'axios';
import { ITTSProvider } from './tts-provider.interface';
import { detectAudioFormat, wavToMp3 } from '../utils/audio-converter.util';

const SMALLESTAI_API_URL = 'https://api.smallest.ai/waves/v1/tts';

export class SmallestAITTSProvider implements ITTSProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly voiceId: string;

  constructor(apiKey: string, config: Record<string, any>) {
    this.apiKey = apiKey;
    this.model = config.model ?? 'lightning_v3.1_pro';
    this.voiceId = config.voice_id ?? config.voiceId;
    if (!this.voiceId) {
      throw new Error('Smallest.ai config requires "voice_id" field');
    }
  }

  async generatePreview(text: string): Promise<Buffer> {
    const response = await axios.post(
      SMALLESTAI_API_URL,
      {
        model: this.model,
        voice_id: this.voiceId,
        sample_rate: 24000,
        language: 'en',
        output_format: 'wav',
        text,
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
        timeout: 30_000,
      },
    );

    const audioBuffer = Buffer.from(response.data);
    const format = detectAudioFormat(audioBuffer);

    if (format === 'mp3') {
      return audioBuffer;
    }

    if (format === 'wav') {
      return wavToMp3(audioBuffer);
    }

    throw new Error(
      `Unsupported audio format returned by Smallest.ai: ${format}`,
    );
  }
}
