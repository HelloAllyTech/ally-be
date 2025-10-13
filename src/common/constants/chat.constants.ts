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

// Chat types that can be hidden via preferences
export enum ChatTypes {
  WEBRTC_CHAT = 'WEBRTC_CHAT',
  MICROPHONE_CHAT = 'MICROPHONE_CHAT',
  EXOTEL_CONFERENCE_CHAT = 'EXOTEL_CONFERENCE_CHAT',
}
