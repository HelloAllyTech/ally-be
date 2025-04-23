export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

export interface Transcription {
  text: string;
  confidence: number;
  words?: TranscriptionWord[];
  isFinal: boolean;
}

export interface DeepgramTranscriptionOptions {
  model?: string;
  smartFormat?: boolean;
  interimResults?: boolean;
  numerals?: boolean;
  punctuate?: boolean;
  channels?: number;
  endpointing?: number;
  utteranceEndMs?: number;
  language?: string;
}
