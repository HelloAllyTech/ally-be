import { SarvamAIClient, SarvamAI } from 'sarvamai';
import { ITTSProvider } from './tts-provider.interface';
import { wavToMp3, detectAudioFormat } from '../utils/audio-converter.util';
import { convertLanguageCodeForSarvam } from '../constants/language-code.constants';

export class SarvamTTSProvider implements ITTSProvider {
  private readonly client: SarvamAIClient;
  private readonly model: SarvamAI.TextToSpeechModel;
  private readonly speaker: SarvamAI.TextToSpeechSpeaker;

  constructor(apiKey: string, config: Record<string, any>) {
    this.client = new SarvamAIClient({ apiSubscriptionKey: apiKey });
    this.model = (config.model ?? 'bulbul:v3') as SarvamAI.TextToSpeechModel;
    this.speaker = config.speaker as SarvamAI.TextToSpeechSpeaker;
    if (!this.speaker) {
      throw new Error('Sarvam config requires "speaker" field');
    }
  }

  async generatePreview(text: string, languageCode: string): Promise<Buffer> {
    const rawCode = languageCode ?? 'en-IN';
    const targetLanguageCode = convertLanguageCodeForSarvam(
      rawCode,
    ) as SarvamAI.TextToSpeechLanguage;
    const response = await this.client.textToSpeech.convert({
      text,
      model: this.model,
      speaker: this.speaker,
      target_language_code: targetLanguageCode,
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
      return await wavToMp3(audioBuffer);
    }

    throw new Error(`Unsupported audio format returned by Sarvam: ${format}`);
  }
}
