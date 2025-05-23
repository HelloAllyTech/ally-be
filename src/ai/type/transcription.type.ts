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

export type DeepgramTranscriptResult = {
  type: 'Results';
  channel_index: number[];
  duration: number;
  start: number;
  is_final: boolean;
  speech_final: boolean;
  channel: {
    alternatives: {
      transcript: string;
      confidence: number;
      languages?: string[];
      words: {
        word: string;
        start: number;
        end: number;
        confidence: number;
        punctuated_word: string;
        language?: string;
      }[];
    }[];
  };
  metadata: {
    request_id: string;
    model_info: {
      name: string;
      version: string;
      arch: string;
    };
    model_uuid: string;
  };
  from_finalize?: boolean;
};

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
