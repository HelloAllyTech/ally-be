export type TokenUser = {
  id: number;
  username: string;
  tenantId: string;
};

export enum AuthProvider {
  EMAIL_OTP = 'email_otp',
  GOOGLE = 'google',
  MAGIC_LINK = 'magic_link',
}

export type GoogleTokenPayload = {
  email: string;
};
