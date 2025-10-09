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

export const SESSION_FIELDS = [
  'sessionSummary',
  'counselingProcessFlow',
  'keyConcerns',
  'subjectiveObservations',
  'objectiveObservations',
  'assessment',
  'dominantFeelings',
  'issuesWorkedOn',
  'keyTherapeuticTechniques',
  'referralsProvided',
  'homework',
  'planForNextCall',
];

export const METRIC_FIELDS = [
  'reflectiveQuestionsAsked',
  'openEndedQuestionsAsked',
  'emotionalLift',
  'listeningShare',
];

export const OTHER_FIELDS = [
  'callId',
  'callDuration',
  'callDate',
  'callTime',
  'clientId',
  'counsellor',
  'callType',
  'tags',
  'callQuality',
  'newCallFollowUp',
];

export const DEMOGRAPHIC_FIELDS = [
  'age',
  'gender',
  'location',
  'profession',
  'relationshipStatus',
  'languages',
  'codeOfConcern',
];

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
