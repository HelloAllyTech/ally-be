import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export enum TTSProviderEnum {
  DEEPGRAM = 'deepgram',
  ELEVENLABS = 'elevenlabs',
  SARVAM = 'sarvam',
  GOOGLE = 'google',
  HUME = 'hume',
}

export class PreviewRequestDto {
  @IsUUID()
  voiceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  text?: string;
}
