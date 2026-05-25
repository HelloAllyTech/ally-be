export type TokenUser = {
  id: number;
  username: string;
  tenantId: string;
};

export enum AuthProvider {
  EMAIL_OTP = 'email_otp',
  GOOGLE = 'google',
  APPLE = 'apple',
  MAGIC_LINK = 'magic_link',
}

export type GoogleTokenPayload = {
  email: string;
};

export type AppleTokenPayload = {
  email: string;
};
