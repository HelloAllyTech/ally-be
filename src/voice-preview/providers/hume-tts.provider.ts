import { HumeClient, Hume } from 'hume';
import { ITTSProvider } from './tts-provider.interface';
import { detectAudioFormat, wavToMp3 } from '../utils/audio-converter.util';

export class HumeTTSProvider implements ITTSProvider {
  private readonly client: HumeClient;
  private readonly voiceName: string;
  private readonly voiceProvider: Hume.tts.VoiceProvider;

  constructor(apiKey: string, config: Record<string, any>) {
    this.client = new HumeClient({ apiKey });
    this.voiceName = config.name || config.voiceName || config.voice_name;
    this.voiceProvider = (config.voice_provider ??
      config.voiceProvider ??
      'HUME_AI') as Hume.tts.VoiceProvider;
    if (!this.voiceName) {
      throw new Error('Hume config requires "voice_name" or "voiceName" field');
    }
  }

  async generatePreview(text: string): Promise<Buffer> {
    const result = await this.client.tts.synthesizeJson(
      {
        utterances: [
          {
            text,
            voice: {
              name: this.voiceName,
              provider: this.voiceProvider,
            },
          },
        ],
      },
      { timeoutInSeconds: 30 },
    );

    const generation = result.generations?.[0];
    if (!generation?.audio) {
      throw new Error('Hume returned no audio data');
    }

    const audioBuffer = Buffer.from(generation.audio, 'base64');
    const format = detectAudioFormat(audioBuffer);

    if (format === 'mp3') {
      return audioBuffer;
    }

    if (format === 'wav') {
      return wavToMp3(audioBuffer);
    }

    throw new Error(`Unsupported audio format returned by Hume: ${format}`);
  }
}
