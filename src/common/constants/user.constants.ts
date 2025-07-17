export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  BLOCKED = 'BLOCKED',
}

export enum UserRole {
  CLIENT = 'CLIENT',
  COUNSELOR = 'COUNSELOR',
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
}

export enum PreferenceName {
  SUMMARY_HIDDEN_FIELDS = 'SUMMARY_HIDDEN_FIELDS',
  NUDGE_STATUS = 'NUDGE_STATUS',
  HIDDEN_CHAT_TYPES = 'HIDDEN_CHAT_TYPES',
}

export enum PreferenceRelatedEntity {
  ORGANIZATION = 'ORGANIZATION',
  COUNSELOR = 'COUNSELOR',
}

// Chat types that can be hidden via preferences
export enum HiddenChatType {
  WEBRTC_CHAT = 'WEBRTC_CHAT',
  MICROPHONE_CHAT = 'MICROPHONE_CHAT',
  EXOTEL_CONFERENCE_CHAT = 'EXOTEL_CONFERENCE_CHAT',
}

export const ANONYMOUS_CLIENT_ID = -1;

export const PLACEHOLDER_CHAT_ID = -99;
