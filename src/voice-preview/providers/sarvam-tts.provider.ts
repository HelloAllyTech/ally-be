import { SarvamAIClient, SarvamAI } from 'sarvamai';
import { ITTSProvider } from './tts-provider.interface';
import { wavToMp3, detectAudioFormat } from '../utils/audio-converter.util';

export class SarvamTTSProvider implements ITTSProvider {
  private readonly client: SarvamAIClient;
  private readonly model: SarvamAI.TextToSpeechModel;
  private readonly speaker: SarvamAI.TextToSpeechSpeaker;
  private readonly targetLanguageCode: SarvamAI.TextToSpeechLanguage;

  constructor(
    apiKey: string,
    config: Record<string, any>,
    languageCode: string,
  ) {
    this.client = new SarvamAIClient({ apiSubscriptionKey: apiKey });
    this.model = (config.model ?? 'bulbul:v3') as SarvamAI.TextToSpeechModel;
    this.speaker = config.speaker as SarvamAI.TextToSpeechSpeaker;
    this.targetLanguageCode = (config.target_language_code ??
      languageCode ??
      'en-IN') as SarvamAI.TextToSpeechLanguage;
    if (!this.speaker) {
      throw new Error('Sarvam config requires "speaker" field');
    }
  }

  async generatePreview(text: string): Promise<Buffer> {
    const response = await this.client.textToSpeech.convert({
      text,
      model: this.model,
      speaker: this.speaker,
      target_language_code: this.targetLanguageCode,
    });

    const { audios } = response;
    if (!audios || !audios[0]) {
      throw new Error('Sarvam returned no audio data');
    }

    const audioBuffer = Buffer.from(audios[0], 'base64');
    const format = detectAudioFormat(audioBuffer);
    if (format === 'mp3') {
      return audioBuffer;
    }

    if (format === 'wav') {
      return wavToMp3(audioBuffer);
    }

    throw new Error(`Unsupported audio format returned by Sarvam: ${format}`);
  }
}
