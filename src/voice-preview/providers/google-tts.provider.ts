import * as textToSpeech from '@google-cloud/text-to-speech';
import { ITTSProvider } from './tts-provider.interface';

const GENDER_MAP: Record<string, 'MALE' | 'FEMALE' | 'NEUTRAL'> = {
  male: 'MALE',
  female: 'FEMALE',
  neutral: 'NEUTRAL',
};

export class GoogleTTSProvider implements ITTSProvider {
  private readonly client: textToSpeech.TextToSpeechClient;
  private readonly voiceName?: string;
  private readonly ssmlGender?: 'MALE' | 'FEMALE' | 'NEUTRAL';
  private readonly languageCode: string;
  /**
   * Resolved once here so a credential failure lands on an awaited promise.
   *
   * google-gax creates the gRPC stub lazily in the background; if ADC can't be
   * resolved, that rejection belongs to no promise we hold, and under Node's
   * default unhandled-rejection policy it terminates the API process — one bad
   * voice config took the whole backend down. Holding the initialize() promise
   * (and swallowing it here) keeps the failure attached, and generatePreview
   * re-awaits it so the caller still gets a clean error.
   */
  private readonly ready: Promise<void>;

  constructor(config: Record<string, any>, languageCode: string) {
    this.client = new textToSpeech.TextToSpeechClient();
    this.ready = this.client.initialize().then(
      () => undefined,
      (error: unknown) => {
        throw error instanceof Error ? error : new Error(String(error));
      },
    );
    // Never let the stored promise be "unhandled" while nothing awaits it.
    this.ready.catch(() => undefined);
    this.voiceName = config.voice_name ?? config.voiceName;
    this.languageCode = languageCode ?? 'en-US';

    const genderInput = config.gender?.toLowerCase();
    this.ssmlGender = genderInput ? GENDER_MAP[genderInput] : undefined;
  }

  async generatePreview(text: string): Promise<Buffer> {
    await this.ready;

    const [response] = await this.client.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: this.languageCode,
        ...(this.voiceName && { name: this.voiceName }),
        ...(this.ssmlGender && { ssmlGender: this.ssmlGender }),
      },
      audioConfig: {
        audioEncoding: 'MP3',
        sampleRateHertz: 24000,
      },
    });

    if (!response.audioContent) {
      throw new Error('Google TTS returned no audio content');
    }

    return typeof response.audioContent === 'string'
      ? Buffer.from(response.audioContent, 'base64')
      : Buffer.from(response.audioContent);
  }
}
