import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export enum TTSProviderEnum {
  DEEPGRAM = 'DEEPGRAM',
  ELEVENLABS = 'ELEVENLABS',
  SARVAM = 'SARVAM',
  GOOGLE = 'GOOGLE',
  HUME = 'HUME',
}

export class PreviewRequestDto {
  @IsUUID()
  voiceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  text?: string;
}
