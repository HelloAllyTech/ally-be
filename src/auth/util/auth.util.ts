import { randomInt } from 'crypto';

export class AuthUtil {
  private static readonly OTP_LENGTH = 4;
  private static readonly OTP_MIN = 10 ** (this.OTP_LENGTH - 1);
  private static readonly OTP_MAX_EXCLUSIVE = 10 ** this.OTP_LENGTH;

  /**
   * A login code from the CSPRNG. `Math.random` is not one: its output can be
   * predicted from enough earlier outputs, and those are exactly what a caller
   * who requests codes for their own account gets to see.
   */
  public static generateOtp() {
    return randomInt(this.OTP_MIN, this.OTP_MAX_EXCLUSIVE).toString();
  }
}
