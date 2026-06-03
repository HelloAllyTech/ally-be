export enum ChatEvents {
  SEND_MESSAGE = 'SEND_MESSAGE',
  MESSAGE_RECEIVED = 'MESSAGE_RECEIVED',
  USER_TYPING = 'USER_TYPING',
  USER_STOPPED_TYPING = 'USER_STOPPED_TYPING',
  CHAT_ACCEPTED = 'CHAT_ACCEPTED',
  ERROR = 'ERROR',
  PING = 'PING',
  PONG = 'PONG',
  TRANSCRIPTION_COMPLETE = 'TRANSCRIPTION_COMPLETE',
  NUDGE = 'NUDGE',
  STAGE = 'STAGE',
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  TRANSCRIPTION = 'TRANSCRIPTION',
  TYPING = 'TYPING',
  ICE_CANDIDATE = 'webrtc-ice-candidate',
  WEBRTC_OFFER = 'webrtc-offer',
  WEBRTC_ANSWER = 'webrtc-answer',
  CHAT_ENDED = 'CHAT_ENDED',
  START_AUDIO_CHAT = 'START_AUDIO_CHAT',
  AUDIO_CHAT_ENDED = 'AUDIO_CHAT_ENDED',
  AUDIO_MESSAGE = 'AUDIO_MESSAGE',
  AUDIO_CHAT_MUTED = 'AUDIO_CHAT_MUTED',
  UTTERANCE_ENDED = 'UTTERANCE_ENDED',
  USER_DISCONNECTED = 'USER_DISCONNECTED',
  USER_CONNECTED = 'USER_CONNECTED',
  USER_JOINED = 'USER_JOINED',
  CALL_STARTED = 'CALL_STARTED',
  AUDIO_STREAM = 'AUDIO_STREAM',
  AUDIO_CHAT_PAUSED = 'AUDIO_CHAT_PAUSED',
  AUDIO_CHAT_RESUMED = 'AUDIO_CHAT_RESUMED',
  SESSION_CREATED = 'SESSION_CREATED',
}

// A chat's summary is produced asynchronously by the AI service; the chat only
// leaves PENDING when a transcribe/summarize result is posted back. If that
// result is lost (worker crash, dropped SQS message, an AI-service error that
// never reports back) the chat would sit on "Processing" forever. The reaper
// marks any chat still PENDING/IN_PROGRESS past this TTL as FAILED.
export const CHAT_SUMMARY_TIMEOUT_MINUTES = 30;

// Only recordings created within this window are eligible for the one-time
// reprocess backfill; older stuck chats are left for the reaper to fail since
// their source audio has very likely been aged out of storage.
export const CHAT_REPROCESS_LOOKBACK_DAYS = 60;

// Marker the reaper writes to metadata.error when it fails a chat purely for
// exceeding the summary TTL. The reprocess backfill matches on this so it can
// recover timeout-failed chats and is safe to run regardless of reaper timing.
export const CHAT_SUMMARY_TIMEOUT_ERROR = 'Summary timed out';

export const LANGUAGE_MAP = {
  bn: 'Bengali',
  pa: 'Gurmukhi',
  gu: 'Gujarati',
  or: 'Oriya',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  ml: 'Malayalam',
  en: 'English',
};

export const UPLOADED_AUDIO_FILE_SIZE_LIMIT = 800 * 1024 * 1024; // 800 MB

export const SUPPORTED_AUDIO_FILE_TYPES = [
  // MP3
  'audio/mpeg',
  'audio/mp3',
  'audio/x-mp3',

  // WAV
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/x-wave',
  'audio/vnd.wave',

  // m4a
  'audio/m4a',
  'audio/x-m4a',
  'audio/m4a',
  'audio/mp4a-latm',
];
