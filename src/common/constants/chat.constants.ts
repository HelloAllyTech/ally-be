export enum QueueStatus {
  WAITING = 'WAITING',
  MATCHED = 'MATCHED',
}

/**
 * Suffix for the durability-checkpoint object of an in-progress live recording.
 * Written to `<storageKey><suffix>` (a DIFFERENT key from the final object) so a
 * checkpoint upload can never race with / clobber the final object written on a
 * clean endCallStream. Promoted to the canonical key only during recovery.
 */
export const AUDIO_CHECKPOINT_SUFFIX = '.checkpoint';

export enum CloudTelephonyProvider {
  OZONETEL = 'OZONETEL',
}

export enum AudioChatProvider {
  WEBRTC = 'WEBRTC',
  EXOTEL_CONFERENCE_CALL = 'EXOTEL_CONFERENCE_CALL',
  MICROPHONE = 'MICROPHONE',
  OZONETEL = CloudTelephonyProvider.OZONETEL,
  AUDIO_UPLOAD = 'AUDIO_UPLOAD',
}

export enum AudioChatPlatform {
  WEB = 'WEB',
  MOBILE = 'MOBILE',
}

export enum ScribeSessionMode {
  SCRIBE = 'SCRIBE',
  DICTATION = 'DICTATION',
}

// Chat types that can be hidden via preferences
export enum ChatTypes {
  MICROPHONE_CHAT = 'MICROPHONE_CHAT',
  AUDIO_UPLOAD = 'AUDIO_UPLOAD',
  DICTATION_MODE = 'DICTATION_MODE',
}
