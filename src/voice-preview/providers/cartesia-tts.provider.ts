import axios from 'axios';
import { ITTSProvider } from './tts-provider.interface';
import { detectAudioFormat, wavToMp3 } from '../utils/audio-converter.util';

const CARTESIA_API_URL = 'https://api.cartesia.ai/tts/bytes';
const CARTESIA_API_VERSION = '2025-04-16';

export class CartesiaTTSProvider implements ITTSProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly voice: string;

  constructor(apiKey: string, config: Record<string, any>) {
    this.apiKey = apiKey;
    this.model = config.model ?? 'sonic-3';
    this.voice = config.voice;
    if (!this.voice) {
      throw new Error('Cartesia config requires "voice" field');
    }
  }

  async generatePreview(text: string, languageCode: string): Promise<Buffer> {
    // Cartesia expects a bare ISO 639-1 code (e.g. "en", "hi"), same as the
    // ally-ai-learn client — the region subtag is stripped.
    const language = (languageCode || 'en').split('-')[0];
    const response = await axios.post(
      CARTESIA_API_URL,
      {
        model_id: this.model,
        transcript: text,
        voice: { mode: 'id', id: this.voice },
        output_format: {
          container: 'wav',
          encoding: 'pcm_s16le',
          sample_rate: 24000,
        },
        language: language,
      },
      {
        headers: {
          'X-API-Key': this.apiKey,
          'Cartesia-Version': CARTESIA_API_VERSION,
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

    throw new Error(`Unsupported audio format returned by Cartesia: ${format}`);
  }
}
