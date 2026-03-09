export interface CachedAuthAttempt {
  email: string;
  otpHash: string;
  magicTokenHash: string;
  expiresAt: string;
}
