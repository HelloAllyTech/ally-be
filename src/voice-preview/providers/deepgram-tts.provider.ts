import { DeepgramClient } from '@deepgram/sdk';
import { ITTSProvider } from './tts-provider.interface';
import { pcmToMp3 } from '../utils/audio-converter.util';

export class DeepgramTTSProvider implements ITTSProvider {
  private readonly client: DeepgramClient;
  private readonly model: string;

  constructor(apiKey: string, config: Record<string, any>) {
    this.client = new DeepgramClient({ apiKey });
    this.model = config.model;
    if (!this.model) {
      throw new Error('Deepgram config requires "model" field');
    }
  }

  async generatePreview(text: string): Promise<Buffer> {
    const response = await this.client.speak.v1.audio.generate({
      text,
      model: this.model,
      encoding: 'linear16',
      sample_rate: 24000,
    });

    const stream = await response.stream();
    if (!stream) {
      throw new Error('Deepgram returned no audio stream');
    }

    const reader = stream.getReader();
    try {
      const chunks: Uint8Array[] = [];
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) {
          chunks.push(result.value);
        }
      }

      const pcmBuffer = Buffer.concat(chunks);
      return pcmToMp3(pcmBuffer, 24000, 1);
    } finally {
      reader.releaseLock();
    }
  }
}
