export enum QueueStatus {
  WAITING = 'WAITING',
  MATCHED = 'MATCHED',
}

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
