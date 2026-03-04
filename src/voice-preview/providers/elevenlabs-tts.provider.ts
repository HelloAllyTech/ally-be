import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { ITTSProvider } from './tts-provider.interface';

export class ElevenLabsTTSProvider implements ITTSProvider {
  private readonly client: ElevenLabsClient;
  private readonly voiceId: string;
  private readonly modelId: string;

  constructor(apiKey: string, config: Record<string, any>) {
    this.client = new ElevenLabsClient({ apiKey });
    this.voiceId = config.voice_id ?? config.voiceId;
    this.modelId = config.model_id ?? config.model ?? 'eleven_multilingual_v2';
    if (!this.voiceId) {
      throw new Error(
        'ElevenLabs config requires "voice_id" or "voiceId" field',
      );
    }
  }

  async generatePreview(text: string): Promise<Buffer> {
    const audioStream = await this.client.textToSpeech.convert(this.voiceId, {
      text,
      modelId: this.modelId,
      outputFormat: 'mp3_44100_128',
    });

    const chunks: Uint8Array[] = [];
    for await (const chunk of audioStream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }

    return Buffer.concat(chunks);
  }
}
