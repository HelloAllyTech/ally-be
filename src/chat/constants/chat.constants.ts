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

// Why a live recording's stream was finalized. A clean user-initiated stop is
// COMPLETED; the rest mean the socket died before the counselor finished, so
// the audio (and therefore the summary) is almost certainly partial. Stamped on
// chat.metadata.streamEndReason by endChat and read at finalize to flag the
// session as an incomplete recording. endChat's ACTIVE guard means the FIRST
// end wins, so a real stop (COMPLETED) is never overwritten by the socket-close
// disconnect that immediately follows it.
export enum StreamEndReason {
  COMPLETED = 'completed',
  CLIENT_DISCONNECT = 'client-disconnect',
  JANITOR_ORPHAN = 'janitor-orphan',
  SHUTDOWN_DRAIN = 'shutdown-drain',
}

export const ABNORMAL_STREAM_END_REASONS: readonly StreamEndReason[] = [
  StreamEndReason.CLIENT_DISCONNECT,
  StreamEndReason.JANITOR_ORPHAN,
  StreamEndReason.SHUTDOWN_DRAIN,
];

// A chat's summary is produced asynchronously by the AI service; the chat only
// leaves PENDING when a transcribe/summarize result is posted back. If that
// result is lost (worker crash, dropped SQS message, an AI-service error that
// never reports back) the chat would sit on "Processing" forever. The reaper
// marks any chat still PENDING/IN_PROGRESS past this TTL as FAILED.
//
// This TTL MUST exceed the AI worker's worst-case end-to-end budget, otherwise
// the reaper fails chats that are still being processed healthily. The ally-ai
// SQS visibility timeout is 900s (15 min) — a single message can legitimately
// run that long (long recording: download + segmented STT + chunked diarize +
// summary), and during the pre-phase-1 window there is no transcript yet, so a
// premature reap is recorded as a dead failure (no transcript, not retryable).
// Set comfortably above 15 min so the reaper only catches genuinely lost
// results (worker crash, dropped SQS message, an error that never reports
// back), not slow-but-healthy jobs. The transcript is still delivered+stored
// before the summary (two-phase) and the audio is kept until success, so a
// genuine timeout with a transcript present is marked retryable for the
// auto-retry cron / manual retry.
export const CHAT_SUMMARY_TIMEOUT_MINUTES = 20;

// Only recordings created within this window are eligible for the one-time
// reprocess backfill; older stuck chats are left for the reaper to fail since
// their source audio has very likely been aged out of storage.
export const CHAT_REPROCESS_LOOKBACK_DAYS = 60;

// Bounds how many times a single chat may be re-dispatched for transcription
// (e.g. via the Retry action's re-transcribe fallback) so a chat whose audio
// repeatedly fails to transcribe can't be re-queued forever.
export const MAX_STUCK_REPROCESS_ATTEMPTS = 3;

// Marker the reaper writes to metadata.error when it fails a chat purely for
// exceeding the summary TTL. The reprocess backfill matches on this so it can
// recover timeout-failed chats and is safe to run regardless of reaper timing.
export const CHAT_SUMMARY_TIMEOUT_ERROR = 'Summary timed out';

// When transcription succeeds but summary generation fails, the transcript is
// kept and the summary is flagged retryable (metadata.summaryRetryable). The
// cron auto-retries from the stored transcript up to this many times, then
// leaves it FAILED for a manual retry. Manual retries are not bounded here.
export const SUMMARY_RETRY_MAX_ATTEMPTS = 3;

// Only retry summaries for chats created within this window; older transcripts
// are left for a manual retry rather than auto-retried indefinitely.
export const SUMMARY_RETRY_LOOKBACK_DAYS = 30;

// Middle of the 1-5 positivity scale. Tags are stored with this the moment the
// counsellor types them, then re-rated in the background — so a slow or dead AI
// service delays the colour of a chip, never the save itself.
export const NEUTRAL_TAG_POSITIVITY = 3;

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
