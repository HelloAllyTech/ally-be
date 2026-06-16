export enum AppVersionSettingsEnum {
  ios = 'APP_MIN_SUPPORTED_VERSION_IOS',
  android = 'APP_MIN_SUPPORTED_VERSION_ANDROID',
}

/**
 * Keys for platform-wide legal/consent content stored in `global_settings`
 * with a `{ html: string }` value. Edited by admins via /v1/settings and
 * served (read-only) to the clients that render the legal pages / consent popup.
 */
export enum LegalContentKey {
  TERMS = 'LEGAL_TERMS',
  PRIVACY = 'LEGAL_PRIVACY_POLICY',
  TERMS_AND_AGREEMENT = 'LEGAL_TERMS_AND_AGREEMENT',
}
