export type TokenUser = {
  id: number;
  username: string;
  tenantId: string;
};
export enum AuthProvider {
  EMAIL_OTP = 'email_otp',
  GOOGLE = 'google',
}
